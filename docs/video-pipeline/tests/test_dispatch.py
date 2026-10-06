"""Unit tests for the GitHub `render-complete` dispatch helper (story 051).

The helper takes an injected `fetchImpl`, so it runs without network. It must
never raise: a missing repo/token, a non-2xx status and a thrown fetch all become
`{"sent": False, "error": ...}`.
"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pipeline_lib as lib  # noqa: E402


class FakeResponse:
    def __init__(self, status):
        self.status = status


def make_fetch(status=None, exc=None, capture=None):
    def fetch(url, method="GET", headers=None, body=None):
        if capture is not None:
            capture.update(url=url, method=method, headers=headers or {}, body=body)
        if exc is not None:
            raise exc
        return FakeResponse(status)
    return fetch


class DispatchRenderCompleteTest(unittest.TestCase):
    def test_posts_render_complete_with_auth_headers(self):
        capture = {}
        result = lib.dispatch_render_complete(
            "joelipi/uffenglish", "tok", {"jobId": "j1", "published": ["a"]},
            make_fetch(204, capture=capture))
        self.assertEqual(result, {"sent": True})
        self.assertEqual(capture["url"],
                         "https://api.github.com/repos/joelipi/uffenglish/dispatches")
        self.assertEqual(capture["method"], "POST")
        self.assertEqual(capture["headers"]["Authorization"], "Bearer tok")
        self.assertEqual(capture["headers"]["Accept"], "application/vnd.github+json")
        payload = json.loads(capture["body"])
        self.assertEqual(payload["event_type"], "render-complete")
        self.assertEqual(payload["client_payload"], {"jobId": "j1", "published": ["a"]})

    def test_non_2xx_is_an_error_not_a_raise(self):
        result = lib.dispatch_render_complete("r", "t", {}, make_fetch(403))
        self.assertFalse(result["sent"])
        self.assertIn("403", result["error"])

    def test_thrown_fetch_is_caught(self):
        result = lib.dispatch_render_complete(
            "r", "t", {}, make_fetch(exc=RuntimeError("boom")))
        self.assertEqual(result, {"sent": False, "error": "boom"})

    def test_unserializable_payload_is_an_error_not_a_raise(self):
        result = lib.dispatch_render_complete("r", "t", {"bad": {1, 2}}, make_fetch(204))
        self.assertFalse(result["sent"])
        self.assertIn("error", result)

    def test_missing_repo_or_token_is_an_error(self):
        self.assertFalse(lib.dispatch_render_complete("", "t", {}, make_fetch(204))["sent"])
        self.assertFalse(lib.dispatch_render_complete("r", "", {}, make_fetch(204))["sent"])


if __name__ == "__main__":
    unittest.main()
