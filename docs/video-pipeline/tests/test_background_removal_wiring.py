"""Story 052: the lesson pipeline reuses the already-deployed
``video-background-removal`` app instead of registering a GPU function on
``uff-lesson-video``.

Guards:
  - Task 1: ``background_removal_app.py`` defines the deployed app/function, and
    neither ``modal_app.py`` nor ``video_pipeline.py`` imports it.
  - Task 3: the deploy graph (``modal_app.py`` + ``video_pipeline.py``) registers
    no GPU function.
  - Task 2 (behavioral): the resolver returns ``modal.Function.from_name(...)``
    and names the app on failure; ``process_video_background`` calls the
    resolved function's ``.remote(...)`` with the exact args and no ``app.run()``.

The behavioral tests load ``video_pipeline`` with its cinematic/ML imports
stubbed, so CI (no moviepy/modal/torch) can still exercise the wiring.
"""

import importlib.util
import os
import re
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
PIPELINE_DIR = REPO_ROOT / "docs" / "video-pipeline"
MODAL_APP = PIPELINE_DIR / "modal_app.py"
VIDEO_PIPELINE = PIPELINE_DIR / "video_pipeline.py"
BG_APP = PIPELINE_DIR / "background_removal_app.py"

sys.path.insert(0, str(PIPELINE_DIR))


def read(path) -> str:
    return Path(path).read_text(encoding="utf-8")


def slice_between(text: str, start: str, end: str) -> str:
    i = text.index(start)
    j = text.index(end, i + len(start))
    return text[i:j]


class BackgroundRemovalAppGuardTest(unittest.TestCase):
    """Task 1: the redeploy module defines the deployed app + T4 function."""

    def test_defines_the_deployed_app_and_gpu_function(self):
        text = read(BG_APP)
        # Compiling (not importing) catches a syntax error in a module that is
        # deliberately outside the deploy graph and never imported by tests.
        compile(text, str(BG_APP), "exec")
        self.assertIn('modal.App("video-background-removal")', text)
        signature = slice_between(text, "def process_video_background_modal(",
                                  "):", )
        self.assertIn("input_video_bytes, background_bytes, is_video_bg,", signature)
        self.assertIn("fps=0, fast_mode=True, max_workers=10", signature)
        decorator = text[text.index("@bg_app.function("):text.index("def process_video_background_modal(")]
        self.assertIn("gpu=\"T4\"", decorator)
        self.assertIn("image=image", decorator)

    def test_deploy_graph_does_not_import_the_redeploy_module(self):
        for path in (MODAL_APP, VIDEO_PIPELINE):
            self.assertNotIn("background_removal_app", read(path), str(path))


class DeployGraphGuardTest(unittest.TestCase):
    """Task 3: the two modules that register `@app.function`s -- modal_app.py
    (orchestrator, trigger) and video_pipeline.py (the app) -- must register no
    GPU function. background_removal_app.py is deliberately excluded here; it is
    the separately-deployed GPU app."""

    FILES = (MODAL_APP, VIDEO_PIPELINE)

    @staticmethod
    def _decorators(text: str):
        # `@app.function(...)` up to its closing paren (one level of nesting).
        return re.findall(r"@app\.function\((?:[^()]|\([^()]*\))*\)", text)

    def _assert_no_gpu(self, texts):
        seen = 0
        for path, text in texts.items():
            self.assertNotIn("gpu=", text, str(path))
            for decorator in self._decorators(text):
                seen += 1
                self.assertNotIn("gpu", decorator, str(path))
        # The scan is not vacuous: the graph does register CPU functions.
        self.assertGreater(seen, 0)

    def test_deploy_graph_registers_no_gpu_function(self):
        self._assert_no_gpu({p: read(p) for p in self.FILES})

    def test_guard_can_fail(self):
        real = {p: read(p) for p in self.FILES}
        mutated = dict(real)
        mutated[VIDEO_PIPELINE] = real[VIDEO_PIPELINE].replace(
            'app = modal.App("uff-lesson-video")',
            'app = modal.App("uff-lesson-video")\n\n@app.function(gpu="T4")\ndef tmp_gpu(): ...',
        )
        with self.assertRaises(AssertionError):
            self._assert_no_gpu(mutated)


