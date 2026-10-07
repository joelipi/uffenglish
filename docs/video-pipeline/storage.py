"""R2 (S3-compatible) storage helpers for the Modal lesson-video pipeline.

Keys always come from ``pipeline_lib`` so the Python runner and the JavaScript
Pages Functions cannot drift on object layout. Credentials are read from the
environment (supplied by the Modal ``uff-r2`` secret) — never hardcoded here.

Two buckets (story 041): public CDN media (``assets/videos/``, ``videos/``) in
R2_BUCKET (default ``uff``) and private objects (``raw/``, ``raw/status/``,
``pipeline-assets/``) in R2_PRIVATE_BUCKET. Every helper routes by
``pipeline_lib.bucket_for_key`` so a raw key can never land in the public bucket.

The private routing FAILS CLOSED: a private key with ``R2_PRIVATE_BUCKET`` unset
raises rather than falling back to the public bucket, because that fallback would
silently re-expose unpublished takes on the public CDN. A local single-bucket run
must set ``R2_PRIVATE_BUCKET`` (to the same name as ``R2_BUCKET`` if it really
wants one bucket).

Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (default
``uff``), R2_PRIVATE_BUCKET (required whenever a private key is used).
"""

from __future__ import annotations

import os
from contextlib import contextmanager

from pipeline_lib import (
    PUBLISHED_VIDEO_PREFIX,
    UGC_PREFIX,
    bucket_for_key,
    is_private_key,
)

DEFAULT_BUCKET = "uff"


def public_bucket_name(environ=None) -> str:
    env = os.environ if environ is None else environ
    return env.get("R2_BUCKET") or DEFAULT_BUCKET


def private_bucket_name(environ=None) -> str:
    """R2_PRIVATE_BUCKET. Raises when unset so private writes never fall back to
    the public bucket (fail closed)."""
    env = os.environ if environ is None else environ
    name = env.get("R2_PRIVATE_BUCKET")
    if not name:
        raise RuntimeError(
            "R2_PRIVATE_BUCKET is unset; refusing to route a private object to "
            "the public bucket. Set R2_PRIVATE_BUCKET (the same value as "
            "R2_BUCKET for a deliberate single-bucket run)."
        )
    return name


def _bucket_for(r2_key: str, environ=None) -> str:
    """The bucket a key belongs in, per the shared private-key rule."""
    env = os.environ if environ is None else environ
    return private_bucket_name(env) if bucket_for_key(r2_key) == "private" else public_bucket_name(env)


def endpoint_url(environ=None) -> str:
    env = os.environ if environ is None else environ
    account_id = env["R2_ACCOUNT_ID"]
    return f"https://{account_id}.r2.cloudflarestorage.com"


@contextmanager
def r2_client(environ=None):
    """A boto3 S3 client bound to the R2 endpoint. Closed on exit."""
    env = os.environ if environ is None else environ
    import boto3

    client = boto3.client(
        "s3",
        endpoint_url=endpoint_url(env),
        aws_access_key_id=env["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )
    try:
        yield client
    finally:
        client.close()


def download_to(r2_key: str, dest_path) -> str:
    """Download an object to ``dest_path`` (creating parent dirs)."""
    from pathlib import Path

    dest = Path(dest_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with r2_client() as client:
        client.download_file(_bucket_for(r2_key), r2_key, str(dest))
    return str(dest)


def head(r2_key: str):
    """An object's metadata, or ``None`` when it is absent.

    Returns ``{"last_modified": datetime | None, "size": int | None}``. Only a
    genuine 404 maps to ``None``; auth/network failures re-raise, so a
    misconfigured secret cannot masquerade as "no object" (same rule as
    ``read_json``).
    """
    from botocore.exceptions import ClientError

    with r2_client() as client:
        try:
            response = client.head_object(Bucket=_bucket_for(r2_key), Key=r2_key)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code")
            if code in ("NoSuchKey", "404", "NotFound"):
                return None
            raise
    return {
        "last_modified": response.get("LastModified"),
        "size": response.get("ContentLength"),
    }


def upload_file(local_path, r2_key: str, content_type: str | None = None) -> str:
    """Upload a local file. Returns the public CDN URL only for a public key;
    private keys (no custom domain) return the key, not a misleading 404 URL."""
    extra = {"ContentType": content_type} if content_type else None
    with r2_client() as client:
        client.upload_file(
            str(local_path), _bucket_for(r2_key), r2_key,
            ExtraArgs=extra or {},
        )
    if bucket_for_key(r2_key) == "private":
        return r2_key
    return f"https://r2.ultrafastfluency.com/{r2_key}"


def upload_json(r2_key: str, payload: str, content_type: str = "application/json") -> str:
    """Put a UTF-8 JSON/text body under ``r2_key``. Returns the public CDN URL
    only for a public key; private keys return the key."""
    with r2_client() as client:
        client.put_object(
            Bucket=_bucket_for(r2_key),
            Key=r2_key,
            Body=payload.encode("utf-8"),
            ContentType=content_type,
        )
    if bucket_for_key(r2_key) == "private":
        return r2_key
    return f"https://r2.ultrafastfluency.com/{r2_key}"


def list_keys(prefix: str) -> list:
    """Every object key under ``prefix`` (recursively), sorted.

    ``prefix`` must itself resolve under one namespace (it is passed to
    ``_bucket_for``), so a leading private prefix lists the private bucket and a
    public prefix lists the public bucket; an ambiguous prefix raises rather than
    silently returning an empty list from the wrong bucket.
    """
    if not (is_private_key(prefix)
            or prefix.startswith((PUBLISHED_VIDEO_PREFIX, UGC_PREFIX))):
        raise ValueError(
            f"list_keys prefix {prefix!r} does not resolve to a known bucket namespace"
        )
    keys = []
    with r2_client() as client:
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=_bucket_for(prefix), Prefix=prefix):
            for obj in page.get("Contents", []):
                keys.append(obj["Key"])
    return sorted(keys)


def read_json(r2_key: str):
    """Fetch and parse a JSON object, or ``None`` only when it is absent.

    Auth/network failures are re-raised (a missing object is distinguishable
    from a failure to reach R2), so a misconfigured secret cannot masquerade as
    "no marker yet".
    """
    import json

    from botocore.exceptions import ClientError

    with r2_client() as client:
        try:
            obj = client.get_object(Bucket=_bucket_for(r2_key), Key=r2_key)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code")
            if code in ("NoSuchKey", "404", "NotFound"):
                return None
            raise
    return json.loads(obj["Body"].read().decode("utf-8"))
