#!/usr/bin/env python3
"""
Full lesson-video pipeline — one script, three stages.

    rawvideos/
        │  Stage 1: mirror (optional) + CFR + silence removal
        ▼
    no_silence/
        │  Stage 2: background removal (Modal / BiRefNet)
        ▼
    no_silence_bg_removed/
        │  Stage 3: overlays, effects, audio, concatenation
        ▼
    output/social/<name>.mp4   very high quality (social upload)
    output/web/<name>.mp4      web-optimized (faststart, 720p-class, ~1.5 Mbps)

Every final video is written to BOTH folders with the SAME filename. The social
file is the master (rendered once by MoviePy); the web file is a single cheap
ffmpeg transcode of it, so the composited clip is never rendered twice.

Web profile (fixes the web playback stall):
  - moov atom first           ->  -movflags +faststart
  - long edge <= 1280 px      ->  1080x1920 becomes 720x1280
  - H.264 main / yuv420p      ->  plays on iOS, Android, every browser
  - CRF 26 + 1.5 Mbps ceiling ->  ~1-1.5 Mbps instead of ~8 Mbps
  - AAC 128 kbps

Social profile: native resolution, H.264 high profile, CRF 18, preset slow,
AAC 256 kbps, faststart.

Requires: moviepy 2.x, html2image, pandas, opencv-python, pydub, modal,
ffmpeg + ffprobe on PATH.

Usage:
    python video_pipeline.py                 # full pipeline
    python video_pipeline.py --skip-background
    python video_pipeline.py --render-only   # Stage 3 only (outputs already exist)
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import cv2  # faster per-frame zoom resizing than PIL/LANCZOS
import modal
import numpy as np
import pandas as pd
from html2image import Html2Image
from moviepy import (
    VideoFileClip,
    ImageClip,
    CompositeVideoClip,
    AudioFileClip,
    CompositeAudioClip,
    AudioClip,
    concatenate_audioclips,
    concatenate_videoclips,
    vfx,
)
from PIL import Image
from pydub import AudioSegment
from pydub.silence import detect_nonsilent

from pipeline_lib import (
    chrome_flags,
    missing_required_fonts,
    resolve_web_profile,
    resolve_work_dir,
    select_rows,
)

# =============================================================================
# Configuration
# =============================================================================

# Everything is rooted at PIPELINE_WORKDIR when set (the Modal container), else
# the current working directory (the local Windows flow keeps working).
WORK_DIR = resolve_work_dir(os.environ)
VIDEO_DIRECTORY = str(WORK_DIR / 'no_silence_bg_removed')
NO_SILENCE_DIRECTORY = str(WORK_DIR / 'no_silence')
AUDIO_DIRECTORY = str(WORK_DIR / 'audio')
FONT_DIRECTORY = str(WORK_DIR / 'fonts')
BACKGROUNDS_DIRECTORY = str(WORK_DIR / 'backgrounds')
RAWVIDEOS_DIRECTORY = str(WORK_DIR / 'rawvideos')
OVERLAYS_DIRECTORY = str(WORK_DIR / 'overlays')
OVERLAYS_TEMP_DIRECTORY = str(WORK_DIR / 'overlays_temp')
CSV_FILE = str(WORK_DIR / 'video_data.csv')

VIDEO_EXTENSION = '_no_silence_bg_removed.mp4'
AUDIO_EXTENSION = '.mp3'

TITLE_FONT = 'Atkinson Hyperlegible Next'
SUBTITLE_FONT = 'Atkinson Hyperlegible Next'
FOOTER_FONT = 'Atkinson Hyperlegible Next'
FONT_FILE_VARIABLE = 'AtkinsonHyperlegibleNext-VariableFont_wght.ttf'
FONT_FILE_ITALIC = 'AtkinsonHyperlegibleNext-Italic-VariableFont_wght.ttf'
MARKER_FONT_NAME = 'MarkerFont'
FONT_FILE_MARKER = 'Kalam-Bold.ttf'

# ---- Intermediates (Stage 1/2): high quality so the social master stays clean
MASTER_CRF = "16"
MASTER_PRESET = "fast"
MASTER_PIX_FMT = "yuv420p"
MASTER_FASTSTART = ["-movflags", "+faststart"]

# ---- Social / master profile (Stage 3) --------------------------------------
SOCIAL_CRF = 18
SOCIAL_PRESET = "slow"
SOCIAL_AUDIO_BITRATE = "256k"

# ---- Web profile (Stage 3) --------------------------------------------------
# The container sets PIPELINE_WEB_TARGET_LONG_EDGE=720 / ..._AUDIO_BITRATE=96k to
# hit the 032 web budget without changing the PC default.
WEB_TARGET_LONG_EDGE, WEB_AUDIO_BITRATE = resolve_web_profile(os.environ)
WEB_CRF = 26
WEB_PRESET = "medium"
WEB_MAXRATE = "1.5M"
WEB_BUFSIZE = "3M"

OUTPUT_ROOT = WORK_DIR / "output"
SOCIAL_DIR = OUTPUT_ROOT / "social"
WEB_DIR = OUTPUT_ROOT / "web"

# =============================================================================
# Output profiles / directory setup
# =============================================================================

def ensure_dirs() -> None:
    """Create every directory the pipeline reads or writes."""
    for directory in (
        OVERLAYS_DIRECTORY,
        OVERLAYS_TEMP_DIRECTORY,
        VIDEO_DIRECTORY,
        NO_SILENCE_DIRECTORY,
        AUDIO_DIRECTORY,
        FONT_DIRECTORY,
        RAWVIDEOS_DIRECTORY,
        BACKGROUNDS_DIRECTORY,
    ):
        Path(directory).mkdir(parents=True, exist_ok=True)
    SOCIAL_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DIR.mkdir(parents=True, exist_ok=True)


def social_path(name: str) -> str:
    return str(SOCIAL_DIR / name)


def web_path(name: str) -> str:
    return str(WEB_DIR / name)


def social_write_kwargs(fps=None) -> dict:
    """Keyword args for MoviePy's write_videofile() producing the master."""
    kwargs = dict(
        codec="libx264",
        audio_codec="aac",
        audio_bitrate=SOCIAL_AUDIO_BITRATE,
        preset=SOCIAL_PRESET,
        pixel_format="yuv420p",  # already emits -pix_fmt; don't duplicate below
        threads=4,
        ffmpeg_params=[
            "-crf", str(SOCIAL_CRF),
            "-profile:v", "high",
            "-movflags", "+faststart",
        ],
        logger="bar",
    )
    if fps:
        kwargs["fps"] = fps
    return kwargs


def _probe_size(path: str):
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", path,
        ],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    width, height = out.split("x")
    return int(width), int(height)


def _even(value: float) -> int:
    return max(2, int(round(value / 2.0)) * 2)


def write_web_from_master(
    master_file: str,
    web_file: str,
    target_long_edge: int = WEB_TARGET_LONG_EDGE,
) -> str:
    """Transcode the social master into the web profile (single ffmpeg pass)."""
    width, height = _probe_size(master_file)
    scale_args = []
    if max(width, height) > target_long_edge:
        factor = target_long_edge / float(max(width, height))
        scale_args = [
            "-vf",
            f"scale={_even(width * factor)}:{_even(height * factor)}:flags=lanczos",
        ]

    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", master_file,
        *scale_args,
        "-c:v", "libx264",
        "-preset", WEB_PRESET,
        "-crf", str(WEB_CRF),
        "-maxrate", WEB_MAXRATE,
        "-bufsize", WEB_BUFSIZE,
        "-profile:v", "main",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", WEB_AUDIO_BITRATE,
        "-movflags", "+faststart",
        web_file,
    ]
    subprocess.run(cmd, capture_output=True, text=True, check=True)
    return web_file


def render_profiles(clip, name: str, fps=None) -> tuple:
    """Render `clip` once to output/social/<name> and derive output/web/<name>."""
    ensure_dirs()
    master = social_path(name)
    web = web_path(name)
    clip.write_videofile(master, **social_write_kwargs(fps=fps))
    write_web_from_master(master, web)
    return master, web


