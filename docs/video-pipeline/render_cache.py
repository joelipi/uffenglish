"""Content-addressed render cache + publish idempotence.

A render used to be all-or-nothing: Stages 1-3 write into the Modal container's
work dir, and the publish step uploads afterwards. Any failure (a stalled
multipart upload, a timeout) discarded the whole run, because the retry starts
with an empty container. On 2026-10-26 that cost a ~50-minute cartoon-preferences
render, and the retry was destined to re-render every frame.

Two mechanisms fix that, and this module is the pure part of both:

1. **Publish idempotence.** Every uploaded object carries ``sha256`` in its R2
   custom metadata. A later run hashes the local file and skips the upload when
   the published object already has that digest. ``should_upload`` decides.
   (S3/R2 multipart ETags are not the file MD5, so the digest must be stored.)

2. **A content-addressed render cache.** The Stage-2 background-removed clips and
   the Stage-3 web/social outputs are stored under
   ``pipeline-assets/render-cache/<course>/<fingerprint>/``. The fingerprint
   covers everything that changes the output — the CSV rows that define the
   takes, the raw takes' identities, and a pipeline version — so a changed
   phrase or a re-recorded take gets a new prefix and a stale cache is never
   used. A retry with the same fingerprint restores the files and the stages
   skip them (``run_silence_removal`` / ``run_background_removal`` /
   ``process_single_video`` all skip an existing output).

Everything here is pure (no boto3, no ffmpeg, no filesystem) so the rules are
unit-testable; the Modal orchestrator supplies the rows and object metadata.
"""

from __future__ import annotations

import hashlib
import json

# Bump when the rendering itself changes shape (a new stage, a different
# composite). Old caches then miss instead of restoring videos that no longer
# match what the pipeline would produce.
RENDER_CACHE_VERSION = 1

CACHE_ROOT = "pipeline-assets/render-cache"

# Columns the pipeline WRITES back or that only affect app copy: they must not
# participate in the fingerprint, or the cache would invalidate itself after a
# successful run (sync-srt writes `srt`, translate-master writes the `_<lang>`
# cells) and every retry would re-render.
_LOCALES = ("es", "pt", "fr", "hi", "bn")


def _is_derived_column(name: str) -> bool:
    """A column that is a pipeline output or pure UI copy, not a render input."""
    column = str(name or "").strip().lower()
    if not column:
        return True
    # srt, srt_es, success_srt_pt, ... — written by the render / translator.
    if column == "srt" or column.endswith("_srt") or column.startswith("srt_"):
        return True
    for lang in _LOCALES:
        if column.endswith("_" + lang):
            return True
    return False


