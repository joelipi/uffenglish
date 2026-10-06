"""Modal app for the cloud lesson-video pipeline (story 040, Task 7).

Attaches the CPU orchestrator and the proxy-auth trigger to the
``uff-lesson-video`` app defined in ``video_pipeline``:

    modal deploy docs/video-pipeline/modal_app.py

This app registers **no** GPU function (Modal refuses a new T4 function without a
payment method). Background removal calls the separately deployed
``video-background-removal`` app by name through ``modal.Function.from_name``;
that app is not imported here, so the deploy graph stays CPU-only.
"""

from __future__ import annotations

import argparse
import os
import time

import modal
from fastapi import HTTPException

from video_pipeline import app
import video_pipeline as pipeline
import storage
from pipeline_lib import (
    PIPELINE_ASSET_PREFIX,
    dispatch_render_complete,
    estimate_cost,
    fetch_sheet_csv,
    plan_publish,
    pipeline_asset_key,
    raw_take_key,
    resolve_sheet_url,
    serialize_status,
    status_key,
)

WORKDIR = os.environ.get("PIPELINE_WORKDIR", "/tmp/pipeline-work")

# CPU orchestrator image: ffmpeg for media, Chromium for the html2image overlays,
# libgl1/libglib2.0-0 for the headless browser. Same source tree the PC runs.
cpu_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "chromium", "libgl1", "libglib2.0-0")
    .pip_install(
        "moviepy==2.2.1",
        "html2image==2.0.7",
        "pandas==3.0.6",
        "opencv-python-headless==5.0.0.93",
        "pydub==0.25.1",
        "numpy==2.5.3",
        # moviepy==2.2.1 requires pillow<12.0, so the CPU image pins a
        # compatible 11.x (12.3.0 makes the resolver fail the build).
        "pillow==11.3.0",
        "boto3==1.43.108",
    )
    .add_local_dir("docs/video-pipeline", remote_path="/root/pipeline")
    .env({
        "PYTHONPATH": "/root/pipeline",
        "PIPELINE_WORKDIR": WORKDIR,
        "PIPELINE_CHROME_NO_SANDBOX": "1",
        "PIPELINE_WEB_TARGET_LONG_EDGE": "720",
        "PIPELINE_WEB_AUDIO_BITRATE": "96k",
    })
)

secret = modal.Secret.from_name("uff-r2")
# One-click pipeline: `GH_DISPATCH_REPO` / `GH_DISPATCH_TOKEN` for the
# `render-complete` repository_dispatch (story 051). The `uff-github` secret is a
# deploy prerequisite (`from_name` raises at invocation if it is absent); only its
# values are optional — when unset the dispatch is skipped, the render stays green.
github_secret = modal.Secret.from_name("uff-github")

FETCH_TREES = ("backgrounds", "audio", "overlays", "fonts")


def _github_fetch(url, method="GET", headers=None, body=None):
    """Minimal urllib fetch for `dispatch_render_complete` (no extra dependency).

    Returns the response object (with `.status`); a non-2xx raises and the helper
    turns it into an error result. The orchestrator never fails on it.
    """
    import urllib.request

    data = body.encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    return urllib.request.urlopen(request, timeout=10)


def _fetch_takes(workdir, files):
    for slug in files:
        key = raw_take_key(slug)
        if not key:
            continue
        dest = os.path.join(workdir, "rawvideos", f"{slug}.mp4")
        storage.download_to(key, dest)


def _sheet_fetch(url):
    """urllib fetch for the published sheet (urlopen follows the 307 by default)."""
    import urllib.request

    return urllib.request.urlopen(url, timeout=30)


