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
    plan_publish_phrase_takes,
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
    """Download the raw takes and return their published identity.

    The identity (``etag`` + ``size``) feeds the render-cache fingerprint: a
    re-recorded take keeps its slug but changes the bytes, so the cache must miss.
    """
    identities = {}
    for slug in files:
        key = raw_take_key(slug)
        if not key:
            continue
        dest = os.path.join(workdir, "rawvideos", f"{slug}.mp4")
        storage.download_to(key, dest)
        meta = storage.head(key) or {}
        identities[slug] = {"etag": meta.get("etag") or "", "size": meta.get("size") or 0}
    return identities


def _sheet_fetch(url):
    """urllib fetch for the committed master CSV (urlopen follows redirects by default)."""
    import urllib.request

    return urllib.request.urlopen(url, timeout=30)


def _fetch_assets(workdir, course_id: str = ""):
    os.makedirs(workdir, exist_ok=True)
    # Story 065: the committed master CSV is the render's input, not the R2
    # object. Fetch it over HTTP into the work dir as `video_data.csv`;
    # `pipeline-assets/video_data.csv` is now only the post-render output the
    # orchestrator uploads after computing the `srt` column.
    csv_text = fetch_sheet_csv(resolve_sheet_url(course_id=course_id), _sheet_fetch)
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


def _publish_intro_posters(rows):
    """Publish the lesson-intro posters the step publish plan cannot cover.

    A lesson intro comes from the master CSV's ``intro_video`` column, so it is never
    a row slug in ``plan_publish`` and ``_publish`` never sees it — yet the app
    still resolves its poster as ``assets/videos/<slug>.jpg``. This mirrors
    ``scripts/generate-thumbnails.mjs``: for each intro slug whose poster is
    missing or older than its source video, fetch ``assets/videos/<slug>.mp4``
    and write the 0.2s still. Deliberately *not* scoped to the render's ``only``
    files — posters are per-slug and a fresh one is skipped — and best-effort, so
    a poster can never fail an otherwise-good render.
    """
    import subprocess
    import tempfile

    from pipeline_lib import (
        intro_poster_slugs,
        plan_intro_posters,
        poster_args,
        published_poster_key,
        published_video_key,
        social_poster_key,
    )

    # Planning reads R2 metadata (`storage.head` re-raises anything that is not a
    # 404) and the videos are already published by the time this runs, so a blip
    # here must not turn a good render into an `error` or suppress the
    # render-complete dispatch chain.
    try:
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
                # Private social-still twin (still best-effort: a failure here
                # prints and continues, never fails the render).
                storage.upload_file(poster, social_poster_key(slug),
                                    content_type="image/jpeg")
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


def _evict_stale_cache(course_id, fingerprint, files):
    """Delete caches for the SAME take set under an older fingerprint.

    Bounded growth: every changed input produces a new fingerprint, so without
    this the bucket keeps every version forever. Scoped by ``files`` so a
    parallel per-lesson job's cache is never touched. Best-effort.
    """
    import render_cache

    try:
        root = f"{render_cache.CACHE_ROOT}/{course_id}/"
        prefixes = set()
        for key in storage.list_keys(root):
            rest = key[len(root):]
            if "/" in rest:
                prefixes.add(rest.split("/", 1)[0])
        for other in prefixes:
            if other == fingerprint:
                continue
            manifest = _load_manifest(course_id, other)
            if not render_cache.shares_file_set(manifest, files):
                continue
            for key in storage.list_keys(f"{root}{other}/"):
                storage.delete_object(key)
            print(f"🧹 evicted stale render cache {other[:12]} for the same take set")
    except Exception as exc:  # noqa: BLE001 - cache maintenance is best-effort
        print(f"⚠️ render cache eviction failed: {exc}")


