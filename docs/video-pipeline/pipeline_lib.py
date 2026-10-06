"""Pure, dependency-free helpers for the lesson-video pipeline (story 040).

This module deliberately imports only the standard library. It is the Python
mirror of ``src/modules/video/pipeline-keys.js`` and the home of the pure
decisions (work-dir/web-profile resolution, slug + object-key rules, the publish
plan, the web-budget check and the cost estimate) that would otherwise require
``modal``/``moviepy``/``torch`` to import and therefore could never run in CI.

``video_pipeline.py`` imports these helpers and wires them in; the Modal
orchestrator and storage layer reuse the same key functions so the JS Pages
Functions and the Python runner cannot drift.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

# --------------------------------------------------------------------------- #
# Naming rules (mirror of src/modules/video/pipeline-keys.js)
# --------------------------------------------------------------------------- #

PIPELINE_SLUG_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}\Z")
PIPELINE_JOB_ID_PATTERN = re.compile(r"^[A-Za-z0-9-]{8,64}\Z")

PROCESSED_PREFIX = "processed_"
VIDEO_EXTENSION = "_no_silence_bg_removed.mp4"

PUBLISHED_VIDEO_PREFIX = "assets/videos/"
UGC_PREFIX = "videos/"  # learner/recap clips (48h lifecycle), public bucket
RAW_PREFIX = "raw/"
STATUS_PREFIX = "raw/status/"
PIPELINE_ASSET_PREFIX = "pipeline-assets/"

# Keys that must never be served by the public CDN: raw takes, their status
# markers (covered by RAW_PREFIX) and operator pipeline inputs. Mirrors
# PRIVATE_KEY_PREFIXES in src/modules/video/pipeline-keys.js.
PRIVATE_KEY_PREFIXES = (RAW_PREFIX, PIPELINE_ASSET_PREFIX)


def is_valid_slug(name) -> bool:
    """A bare CSV ``filename``/``join`` value: [A-Za-z0-9_-], leading alnum, <=100."""
    return isinstance(name, str) and PIPELINE_SLUG_PATTERN.match(name) is not None


def is_valid_job_id(job_id) -> bool:
    return isinstance(job_id, str) and PIPELINE_JOB_ID_PATTERN.match(job_id) is not None


def raw_take_key(slug):
    return f"{RAW_PREFIX}{slug}.mp4" if is_valid_slug(slug) else None


def status_key(job_id):
    return f"{STATUS_PREFIX}{job_id}.json" if is_valid_job_id(job_id) else None


def published_video_key(slug):
    return f"{PUBLISHED_VIDEO_PREFIX}{slug}.mp4" if is_valid_slug(slug) else None


def published_poster_key(slug):
    return f"{PUBLISHED_VIDEO_PREFIX}{slug}.jpg" if is_valid_slug(slug) else None


def pipeline_asset_key(rel_path) -> str:
    normalized = str(rel_path or "").replace("\\", "/").lstrip("/")
    return f"{PIPELINE_ASSET_PREFIX}{normalized}"


def is_private_key(key) -> bool:
    """True when ``key`` belongs in the private bucket, not the public CDN."""
    return isinstance(key, str) and key.startswith(PRIVATE_KEY_PREFIXES)


def bucket_for_key(key) -> str:
    """``"private"`` for raw/assets keys, ``"public"`` for CDN media."""
    return "private" if is_private_key(key) else "public"


def processed_web_name(filename: str) -> str:
    """The Stage-3 per-row output name: ``processed_<filename>_no_silence_bg_removed.mp4``."""
    return f"{PROCESSED_PREFIX}{filename}{VIDEO_EXTENSION}"


def group_prefix_for_filename(filename) -> str:
    """Legacy step key: the leading non-digit run of a CSV ``filename`` (with
    trailing ``_- `` stripped). Used only when a sheet has no ``video_file``
    column, so legacy sheets keep their per-prefix grouping."""
    base = str(filename)
    if not base.endswith(VIDEO_EXTENSION):
        base += VIDEO_EXTENSION
    name_without_ext = os.path.splitext(base)[0]
    match = re.match(r"^([^\d]*)", name_without_ext)
    prefix = match.group(1).rstrip("_- ") if match else name_without_ext
    return prefix or name_without_ext


def group_key_for_filename(filename, video_file_map=None) -> str:
    """The step key for a CSV ``filename`` (story 050).

    Its non-blank ``video_file`` value when the sheet carries the column, else
    ``group_prefix_for_filename``. One key drives the rendered video, the join
    and the SRT, so they cannot disagree on step granularity. ``video_file_map``
    is ``filename -> video_file``.
    """
    if video_file_map:
        video_file = str(video_file_map.get(str(filename), "") or "").strip()
        if video_file:
            return video_file
    return group_prefix_for_filename(filename)


def step_key_matches(filename, step_key, video_file_map=None) -> bool:
    """True when ``filename``'s step key equals ``step_key``.

    Equality, never a substring/prefix match: sibling keys like
    ``wouldyourather_b01_i`` and ``wouldyourather_b01_ii`` share a prefix, so
    ``startswith`` would pick the wrong row's music.
    """
    return group_key_for_filename(filename, video_file_map) == step_key


# --------------------------------------------------------------------------- #
# SRT timing (one cursor model for groups and their joins)
# --------------------------------------------------------------------------- #

def format_srt_time(seconds) -> str:
    """Seconds -> ``HH:MM:SS,mmm`` (SRT)."""
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


def build_srt_from_segments(segments, start_cursor=0.0, start_index=0):
    """SRT text for a sequence of ``(phrase, duration)`` segments.

    The single timing model: cues start at ``start_cursor`` and number from
    ``start_index``; a blank phrase emits no cue but still advances time. Returns
    ``(srt_text_or_None, end_cursor, end_index)``. Passing a joined step's parts
    as one flat segment list shifts every later part by the cumulative duration
    of the earlier ones (cue numbering continues).
    """
    blocks = []
    cursor = start_cursor
    index = start_index
    for phrase, duration in segments:
        text = (phrase or "").strip()
        if text:
            index += 1
            blocks.append(
                f"{index}\n{format_srt_time(cursor)} --> {format_srt_time(cursor + duration)}\n{text}"
            )
        cursor += duration
    return ("\n\n".join(blocks) if blocks else None), cursor, index


# --------------------------------------------------------------------------- #
# Local-vs-container seams
# --------------------------------------------------------------------------- #

def resolve_work_dir(environ=None) -> Path:
    """``PIPELINE_WORKDIR`` when set, else the current working directory."""
    env = os.environ if environ is None else environ
    value = env.get("PIPELINE_WORKDIR")
    return Path(value) if value else Path.cwd()


def resolve_web_profile(environ=None):
    """(target_long_edge, audio_bitrate) for the web encode."""
    env = os.environ if environ is None else environ
    edge = env.get("PIPELINE_WEB_TARGET_LONG_EDGE")
    audio = env.get("PIPELINE_WEB_AUDIO_BITRATE")
    return (int(edge) if edge else 1280, audio or "128k")


def chrome_flags(environ=None):
    """html2image custom flags; ``--no-sandbox`` only when running as root."""
    env = os.environ if environ is None else environ
    flags = [
        "--headless",
        "--hide-scrollbars",
        "--disable-gpu",
        "--default-background-color=00000000",
    ]
    if env.get("PIPELINE_CHROME_NO_SANDBOX"):
        flags.append("--no-sandbox")
    return flags


REQUIRED_FONTS = (
    "AtkinsonHyperlegibleNext-VariableFont_wght.ttf",
    "Kalam-Bold.ttf",
)


def missing_required_fonts(font_dir) -> list:
    """Required font filenames absent from ``font_dir`` (empty list when all present)."""
    base = Path(font_dir)
    return [name for name in REQUIRED_FONTS if not (base / name).exists()]


# --------------------------------------------------------------------------- #
# Row scope + publish plan
# --------------------------------------------------------------------------- #

def _row_filename(row):
    if row is None:
        return None
    getter = getattr(row, "get", None)
    if callable(getter):
        try:
            return getter("filename")
        except Exception:
            return None
    try:
        return row["filename"]
    except Exception:
        return None


def select_rows(rows, only=None):
    """Rows in scope. ``only=None`` = every row; ``only=[]`` = none."""
    rows = list(rows)
    if only is None:
        return rows
    allowed = set(only)
    return [row for row in rows if _row_filename(row) in allowed]


def plan_publish(rows, join_values, web_listing, only=None):
    """Ordered publish plan for the rendered ``output/web`` contents.

    Per CSV row in scope: slug = ``filename``, web_name =
    ``processed_<filename>_no_silence_bg_removed.mp4``. Per join value: slug =
    ``join_value``, web_name = ``<join_value>.mp4``. An entry is kept only when
    its ``web_name`` is actually present; entries are deduped by slug (first
    wins) in first-seen order. Slugs that fail validation are never emitted.
    """
    listing = set(web_listing or [])
    seen = set()
    plan = []

    def add(slug, web_name):
        if slug in seen or not is_valid_slug(slug) or web_name not in listing:
            return
        video_key = published_video_key(slug)
        poster_key = published_poster_key(slug)
        if not video_key or not poster_key:
            return
        seen.add(slug)
        plan.append({
            "slug": slug,
            "web_name": web_name,
            "video_key": video_key,
            "poster_key": poster_key,
        })

    for row in select_rows(rows, only):
        slug = _row_filename(row)
        if slug is None:
            continue
        add(str(slug), processed_web_name(str(slug)))

    for join_value in join_values or []:
        if join_value is None:
            continue
        add(str(join_value), f"{join_value}.mp4")

    return plan


# --------------------------------------------------------------------------- #
# Web budget (mirrors scripts/lib/video-optimize-utils.js)
# --------------------------------------------------------------------------- #

MAX_VIDEO_WIDTH = 720
MAX_TOTAL_BITRATE_BPS = 1_500_000
X264_CRF = 26
X264_PRESET = "medium"
WEB_MAXRATE = "1.5M"
WEB_BUFSIZE = "3M"
WEB_AUDIO_BITRATE = "96k"

FRAME_AT_SECONDS = 0.2
POSTER_WIDTH = 640
POSTER_QUALITY = 8


def is_within_web_budget(probe) -> bool:
    """Decode width <=720, total bitrate <=1.5 Mbps, and faststart.

    Mirrors ``planVideoOptimize`` in scripts/lib/video-optimize-utils.js, which
    compares the decoded ``width`` (not the long edge): a portrait 720x1280 clip
    has width 720 and passes.
    """
    if not probe:
        return False
    width = probe.get("width")
    bitrate = probe.get("totalBitrateBps")
    if width is None or bitrate is None:
        return False
    if width > MAX_VIDEO_WIDTH:
        return False
    if bitrate > MAX_TOTAL_BITRATE_BPS:
        return False
    return probe.get("faststart") is True


def reencode_web_args(src, out):
    """ffmpeg args for the web-budget fallback re-encode (032 arguments)."""
    return [
        "-y", "-loglevel", "error", "-i", str(src),
        "-c:v", "libx264", "-preset", X264_PRESET, "-crf", str(X264_CRF),
        "-maxrate", WEB_MAXRATE, "-bufsize", WEB_BUFSIZE,
        "-profile:v", "main", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", WEB_AUDIO_BITRATE,
        "-movflags", "+faststart", str(out),
    ]


def poster_args(src, out):
    """ffmpeg args for the 0.2s sibling poster (mirrors scripts/lib/poster-utils.js)."""
    return [
        "-y", "-loglevel", "error", "-i", str(src),
        "-ss", str(FRAME_AT_SECONDS), "-vframes", "1",
        "-vf", f"scale={POSTER_WIDTH}:-2", "-q:v", str(POSTER_QUALITY),
        str(out),
    ]


# --------------------------------------------------------------------------- #
# Cost (Modal 2026-10-05 rates)
# --------------------------------------------------------------------------- #

GPU_SECOND_RATE = 0.000164        # T4, $/s
CPU_CORE_SECOND_RATE = 0.0000131  # $/core/s
MEMORY_GIB_SECOND_RATE = 0.00000222  # $/GiB/s

# Stage 2 ~120s T4; 8 CPU cores ~300s; 16 GiB ~300s -> ~$0.062.
REPRESENTATIVE_METRICS = {
    "gpu_seconds": 120,
    "cpu_core_seconds": 2400,
    "memory_gib_seconds": 4800,
}


def estimate_cost(metrics) -> float:
    metrics = metrics or {}
    return (
        metrics.get("gpu_seconds", 0) * GPU_SECOND_RATE
        + metrics.get("cpu_core_seconds", 0) * CPU_CORE_SECOND_RATE
        + metrics.get("memory_gib_seconds", 0) * MEMORY_GIB_SECOND_RATE
    )


# --------------------------------------------------------------------------- #
# GitHub repository_dispatch (best-effort `render-complete` notification)
# --------------------------------------------------------------------------- #

GITHUB_DISPATCH_URL = "https://api.github.com/repos/{repo}/dispatches"


def _response_status(response):
    """The HTTP status of a fetch response (attr or dict), or ``None``."""
    if response is None:
        return None
    status = getattr(response, "status", None)
    if status is None and isinstance(response, dict):
        status = response.get("status")
    return status


def dispatch_render_complete(repo, token, payload, fetchImpl):
    """POST a ``render-complete`` repository_dispatch to GitHub. Never raises.

    Returns ``{"sent": True}`` on a 2xx response, else ``{"sent": False,
    "error": "<message>"}`` (a missing repo/token, a non-2xx status, or a thrown
    fetch). ``fetchImpl(url, method=..., headers=..., body=...)`` is injected so
    the helper is unit-testable without network; it returns an object with a
    ``status`` attribute (or a ``{"status": ...}`` dict).
    """
    if not repo:
        return {"sent": False, "error": "GH_DISPATCH_REPO is not set"}
    if not token:
        return {"sent": False, "error": "GH_DISPATCH_TOKEN is not set"}
    url = GITHUB_DISPATCH_URL.format(repo=repo)
    try:
        body = json.dumps({"event_type": "render-complete", "client_payload": payload or {}})
        response = fetchImpl(
            url,
            method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
            },
            body=body,
        )
    except Exception as exc:  # noqa: BLE001 - best-effort; never fail the render
        return {"sent": False, "error": str(exc)}
    status = _response_status(response)
    if isinstance(status, int) and 200 <= status < 300:
        return {"sent": True}
    return {"sent": False, "error": f"HTTP {status}"}


# --------------------------------------------------------------------------- #
# Status marker (stage-level, carried by R2 between the stateless Functions)
# --------------------------------------------------------------------------- #

def serialize_status(status) -> str:
    return json.dumps(status)


def parse_status(text):
    """Parsed status object, or ``None`` when malformed or missing ``status``."""
    try:
        parsed = json.loads(text)
    except (TypeError, ValueError):
        return None
    if not isinstance(parsed, dict) or "status" not in parsed:
        return None
    return parsed
