#!/usr/bin/env python3
"""Behavioural tests for the publish-idempotence helper and the progress hook.

The pure decisions live in ``render_cache`` (tested there). Here the wiring is
exercised on the real ``modal_app`` module: it is loaded with a fake ``modal``
whose ``app.function`` is an identity decorator (so the functions stay callable)
and with ``storage``/``video_pipeline`` stubbed, so no ffmpeg, boto3 or GPU is
involved.
"""

import os
import sys
import types
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE_DIR = os.path.dirname(HERE)
sys.path.insert(0, PIPELINE_DIR)
sys.path.insert(0, HERE)

APP = os.path.join(PIPELINE_DIR, "modal_app.py")


class _Chain:
    """Every attribute/method returns another chainable object (fake modal.Image)."""

    def __getattr__(self, name):
        return _Chain()

    def __call__(self, *args, **kwargs):
        return _Chain()


class _FakeModal(types.ModuleType):
    # `modal.Image` / `modal.Secret` are attributes in the real package (not
    # methods), so they must be chainable attributes here too.
    Image = _Chain()
    Secret = _Chain()

    def __init__(self):
        super().__init__("modal")
        self.app = self

    def function(self, *args, **kwargs):
        return lambda fn: fn          # identity decorator: keep the real function

    def __getattr__(self, name):
        return _Chain()


def load_modal_app():
    """Import modal_app with modal/fastapi/video_pipeline stubbed."""
    import importlib.util

    saved = {n: sys.modules.get(n) for n in ("modal", "fastapi", "video_pipeline")}
    sys.modules["modal"] = _FakeModal()
    fastapi = types.ModuleType("fastapi")
    fastapi.HTTPException = type("HTTPException", (Exception,), {})
    fastapi.Request = type("Request", (), {})
    sys.modules["fastapi"] = fastapi
    vp = types.ModuleType("video_pipeline")
    vp.WEB_DIR = "/tmp/web"
    vp.SOCIAL_DIR = "/tmp/social"
    vp.VIDEO_DIRECTORY = "/tmp/vec"
    sys.modules["video_pipeline"] = vp
    try:
        spec = importlib.util.spec_from_file_location("modal_app_under_test", APP)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        for name, old in saved.items():
            if old is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = old
    return module


class _FakeStorage:
    def __init__(self, published=None, digest="sha-local"):
        self.published = published or {}
        self.digest = digest
        self.uploads = []

    def sha256_file(self, path):
        return self.digest

    def head(self, key):
        return self.published.get(key)

    def upload_file(self, path, key, content_type=None, metadata=None):
        self.uploads.append((key, metadata))
        return key


class UploadIfChangedTest(unittest.TestCase):
    def setUp(self):
        self.app = load_modal_app()

    def test_skips_when_the_published_digest_matches(self):
        fake = _FakeStorage({"assets/videos/s.mp4": {"metadata": {"sha256": "sha-local"}}})
        with mock.patch.object(self.app, "storage", fake):
            digest = self.app._upload_if_changed("/tmp/s.mp4", "assets/videos/s.mp4", "video/mp4")
        self.assertEqual(digest, "sha-local")
        self.assertEqual(fake.uploads, [], "identical bytes must not be re-uploaded")

    def test_uploads_when_the_object_is_missing(self):
        fake = _FakeStorage({})
        with mock.patch.object(self.app, "storage", fake):
            self.app._upload_if_changed("/tmp/s.mp4", "assets/videos/s.mp4", "video/mp4")
        self.assertEqual(fake.uploads, [("assets/videos/s.mp4", {"sha256": "sha-local"})])

    def test_uploads_when_the_published_digest_differs(self):
        fake = _FakeStorage({"assets/videos/s.mp4": {"metadata": {"sha256": "old"}}})
        with mock.patch.object(self.app, "storage", fake):
            self.app._upload_if_changed("/tmp/s.mp4", "assets/videos/s.mp4", "video/mp4")
        self.assertEqual(len(fake.uploads), 1)

    def test_uploads_when_the_object_has_no_digest(self):
        # Written before this feature: existence is not identity.
        fake = _FakeStorage({"assets/videos/s.mp4": {"metadata": {}}})
        with mock.patch.object(self.app, "storage", fake):
            self.app._upload_if_changed("/tmp/s.mp4", "assets/videos/s.mp4", "video/mp4")
        self.assertEqual(len(fake.uploads), 1)


if __name__ == "__main__":
    unittest.main()