def _rows_for_files(rows, files):
    """The CSV rows that define this run's takes (the cache fingerprint's input).

    A row whose ``filename`` is in scope defines a take; rows without one (the
    branch/answer variant rows) do not change the rendered bytes on their own,
    but their step key does, so include rows whose ``video_file`` is in scope too.
    """
    wanted = {str(f).strip() for f in files}
    scoped = []
    for row in rows or []:
        name = str(row.get("filename") or "").strip()
        step = str(row.get("video_file") or "").strip()
        if (name and name in wanted) or (step and step in wanted):
            # Plain dicts: the fingerprint helper must not receive pandas Series.
            scoped.append({k: v for k, v in row.items()})
    return scoped or [{k: v for k, v in row.items()} for row in (rows or [])]


def _load_manifest(course_id, fingerprint):
    """The render cache's manifest for this fingerprint, or None.

    A cache is an optimization, never a gate: any read problem is a miss.
    """
    import render_cache

    try:
        return storage.read_json(render_cache.manifest_key(course_id, fingerprint))
    except Exception as exc:  # noqa: BLE001 - a broken cache must not fail a render
        print(f"⚠️ render cache manifest unreadable: {exc}")
        return None


def _restore_cached_bg(course_id, fingerprint, files, cache_keys):
    """Restore Stage-2 outputs into ``VIDEO_DIRECTORY``; returns the take slugs restored."""
    import render_cache
    import video_pipeline as pipeline

    restored = []
    for take in files:
        dest = os.path.join(pipeline.VIDEO_DIRECTORY, f"{take}_no_silence_bg_removed.mp4")
        if os.path.exists(dest):
            restored.append(take)
            continue
        key = render_cache.bg_key(course_id, fingerprint, take)
        if key not in cache_keys:
            continue
        try:
            storage.download_to(key, dest)
            restored.append(take)
        except Exception as exc:  # noqa: BLE001 - fall back to rendering this take
            print(f"⚠️ render cache restore failed for {take}: {exc}")
    return restored


def _restore_from_cache(course_id, fingerprint, plan, cache_keys, objects):
    """Download the sources a publish still needs. False when the cache cannot.

    Only the entries whose published objects are missing or stale need their
    source, so a retry after one failed upload downloads that one file rather
    than the whole course. Returns ``(ok, already_current_slugs)``: a slug whose
    objects all match is live already and has no local source, so the caller must
    still report it as published.
    """
    import render_cache
    import video_pipeline as pipeline

    current = []
    for entry in plan:
        web_name = entry.get("web_name")
        need_web = any(
            render_cache.should_upload(storage.head(entry.get(key)), objects.get(entry.get(key), ""))
            for key in ("video_key", "poster_key")
        )
        if need_web:
            key = render_cache.output_key(course_id, fingerprint, "web", web_name)
            if key not in cache_keys:
                return False, current
            storage.download_to(key, os.path.join(pipeline.WEB_DIR, web_name))
        # A per-take phrase video may have no social twin at all; the cache is
        # the source of truth for "this entry had one", so an entry without a
        # cached social file must not demand one (that would fall back to a
        # full re-render for the whole run).
        social_cache_key = render_cache.output_key(course_id, fingerprint, "social", web_name)
        need_social = social_cache_key in cache_keys and any(
            render_cache.should_upload(storage.head(entry.get(key)), objects.get(entry.get(key), ""))
            for key in ("social_video_key", "social_poster_key")
        )
        if need_social:
            storage.download_to(social_cache_key, os.path.join(pipeline.SOCIAL_DIR, web_name))
        if not need_web and not need_social:
            current.append(entry.get("slug"))
    return True, current


def _write_manifest(course_id, fingerprint, plan, srt_by_prefix, take_ids, files, objects):
    """Persist the cache manifest (best-effort)."""
    import json
    from datetime import datetime, timezone

    import render_cache

    payload = render_cache.manifest_payload(
        course_id, fingerprint, plan, objects, srt_by_prefix,
        take_ids=take_ids, files=files,
        created=datetime.now(timezone.utc).isoformat(),
    )
    storage.upload_json(render_cache.manifest_key(course_id, fingerprint),
                        json.dumps(payload))


