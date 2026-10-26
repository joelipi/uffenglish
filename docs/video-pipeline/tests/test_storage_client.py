#!/usr/bin/env python3
"""The R2 client must retry a stalled upload instead of failing the render.

2026-10-26: a cartoon-preferences render finished Stages 1-3, then died in
``_publish`` with ``ReadTimeoutError`` on one multipart part of
``pipeline-assets/social/...-c-01.mp4`` — discarding ~50 minutes of work. The
boto3 client was built with no explicit config, so the default 60 s read
timeout surfaced the stall. These tests pin the resilience settings to the
client the helpers actually build.
"""

import os
import sys
import unittest
from contextlib import contextmanager
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import storage  # noqa: E402  (path set up above)


ENV = {
    "R2_ACCOUNT_ID": "acc",
    "R2_ACCESS_KEY_ID": "key",
    "R2_SECRET_ACCESS_KEY": "secret",
}


class FakeClient:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


class R2ClientResilienceTest(unittest.TestCase):
    def _build(self):
        captured = {}

        def fake_client(service_name, **kwargs):
            captured["service"] = service_name
            captured.update(kwargs)
            return FakeClient()

        with mock.patch("boto3.client", fake_client):
            with storage.r2_client(ENV) as client:
                self.assertIsInstance(client, FakeClient)
                self.assertFalse(client.closed)
        return captured

    def test_client_is_built_with_a_retry_config(self):
        captured = self._build()
        self.assertEqual(captured["service"], "s3")
        self.assertIn("config", captured, "r2_client must pass an explicit Config")

    def test_read_timeout_absorbs_a_slow_part(self):
        cfg = self._build()["config"]
        self.assertEqual(cfg.read_timeout, storage.R2_READ_TIMEOUT)
        self.assertGreaterEqual(cfg.read_timeout, 120)
        self.assertEqual(cfg.connect_timeout, storage.R2_CONNECT_TIMEOUT)

    def test_standard_retry_mode_covers_read_timeouts(self):
        cfg = self._build()["config"]
        self.assertEqual(cfg.retries["mode"], "standard")
        self.assertEqual(cfg.retries["max_attempts"], storage.R2_MAX_ATTEMPTS)
        self.assertGreaterEqual(cfg.retries["max_attempts"], 10)

    def test_every_helper_goes_through_the_shared_client(self):
        """upload/download/head/json must all build the resilient client, or a
        helper bypasses the retry settings the tests above pin."""
        calls = []

        @contextmanager
        def fake_r2_client(environ=None):
            calls.append(environ)
            yield mock.MagicMock()

        with mock.patch.object(storage, "r2_client", fake_r2_client):
            storage.head("assets/videos/x.mp4")
            storage.upload_json("assets/videos/x.json", "{}")
            storage.upload_file(__file__, "assets/videos/x.mp4")
            storage.download_to("assets/videos/x.mp4", os.devnull)

        self.assertEqual(len(calls), 4, "a helper built its own client")
        self.assertEqual(calls, [None, None, None, None])


if __name__ == "__main__":
    unittest.main()
