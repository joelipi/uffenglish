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


class StorageGuardTest(unittest.TestCase):
    def test_storage_builds_endpoint_and_exposes_helpers(self):
        text = read(STORAGE)
        self.assertIn("R2_ACCOUNT_ID", text)
        self.assertIn("r2.cloudflarestorage.com", text)
        self.assertIn("R2_BUCKET", text)
        self.assertIn('DEFAULT_BUCKET = "uff"', text)
        for fn in ("def upload_json(", "def read_json(", "def download_to(", "def upload_file("):
            self.assertIn(fn, text, fn)

    def test_no_hardcoded_credentials(self):
        for path in (APP, STORAGE):
            text = read(path)
            self.assertNotIn("R2_ACCESS_KEY_ID =", text)
            self.assertNotIn("R2_SECRET_ACCESS_KEY =", text)
            # No literal AWS-style key assignment.
            self.assertIsNone(re.search(r"['\"]AKIA[0-9A-Z]{16}['\"]", text))


if __name__ == "__main__":
    unittest.main()