def _store_render_cache(course_id, fingerprint, files, plan, srt_by_prefix, take_ids):
    """Persist what this run rendered, so a retry can skip Stages 1-3.

    Written BEFORE the publish: a publish failure then leaves a retry with only
    uploads (and the hash-skip) to do. Best-effort — a cache write must never
    fail an otherwise-good render.
    """
    import json

    import render_cache
    import video_pipeline as pipeline

    try:
        for take in files:
            local = os.path.join(pipeline.VIDEO_DIRECTORY, f"{take}_no_silence_bg_removed.mp4")
            if os.path.exists(local):
                _upload_if_changed(local, render_cache.bg_key(course_id, fingerprint, take),
                                   "video/mp4")
        for entry in plan:
            for kind, directory in (("web", pipeline.WEB_DIR), ("social", pipeline.SOCIAL_DIR)):
                local = os.path.join(directory, entry["web_name"])
                if os.path.exists(local):
                    _upload_if_changed(
                        local,
                        render_cache.output_key(course_id, fingerprint, kind, entry["web_name"]),
                        "video/mp4")
        storage.upload_json(render_cache.srt_key(course_id, fingerprint),
                            json.dumps(srt_by_prefix or {}))
        _write_manifest(course_id, fingerprint, plan, srt_by_prefix, take_ids, files, objects={})
    except Exception as exc:  # noqa: BLE001 - cache is an optimization
        print(f"⚠️ render cache write failed: {exc}")


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
    # The course whose master CSV this render reads. The trigger requires it.
    course_id = spec["course"]
    os.makedirs(WORKDIR, exist_ok=True)
    started = time.time()
    progress_state = {"published": [], "social_published": []}

    def _on_publish_progress(pub, social):
        # Written after every entry, so a failure's marker names exactly what
        # landed. Before this, a timeout reported `published: []` while a dozen
        # objects were live.
        progress_state["published"] = list(pub)
        progress_state["social_published"] = list(social)
        _write_status(job_id, "running", "publish", dict(progress_state))

    try:
        import render_cache

        _write_status(job_id, "running", "fetch")
        _fetch_assets(WORKDIR, course_id=course_id)
        take_ids = _fetch_takes(WORKDIR, files)

        # Create the pipeline's sub-directories (no_silence/, output/social, …)
        # and verify deps/fonts before Stage 1. The local main() calls this;
        # without it Stage 1 fails on the missing `no_silence/`, and a missing
        # font would silently degrade the Stage 3 overlays.
        if not pipeline.setup_environment():
            raise RuntimeError("pipeline environment not ready (missing dependency or font)")

        csv_file = os.path.join(WORKDIR, "video_data.csv")
        video_file_map = pipeline.load_video_file_map(csv_file)
        rows = pipeline.load_csv_rows(csv_file)

        # Content-addressed render cache: the fingerprint covers this run's CSV
        # rows and the raw takes' published identities, so unchanged inputs hit
        # and a retry skips Stages 1-3 instead of re-rendering every frame.
        fingerprint = render_cache.inputs_fingerprint(_rows_for_files(rows, files), take_ids)
        manifest = _load_manifest(course_id, fingerprint)
        cache_keys = set()
        if manifest:
            cache_keys = set(storage.list_keys(render_cache.cache_prefix(course_id, fingerprint)))
        plan = render_cache.plan_from_manifest(manifest) if manifest else []
        cache_objects = render_cache.objects_from_manifest(manifest) if manifest else {}
        current_slugs = []
        restored = False
        if plan:
            restored, current_slugs = _restore_from_cache(
                course_id, fingerprint, plan, cache_keys, cache_objects)
        gpu_seconds = 0.0

        if restored:
            print(f"♻️ render cache hit: {len(plan)} publish entries, Stages 1-3 skipped")
            _write_status(job_id, "running", "publish")
            srt_by_prefix = render_cache.srt_from_manifest(manifest)
            pipeline.write_srt_column(csv_file, srt_by_prefix, video_file_map)
            storage.upload_file(csv_file, pipeline_asset_key("video_data.csv"),
                                content_type="text/csv")
        else:
            background_mapping, mirror_mapping = pipeline.load_background_mapping(csv_file)
            # Restore whatever Stage-2 outputs the cache has; the stages skip an
            # existing output, so this saves the GPU work for finished takes.
            restored_takes = _restore_cached_bg(course_id, fingerprint, files, cache_keys)
            if restored_takes and set(restored_takes) >= set(files):
                print(f"♻️ render cache hit: all {len(files)} takes restored, Stages 1-2 skipped")
            else:
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
            # SRT (falling back to the filename prefix on legacy rows without it).
            video_file_map = pipeline.load_video_file_map(csv_file)
            _, srt_by_prefix = pipeline.concatenate_all_processed_videos(
                joined_prefixes, phrase_map, video_file_map, join_plan)
            # Persist the computed SRT into the CSV (before the join, so the CSV
            # carries the per-step srt values), then after the join upload the updated
            # CSV back to R2 so the sync-srt action can write the `srt` column into
            # the master CSV (story 050, Option B), mirroring video_pipeline.main.
            pipeline.write_srt_column(csv_file, srt_by_prefix, video_file_map)
            pipeline.concatenate_joined_videos(join_plan)
            storage.upload_file(csv_file, pipeline_asset_key("video_data.csv"),
                                content_type="text/csv")

            _write_status(job_id, "running", "publish")
            rows = pipeline.load_csv_rows(csv_file)
            # The plan derives the step/join slugs from the rows themselves (the
            # join column), so it needs the rendered `output/web` listing; the
            # social twins share one compositing pass with it.
            plan = plan_publish(rows, os.listdir(pipeline.WEB_DIR), only=files)
            # Per-take phrase-only web videos are named after the raw take (no
            # `processed_`/`_full` suffix) and are served to the app as-is.
            take_plan = plan_publish_phrase_takes(os.listdir(pipeline.WEB_DIR), only=files)
            seen = {e["slug"] for e in plan}
            take_plan = [e for e in take_plan if e["slug"] not in seen]
            plan = plan + take_plan
            # Cache BEFORE publishing: if the publish dies, the retry restores
            # these files instead of re-rendering them.
            _store_render_cache(course_id, fingerprint, files, plan, srt_by_prefix, take_ids)

        publish_result = _publish(plan, on_progress=_on_publish_progress)
        # An entry with no local source (fully current cache hit) is still live;
        # report it, or a "nothing to do" retry looks like it published nothing.
        social_current = [
            entry.get("slug") for entry in plan
            if entry.get("slug") in current_slugs
            and cache_objects.get(entry.get("social_video_key"))
        ]
        published = list(dict.fromkeys(current_slugs + publish_result["published"]))
        social_published = list(dict.fromkeys(social_current + publish_result["social_published"]))
        # Record the published digests, so a later retry can prove from object
        # metadata that there is nothing left to do (no downloads at all).
        try:
            _write_manifest(course_id, fingerprint, plan, srt_by_prefix, take_ids, files,
                            objects=publish_result.get("digests") or {})
        except Exception as exc:  # noqa: BLE001 - cache is an optimization
            print(f"⚠️ render cache manifest finalize failed: {exc}")
        # Only after a successful publish: an older cache is superseded.
        _evict_stale_cache(course_id, fingerprint, files)


        # Lesson intros are synthesized from the master CSV's `intro_video` column,
        # so they never enter the plan above; the render still owes them their
        # posters (the deploy no longer generates any).
        # Keep the publish progress on the posters stage: a poller must not see
        # published drop back to empty while the run is still healthy.
        _write_status(job_id, "running", "posters", dict(progress_state))
        intro_posters = _publish_intro_posters(rows)

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
            "social_published": social_published,
            "intro_posters": intro_posters,
            "wall_seconds": wall,
            "gpu_seconds": gpu_seconds,
            "estimated_cost_usd": cost,
            "dispatch": dispatch_note,
        })
        return {"jobId": job_id, "published": published, "social_published": social_published,
                "intro_posters": intro_posters,
                "wall_seconds": wall, "gpu_seconds": gpu_seconds}
    except Exception as exc:  # noqa: BLE001 - surface any failure as a status marker
        # Carry the publish progress: a failed run must say what already landed.
        _write_status(job_id, "error", "error", {"error": str(exc), **progress_state})
        raise


