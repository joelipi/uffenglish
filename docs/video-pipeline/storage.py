"""R2 (S3-compatible) storage helpers for the Modal lesson-video pipeline.

Keys always come from ``pipeline_lib`` so the Python runner and the JavaScript
Pages Functions cannot drift on object layout. Credentials are read from the
environment (supplied by the Modal ``uff-r2`` secret) — never hardcoded here.

Two buckets (story 041): public CDN media (``assets/videos/``, ``videos/``) in
R2_BUCKET (default ``uff``) and private objects (``raw/``, ``raw/status/``,
``pipeline-assets/``) in R2_PRIVATE_BUCKET. Every helper routes by
``pipeline_lib.bucket_for_key`` so a raw key can never land in the public
bucket. ``R2_PRIVATE_BUCKET`` unset falls back to the public bucket, keeping a
single-bucket local run working; the Modal secret always sets it.

Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (default
``uff``), R2_PRIVATE_BUCKET (default ``R2_BUCKET``).
"""

from __future__ import annotations

import os
from contextlib import contextmanager

from pipeline_lib import bucket_for_key

DEFAULT_BUCKET = "uff"


def public_bucket_name(environ=None) -> str:
    env = os.environ if environ is None else environ
    return env.get("R2_BUCKET") or DEFAULT_BUCKET


def private_bucket_name(environ=None) -> str:
    """R2_PRIVATE_BUCKET when set, else the public bucket (single-bucket run)."""
    env = os.environ if environ is None else environ
    return env.get("R2_PRIVATE_BUCKET") or public_bucket_name(env)


def bucket_name(environ=None) -> str:
    return public_bucket_name(environ)


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


def upload_file(local_path, r2_key: str, content_type: str | None = None) -> str:
    """Upload a local file, returning its (CDN) URL."""
    extra = {"ContentType": content_type} if content_type else None
    with r2_client() as client:
        client.upload_file(
            str(local_path), _bucket_for(r2_key), r2_key,
            ExtraArgs=extra or {},
        )
    return f"https://r2.ultrafastfluency.com/{r2_key}"


def upload_json(r2_key: str, payload: str, content_type: str = "application/json") -> str:
    """Put a UTF-8 JSON/text body under ``r2_key``."""
    with r2_client() as client:
        client.put_object(
            Bucket=_bucket_for(r2_key),
            Key=r2_key,
            Body=payload.encode("utf-8"),
            ContentType=content_type,
        )
    return f"https://r2.ultrafastfluency.com/{r2_key}"


def list_keys(prefix: str) -> list:
    """Every object key under ``prefix`` (recursively), sorted."""
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