def _canonical(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def row_fingerprint_part(row: dict) -> dict:
    """The render-relevant part of one CSV row (derived columns removed)."""
    items = row.items() if hasattr(row, "items") else []
    return {
        str(k): _canonical(v)
        for k, v in sorted(items)
        if not _is_derived_column(k)
    }


def inputs_fingerprint(rows, take_ids=None, version: int = RENDER_CACHE_VERSION) -> str:
    """A stable SHA-256 over everything that decides the rendered bytes.

    ``rows`` are the CSV dicts in file order (order matters: it drives joins and
    group ordering). ``take_ids`` maps a take slug to its published identity —
    ``{"etag": ..., "size": ...}`` — so a re-recorded take invalidates the
    cache. Derived columns (``srt*``, translations) are excluded: they change
    after a successful run and would otherwise make every retry a cache miss.
    """
    payload = {
        "version": int(version),
        "rows": [row_fingerprint_part(r) for r in (rows or [])],
        "takes": sorted(
            [str(slug), _canonical(meta.get("etag")), int(meta.get("size") or 0)]
            for slug, meta in (take_ids or {}).items()
        ),
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def cache_prefix(course_id: str, fingerprint: str) -> str:
    """The private R2 prefix holding one fingerprint's cache."""
    return f"{CACHE_ROOT}/{course_id}/{fingerprint}/"


def cache_key(course_id: str, fingerprint: str, rel_path: str) -> str:
    return cache_prefix(course_id, fingerprint) + str(rel_path).lstrip("/")


def manifest_key(course_id: str, fingerprint: str) -> str:
    return cache_key(course_id, fingerprint, "manifest.json")


def srt_key(course_id: str, fingerprint: str) -> str:
    return cache_key(course_id, fingerprint, "srt.json")


def bg_key(course_id: str, fingerprint: str, take: str) -> str:
    """Stage-2 output for one raw take (the GPU product)."""
    return cache_key(course_id, fingerprint, f"bg/{take}.mp4")


def output_key(course_id: str, fingerprint: str, kind: str, name: str) -> str:
    """A Stage-3 output: ``kind`` is ``web`` or ``social``, ``name`` its filename."""
    if kind not in ("web", "social"):
        raise ValueError(f"unknown output kind: {kind!r}")
    return cache_key(course_id, fingerprint, f"{kind}/{name}")


def should_upload(published, local_sha256: str) -> bool:
    """Whether a local file must be uploaded over ``published`` (a ``head`` result).

    Absent object -> upload. Present but written by an older pipeline (no
    ``sha256`` metadata) -> upload, because existence is not identity. Present
    with a different digest -> upload. Same digest -> skip.
    """
    if not published:
        return True
    metadata = published.get("metadata") or {}
    return str(metadata.get("sha256") or "") != str(local_sha256 or "")


def manifest_payload(course_id: str, fingerprint: str, plan, objects, srt_by_prefix,
                     take_ids=None, files=None, created: str | None = None) -> dict:
    """The cache manifest: what this fingerprint rendered, and its digests.

    ``objects`` maps an R2 key -> the local file's sha256, so a retry can decide
    "already published" from object metadata alone (no downloads).
    ``plan`` keeps the publish plan, because reconstructing it needs the local
    ``output/web`` listing that a fresh container does not have. ``files`` (the
    requested take slugs) scopes cache eviction: only a manifest with the same
    file set is an older run of the same work.
    """
    entries = []
    for entry in plan or []:
        entries.append({
            "slug": entry.get("slug"),
            "web_name": entry.get("web_name"),
            "video_key": entry.get("video_key"),
            "poster_key": entry.get("poster_key"),
            "social_video_key": entry.get("social_video_key"),
            "social_poster_key": entry.get("social_poster_key"),
        })
    return {
        "version": int(RENDER_CACHE_VERSION),
        "courseId": course_id,
        "fingerprint": fingerprint,
        "created": created,
        "files": sorted(str(f) for f in (files or [])),
        "takes": {str(k): {"etag": _canonical(v.get("etag")), "size": int(v.get("size") or 0)}
                  for k, v in (take_ids or {}).items()},
        "objects": {str(k): str(v) for k, v in (objects or {}).items()},
        "srt": dict(srt_by_prefix or {}),
        "plan": entries,
    }


def plan_from_manifest(manifest) -> list:
    """The publish plan recorded in a manifest, or ``[]`` when unusable."""
    if not isinstance(manifest, dict):
        return []
    if int(manifest.get("version") or 0) != int(RENDER_CACHE_VERSION):
        return []
    plan = manifest.get("plan")
    return list(plan) if isinstance(plan, list) else []


def objects_from_manifest(manifest) -> dict:
    if not isinstance(manifest, dict):
        return {}
    objects = manifest.get("objects")
    return dict(objects) if isinstance(objects, dict) else {}


def srt_from_manifest(manifest) -> dict:
    if not isinstance(manifest, dict):
        return {}
    srt = manifest.get("srt")
    return dict(srt) if isinstance(srt, dict) else {}


def missing_objects(manifest, heads) -> list:
    """The recorded object keys whose published digest does not match.

    ``heads`` maps R2 key -> ``head`` result (or ``None``). An empty list means
    the previous run's output is fully published and a retry only has to
    re-apply the SRT and dispatch — no rendering, no uploads.
    """
    missing = []
    for key, sha in objects_from_manifest(manifest).items():
        if should_upload(heads.get(key), sha):
            missing.append(key)
    return missing