def _upload_if_changed(local_path, r2_key, content_type):
    """Upload only when the published object's ``sha256`` differs.

    Existence is not identity: an object written by an older pipeline carries no
    digest and is re-uploaded. Returns the local file's digest either way, so
    the caller can record what the published bytes are.
    """
    import render_cache

    digest = storage.sha256_file(local_path)
    if render_cache.should_upload(storage.head(r2_key), digest):
        storage.upload_file(local_path, r2_key, content_type=content_type,
                            metadata={"sha256": digest})
    return digest


def _publish(plan, on_progress=None):
    """Publish each planned web file plus a 0.2s poster; enforce the web budget.

    Every entry also publishes its private **social twin** — the CRF-18
    full-resolution master the operator uploads to TikTok/IG — plus a
    ``poster_args`` still cut from that master. Social files upload as-is (no
    budget check, no re-encode: the master is the high-quality source) and are
    required, so a social upload error propagates exactly like a web one.

    Uploads are idempotent (``_upload_if_changed``), so a retry re-sends only the
    objects whose bytes changed. ``on_progress(published, social_published)`` is
    called after each entry, so a failure's status marker names exactly what
    landed instead of reporting an empty list.
    """
    from pipeline_lib import (
        is_within_web_budget,
        poster_args,
        reencode_web_args,
        social_poster_key,
        social_video_key,
    )
    import json
    import subprocess
    import tempfile
    import video_pipeline as pipeline

    published = []
    social_published = []
    digests = {}
    for entry in plan:
        slug = entry["slug"]
        source = os.path.join(pipeline.WEB_DIR, entry["web_name"])
        social_source = os.path.join(pipeline.SOCIAL_DIR, entry["web_name"])
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
            digests[entry["video_key"]] = _upload_if_changed(
                web, entry["video_key"], "video/mp4")
            poster = os.path.join(tmp, "poster.jpg")
            subprocess.run(["ffmpeg", *poster_args(web, poster)], check=True)
            digests[entry["poster_key"]] = _upload_if_changed(
                poster, entry["poster_key"], "image/jpeg")
            # The social twin: same missing-file skip as web, no budget path.
            if os.path.exists(social_source):
                digests[social_video_key(slug)] = _upload_if_changed(
                    social_source, social_video_key(slug), "video/mp4")
                social_poster = os.path.join(tmp, "social-poster.jpg")
                subprocess.run(["ffmpeg", *poster_args(social_source, social_poster)],
                               check=True)
                digests[social_poster_key(slug)] = _upload_if_changed(
                    social_poster, social_poster_key(slug), "image/jpeg")
                social_published.append(slug)
            else:
                # Loud, never silent: the web twin exists (just published), so
                # a missing social master means the compositing pass died
                # halfway or `output/` was edited. The operator must see it
                # here rather than when uploading to TikTok/IG.
                print(f"\u26a0\ufe0f social twin missing for {slug}: "
                      f"{entry['web_name']} (web published, social not)")
        published.append(slug)
        if on_progress:
            on_progress(list(published), list(social_published))
    return {"published": published, "social_published": social_published,
            "digests": digests}



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