class _Any:
    """Chainable callable sentinel for stubbed heavy imports."""

    def __init__(self, *args, **kwargs):
        pass

    def __call__(self, *args, **kwargs):
        return _Any()

    def __getattr__(self, name):
        return _Any()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _StubModule(types.ModuleType):
    def __getattr__(self, name):
        # Cache so patching `modal.Function.from_name` is stable across lookups.
        value = _Any()
        setattr(self, name, value)
        return value


STUB_MODULES = (
    "cv2", "numpy", "pandas", "html2image", "moviepy",
    "PIL", "PIL.Image", "pydub", "pydub.silence", "modal",
)


def load_video_pipeline(modal_stub=None):
    """Import ``video_pipeline`` with its heavy imports stubbed for CI.

    ``modal_stub`` lets a test supply a pre-wired ``modal`` module (e.g. to spy
    on ``Function.from_name`` while the module is being imported).
    """
    saved = {name: sys.modules.get(name) for name in STUB_MODULES}
    for name in STUB_MODULES:
        sys.modules[name] = modal_stub if (name == "modal" and modal_stub) else _StubModule(name)
    try:
        spec = importlib.util.spec_from_file_location("video_pipeline_under_test", VIDEO_PIPELINE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        for name, old in saved.items():
            if old is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = old
    return module


class ResolverBehaviorTest(unittest.TestCase):
    """Task 2: `background_removal_remote` resolves the deployed function."""

    @classmethod
    def setUpClass(cls):
        cls.vp = load_video_pipeline()

    def test_returns_the_resolved_function(self):
        sentinel = object()
        with mock.patch.object(self.vp.modal.Function, "from_name",
                               return_value=sentinel) as from_name:
            self.assertIs(self.vp.background_removal_remote(), sentinel)
        from_name.assert_called_once_with(
            "video-background-removal", "process_video_background_modal")

    def test_lookup_failure_names_the_app(self):
        with mock.patch.object(self.vp.modal.Function, "from_name",
                               side_effect=RuntimeError("missing")):
            with self.assertRaises(RuntimeError) as ctx:
                self.vp.background_removal_remote()
        self.assertIn("video-background-removal", str(ctx.exception))

    def test_import_does_not_resolve_the_function(self):
        # The lookup is lazy: importing video_pipeline must not call
        # Function.from_name, so an absent app cannot break an import.
        modal_stub = _StubModule("modal")
        modal_stub.Function = _Any()
        from_name = mock.Mock()
        modal_stub.Function.from_name = from_name
        load_video_pipeline(modal_stub=modal_stub)
        from_name.assert_not_called()


class ProcessVideoBackgroundBehaviorTest(unittest.TestCase):
    """Task 2: `process_video_background` calls `.remote(...)` with the args."""

    @classmethod
    def setUpClass(cls):
        cls.vp = load_video_pipeline()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.input_path = os.path.join(self.tmp.name, "in.mp4")
        self.bg_path = os.path.join(self.tmp.name, "bg.jpg")
        self.out_path = os.path.join(self.tmp.name, "out.mp4")
        Path(self.input_path).write_bytes(b"INPUT")
        Path(self.bg_path).write_bytes(b"BG")

    def _call(self, remote):
        with mock.patch.object(self.vp, "background_removal_remote", return_value=remote), \
                mock.patch.object(self.vp, "check_audio_sync", return_value=True):
            return self.vp.process_video_background(self.input_path, self.bg_path, self.out_path)

    def test_calls_remote_with_exact_args_and_returns_result(self):
        remote = mock.Mock()
        remote.remote.return_value = b"RESULT"
        result = self._call(remote)
        remote.remote.assert_called_once_with(
            b"INPUT", b"BG", False, fps=0, fast_mode=True, max_workers=10)
        self.assertEqual(result, self.out_path)
        self.assertEqual(Path(self.out_path).read_bytes(), b"RESULT")

    def test_video_background_is_flagged(self):
        remote = mock.Mock()
        remote.remote.return_value = b"RESULT"
        video_bg = os.path.join(self.tmp.name, "bg.mp4")
        Path(video_bg).write_bytes(b"BG")
        with mock.patch.object(self.vp, "background_removal_remote", return_value=remote), \
                mock.patch.object(self.vp, "check_audio_sync", return_value=True):
            self.vp.process_video_background(self.input_path, video_bg, self.out_path)
        self.assertIs(remote.remote.call_args.args[2], True)


if __name__ == "__main__":
    unittest.main()