def duck_master(master_file: str, bg_music_path: str,
                main_volume: float = 1.9, music_volume: float = 0.06) -> str:
    """Mix background music into the master IN PLACE.

    Video is stream-copied (no re-encode); only audio is re-encoded, and
    +faststart is preserved. Returns the master path.
    """
    tmp = master_file + ".ducked.mp4"
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", master_file, "-i", bg_music_path,
        "-filter_complex",
        f"[0:a]volume={main_volume}[main];"
        f"[1:a]volume={music_volume}[music];"
        "[main][music]amix=inputs=2:duration=first:dropout_transition=0[mixed]",
        "-map", "0:v", "-map", "[mixed]",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        tmp,
    ]
    subprocess.run(cmd, capture_output=True, text=True, check=True)
    Path(tmp).replace(master_file)
    return master_file


def setup_environment() -> bool:
    """Create dirs and sanity-check dependencies + fonts."""
    print("🔧 Setting up environment...")
    ensure_dirs()

    try:
        import moviepy, html2image, pandas  # noqa: F401
        print("✅ All dependencies found")
    except ImportError as e:
        print(f"❌ Missing dependency: {e}")
        print("Please run: pip install moviepy html2image pandas opencv-python pydub modal")
        return False

    # Required fonts must be present before Stage 3 renders overlays; a missing
    # font silently degrades the composited text. Fail the run rather than
    # printing a warning nobody sees in a Modal container's logs.
    missing_fonts = missing_required_fonts(FONT_DIRECTORY)
    if missing_fonts:
        print(f"❌ Missing required font file(s): {', '.join(missing_fonts)}")
        print(f"💡 Add them to the '{FONT_DIRECTORY}' folder (or R2 pipeline-assets/fonts/)")
        return False
    print(f"✅ Required font files present in '{FONT_DIRECTORY}'")

    return True

# =============================================================================
# Shared helpers
# =============================================================================

