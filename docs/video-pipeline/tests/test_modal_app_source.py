"""Source guards for the Modal app + R2 storage (story 040, Task 7).

These files import modal/boto3 and cannot run in CI, so the wiring is asserted
against the source text. Guards slice specific regions and assert tokens that
appear once, so deleting the wiring fails the test.
"""

import os
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

REPO_ROOT = Path(__file__).resolve().parents[3]
APP = REPO_ROOT / "docs" / "video-pipeline" / "modal_app.py"
STORAGE = REPO_ROOT / "docs" / "video-pipeline" / "storage.py"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def slice_between(text: str, start: str, end: str) -> str:
    i = text.index(start)
    j = text.index(end, i + len(start))
    return text[i:j]


class ModalImageGuardTest(unittest.TestCase):
    def test_cpu_image_has_ffmpeg_chromium_and_local_source(self):
        text = read(APP)
        image = slice_between(text, "cpu_image = (", ")\n\nsecret")
        self.assertIn('"ffmpeg"', image)
        self.assertIn('"chromium"', image)
        self.assertIn('add_local_dir("docs/video-pipeline"', image)
        self.assertIn("PYTHONPATH", image)
        self.assertIn("PIPELINE_WORKDIR", image)
        self.assertIn("PIPELINE_CHROME_NO_SANDBOX", image)

    def test_reuses_the_existing_app_and_gpu_function(self):
        text = read(APP)
        self.assertIn("from video_pipeline import app, process_video_background_modal", text)


class OrchestratorGuardTest(unittest.TestCase):
    def test_orchestrator_resources_and_body(self):
        text = read(APP)
        signature = text.index("def orchestrator(spec: dict):")
        # Decorator is immediately above the def.
        decorator = text.rindex("@app.function(", 0, signature)
        header = text[decorator:signature]
        self.assertIn("image=cpu_image", header)
        self.assertIn("cpu=8", header)
        self.assertIn("memory=16384", header)
        self.assertIn("timeout=7200", header)
        self.assertIn("secrets=[secret]", header)

        body = slice_between(text, "def orchestrator(spec: dict):", "def _publish(")
        for token in ("run_silence_removal", "run_background_removal",
                      "process_video_batch", "concatenate_all_processed_videos",
                      "concatenate_joined_videos", "plan_publish"):
            self.assertIn(token, body, token)
        # Status is serialized through the shared writer the orchestrator calls.
        writer = slice_between(text, "def _write_status(", "def orchestrator(")
        self.assertIn("serialize_status", writer)

    def test_writes_status_after_each_stage(self):
        text = read(APP)
        body = slice_between(text, "def orchestrator(spec: dict):", "def _publish(")
        # A serialize_status call for running, done and error.
        self.assertGreaterEqual(body.count("_write_status("), 5)
        self.assertIn('"running"', body)
        self.assertIn('"done"', body)
        error_block = slice_between(text, "except Exception as exc", "def _publish(")
        self.assertIn('"error"', error_block)
        self.assertIn("serialize_status", read(APP))


class TriggerGuardTest(unittest.TestCase):
    def test_trigger_uses_proxy_auth_and_spawn(self):
        text = read(APP)
        self.assertIn('@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)', text)
        self.assertIn("orchestrator.spawn(", text)
        # The trigger needs no R2 credentials — the secret is orchestrator-only.
        header = slice_between(text, '@app.function(image=trigger_image', "def trigger(spec: dict):")
        self.assertNotIn("secret", header)

    def test_gpu_seconds_flow_into_the_cost_estimate(self):
        text = read(APP)
        body = slice_between(text, "def orchestrator(spec: dict):", "def _publish(")
        # Stage 2 returns the accumulated GPU wall time and it feeds estimate_cost.
        self.assertIn("gpu_seconds = pipeline.run_background_removal(", body)
        self.assertIn('"gpu_seconds": gpu_seconds', body)

    def test_asset_fetch_rejects_path_traversal(self):
        text = read(APP)
        fetch = slice_between(text, "def _fetch_assets(", "def _write_status(")
        self.assertIn("os.path.realpath", fetch)
        self.assertIn("startswith(os.path.realpath(workdir)", fetch)


class StorageGuardTest(unittest.TestCase):
    def test_storage_builds_endpoint_and_exposes_helpers(self):
        text = read(STORAGE)
        self.assertIn("R2_ACCOUNT_ID", text)
        self.assertIn("r2.cloudflarestorage.com", text)
        self.assertIn("R2_BUCKET", text)
        self.assertIn('DEFAULT_BUCKET = "uff"', text)
        for fn in ("def upload_json(", "def read_json(", "def download_to(", "def upload_file("):
            self.assertIn(fn, text, fn)

    # Story 041, Task 4: two-bucket routing driven by the shared key rule.
    def test_defines_public_and_private_bucket_names(self):
        text = read(STORAGE)
        self.assertIn("def public_bucket_name(", text)
        self.assertIn("def private_bucket_name(", text)
        public = slice_between(text, "def public_bucket_name(", "def private_bucket_name(")
        self.assertIn("R2_BUCKET", public)
        self.assertIn("DEFAULT_BUCKET", public)
        private = slice_between(text, "def private_bucket_name(", "def bucket_name(")
        self.assertIn("R2_PRIVATE_BUCKET", private)
        self.assertIn("public_bucket_name(", private)

    def test_imports_and_routes_by_bucket_for_key(self):
        text = read(STORAGE)
        self.assertIn("from pipeline_lib import bucket_for_key", text)
        self.assertIn("def _bucket_for(", text)
        # Every helper selects the bucket through the shared rule, never a
        # hardcoded name.
        for fn in ("def download_to(", "def upload_file(", "def upload_json(",
                   "def list_keys(", "def read_json("):
            start = text.index(fn)
            rest = text[start:]
            next_def = rest.find("\ndef ", 1)
            body = rest if next_def == -1 else rest[:next_def]
            self.assertIn("_bucket_for(", body, fn)
        self.assertIn("bucket_for_key(r2_key)", text)

    def test_no_hardcoded_credentials(self):
        for path in (APP, STORAGE):
            text = read(path)
            self.assertNotIn("R2_ACCESS_KEY_ID =", text)
            self.assertNotIn("R2_SECRET_ACCESS_KEY =", text)
            # No literal AWS-style key assignment.
            self.assertIsNone(re.search(r"['\"]AKIA[0-9A-Z]{16}['\"]", text))

    def test_modal_app_never_names_a_bucket(self):
        # Bucket selection is storage.py's single responsibility: the
        # orchestrator passes keys only, so it cannot pick the wrong bucket.
        text = read(APP)
        self.assertNotIn("R2_PRIVATE_BUCKET", text)
        self.assertNotIn("R2_BUCKET", text)
        for call in ("storage.download_to(", "storage.upload_file(",
                     "storage.upload_json(", "storage.list_keys("):
            self.assertIn(call, text, call)

    def test_read_json_only_swallows_missing(self):
        text = read(STORAGE)
        start = text.index("def read_json(")
        rest = text[start:]
        # End the slice at the next top-level def so a function appended later
        # cannot quietly join the region (AGENTS.md guard rule).
        next_def = rest.find("\ndef ", 1)
        body = rest if next_def == -1 else rest[:next_def]
        # Missing objects return None; real failures must propagate.
        self.assertIn("ClientError", body)
        self.assertIn("return None", body)
        self.assertIn("raise", body)
        self.assertNotIn("except Exception", body)


if __name__ == "__main__":
    unittest.main()
