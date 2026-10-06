"""Source guards for the Modal app + R2 storage (story 040, Task 7).

These files import modal/boto3 and cannot run in CI, so the wiring is asserted
against the source text. Guards slice specific regions and assert tokens that
appear once, so deleting the wiring fails the test.
"""

import ast
import importlib.util
import os
import re
import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

REPO_ROOT = Path(__file__).resolve().parents[3]
APP = REPO_ROOT / "docs" / "video-pipeline" / "modal_app.py"
TRIGGER = REPO_ROOT / "docs" / "video-pipeline" / "trigger_app.py"
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

    def test_reuses_the_existing_lesson_app_without_the_gpu_function(self):
        # Story 053: this module reuses only the `uff-lesson-video` app handle;
        # the T4 function is resolved from the separately deployed app. (The
        # deploy-graph no-GPU scan and the `background_removal_app` import guard
        # live in test_pipeline_source.py / test_background_removal_wiring.py.)
        # Story 054: the app handle now comes from the lightweight trigger module
        # (Modal imports that module in the fastapi-only trigger container).
        text = read(APP)
        self.assertIn("from trigger_app import app, trigger", text)
        self.assertNotIn("process_video_background_modal", text)


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
        # Story 051: the orchestrator also gets the uff-github dispatch secret.
        self.assertIn("secrets=[secret, github_secret]", header)

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
    def _assert_trigger_contract(self, text):
        self.assertIn('@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)', text)
        self.assertIn('modal.Function.from_name("uff-lesson-video", "orchestrator").spawn(spec)', text)
        # The trigger needs no R2 credentials — the secret is orchestrator-only.
        header = slice_between(text, '@app.function(image=trigger_image', "def trigger(spec: dict):")
        self.assertNotIn("secret", header)

    def test_trigger_uses_proxy_auth_and_spawn(self):
        # Story 054: the endpoint lives in the lightweight `trigger_app` module
        # (Modal imports it in the fastapi-only trigger container), so it spawns
        # the orchestrator by name rather than by direct object reference.
        self._assert_trigger_contract(read(TRIGGER))

    def test_trigger_guard_can_fail(self):
        good = read(TRIGGER)
        for token in ('modal.Function.from_name("uff-lesson-video", "orchestrator").spawn(spec)',
                      '@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)'):
            mutated = "SENTINEL_REMOVED".join(good.split(token))
            self.assertNotEqual(mutated, good, token)
            with self.assertRaises(AssertionError, msg=token):
                self._assert_trigger_contract(mutated)

    def test_gpu_seconds_flow_into_the_cost_estimate(self):
        text = read(APP)
        body = slice_between(text, "def orchestrator(spec: dict):", "def _publish(")
        # Stage 2 returns the accumulated GPU wall time and it feeds estimate_cost.
        self.assertIn("gpu_seconds = pipeline.run_background_removal(", body)
        self.assertIn('"gpu_seconds": gpu_seconds', body)

    def test_persists_the_updated_video_data_csv_to_r2(self):
        # Story 050, Task 5: the orchestrator writes the computed srt column into
        # the CSV (mirroring video_pipeline.main) and uploads the updated CSV back
        # to R2 so the sync-srt Action can read the `srt` column.
        text = read(APP)
        body = slice_between(text, "def orchestrator(spec: dict):", "def _publish(")
        self.assertIn("write_srt_column", body)
        self.assertIn('pipeline_asset_key("video_data.csv")', body)
        self.assertIn("storage.upload_file(csv_file", body)
        # Order: concatenate -> write_srt_column -> upload, after concatenation.
        self.assertLess(body.index("concatenate_all_processed_videos"),
                        body.index("write_srt_column"))
        self.assertLess(body.index("write_srt_column"),
                        body.index('pipeline_asset_key("video_data.csv")'))

    def test_asset_fetch_rejects_path_traversal(self):
        text = read(APP)
        fetch = slice_between(text, "def _fetch_assets(", "def _write_status(")
        self.assertIn("os.path.realpath", fetch)
        self.assertIn("startswith(os.path.realpath(workdir)", fetch)


