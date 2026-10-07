"""Modal app for the cloud lesson-video pipeline (story 040, Task 7).

Registers the CPU orchestrator on the ``uff-lesson-video`` app and pulls in the
proxy-auth trigger from ``trigger_app`` (the lightweight module Modal imports in
the fastapi-only trigger container):

    modal deploy docs/video-pipeline/modal_app.py

This app registers **no** GPU function (Modal refuses a new T4 function without a
payment method). Background removal calls the separately deployed
``video-background-removal`` app by name through ``modal.Function.from_name``;
that app is not imported here, so the deploy graph stays CPU-only.

``video_pipeline`` is imported **lazily** inside ``orchestrator``/``_publish``:
a module-level import would be pulled into the trigger container, which has only
``fastapi[standard]`` and no pipeline source/deps.
"""

from __future__ import annotations

import argparse
import os
import time

import modal

from trigger_app import app, trigger  # noqa: F401 - `trigger` keeps the endpoint in the deploy graph
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
        # The orchestrator's module imports `trigger_app` (so the deploy includes
        # the trigger), and `trigger_app` imports `fastapi` — so the CPU image
        # needs fastapi too, or the orchestrator container fails to import.
        "fastapi[standard]",
    )
    # `.env` is a build step, so it must come before `.add_local_dir`: Modal
    # requires `add_local_*` to be the last build step (otherwise the build
    # fails with "a build step after add_local_*").
    .env({
        "PYTHONPATH": "/root/pipeline",
        "PIPELINE_WORKDIR": WORKDIR,
        "PIPELINE_CHROME_NO_SANDBOX": "1",
        "PIPELINE_WEB_TARGET_LONG_EDGE": "720",
        "PIPELINE_WEB_AUDIO_BITRATE": "96k",
    })
    .add_local_dir("docs/video-pipeline", remote_path="/root/pipeline")
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


def _publish_intro_posters(csv_file):
    """Publish the lesson-intro posters the step publish plan cannot cover.

    A lesson intro comes from the sheet's ``intro_video`` column, so it is never
    a row slug in ``plan_publish`` and ``_publish`` never sees it — yet the app
    still resolves its poster as ``assets/videos/<slug>.jpg``. This mirrors
    ``scripts/generate-thumbnails.mjs``: for each intro slug whose poster is
    missing or older than its source video, fetch ``assets/videos/<slug>.mp4``
    and write the 0.2s still. Best-effort per slug — a poster must never fail an
    otherwise-good render.
    """
    import subprocess
    import tempfile

    from pipeline_lib import (
        intro_poster_slugs,
        plan_intro_posters,
        poster_args,
        published_poster_key,
        published_video_key,
    )
    import video_pipeline as pipeline

    # Planning reads R2 metadata (`storage.head` re-raises anything that is not a
    # 404) and the videos are already published by the time this runs, so a blip
    # here must not turn a good render into an `error` or suppress the
    # render-complete dispatch chain.
    try:
        rows = pipeline.load_csv_rows(csv_file)
        slugs = intro_poster_slugs(rows)
        # `None` means the object is absent (storage.head maps only a 404 to None).
        posters = {}
        sources = {}
        for slug in slugs:
            posters[slug] = (storage.head(published_poster_key(slug)) or {}).get("last_modified")
            sources[slug] = (storage.head(published_video_key(slug)) or {}).get("last_modified")
        targets = plan_intro_posters(rows, posters, sources)
    except Exception as exc:  # noqa: BLE001 - planning must never fail the render
        print(f"⚠️ intro poster planning failed: {exc}")
        return []

    published = []
    for slug in targets:
        source_key = published_video_key(slug)
        poster_key = published_poster_key(slug)
        if not source_key or not poster_key or sources.get(slug) is None:
            # The intro video is not on R2 yet (uploaded out of band later):
            # there is no still to take.
            continue
        try:
            with tempfile.TemporaryDirectory() as tmp:
                source = os.path.join(tmp, "intro.mp4")
                poster = os.path.join(tmp, "poster.jpg")
                storage.download_to(source_key, source)
                subprocess.run(["ffmpeg", *poster_args(source, poster)], check=True)
                storage.upload_file(poster, poster_key, content_type="image/jpeg")
            published.append(slug)
        except Exception as exc:  # noqa: BLE001 - best-effort, never fail the render
            print(f"⚠️ intro poster failed for {slug}: {exc}")
    return published


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
    # Lazy import: a module-level import is pulled into the fastapi-only trigger
    # container when Modal imports the deploy module to resolve the endpoint;
    # there it fails (no pipeline source/deps). The orchestrator's cpu_image
    # carries the source tree on PYTHONPATH, so the import works here.
    import video_pipeline as pipeline

    job_id = spec["jobId"]
    files = spec["files"]
    os.makedirs(WORKDIR, exist_ok=True)
    started = time.time()

    try:
        _write_status(job_id, "running", "fetch")
        _fetch_assets(WORKDIR)
        _fetch_takes(WORKDIR, files)

        # Create the pipeline's sub-directories (no_silence/, output/social, …)
        # and verify deps/fonts before Stage 1. The local main() calls this;
        # without it Stage 1 fails on the missing `no_silence/`, and a missing
        # font would silently degrade the Stage 3 overlays.
        if not pipeline.setup_environment():
            raise RuntimeError("pipeline environment not ready (missing dependency or font)")

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
        # The plan derives the step/join slugs from the rows themselves (the
        # join column), so it needs only the rendered `output/web` listing.
        plan = plan_publish(rows, os.listdir(pipeline.WEB_DIR), only=files)
        published = _publish(plan)

        # Lesson intros are synthesized from the sheet's `intro_video` column,
        # so they never enter the plan above; the render still owes them their
        # posters (the deploy no longer generates any).
        _write_status(job_id, "running", "posters")
        intro_posters = _publish_intro_posters(csv_file)

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
            "intro_posters": intro_posters,
            "wall_seconds": wall,
            "gpu_seconds": gpu_seconds,
            "estimated_cost_usd": cost,
            "dispatch": dispatch_note,
        })
        return {"jobId": job_id, "published": published, "intro_posters": intro_posters,
                "wall_seconds": wall, "gpu_seconds": gpu_seconds}
    except Exception as exc:  # noqa: BLE001 - surface any failure as a status marker
        _write_status(job_id, "error", "error", {"error": str(exc)})
        raise


def _publish(plan):
    """Publish each planned web file plus a 0.2s poster; enforce the web budget."""
    from pipeline_lib import is_within_web_budget, poster_args, reencode_web_args
    import json
    import subprocess
    import tempfile
    import video_pipeline as pipeline

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
                # `*_args` return ffmpeg *arguments* (they start with `-y`), so
                # the binary must be prepended or Python tries to exec `-y`.
                subprocess.run(["ffmpeg", *reencode_web_args(source, web)], check=True)
            storage.upload_file(web, entry["video_key"], content_type="video/mp4")
            poster = os.path.join(tmp, "poster.jpg")
            subprocess.run(["ffmpeg", *poster_args(web, poster)], check=True)
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