def _fetch_assets(workdir):
    os.makedirs(workdir, exist_ok=True)
    # Story 052: the published sheet is the render's input, not the R2 object.
    # Fetch its CSV over HTTP (Google answers with a 307 redirect) into the work
    # dir as `video_data.csv`; `pipeline-assets/video_data.csv` is now only the
    # post-render output the orchestrator uploads after computing the `srt` column.
    csv_text = fetch_sheet_csv(resolve_sheet_url(), _sheet_fetch)
    with open(os.path.join(workdir, "video_data.csv"), "w", encoding="utf-8") as fh:
        fh.write(csv_text)
    for tree in FETCH_TREES:
        prefix = pipeline_asset_key(tree) + "/"
        for key in storage.list_keys(prefix):
            rel = key[len(PIPELINE_ASSET_PREFIX):]
            dest = os.path.realpath(os.path.join(workdir, rel))
            # A key planted in the bucket must not escape the work dir
            # (boto3 download_file would happily write outside it).
            if not dest.startswith(os.path.realpath(workdir) + os.sep):
                continue
            storage.download_to(key, dest)


def _write_status(job_id, status, stage, extra=None):
    payload = {"status": status, "stage": stage}
    if extra:
        payload.update(extra)
    key = status_key(job_id)
    if key:
        storage.upload_json(key, serialize_status(payload))


@app.function(image=cpu_image, cpu=8, memory=16384, timeout=7200,
              secrets=[secret, github_secret])
def orchestrator(spec: dict):
    """Run Stages 1-3 for a filename set and publish the web outputs to R2."""
    job_id = spec["jobId"]
    files = spec["files"]
    os.makedirs(WORKDIR, exist_ok=True)
    started = time.time()

    try:
        _write_status(job_id, "running", "fetch")
        _fetch_assets(WORKDIR)
        _fetch_takes(WORKDIR, files)

        csv_file = os.path.join(WORKDIR, "video_data.csv")
        background_mapping, mirror_mapping = pipeline.load_background_mapping(csv_file)

        _write_status(job_id, "running", "stage1")
        stage_args = argparse.Namespace(
            silence_threshold=-50, min_silence=1000, min_speech=300,
            start_margin=100, end_margin=500, output_suffix="no_silence",
            cfr_fps=30, workers=8,
        )
        pipeline.run_silence_removal(stage_args, background_mapping,
                                     mirror_mapping, only=files)

        _write_status(job_id, "running", "stage2")
        gpu_seconds = pipeline.run_background_removal(background_mapping,
                                                      mirror_mapping, only=files)

        _write_status(job_id, "running", "stage3")
        pipeline.process_video_batch(csv_file, max_workers=8, only=files)
        join_plan, joined_prefixes = pipeline.load_join_plan(csv_file)
        phrase_map = pipeline.load_phrase_map(csv_file)
        # `video_file` is the step key for the rendered video, the join and the
        # SRT (falling back to the filename prefix on legacy sheets without it).
        video_file_map = pipeline.load_video_file_map(csv_file)
        _, srt_by_prefix = pipeline.concatenate_all_processed_videos(
            joined_prefixes, phrase_map, video_file_map, join_plan)
        # Persist the computed SRT into the CSV (before the join, so the CSV
        # carries the per-step srt values), then after the join upload the updated
        # CSV back to R2 so the sync-srt action can write the `srt` column into
        # the sheet (story 050, Option B), mirroring video_pipeline.main.
        pipeline.write_srt_column(csv_file, srt_by_prefix, video_file_map)
        pipeline.concatenate_joined_videos(join_plan)
        storage.upload_file(csv_file, pipeline_asset_key("video_data.csv"),
                            content_type="text/csv")

        _write_status(job_id, "running", "publish")
        rows = pipeline.load_csv_rows(csv_file)
        plan = plan_publish(rows, list(join_plan.keys()),
                            os.listdir(pipeline.WEB_DIR), only=files)
        published = _publish(plan)

        # One-click chain: tell GitHub to run SRT write-back -> translation ->
        # config generation. Best-effort — the videos are already published, so a
        # dispatch failure (or unset env) must never fail the render.
        repo = os.environ.get("GH_DISPATCH_REPO")
        token = os.environ.get("GH_DISPATCH_TOKEN")
        if not repo or not token:
            dispatch_note = "skipped"
            print("⚠️ GH_DISPATCH_REPO/GH_DISPATCH_TOKEN unset; skipping render-complete dispatch")
        else:
            result = dispatch_render_complete(
                repo, token, {"jobId": job_id, "published": published}, _github_fetch)
            if result.get("sent"):
                dispatch_note = "sent"
            else:
                dispatch_note = f"failed: {result.get('error')}"
                print(f"⚠️ render-complete dispatch failed: {result.get('error')}")

        wall = time.time() - started
        cost = estimate_cost({
            "gpu_seconds": gpu_seconds,
            "cpu_core_seconds": 8 * wall,
            "memory_gib_seconds": 16 * wall,
        })
        _write_status(job_id, "done", "publish", {
            "published": published,
            "wall_seconds": wall,
            "gpu_seconds": gpu_seconds,
            "estimated_cost_usd": cost,
            "dispatch": dispatch_note,
        })
        return {"jobId": job_id, "published": published, "wall_seconds": wall,
                "gpu_seconds": gpu_seconds}
    except Exception as exc:  # noqa: BLE001 - surface any failure as a status marker
        _write_status(job_id, "error", "error", {"error": str(exc)})
        raise