class DeployGraphImportGuardTest(unittest.TestCase):
    """Story 054: the trigger container installs only ``fastapi[standard]``.

    Modal imports the *defining* module of the trigger endpoint inside that
    container, so ``trigger_app.py`` must import nothing from the pipeline and
    ``modal_app.py`` must not import ``video_pipeline`` at module level (it is
    imported lazily inside the orchestrator/publish functions, which run in the
    CPU image that carries the source tree).
    """

    @staticmethod
    def _module_level_imports(text):
        tree = ast.parse(text)
        names = set()
        for node in tree.body:  # top level only — lazy imports are inside defs
            if isinstance(node, ast.Import):
                names.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                names.add(node.module)
        return names

    def _assert_app_imports(self, text):
        # No module-level pipeline import (the trigger container would need it)...
        self.assertNotIn("video_pipeline", self._module_level_imports(text))
        # ...but it must still be imported lazily, or the orchestrator breaks.
        self.assertIn("import video_pipeline as pipeline", text)
        body = slice_between(text, "def orchestrator(spec: dict):", "def _publish(")
        self.assertIn("import video_pipeline as pipeline", body)
        publish = slice_between(text, "def _publish(plan):", "def _probe(")
        self.assertIn("import video_pipeline as pipeline", publish)

    def _assert_trigger_imports(self, text):
        # Only the trigger container's own deps; nothing from the pipeline.
        imports = self._module_level_imports(text)
        self.assertIn("modal", imports)
        self.assertIn("fastapi", imports)
        self.assertNotIn("video_pipeline", imports)
        self.assertNotIn("video_pipeline", text)

    def test_modal_app_has_no_module_level_pipeline_import(self):
        self._assert_app_imports(read(APP))

    def test_trigger_module_imports_no_pipeline(self):
        self._assert_trigger_imports(read(TRIGGER))

    def test_import_guards_can_fail(self):
        # A module-level pipeline import must fail the modal_app guard.
        with self.assertRaises(AssertionError):
            self._assert_app_imports("import video_pipeline as pipeline\n" + read(APP))
        # A pipeline import in the trigger module must fail the trigger guard.
        with self.assertRaises(AssertionError):
            self._assert_trigger_imports(read(TRIGGER) + "\nimport video_pipeline  # noqa: F401\n")


class _StubModule(types.ModuleType):
    """Returns a chainable sentinel for any attribute (stubbed heavy deps)."""

    def __getattr__(self, name):
        value = _Any()
        setattr(self, name, value)
        return value


class _Any:
    def __init__(self, *args, **kwargs):
        pass

    def __call__(self, *args, **kwargs):
        return _Any()

    def __getattr__(self, name):
        return _Any()


class TriggerModuleImportTest(unittest.TestCase):
    """The trigger container installs only ``fastapi[standard]``, so importing
    the module that defines the endpoint must not need the pipeline (the original
    failure: ``ModuleNotFoundError: No module named 'video_pipeline'``)."""

    def test_imports_with_only_modal_and_fastapi(self):
        names = ("modal", "fastapi", "video_pipeline")
        saved = {name: sys.modules.get(name) for name in names}
        sys.modules["modal"] = _StubModule("modal")
        sys.modules["fastapi"] = _StubModule("fastapi")
        sys.modules.pop("video_pipeline", None)
        try:
            spec = importlib.util.spec_from_file_location("trigger_app_under_test", TRIGGER)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            # Assert inside the try, before `finally` restores sys.modules:
            # loading the module must not have dragged the pipeline in.
            self.assertNotIn("video_pipeline", sys.modules)
            self.assertTrue(hasattr(module, "trigger"))
        finally:
            for name, old in saved.items():
                if old is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = old


class SheetFetchGuardTest(unittest.TestCase):
    """Story 052: the render reads the published sheet, not the R2 CSV object.

    ``_fetch_assets`` must fetch the sheet URL (``PIPELINE_SHEET_URL``/``SHEET_URL``)
    over HTTP into ``video_data.csv`` and must no longer download
    ``pipeline_asset_key("video_data.csv")``; the post-render upload stays.
    """

    def _assert_contract(self, text):
        fetch = slice_between(text, "def _fetch_assets(", "def _write_status(")
        self.assertIn("resolve_sheet_url(", fetch)
        self.assertIn("fetch_sheet_csv(", fetch)
        self.assertIn('os.path.join(workdir, "video_data.csv")', fetch)
        self.assertNotIn('storage.download_to(pipeline_asset_key("video_data.csv")', fetch)
        # The post-render output upload (sync-srt.yml reads it) is untouched.
        body = slice_between(text, "def orchestrator(spec: dict):", "def _publish(")
        self.assertIn('storage.upload_file(csv_file, pipeline_asset_key("video_data.csv")', body)

    def test_fetch_assets_reads_the_sheet_not_r2(self):
        self._assert_contract(read(APP))

    def test_guard_can_fail(self):
        good = read(APP)
        for token in ("resolve_sheet_url(", "fetch_sheet_csv("):
            mutated = "SENTINEL_REMOVED".join(good.split(token))
            self.assertNotEqual(mutated, good, token)
            with self.assertRaises(AssertionError, msg=token):
                self._assert_contract(mutated)
        # Re-introducing the old R2 download must fail the guard too.
        reverted = good.replace(
            "    for tree in FETCH_TREES:",
            '    storage.download_to(pipeline_asset_key("video_data.csv"),\n'
            '                        os.path.join(workdir, "video_data.csv"))\n'
            "    for tree in FETCH_TREES:",
            1,
        )
        self.assertNotEqual(reverted, good)
        with self.assertRaises(AssertionError):
            self._assert_contract(reverted)