def format_time_ms(ms):
    minutes = int(ms // 60000)
    seconds = int((ms % 60000) // 1000)
    milliseconds = int(ms % 1000)
    return f"{minutes:02d}:{seconds:02d}.{milliseconds:03d}"


def format_time_ms_detailed(ms):
    hours = int(ms // 3600000)
    minutes = int((ms % 3600000) // 60000)
    seconds = int((ms % 60000) // 1000)
    milliseconds = int(ms % 1000)
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{milliseconds:03d}"
    return f"{minutes:02d}:{seconds:02d}.{milliseconds:03d}"


def natural_sort_key(filename):
    name_without_ext = os.path.splitext(filename)[0]

    def convert(text):
        return int(text) if text.isdigit() else text.lower()

    return [convert(c) for c in re.split('([0-9]+)', name_without_ext)]


def safe_get_value(row, column_name, default=''):
    try:
        if column_name in row:
            value = row[column_name]
            if pd.isna(value):
                return default
            if column_name == 'filename':
                return str(value) if not isinstance(value, (int, float)) else f"{int(value):02d}"
            return str(value).strip()
        return default
    except Exception:
        return default


def resolve_csv_file() -> str | None:
    """Prefer video_data.csv; otherwise the first *.csv in the work dir."""
    if os.path.exists(CSV_FILE):
        return CSV_FILE
    csvs = [f for f in os.listdir(WORK_DIR) if f.endswith('.csv')]
    if not csvs:
        return None
    if len(csvs) > 1:
        print(f"WARNING: Multiple CSV files found, using: {csvs[0]}")
    return str(WORK_DIR / csvs[0])


def create_sample_csv():
    data = {
        'filename': ['video_01'],
        'phrase': ['Hello and welcome.'],
        'background': [''],
        'mirror': [''],
        'join': [''],
        'title_text': ['Marker Demo'],
        'subtitle_text': ['Standard text and <mark>whiteboard marker text</mark> mixed.'],
        'footer_text': ['Footer text'],
        'effect': ['Punchin'],
        'dutch_tilt': [''],
        'bgSound': [''],
        'bgMusic': [''],
        'overlay': [''],
        'foreground': [''],
        'endSoundEffect': [''],
        'srt': [''],
    }
    pd.DataFrame(data).to_csv(CSV_FILE, index=False)


def load_background_mapping(csv_path):
    """filename -> background, and filename -> mirror bool. Missing columns are OK."""
    mapping = {}
    mirror_mapping = {}
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            filename = (row.get('filename') or '').strip()
            if not filename:
                continue
            mapping[filename] = (row.get('background') or '').strip()
            mirror_mapping[filename] = (row.get('mirror') or '').strip().lower() == 'mirror'
    return mapping, mirror_mapping

# =============================================================================
# Stage 1 — silence removal (CFR + optional mirror)
# =============================================================================

def extract_audio_from_video(video_path, audio_output_path):
    cmd = [
        'ffmpeg', '-i', video_path, '-vn', '-acodec', 'pcm_s16le',
        '-ar', '44100', '-ac', '2', '-y', audio_output_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def preprocess_to_cfr(video_path, output_path, target_fps=30):
    """Enforce Constant Frame Rate (CFR) using FFmpeg before silence removal."""
    print(f"Pre-processing to enforce CFR ({target_fps} fps): {os.path.basename(video_path)}")
    cmd = [
        'ffmpeg', '-i', video_path,
        '-r', str(target_fps),
        '-c:v', 'libx264',
        '-preset', MASTER_PRESET,
        '-crf', MASTER_CRF,
        '-pix_fmt', MASTER_PIX_FMT,
        '-c:a', 'copy',
        *MASTER_FASTSTART,
        '-y', output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"FFmpeg CFR pre-processing error: {result.stderr}")
        raise Exception("Failed to enforce CFR on video")
    print(f"✓ Successfully enforced CFR to: {output_path}")
    return output_path


def mirror_video(video_path, output_path, target_fps=30):
    """Flip video horizontally and enforce CFR."""
    print(f"Mirroring video and setting CFR to {target_fps} fps: {os.path.basename(video_path)}")
    cmd = [
        'ffmpeg', '-i', video_path,
        '-r', str(target_fps),
        '-vf', 'hflip',
        '-c:v', 'libx264',
        '-preset', MASTER_PRESET,
        '-crf', MASTER_CRF,
        '-pix_fmt', MASTER_PIX_FMT,
        '-c:a', 'copy',
        *MASTER_FASTSTART,
        '-y', output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"FFmpeg mirroring error: {result.stderr}")
        raise Exception("Failed to mirror video")
    print(f"✓ Successfully mirrored video to: {output_path}")
    return output_path


def detect_speech_segments(audio_path, silence_thresh=-50, min_silence_len=2000, min_speech_len=500):
    """Detect speech segments (inverse of silence detection)."""
    audio = AudioSegment.from_wav(audio_path)
    speech_segments = detect_nonsilent(
        audio, min_silence_len=min_silence_len,
        silence_thresh=silence_thresh, seek_step=100,
    )
    filtered_speech_segments = []
    for start, end in speech_segments:
        duration = end - start
        if duration >= min_speech_len:
            filtered_speech_segments.append((start, end))
        else:
            print(f"  Ignoring brief speech at {format_time_ms(start)} (duration: {format_time_ms(duration)})")

    print(f"\nDetected {len(filtered_speech_segments)} speech segments:")
    print(f"{'Start':>12}  {'End':>12}  {'Duration':>12}")
    total_speech_duration = 0
    for s, e in filtered_speech_segments:
        duration = e - s
        total_speech_duration += duration
        print(f"{format_time_ms(s):>12}  {format_time_ms(e):>12}  {format_time_ms(duration):>12}")
    print(f"Total speech duration: {format_time_ms(total_speech_duration)}")
    return filtered_speech_segments, len(audio)


def create_single_video_without_silence_filter(video_path, speech_segments, total_duration,
                                               output_path, margin=100, end_margin=500):
    """Create the silence-free video with filter_complex (best A/V sync)."""
    if not speech_segments:
        print("No speech segments to process")
        return False

    print("\nCreating video without silence using filter_complex...")
    filter_parts = []
    inputs = []
    for i, (start, end) in enumerate(speech_segments):
        clip_start = max(0, start - margin) / 1000.0
        clip_end = min(total_duration, end + end_margin) / 1000.0
        filter_parts.append(f"[0:v]trim=start={clip_start}:end={clip_end},setpts=PTS-STARTPTS[v{i}];")
        filter_parts.append(f"[0:a]atrim=start={clip_start}:end={clip_end},asetpts=PTS-STARTPTS[a{i}];")
        inputs.append(f"[v{i}][a{i}]")
    filter_parts.append(f"{''.join(inputs)}concat=n={len(speech_segments)}:v=1:a=1[outv][outa]")

    cmd = [
        'ffmpeg', '-i', video_path,
        '-filter_complex', ''.join(filter_parts),
        '-map', '[outv]', '-map', '[outa]',
        '-c:v', 'libx264', '-c:a', 'aac',
        '-preset', MASTER_PRESET, '-crf', MASTER_CRF, '-pix_fmt', MASTER_PIX_FMT,
        '-movflags', '+faststart',
        '-y', output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"FFmpeg filter_complex error: {result.stderr}")
        print("Falling back to segment method...")
        return create_single_video_without_silence_segments(
            video_path, speech_segments, total_duration, output_path, margin, end_margin)
    print(f"✓ Successfully created {output_path}")
    return True


def create_single_video_without_silence_segments(video_path, speech_segments, total_duration,
                                                 output_path, margin=100, end_margin=500):
    """Fallback: encode each segment then concat."""
    with tempfile.TemporaryDirectory() as temp_dir:
        segment_files = []
        for i, (start, end) in enumerate(speech_segments):
            clip_start = max(0, start - margin)
            clip_end = min(total_duration, end + end_margin)
            segment_file = os.path.join(temp_dir, f"segment_{i:04d}.mp4")
            segment_files.append(segment_file)
            cmd = [
                'ffmpeg',
                '-ss', str(clip_start / 1000.0),
                '-i', video_path,
                '-t', str((clip_end - clip_start) / 1000.0),
                '-c:v', 'libx264', '-c:a', 'aac',
                '-preset', MASTER_PRESET, '-crf', MASTER_CRF, '-pix_fmt', MASTER_PIX_FMT,
                '-avoid_negative_ts', 'make_zero',
                '-y', segment_file,
            ]
            if subprocess.run(cmd, capture_output=True, text=True).returncode != 0:
                print(f"  FFmpeg error for segment {i+1}")
                return False

        concat_file = os.path.join(temp_dir, "concat_list.txt")
        with open(concat_file, 'w') as f:
            for segment_file in segment_files:
                f.write(f"file '{segment_file}'\n")

        cmd = [
            'ffmpeg', '-f', 'concat', '-safe', '0', '-i', concat_file,
            '-c:v', 'libx264', '-c:a', 'aac',
            '-preset', MASTER_PRESET, '-crf', MASTER_CRF, '-pix_fmt', MASTER_PIX_FMT,
            '-movflags', '+faststart', '-y', output_path,
        ]
        if subprocess.run(cmd, capture_output=True, text=True).returncode != 0:
            raise Exception("Failed to concatenate video segments")
        print(f"✓ Successfully created {output_path}")
        return True


def check_audio_sync(video_path):
    result = subprocess.run(['ffmpeg', '-i', video_path, '-f', 'null', '-'], capture_output=True, text=True)
    return not ("timestamp" in result.stderr.lower() or "sync" in result.stderr.lower())


def run_silence_removal(args, background_mapping, mirror_mapping, only=None):
    print(f"{'='*60}\nSTAGE 1: SILENCE REMOVAL\n{'='*60}")

    rawvideos_dir = RAWVIDEOS_DIRECTORY
    allowed = None if only is None else set(only)
    files_to_process = [
        f"{filename}.mp4" for filename in background_mapping.keys()
        if allowed is None or filename in allowed
    ]
    mp4_files = [f for f in files_to_process if os.path.exists(os.path.join(rawvideos_dir, f))]

    if not mp4_files:
        print(f"No MP4 files found matching CSV entries in '{RAWVIDEOS_DIRECTORY}' folder")
        return

    print(f"\nFound {len(mp4_files)} MP4 file(s) to process")

    for input_file in mp4_files:
        print(f"\n{'='*60}\nProcessing: {input_file}\n{'='*60}")
        name, ext = os.path.splitext(input_file)
        output_path = os.path.join(NO_SILENCE_DIRECTORY, f"{name}_{args.output_suffix}{ext}")
        if os.path.exists(output_path):
            print(f"Output file already exists, skipping...")
            continue

        source_file_path = os.path.join(rawvideos_dir, input_file)
        input_file_path = source_file_path
        temp_file_created = False
        original_name = input_file.replace('.mp4', '')
        should_mirror = mirror_mapping.get(original_name, False)

        if should_mirror:
            with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as temp_mirrored:
                mirrored_path = temp_mirrored.name
            try:
                input_file_path = mirror_video(source_file_path, mirrored_path, target_fps=args.cfr_fps)
                temp_file_created = True
            except Exception as e:
                print(f"✗ Failed to mirror video: {e}")
                continue
        else:
            with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as temp_cfr:
                cfr_path = temp_cfr.name
            try:
                input_file_path = preprocess_to_cfr(source_file_path, cfr_path, target_fps=args.cfr_fps)
                temp_file_created = True
            except Exception as e:
                print(f"✗ Failed to enforce CFR: {e}")
                continue

        with tempfile.TemporaryDirectory() as temp_dir:
            audio_temp_path = os.path.join(temp_dir, 'temp_audio.wav')
            try:
                extract_audio_from_video(input_file_path, audio_temp_path)
                speech_segments, total_duration = detect_speech_segments(
                    audio_temp_path,
                    silence_thresh=args.silence_threshold,
                    min_silence_len=args.min_silence,
                    min_speech_len=args.min_speech,
                )
                if not speech_segments:
                    print("No speech segments detected. Skipping file.")
                    continue

                success = create_single_video_without_silence_filter(
                    input_file_path, speech_segments, total_duration, output_path,
                    args.start_margin, args.end_margin,
                )
                if success:
                    if not check_audio_sync(output_path):
                        print(f"⚠ Possible sync issues detected in {output_path}")
                    speech_duration = sum(end - start for start, end in speech_segments)
                    reduction = ((total_duration - speech_duration) / total_duration) * 100
                    print(f"\n✓ Processing completed for {input_file}! Reduction: {reduction:.1f}%")
                else:
                    print(f"✗ Failed to create output video for {input_file}")
            except Exception as e:
                print(f"Error processing {input_file}: {e}")
            finally:
                if temp_file_created and os.path.exists(input_file_path):
                    os.unlink(input_file_path)

# =============================================================================
# Stage 2 — background removal (Modal)
# =============================================================================

app = modal.App("uff-lesson-video")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch", "torchvision", "transformers", "pillow", "numpy",
        "moviepy", "pydub", "gradio", "einops", "kornia", "timm",
        "opencv-python",
    )
    .apt_install("ffmpeg")
)


@app.function(image=image, gpu="T4", timeout=3600)
def process_video_background_modal(input_video_bytes, background_bytes, is_video_bg,
                                   fps=0, fast_mode=True, max_workers=10):
    from transformers import AutoModelForImageSegmentation
    import torch
    from torchvision import transforms
    from moviepy import VideoFileClip, vfx, ImageSequenceClip
    from concurrent.futures import ThreadPoolExecutor

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if fast_mode:
        model = AutoModelForImageSegmentation.from_pretrained("ZhengPeng7/BiRefNet_lite", trust_remote_code=True)
    else:
        model = AutoModelForImageSegmentation.from_pretrained("ZhengPeng7/BiRefNet", trust_remote_code=True)
    model.to(device)

    transform_image = transforms.Compose([
        transforms.Resize((768, 768)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])

    def process_frame_with_bg(frame, bg_image, model, device):
        import torch.nn.functional as F

        original_h, original_w = frame.shape[:2]
        pil_image = Image.fromarray(frame)
        image_size = pil_image.size
        input_images = transform_image(pil_image).unsqueeze(0).to(device)

        with torch.no_grad():
            preds = model(input_images)[-1].sigmoid().cpu()

        preds = F.interpolate(preds, size=(original_h, original_w), mode='bilinear', align_corners=False)
        pred = preds[0].squeeze().numpy()

        high_conf_mask = (pred > 0.80).astype(np.uint8)
        low_conf_mask = (pred > 0.15).astype(np.uint8)

        contours, _ = cv2.findContours(low_conf_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        final_mask = np.zeros_like(low_conf_mask)
        for contour in contours:
            blob_mask = np.zeros_like(low_conf_mask)
            cv2.drawContours(blob_mask, [contour], -1, 1, thickness=cv2.FILLED)
            if np.logical_and(blob_mask, high_conf_mask).any():
                final_mask = cv2.bitwise_or(final_mask, blob_mask)

        final_mask_tensor = torch.from_numpy(final_mask.astype(np.float32))
        final_mask_tensor = final_mask_tensor.unsqueeze(0).unsqueeze(0)
        final_mask_tensor = F.max_pool2d(final_mask_tensor, kernel_size=5, stride=1, padding=2)
        final_mask_tensor = final_mask_tensor.squeeze()

        pred_pil = transforms.ToPILImage()(final_mask_tensor)
        mask = pred_pil.resize(image_size)

        background = bg_image.convert("RGBA").resize(image_size)
        return np.array(Image.composite(pil_image, background, mask))

    tmp_video_path = tmp_bg_path = output_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_video:
            tmp_video.write(input_video_bytes)
            tmp_video_path = tmp_video.name

        suffix = ".mp4" if is_video_bg else ".jpg"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_bg:
            tmp_bg.write(background_bytes)
            tmp_bg_path = tmp_bg.name

        video = VideoFileClip(tmp_video_path)
        if fps == 0:
            fps = video.fps
        audio = video.audio
        frames = list(video.iter_frames(fps=fps))

        if is_video_bg:
            background_video = VideoFileClip(tmp_bg_path)
            if background_video.duration < video.duration:
                background_video = background_video.fx(vfx.speedx, factor=video.duration / background_video.duration)
            background_frames = list(background_video.iter_frames(fps=fps))
        else:
            bg_image = Image.open(tmp_bg_path)
            background_frames = [np.array(bg_image)] * len(frames)

        processed_frames = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = []
            for i in range(len(frames)):
                bg_frame = background_frames[min(i, len(background_frames) - 1)]
                futures.append(executor.submit(process_frame_with_bg, frames[i], Image.fromarray(bg_frame), model, device))
            for future in futures:
                processed_frames.append(future.result())

        processed_video = ImageSequenceClip(processed_frames, fps=fps).with_audio(audio)
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as output_tmp:
            output_path = output_tmp.name
            processed_video.write_videofile(
                output_path,
                codec="libx264",
                audio_codec="aac",
                audio_bitrate="192k",
                preset=MASTER_PRESET,
                ffmpeg_params=[
                    "-crf", MASTER_CRF,
                    "-pix_fmt", MASTER_PIX_FMT,
                    "-movflags", "+faststart",
                ],
            )

        with open(output_path, 'rb') as f:
            return f.read()
    finally:
        for path in (tmp_video_path, tmp_bg_path, output_path):
            if path and os.path.exists(path):
                os.unlink(path)


def process_video_background(input_video_path, background_path, output_path):
    print(f"\nProcessing: {os.path.basename(input_video_path)}  |  Background: {os.path.basename(background_path)}")
    with open(input_video_path, 'rb') as f:
        input_video_bytes = f.read()
    with open(background_path, 'rb') as f:
        background_bytes = f.read()

    is_video_bg = os.path.splitext(background_path)[1].lower() in ['.mp4', '.avi', '.mov', '.mkv', '.webm']
    try:
        print("Sending to Modal for processing...")
        # Locally the CLI must open an app run context; inside a Modal container
        # the function is already running, so `.remote()` is called directly.
        if modal.is_local():
            with app.run():
                output_bytes = process_video_background_modal.remote(
                    input_video_bytes, background_bytes, is_video_bg,
                    fps=0, fast_mode=True, max_workers=10,
                )
        else:
            output_bytes = process_video_background_modal.remote(
                input_video_bytes, background_bytes, is_video_bg,
                fps=0, fast_mode=True, max_workers=10,
            )
        with open(output_path, 'wb') as f:
            f.write(output_bytes)
        if not check_audio_sync(output_path):
            print(f"⚠ Possible sync issues in {output_path}")
        print(f"✓ Saved to: {output_path}")
        return output_path
    except Exception as e:
        print(f"✗ ERROR processing {os.path.basename(input_video_path)}: {e}")
        return None


def get_original_filename(processed_filename, suffix='_no_silence'):
    return processed_filename.replace(suffix, '').replace('.mp4', '')


def run_background_removal(background_mapping, mirror_mapping, only=None):
    print(f"\n{'='*60}\nSTAGE 2: BACKGROUND REMOVAL (Using Modal)\n{'='*60}")
    allowed = None if only is None else set(only)
    all_silence_removed = [f for f in os.listdir(NO_SILENCE_DIRECTORY) if f.endswith('_no_silence.mp4')]
    silence_removed_files = [
        f for f in all_silence_removed
        if get_original_filename(f) in background_mapping
        and (allowed is None or get_original_filename(f) in allowed)
    ]
    if not silence_removed_files:
        print("WARNING: No *_no_silence.mp4 files found matching CSV entries")
        return 0.0

    print(f"\nFound {len(silence_removed_files)} silence-removed video(s) to process")
    gpu_seconds = 0.0
    for video_file in sorted(silence_removed_files):
        _t0 = time.time()
        try:
            original_name = get_original_filename(video_file)
            background_file = background_mapping[original_name]
            input_video_path = os.path.join(NO_SILENCE_DIRECTORY, video_file)
            output_filename = video_file.replace('_no_silence.mp4', '_no_silence_bg_removed.mp4')
            output_path = os.path.join(VIDEO_DIRECTORY, output_filename)

            if os.path.exists(output_path):
                print(f"Output file already exists, skipping: {output_filename}")
                continue

            if not background_file or background_file.lower() in ('none', 'skip'):
                print(f"SKIPPING BACKGROUND REMOVAL for {original_name}. Background entry is empty.")
                try:
                    shutil.copy2(input_video_path, output_path)
                    print(f"✓ Copied CFR/silence-removed video to: {output_filename}")
                except Exception as e:
                    print(f"✗ Failed to copy video: {e}")
                continue

            background_path = os.path.join(BACKGROUNDS_DIRECTORY, background_file)
            if not os.path.exists(background_path):
                print(f"ERROR: Background file not found: {background_file}")
                continue

            result = process_video_background(input_video_path, background_path, output_path)
            print(f"✓ Successfully processed: {video_file}" if result else f"✗ Failed to process: {video_file}")
        finally:
            # Accumulate per-clip wall time so the orchestrator can report a real
            # (not always-zero) GPU term in estimate_cost. Includes local I/O, so
            # it is an upper bound on billed GPU seconds.
            gpu_seconds += time.time() - _t0
    return gpu_seconds

# =============================================================================
# Stage 3 — overlays / effects / audio / concatenation -> social + web
# =============================================================================

def group_videos_by_prefix(directory=None):
    if directory is None:
        directory = str(SOCIAL_DIR)
    if not os.path.exists(directory):
        return {}
    filenames = [f for f in os.listdir(directory)
                 if f.lower().endswith(VIDEO_EXTENSION) and f.startswith('processed_')]
    grouped = defaultdict(list)
    for filename in filenames:
        name_without_ext = os.path.splitext(filename.replace('processed_', ''))[0]
        match = re.match(r'^([^\d]*)', name_without_ext)
        prefix = (match.group(1).rstrip('_- ') if match else name_without_ext) or name_without_ext
        grouped[prefix].append(filename)
    for prefix in grouped:
        grouped[prefix].sort(key=natural_sort_key)
    return dict(grouped)


def resolve_music_path(bg_music_file):
    if not bg_music_file or pd.isna(bg_music_file) or str(bg_music_file).strip() == '':
        return None
    name = str(bg_music_file).strip()
    if not name.endswith(AUDIO_EXTENSION):
        name += AUDIO_EXTENSION
    path = os.path.join(AUDIO_DIRECTORY, name)
    return path if os.path.exists(path) else None


def get_background_music_from_csv(csv_file, prefix):
    try:
        df = pd.read_csv(csv_file, dtype={'filename': str})
        for _, row in df.iterrows():
            filename = safe_get_value(row, 'filename')
            if filename and str(filename).startswith(prefix):
                bg_music = safe_get_value(row, 'bgMusic')
                return bg_music if bg_music else None
    except Exception:
        pass
    return None


def group_prefix_for_filename(filename):
    """The same group prefix `group_videos_by_prefix` derives from a processed
    file, computed from a CSV `filename` value (so a join plan can be built
    before/independently of the rendered files)."""
    base = str(filename)
    if not base.endswith(VIDEO_EXTENSION):
        base += VIDEO_EXTENSION
    name_without_ext = os.path.splitext(base)[0]        # e.g. video_01_no_silence_bg_removed
    match = re.match(r'^([^\d]*)', name_without_ext)
    prefix = match.group(1).rstrip('_- ') if match else name_without_ext
    return prefix or name_without_ext


def load_join_plan(csv_file):
    """Read the optional `join` column.

    Returns `(join_plan, joined_prefixes)`:
      - join_plan: {join_value: [prefix, ...]} in CSV row order (first-seen prefix
        order within each join value, deduped).
      - joined_prefixes: every prefix that participates in any join (so its part
        is rendered without per-part music; music is applied once to the join).
    """
    join_plan = {}
    joined_prefixes = set()
    try:
        df = pd.read_csv(csv_file, dtype=str).fillna('')
    except Exception as e:
        print(f"⚠️ Could not read {csv_file} for join plan: {e}")
        return join_plan, joined_prefixes

    for _, row in df.iterrows():
        join_value = safe_get_value(row, 'join')
        if not join_value:
            continue
        prefix = group_prefix_for_filename(safe_get_value(row, 'filename'))
        if not prefix:
            continue
        joined_prefixes.add(prefix)
        join_plan.setdefault(join_value, [])
        if prefix not in join_plan[join_value]:
            join_plan[join_value].append(prefix)
    return join_plan, joined_prefixes


def get_join_music_from_csv(csv_file, join_value):
    """First non-empty `bgMusic` among rows whose `join` equals `join_value`."""
    try:
        df = pd.read_csv(csv_file, dtype=str).fillna('')
        for _, row in df.iterrows():
            if safe_get_value(row, 'join') == join_value:
                bg_music = safe_get_value(row, 'bgMusic')
                if bg_music:
                    return bg_music
    except Exception:
        pass
    return None


def apply_dutch_tilt(clip, tilt_degrees):
    if not tilt_degrees or pd.isna(tilt_degrees) or str(tilt_degrees).strip() == '':
        return clip
    try:
        angle = float(str(tilt_degrees).strip())
        if angle == 0:
            return clip
        print(f"🎥 Applying dutch tilt: {angle}° rotation")
        return clip.with_effects([vfx.Rotate(-angle)])
    except ValueError:
        print(f"⚠️ Invalid dutch tilt value: '{tilt_degrees}'. Must be a number.")
        return clip
    except Exception as e:
        print(f"⚠️ Error applying dutch tilt: {str(e)}")
        return clip


def apply_zoom_effect(clip, zoom_type):
    if not zoom_type or pd.isna(zoom_type) or str(zoom_type).strip() == '':
        return clip

    normalized_zoom_type = str(zoom_type).strip().lower().replace('_', '')
    clip_duration = clip.duration
    max_zoom_factor = 1.5
    hyper_zoom_factor = 2.0
    max_flashback_zoom_factor = 3.0
    hyper_zoom_duration = 0.4
    vertical_center_bias = 0.30

    def calculate_frame_transform(get_frame, t, zoom_factor_function):
        frame = get_frame(t)
        if frame.dtype != np.uint8:
            frame = np.clip(frame, 0, 255).astype(np.uint8)
        h, w = frame.shape[:2]
        zoom_factor = max(1.0, zoom_factor_function(t))
        new_w = int(w / zoom_factor)
        new_h = int(h / zoom_factor)
        x1 = (w - new_w) // 2
        y1 = int((h - new_h) * vertical_center_bias)
        x2, y2 = x1 + new_w, y1 + new_h
        y1 = max(0, y1); x1 = max(0, x1); y2 = min(h, y2); x2 = min(w, x2)
        cropped = frame[y1:y2, x1:x2]
        if cropped.size == 0:
            return frame
        # cv2.resize is dramatically faster than per-frame PIL/LANCZOS. Input and
        # output are RGB, so no channel swap is needed.
        return cv2.resize(np.ascontiguousarray(cropped), (w, h), interpolation=cv2.INTER_LINEAR)

    if normalized_zoom_type == "smoothzoom":
        zoom_duration = min(1.0, clip_duration)
        def smooth_zoom_factor(t):
            return 1 + (t / zoom_duration) * (max_zoom_factor - 1) if t <= zoom_duration else max_zoom_factor
        return clip.transform(lambda get_frame, t: calculate_frame_transform(get_frame, t, smooth_zoom_factor))

    elif normalized_zoom_type == "slowzoom":
        tiny_max_zoom = 1.10
        zoom_duration = min(1.0, clip_duration)
        def slow_zoom_factor(t):
            return min(tiny_max_zoom, 1 + (t / zoom_duration) * (tiny_max_zoom - 1))
        return clip.transform(lambda get_frame, t: calculate_frame_transform(get_frame, t, slow_zoom_factor))

    elif normalized_zoom_type == "punchin":
        return clip.transform(lambda get_frame, t: calculate_frame_transform(get_frame, t, lambda _t: max_zoom_factor))

    elif normalized_zoom_type == "beatsynczoom":
        beat_cycle_time = 1 / 3.0
        zoom_in_duration = 0.05
        zoom_hold_duration = 0.1
        zoom_out_duration = beat_cycle_time - (zoom_in_duration + zoom_hold_duration)
        def beat_sync_factor(t):
            if clip_duration < beat_cycle_time:
                return max_zoom_factor
            t_local = t % beat_cycle_time
            if t_local < zoom_in_duration:
                return 1 + (t_local / zoom_in_duration) * (max_zoom_factor - 1)
            elif t_local < zoom_in_duration + zoom_hold_duration:
                return max_zoom_factor
            progress = (t_local - (zoom_in_duration + zoom_hold_duration)) / zoom_out_duration
            return max_zoom_factor - progress * (max_zoom_factor - 1)
        return clip.transform(lambda get_frame, t: calculate_frame_transform(get_frame, t, beat_sync_factor))

    elif normalized_zoom_type == "hyperzoomin":
        def hyper_zoom_in_factor(t):
            if t < hyper_zoom_duration:
                return 1.0 + (t / hyper_zoom_duration) ** 2 * (hyper_zoom_factor - 1.0)
            return hyper_zoom_factor
        return clip.transform(lambda get_frame, t: calculate_frame_transform(get_frame, t, hyper_zoom_in_factor))

    elif normalized_zoom_type == "hyperzoomout":
        def hyper_zoom_out_factor(t):
            if t < hyper_zoom_duration:
                progress = t / hyper_zoom_duration
                return hyper_zoom_factor - (progress * (2 - progress)) * (hyper_zoom_factor - 1.0)
            return 1.0
        return clip.transform(lambda get_frame, t: calculate_frame_transform(get_frame, t, hyper_zoom_out_factor))

    elif normalized_zoom_type == "hyperzoominflashback":
        start_factor = hyper_zoom_factor
        end_factor = max_flashback_zoom_factor
        def hyper_zoom_in_flashback_factor(t):
            if t < hyper_zoom_duration:
                progress = t / hyper_zoom_duration
                return start_factor + progress ** 2 * (end_factor - start_factor)
            return end_factor
        return clip.transform(lambda get_frame, t: calculate_frame_transform(get_frame, t, hyper_zoom_in_flashback_factor))

    elif normalized_zoom_type == "hyperzoomoutflashback":
        start_factor = max_flashback_zoom_factor
        end_factor = 1.0
        def hyper_zoom_out_flashback_factor(t):
            if t < hyper_zoom_duration:
                progress = t / hyper_zoom_duration
                return start_factor - (1 - (1 - progress) ** 2) * (start_factor - end_factor)
            return end_factor
        return clip.transform(lambda get_frame, t: calculate_frame_transform(get_frame, t, hyper_zoom_out_flashback_factor))

    return clip


def create_overlay_html(row, video_width, video_height):
    base_font_size = video_height * 0.025
    horizontal_margin = video_width * 0.025
    # Subtitles get a wider side gutter than the title/footer so lines never run
    # edge-to-edge (2.5% was near the screen border; 8% gives readable margins).
    subtitle_horizontal_margin = video_width * 0.08

    font_variable_path = f"file:///{os.path.abspath(os.path.join(FONT_DIRECTORY, FONT_FILE_VARIABLE)).replace(chr(92), '/')}"
    font_marker_path = f"file:///{os.path.abspath(os.path.join(FONT_DIRECTORY, FONT_FILE_MARKER)).replace(chr(92), '/')}"

    return f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
@font-face{{font-family:'{TITLE_FONT}';src:url('{font_variable_path}') format('truetype');font-weight:400 900;font-style:normal}}
@font-face{{font-family:'{MARKER_FONT_NAME}';src:url('{font_marker_path}') format('truetype');}}

*{{margin:0;padding:0;box-sizing:border-box}}
html, body{{background:transparent!important; width:{video_width}px; height:{video_height}px; overflow:hidden;}}

.subtitle{{
    position:absolute;
    top:{video_height * 0.50}px;
    bottom:{video_height * 0.30}px;
    left:{subtitle_horizontal_margin}px;
    right:{subtitle_horizontal_margin}px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align:center;
    font-family:'{SUBTITLE_FONT}',sans-serif;
    font-size:{base_font_size*2.2}px;
    font-weight:900;
    color:white;
    -webkit-text-stroke:4px black;
    text-shadow:2px 2px 6px rgba(0,0,0,0.5);
    line-height:1.2;
}}

.footer {{
    position: absolute;
    bottom: {video_height * 0.08}px;
    left: {horizontal_margin}px;
    right: {horizontal_margin}px;
    text-align: center;
    font-family: '{FOOTER_FONT}', sans-serif;
    font-size: {base_font_size * 1.5}px;
    color: #FFD700;
    font-weight: 700;
    text-shadow: 2px 2px 4px rgba(0,0,0,0.9);
    letter-spacing: 1px;
    text-transform: uppercase;
}}

u {{
    text-decoration: underline wavy #FF0000 12px;
    text-underline-offset: 15px;
    text-decoration-skip-ink: none;
}}

.grammar {{
    text-decoration: underline wavy #007aff 12px;
    text-underline-offset: 15px;
    text-decoration-skip-ink: none;
}}

mark {{
    position: fixed;
    top: 35%;
    left: {horizontal_margin + 40}px;
    right: 35%;
    transform: translateY(-50%) rotate(-1.5deg);
    background: none;
    color: #1a1a1a;
    font-family: '{MARKER_FONT_NAME}', cursive;
    font-size: {base_font_size*2.0}px;
    -webkit-text-stroke: 0;
    text-shadow: none;
    text-align: left;
    line-height: 1.3;
}}

/* Callout box: a translucent panel anchored on the left. Author it with
   <aside>...</aside> inside subtitle_text. Deliberately a different tag from
   <mark> so the existing mark styling above is preserved. */
aside {{
    position: fixed;
    top: {video_height * 0.28}px;
    left: {video_width * 0.02}px;
    width: {video_width * 0.70}px;
    background: rgba(255, 255, 255, 0.85);
    color: #111111;
    font-family: '{SUBTITLE_FONT}', sans-serif;
    font-size: {base_font_size * 1.5}px;
    font-weight: 400;
    line-height: 1.5;
    text-align: left;
    -webkit-text-stroke: 0;
    text-shadow: none;
    padding: {base_font_size * 0.5}px {base_font_size * 0.6}px;
    border-radius: {base_font_size * 0.8}px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25);
}}

/* <strong> is used for highlighting (in the callout box and subtitles).
   Overrides the inherited subtitle text-shadow/stroke so the highlight reads
   as clean dark text on yellow. */
strong {{
    background: #ffe600;
    color: #111111;
    font-weight: 800;
    -webkit-text-stroke: 0;
    text-shadow: none;
    padding: 0 0.15em;
    border-radius: 6px;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
}}

.title {{
    position: absolute;
    top: {video_height * 0.07}px;
    max-height: {video_height * 0.38}px;
    left: {horizontal_margin}px;
    right: {horizontal_margin}px;
    text-align: center;
    font-family: '{TITLE_FONT}', sans-serif;
    font-size: {base_font_size * 2}px;
    font-weight: 900;
    line-height: 1.6;
}}

.title span {{
    background: white;
    color: black;
    padding: 18px 40px;
    border-radius: 36px;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
}}
</style></head><body>

{f'<div class="title"><span>{row["title_text"]}</span></div>' if row.get('title_text') else ''}

{f'<div class="footer">{row["footer_text"]}</div>' if row.get('footer_text') else ''}

<div class="subtitle">{row["subtitle_text"]}</div>

<script>
    var titleEl = document.querySelector('.title');
    if (titleEl) {{
        var maxTitleHeight = {video_height * 0.38};
        var titleSize = {base_font_size * 2};
        while (titleEl.scrollHeight > maxTitleHeight && titleSize > 10) {{
            titleSize -= 1;
            titleEl.style.fontSize = titleSize + 'px';
        }}
    }}
    var subEl = document.querySelector('.subtitle');
    if (subEl) {{
        var maxSubHeight = {video_height * 0.20};
        var subSize = {base_font_size * 2.2};
        while (subEl.scrollHeight > maxSubHeight && subSize > 10) {{
            subSize -= 1;
            subEl.style.fontSize = subSize + 'px';
        }}
    }}
</script>

</body></html>"""


def add_background_sound(video_clip, bg_sound_filename):
    if not bg_sound_filename or pd.isna(bg_sound_filename) or str(bg_sound_filename).strip() == '':
        return video_clip
    bg_sound_filename = str(bg_sound_filename).strip()
    if not bg_sound_filename.endswith(AUDIO_EXTENSION):
        bg_sound_filename += AUDIO_EXTENSION
    sound_path = os.path.join(AUDIO_DIRECTORY, bg_sound_filename)
    if not os.path.exists(sound_path):
        return video_clip
    try:
        bg_sound = AudioFileClip(sound_path)
        if bg_sound.duration > video_clip.duration:
            bg_sound = bg_sound.subclipped(0, video_clip.duration)
        elif bg_sound.duration < video_clip.duration:
            silence = AudioClip(lambda t: 0, duration=video_clip.duration - bg_sound.duration, fps=bg_sound.fps)
            bg_sound = concatenate_audioclips([bg_sound, silence])
        original_audio = video_clip.audio
        if original_audio is None:
            return video_clip.with_audio(bg_sound)
        if original_audio.duration != video_clip.duration:
            original_audio = original_audio.subclipped(0, min(original_audio.duration, video_clip.duration))
        return video_clip.with_audio(CompositeAudioClip([original_audio, bg_sound]))
    except Exception:
        return video_clip


def add_ending_sound(video_clip, end_sound_filename):
    if not end_sound_filename or pd.isna(end_sound_filename) or str(end_sound_filename).strip() == '':
        return video_clip
    end_sound_filename = str(end_sound_filename).strip()
    if not end_sound_filename.endswith(AUDIO_EXTENSION):
        end_sound_filename += AUDIO_EXTENSION
    sound_path = os.path.join(AUDIO_DIRECTORY, end_sound_filename)
    if not os.path.exists(sound_path):
        return video_clip
    try:
        end_sound = AudioFileClip(sound_path)
        start_time = video_clip.duration - end_sound.duration
        if start_time < 0:
            end_sound = end_sound.subclipped(end_sound.duration - video_clip.duration, end_sound.duration)
            start_time = 0
        original_audio = video_clip.audio
        end_sound_positioned = end_sound.with_start(start_time)
        if original_audio is None:
            return video_clip.with_audio(CompositeAudioClip([end_sound_positioned], duration=video_clip.duration))
        if original_audio.duration != video_clip.duration:
            original_audio = original_audio.subclipped(0, min(original_audio.duration, video_clip.duration))
        return video_clip.with_audio(CompositeAudioClip([original_audio, end_sound_positioned]))
    except Exception:
        return video_clip


def process_single_video(row):
    overlay_path = None
    base_video_clip = None
    foreground_clip = None
    image_overlay_clip = None
    final_composited_clip = None
    try:
        base_filename = safe_get_value(row, 'filename')
        if not base_filename:
            return False
        if not base_filename.endswith(VIDEO_EXTENSION):
            base_filename += VIDEO_EXTENSION

        video_path = os.path.join(VIDEO_DIRECTORY, base_filename)
        if not os.path.exists(video_path):
            print(f"❌ FILE NOT FOUND: {video_path}")
            return False

        output_filename = f"processed_{base_filename}"
        if os.path.exists(social_path(output_filename)):
            return True

        print(f"→ Processing {base_filename}...")
        base_video_clip = VideoFileClip(video_path)
        video_width, video_height = base_video_clip.size
        clip_for_effects = base_video_clip

        foreground_filename = safe_get_value(row, 'foreground')
        if foreground_filename:
            foreground_path = os.path.join(OVERLAYS_DIRECTORY, foreground_filename)
            if os.path.exists(foreground_path):
                foreground_clip = ImageClip(foreground_path, duration=base_video_clip.duration)
                foreground_clip = foreground_clip.with_opacity(1.0).resized(width=video_width, height=video_height)
                clip_for_effects = CompositeVideoClip([base_video_clip, foreground_clip], size=(video_width, video_height))

        dutch_tilt = safe_get_value(row, 'dutch_tilt')
        if dutch_tilt:
            clip_for_effects = apply_dutch_tilt(clip_for_effects, dutch_tilt)

        effect = safe_get_value(row, 'effect')
        if effect:
            clip_for_effects = apply_zoom_effect(clip_for_effects, effect)

        clips_to_composite = [clip_for_effects]

        image_overlay_filename = safe_get_value(row, 'overlay')
        if image_overlay_filename:
            image_overlay_path = os.path.join(OVERLAYS_DIRECTORY, image_overlay_filename)
            if os.path.exists(image_overlay_path):
                image_overlay_clip = ImageClip(image_overlay_path, duration=clip_for_effects.duration)
                image_overlay_clip = image_overlay_clip.with_opacity(1.0).resized(width=video_width, height=video_height)
                clips_to_composite.append(image_overlay_clip)

        title_text = safe_get_value(row, 'title_text')
        subtitle_text = safe_get_value(row, 'subtitle_text')
        footer_text = safe_get_value(row, 'footer_text')

        if title_text or subtitle_text or footer_text:
            safe_name = base_filename.replace(VIDEO_EXTENSION, '').replace('.', '_')
            overlay_path = os.path.join(OVERLAYS_TEMP_DIRECTORY, f"overlay_{safe_name}.png")
            hti = Html2Image(size=(video_width, video_height), output_path=OVERLAYS_TEMP_DIRECTORY,
                             custom_flags=chrome_flags(os.environ))
            hti.screenshot(html_str=create_overlay_html(row, video_width, video_height),
                           save_as=os.path.basename(overlay_path))
            if os.path.exists(overlay_path):
                clips_to_composite.append(ImageClip(overlay_path, duration=clip_for_effects.duration).with_opacity(1.0))

        if len(clips_to_composite) > 1:
            final_composited_clip = CompositeVideoClip(clips_to_composite, size=(video_width, video_height))
        else:
            final_composited_clip = clip_for_effects

        final_composited_clip = add_background_sound(final_composited_clip, safe_get_value(row, 'bgSound'))
        final_composited_clip = add_ending_sound(final_composited_clip, safe_get_value(row, 'endSoundEffect'))

        # Render once to output/social (high quality) and derive output/web.
        render_profiles(final_composited_clip, output_filename, fps=base_video_clip.fps)
        return True
    except Exception as e:
        print(f"❌ Error during processing {base_filename}: {str(e)}")
        return False
    finally:
        if base_video_clip: base_video_clip.close()
        if foreground_clip: foreground_clip.close()
        if image_overlay_clip: image_overlay_clip.close()
        if final_composited_clip: final_composited_clip.close()
        if overlay_path and os.path.exists(overlay_path):
            try:
                os.remove(overlay_path)
            except Exception:
                pass


def load_csv_rows(csv_file):
    """The CSV as a list of dict rows (for the orchestrator's publish plan)."""
    try:
        df = pd.read_csv(csv_file, dtype=str).fillna('')
    except Exception as e:
        print(f"⚠️ Could not read {csv_file} for publish plan: {e}")
        return []
    return [row for _, row in df.iterrows()]


def process_video_batch(csv_file, max_workers=1, only=None):
    try:
        df = pd.read_csv(csv_file, dtype=str).fillna('')
        all_rows = [row for _, row in df.iterrows()]
        rows_to_process = select_rows(all_rows, only=only)
        completed_count = 0
        total_count = len(rows_to_process)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(process_single_video, row): safe_get_value(row, 'filename')
                       for row in rows_to_process}
            for future in as_completed(futures):
                try:
                    if future.result():
                        completed_count += 1
                except Exception:
                    pass
                sys.stdout.write(f"\r📊 Progress: {completed_count}/{total_count}")
                sys.stdout.flush()
        print()
        return completed_count == total_count
    except Exception:
        return False


def processed_to_original(processed_name):
    """`processed_<filename><VIDEO_EXTENSION>` -> `<filename>`."""
    stem = str(processed_name)
    if stem.startswith('processed_'):
        stem = stem[len('processed_'):]
    if stem.endswith(VIDEO_EXTENSION):
        stem = stem[:-len(VIDEO_EXTENSION)]
    return stem


def load_phrase_map(csv_file):
    """CSV `filename` -> `phrase` text."""
    phrases = {}
    try:
        df = pd.read_csv(csv_file, dtype=str).fillna('')
    except Exception as e:
        print(f"⚠️ Could not read {csv_file} for phrase subtitles: {e}")
        return phrases
    for _, row in df.iterrows():
        filename = safe_get_value(row, 'filename')
        if filename:
            phrases[filename] = safe_get_value(row, 'phrase')
    return phrases


def format_srt_time(seconds):
    """Seconds -> HH:MM:SS,mmm (SRT)."""
    try:
        seconds = max(0.0, float(seconds))
    except (TypeError, ValueError):
        seconds = 0.0
    total_ms = int(round(seconds * 1000))
    hours = total_ms // 3600000
    minutes = (total_ms % 3600000) // 60000
    secs = (total_ms % 60000) // 1000
    millis = total_ms % 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def _segment_duration(clip, single):
    """Duration this clip contributes to the concatenated output, mirroring
    concatenate_video_group: a single-clip group is copied untrimmed; each clip
    in a multi-clip group has 0.15 s trimmed off the end."""
    if single:
        return clip.duration
    valid = clip.duration
    if clip.audio:
        valid = min(clip.duration, clip.audio.duration)
    safe = valid - 0.15
    return safe if safe > 0 else clip.duration


def build_group_srt(filenames, input_dir, phrase_map, single):
    """SRT (config format) for a concatenated group, or None if it has no
    phrases. Cue timing matches the concatenated video."""
    if not phrase_map:
        return None
    blocks = []
    cursor = 0.0
    index = 0
    for f in filenames:
        original = processed_to_original(f)
        try:
            clip = VideoFileClip(os.path.join(input_dir, f))
            duration = _segment_duration(clip, single)
            clip.close()
        except Exception as e:
            print(f"⚠️ Could not read duration for {f}: {e}")
            continue
        phrase = (phrase_map.get(original) or '').strip()
        if phrase:
            index += 1
            blocks.append(
                f"{index}\n{format_srt_time(cursor)} --> {format_srt_time(cursor + duration)}\n{phrase}"
            )
        cursor += duration  # empty phrase -> no cue, but time still advances
    return "\n\n".join(blocks) if blocks else None


def concatenate_video_group(prefix, filenames, input_dir=None, skip_music=False, phrase_map=None):
    if input_dir is None:
        input_dir = str(SOCIAL_DIR)
    if not filenames:
        return None, None

    output_filename = f"{prefix}_full{VIDEO_EXTENSION}"
    master = social_path(output_filename)
    web = web_path(output_filename)
    ensure_dirs()

    single = len(filenames) == 1
    # SRT is derived from the per-segment durations, independent of rendering,
    # so it is produced even when the video already exists.
    srt = build_group_srt(filenames, input_dir, phrase_map, single)

    if single:
        print(f"⏩ Single video detected for '{prefix}'. Bypassing concatenation...")
        shutil.copy2(os.path.join(input_dir, filenames[0]), master)
    else:
        if os.path.exists(master) and os.path.exists(web):
            print(f"↩️  {output_filename} already exists, skipping.")
            return master, srt
        try:
            print(f"🔗 Concatenating {len(filenames)} clips for '{prefix}' (Safe-Sync Mode)...")
            clips = []
            for f in filenames:
                clip = VideoFileClip(os.path.join(input_dir, f))
                valid_duration = clip.duration
                if clip.audio:
                    valid_duration = min(clip.duration, clip.audio.duration)
                safe_duration = valid_duration - 0.15
                if safe_duration > 0:
                    clip = clip.with_section_cut_out(start_time=safe_duration, end_time=clip.duration)
                    clip = clip.with_duration(safe_duration)
                    if clip.audio:
                        clip = clip.with_audio(clip.audio.with_duration(safe_duration))
                clips.append(clip)

            final_clip = concatenate_videoclips(clips, method="compose")
            final_clip.write_videofile(master, **social_write_kwargs())
            for clip in clips:
                clip.close()
            final_clip.close()
        except Exception as e:
            print(f"❌ Error concatenating {prefix}: {str(e)}")
            return None, None

    # Per-part music is skipped for groups that participate in a join; the
    # joined video gets one music mix applied over the whole thing instead.
    if not skip_music:
        music_path = resolve_music_path(get_background_music_from_csv(CSV_FILE, prefix))
        if music_path:
            try:
                duck_master(master, music_path)
            except Exception as e:
                print(f"⚠️ Background-music mixing failed for {prefix}: {e}")

    try:
        write_web_from_master(master, web)
    except Exception as e:
        print(f"❌ Web encode failed for {prefix}: {e}")

    return master, srt


def to_json_subtitle_string(srt_text):
    """Escape an SRT block for direct pasting into the config JSON's
    `"subtitles": "..."` value (matches the `\\n` form used in src/config)."""
    return srt_text.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')


def write_srt_column(csv_file, srt_by_prefix):
    """Write each group's SRT into the CSV `srt` column (same value on every
    row of that group), in the config (JSON-escaped) format."""
    if not srt_by_prefix:
        return
    try:
        df = pd.read_csv(csv_file, dtype=str).fillna('')
    except Exception as e:
        print(f"⚠️ Could not read {csv_file} to write srt column: {e}")
        return
    df['srt'] = ''
    for i, row in df.iterrows():
        prefix = group_prefix_for_filename(safe_get_value(row, 'filename'))
        if prefix in srt_by_prefix:
            df.at[i, 'srt'] = to_json_subtitle_string(srt_by_prefix[prefix])
    df.to_csv(csv_file, index=False)
    print(f"📝 Wrote 'srt' for {len(srt_by_prefix)} concatenated video(s) to '{csv_file}'")


def _concat_video_files(parts, out):
    """Join already-encoded mp4 parts into `out`.

    Stream-copies when the parts share codec parameters (they do — same
    pipeline), which is lossless and fast; falls back to a re-encode otherwise.
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        list_file = os.path.join(temp_dir, "concat_list.txt")
        with open(list_file, 'w', encoding='utf-8') as f:
            for part in parts:
                f.write("file '%s'\n" % os.path.abspath(part).replace('\\', '/'))

        copy_cmd = [
            'ffmpeg', '-y', '-loglevel', 'error',
            '-f', 'concat', '-safe', '0', '-i', list_file,
            '-c', 'copy', '-movflags', '+faststart', out,
        ]
        if subprocess.run(copy_cmd, capture_output=True, text=True).returncode == 0:
            return out

        print("  stream-copy concat failed; re-encoding the joined video...")
        reencode_cmd = [
            'ffmpeg', '-y', '-loglevel', 'error',
            '-f', 'concat', '-safe', '0', '-i', list_file,
            '-c:v', 'libx264', '-preset', SOCIAL_PRESET, '-crf', str(SOCIAL_CRF),
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', SOCIAL_AUDIO_BITRATE,
            '-movflags', '+faststart', out,
        ]
        subprocess.run(reencode_cmd, capture_output=True, text=True, check=True)
        return out


def concatenate_joined_videos(join_plan):
    """Concatenate the `_full` videos of each join group into
    output/social|web/<joinValue>.mp4."""
    if not join_plan:
        return {}
    ensure_dirs()
    results = {}
    for join_value, prefixes in join_plan.items():
        if len(prefixes) < 2:
            print(f"⚠️ join '{join_value}': needs at least 2 parts (got {len(prefixes)}), skipping")
            continue

        parts = []
        for prefix in prefixes:
            part = social_path(f"{prefix}_full{VIDEO_EXTENSION}")
            if os.path.exists(part):
                parts.append(part)
            else:
                print(f"⚠️ join '{join_value}': missing part '{prefix}_full{VIDEO_EXTENSION}'")
        if len(parts) < 2:
            print(f"⚠️ join '{join_value}': fewer than 2 parts available, skipping")
            continue

        output_filename = f"{join_value}.mp4"
        master = social_path(output_filename)
        web = web_path(output_filename)
        if os.path.exists(master) and os.path.exists(web):
            print(f"↩️  {output_filename} already exists, skipping.")
            results[join_value] = master
            continue

        print(f"🔗 Joining {len(parts)} videos for '{join_value}' (CSV order)...")
        try:
            _concat_video_files(parts, master)
        except Exception as e:
            print(f"❌ Join failed for '{join_value}': {e}")
            continue

        # Music: re-applied once across the whole joined video.
        music_path = resolve_music_path(get_join_music_from_csv(CSV_FILE, join_value))
        if music_path:
            try:
                duck_master(master, music_path)
            except Exception as e:
                print(f"⚠️ Background-music mixing failed for join '{join_value}': {e}")

        try:
            write_web_from_master(master, web)
        except Exception as e:
            print(f"❌ Web encode failed for join '{join_value}': {e}")

        results[join_value] = master
    return results


def concatenate_all_processed_videos(joined_prefixes=None, phrase_map=None):
    joined_prefixes = joined_prefixes or set()
    grouped_videos = group_videos_by_prefix(str(SOCIAL_DIR))
    if not grouped_videos:
        return {}, {}
    results = {}
    srt_by_prefix = {}
    for prefix, filenames in grouped_videos.items():
        output_path, srt = concatenate_video_group(
            prefix, filenames,
            skip_music=(prefix in joined_prefixes),
            phrase_map=phrase_map,
        )
        if output_path:
            results[prefix] = output_path
        if srt:
            srt_by_prefix[prefix] = srt
    return results, srt_by_prefix

# =============================================================================
# Entry point
# =============================================================================

def parse_args():
    parser = argparse.ArgumentParser(
        description='Full lesson-video pipeline: silence removal -> background removal -> social + web render')
    parser.add_argument('--silence-threshold', type=int, default=-50, help='Silence threshold in dB (default: -50)')
    parser.add_argument('--min-silence', type=int, default=1000, help='Minimum silence gap in ms (default: 1000)')
    parser.add_argument('--min-speech', type=int, default=300, help='Minimum speech duration to keep in ms (default: 300)')
    parser.add_argument('--start-margin', type=int, default=100, help='Margin before speech segments in ms (default: 100)')
    parser.add_argument('--end-margin', type=int, default=500, help='Margin after speech segments in ms (default: 500)')
    parser.add_argument('--output-suffix', type=str, default='no_silence', help='Stage 1 output suffix (default: no_silence)')
    parser.add_argument('--cfr-fps', type=int, default=30, help='Target CFR for preprocessing (default: 30)')
    parser.add_argument('--workers', type=int, default=1, help='Parallel render workers for Stage 3 (default: 1)')
    parser.add_argument('--skip-silence', action='store_true', help='Skip Stage 1')
    parser.add_argument('--skip-background', action='store_true', help='Skip Stage 2')
    parser.add_argument('--skip-render', action='store_true', help='Skip Stage 3')
    parser.add_argument('--render-only', action='store_true', help='Alias for --skip-silence --skip-background')
    parser.add_argument('--only', type=str, default=None,
                        help='Comma-separated filename set; restrict Stage 1/2/3 to these rows')
    return parser.parse_args()


def main():
    args = parse_args()
    if args.render_only:
        args.skip_silence = True
        args.skip_background = True

    only = None
    if args.only:
        only = [s.strip() for s in args.only.split(',') if s.strip()]

    if not setup_environment():
        sys.exit(1)

    csv_file = resolve_csv_file()
    if not csv_file:
        create_sample_csv()
        print(f"Created {CSV_FILE}. Fill it in and place source videos in '{RAWVIDEOS_DIRECTORY}'.")
        sys.exit(0)

    background_mapping, mirror_mapping = load_background_mapping(csv_file)

    if not args.skip_silence:
        run_silence_removal(args, background_mapping, mirror_mapping, only=only)

    if not args.skip_background:
        run_background_removal(background_mapping, mirror_mapping, only=only)

    if not args.skip_render:
        print(f"\n{'='*60}\nSTAGE 3: RENDER (social + web)\n{'='*60}")
        process_video_batch(csv_file, max_workers=args.workers, only=only)
        join_plan, joined_prefixes = load_join_plan(csv_file)
        phrase_map = load_phrase_map(csv_file)
        _, srt_by_prefix = concatenate_all_processed_videos(joined_prefixes, phrase_map)
        write_srt_column(csv_file, srt_by_prefix)
        if join_plan:
            print(f"\n{'='*60}\nJOIN: concatenating related videos\n{'='*60}")
            concatenate_joined_videos(join_plan)

    print(f"\n✅ Done. Deliverables in: {SOCIAL_DIR}/ and {WEB_DIR}/")


if __name__ == '__main__':
    main()