def _publish(plan):
    """Publish each planned web file plus a 0.2s poster; enforce the web budget."""
    from pipeline_lib import is_within_web_budget, poster_args, reencode_web_args
    import json
    import subprocess
    import tempfile

    published = []
    for entry in plan:
        slug = entry["slug"]
        source = os.path.join(pipeline.WEB_DIR, entry["web_name"])
        if not os.path.exists(source):
            continue
        with tempfile.TemporaryDirectory() as tmp:
            web = source
            probe = _probe(source)
            if not is_within_web_budget(probe):
                web = os.path.join(tmp, "web.mp4")
                subprocess.run(reencode_web_args(source, web), check=True)
            storage.upload_file(web, entry["video_key"], content_type="video/mp4")
            poster = os.path.join(tmp, "poster.jpg")
            subprocess.run(poster_args(web, poster), check=True)
            storage.upload_file(poster, entry["poster_key"], content_type="image/jpeg")
        published.append(slug)
    return published


def _probe(path):
    import json
    import subprocess

    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json",
         "-show_format", "-show_streams", path],
        capture_output=True, text=True, check=True,
    ).stdout
    data = json.loads(out)
    fmt = data.get("format", {})
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    bitrate = fmt.get("bit_rate")
    return {
        "width": video.get("width"),
        "height": video.get("height"),
        "totalBitrateBps": int(bitrate) if bitrate else None,
        "faststart": _is_faststart(path),
    }


def _is_faststart(path):
    try:
        with open(path, "rb") as fh:
            head = fh.read(2 * 1024 * 1024)
    except OSError:
        return None
    for box in _top_level_boxes(head):
        if box == "moov":
            return True
        if box == "mdat":
            return False
    return None


def _top_level_boxes(buffer):
    boxes = []
    offset = 0
    while offset + 8 <= len(buffer):
        size = int.from_bytes(buffer[offset:offset + 4], "big")
        box_type = buffer[offset + 4:offset + 8].decode("latin1", "replace")
        if size < 8:
            break
        boxes.append(box_type)
        offset += size
    return boxes


trigger_image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi[standard]")


@app.function(image=trigger_image)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
def trigger(spec: dict):
    """Validate a render request and spawn the orchestrator (returns immediately)."""
    if not isinstance(spec, dict) or not spec.get("jobId") or not spec.get("files"):
        raise HTTPException(status_code=400, detail="spec requires jobId and files")
    orchestrator.spawn(spec)
    return {"jobId": spec["jobId"]}