class DispatchGuardTest(unittest.TestCase):
    """Story 051: the orchestrator dispatches `render-complete` best-effort."""

    def _assert_contract(self, text):
        body = slice_between(text, "def orchestrator(spec: dict):", "def _publish(")
        self.assertIn("dispatch_render_complete(", body)
        self.assertIn("GH_DISPATCH_REPO", body)
        self.assertIn("GH_DISPATCH_TOKEN", body)
        self.assertIn('"dispatch": dispatch_note', body)
        self.assertIn('"skipped"', body)
        self.assertIn("if not repo or not token:", body)
        self.assertIn('dispatch_note = "sent"', body)
        self.assertIn('dispatch_note = f"failed: {result.get(\'error\')}"', body)
        self.assertIn('modal.Secret.from_name("uff-github")', text)
        # Called once, after publish, and recorded in the `done` extra.
        self.assertEqual(body.count("dispatch_render_complete("), 1)
        self.assertLess(body.index("published = _publish(plan)"),
                        body.index("dispatch_render_complete("))
        self.assertLess(body.index("dispatch_render_complete("),
                        body.index('"dispatch": dispatch_note'))

    def test_orchestrator_dispatches_render_complete_best_effort(self):
        self._assert_contract(read(APP))

    def test_guard_can_fail(self):
        good = read(APP)
        for token in ("dispatch_render_complete(", "GH_DISPATCH_TOKEN",
                      '"dispatch": dispatch_note', 'modal.Secret.from_name("uff-github")'):
            mutated = "SENTINEL_REMOVED".join(good.split(token))
            self.assertNotEqual(mutated, good, token)
            with self.assertRaises(AssertionError, msg=token):
                self._assert_contract(mutated)


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
        private = slice_between(text, "def private_bucket_name(", "def _bucket_for(")
        self.assertIn("R2_PRIVATE_BUCKET", private)

    def test_private_routing_fails_closed(self):
        # A private key must never fall back to the public bucket: an unset
        # R2_PRIVATE_BUCKET raises instead of re-exposing raw takes.
        text = read(STORAGE)
        private = slice_between(text, "def private_bucket_name(", "def _bucket_for(")
        self.assertIn("raise", private)
        self.assertNotIn("public_bucket_name(", private)

    def test_private_bucket_name_raises_behaviorally(self):
        # storage.py imports without boto3 (it is lazy), so exercise the real
        # function: unset -> raises; set -> returns the name; public routes are
        # unaffected by an unset private name.
        import importlib.util

        spec = importlib.util.spec_from_file_location("pipeline_storage", STORAGE)
        storage = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(storage)

        with self.assertRaises(RuntimeError):
            storage.private_bucket_name({})
        self.assertEqual(storage.private_bucket_name({"R2_PRIVATE_BUCKET": "uff-private"}),
                         "uff-private")
        self.assertEqual(storage._bucket_for("assets/videos/x.mp4", {}), "uff")
        with self.assertRaises(RuntimeError):
            storage._bucket_for("raw/x.mp4", {})

    def test_bucket_name_alias_is_gone(self):
        self.assertNotIn("def bucket_name(", read(STORAGE))

    def test_list_keys_rejects_an_unknown_prefix(self):
        # An ambiguous prefix must raise, not silently list the wrong bucket.
        text = read(STORAGE)
        body = slice_between(text, "def list_keys(", "def read_json(")
        self.assertIn("raise", body)
        self.assertIn("prefix", body)

    def test_private_uploads_do_not_return_a_public_url(self):
        # upload_file/upload_json must not hand back a CDN URL for a private key
        # (the private bucket has no custom domain; such a URL is a 404).
        text = read(STORAGE)
        for fn in ("def upload_file(", "def upload_json("):
            body = slice_between(text, fn, "def list_keys(")
            self.assertIn('bucket_for_key(r2_key) == "private"', body, fn)

    def test_imports_and_routes_by_bucket_for_key(self):
        text = read(STORAGE)
        self.assertIn("from pipeline_lib import (", text)
        self.assertIn("bucket_for_key", text)
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
