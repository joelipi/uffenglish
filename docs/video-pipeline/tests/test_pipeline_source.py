"""Source guards for docs/video-pipeline/video_pipeline.py (story 040, Task 5).

The pure decisions live in pipeline_lib and are unit-tested there; these guards
prove the wiring is actually present in the (import-heavy) pipeline script that
CI cannot execute without moviepy/modal/torch. Guards are written to be able to
fail: each slices the specific region and asserts a token that exists once.
"""

import ast
import os
import re
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PIPELINE = REPO_ROOT / "docs" / "video-pipeline" / "video_pipeline.py"
MODAL_APP = REPO_ROOT / "docs" / "video-pipeline" / "modal_app.py"


def read() -> str:
    return PIPELINE.read_text(encoding="utf-8")


def slice_between(text: str, start: str, end: str) -> str:
    i = text.index(start)
    j = text.index(end, i + len(start))
    return text[i:j]


def module_defined_names(tree: ast.AST) -> set:
    """Every top-level name the module binds: imports, defs, assignments."""
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add((alias.asname or alias.name).split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                names.add(alias.asname or alias.name)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            names.add(node.id)
        elif isinstance(node, ast.arg):
            names.add(node.arg)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            names.add(node.name)
    return names


def module_attribute_roots(tree: ast.AST) -> set:
    """Names used as `X.attr` (e.g. `time` in `time.time()`)."""
    roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            roots.add(node.value.id)
    return roots


class UndefinedImportGuardTest(unittest.TestCase):
    def test_every_attribute_root_is_bound(self):
        # `time.time()` with no `import time` is a NameError the string guards
        # cannot see (CI cannot import this module). Assert every `X.attr` root
        # is a name the module binds.
        tree = ast.parse(read())
        defined = module_defined_names(tree)
        builtins = set(dir(__builtins__)) if not isinstance(__builtins__, dict) else set(__builtins__)
        undefined = sorted(
            root for root in module_attribute_roots(tree)
            if root not in defined and root not in builtins
        )
        self.assertEqual(undefined, [])

    def test_guard_can_fail(self):
        bad = ast.parse("import os\nos.path.join('a', time.time())\n")
        defined = module_defined_names(bad)
        undefined = [r for r in module_attribute_roots(bad) if r not in defined]
        self.assertIn("time", undefined)


class WorkdirGuardTest(unittest.TestCase):
    def test_imports_pure_decisions_from_pipeline_lib(self):
        text = read()
        self.assertIn("from pipeline_lib import", text)
        for name in ("resolve_work_dir", "resolve_web_profile", "chrome_flags",
                     "missing_required_fonts", "select_rows"):
            self.assertIn(name, text, name)

    def test_derives_every_directory_constant_from_work_dir(self):
        text = read()
        block = slice_between(text, "WORK_DIR = resolve_work_dir", "VIDEO_EXTENSION")
        for name in ("VIDEO_DIRECTORY", "NO_SILENCE_DIRECTORY", "AUDIO_DIRECTORY",
                     "FONT_DIRECTORY", "BACKGROUNDS_DIRECTORY", "RAWVIDEOS_DIRECTORY",
                     "OVERLAYS_DIRECTORY", "OVERLAYS_TEMP_DIRECTORY", "CSV_FILE"):
            self.assertIn(name, block, name)
            self.assertIn("WORK_DIR", block.split(name, 1)[1].split("\n", 1)[0], name)

    def test_output_dirs_derive_from_work_dir(self):
        text = read()
        block = slice_between(text, "OUTPUT_ROOT =", "def ")
        for name in ("SOCIAL_DIR", "WEB_DIR"):
            self.assertIn(name, block, name)
            self.assertIn("OUTPUT_ROOT", block.split(name, 1)[1].split("\n", 1)[0], name)
        self.assertIn("WORK_DIR", block.split("OUTPUT_ROOT =", 1)[1].split("\n", 1)[0])

    def test_background_removal_always_returns_seconds(self):
        # The early-exit and normal paths must both return a number so the
        # orchestrator's estimate_cost never receives None.
        body = slice_between(read(), "def run_background_removal(", "def group_videos_by_prefix")
        self.assertIn("return 0.0", body)
        self.assertIn("return gpu_seconds", body)

    def test_no_getcwd(self):
        self.assertNotIn("os.getcwd()", read())

    def test_no_windows_only_launch_tokens(self):
        text = read()
        self.assertNotIn("os.startfile", text)
        self.assertNotIn("shell=True", text)
        self.assertNotIn(".exe", text)


class FontAndWebProfileGuardTest(unittest.TestCase):
    def test_font_urls_use_absolute_directory_and_missing_check(self):
        text = read()
        self.assertIn("missing_required_fonts(FONT_DIRECTORY)", text)
        # create_overlay_html builds file:// URLs from the (now absolute) FONT_DIRECTORY.
        overlay = slice_between(text, "def create_overlay_html", "def add_background_sound")
        self.assertIn('f"file:///{os.path.abspath(os.path.join(FONT_DIRECTORY', overlay)

    def test_missing_fonts_abort_setup(self):
        text = read()
        body = slice_between(text, "def setup_environment(", "def ")
        self.assertIn("if missing_fonts:", body)
        # A missing font must fail the run, not just warn.
        self.assertIn("return False", body)

    def test_web_profile_and_chrome_flags_wired(self):
        text = read()
        self.assertIn("resolve_web_profile(os.environ)", text)
        self.assertIn("chrome_flags(os.environ)", text)
        # The inline --default-background-color flag must be gone (moved to chrome_flags).
        self.assertNotIn("--default-background-color=00000000", text)


class OnlyScopeGuardTest(unittest.TestCase):
    def test_stage_functions_accept_only(self):
        text = read()
        self.assertIn("def run_silence_removal(args, background_mapping, mirror_mapping, only=None):", text)
        self.assertIn("def run_background_removal(background_mapping, mirror_mapping, only=None):", text)
        self.assertIn("def process_video_batch(csv_file, max_workers=1, only=None):", text)

    def test_process_video_batch_filters_with_select_rows(self):
        text = read()
        body = slice_between(text, "def process_video_batch", "def processed_to_original")
        self.assertIn("select_rows(", body)

    def test_parse_args_registers_only_and_main_wires_it(self):
        text = read()
        self.assertIn("'--only'", text)
        self.assertIn("only = [s.strip() for s in args.only.split(',')", text)
        self.assertIn("only=only", text)


class ModalGuardTest(unittest.TestCase):
    """Story 052: no GPU function on the lesson app; background removal calls
    the separately deployed `video-background-removal` function by name. This is
    the single home for the video_pipeline/deploy-graph source guards; the
    behavioral tests live in test_background_removal_wiring.py."""

    @staticmethod
    def _decorators(text):
        # `@app.function(...)` up to its closing paren (one level of nesting).
        return re.findall(r"@app\.function\((?:[^()]|\([^()]*\))*\)", text)

    def _assert_resolver(self, text):
        resolver = slice_between(
            text, "def background_removal_remote(", "def process_video_background(")
        self.assertIn(
            'modal.Function.from_name("video-background-removal", "process_video_background_modal")',
            resolver,
        )
        # A lookup failure must name the app so the operator can act on it.
        self.assertIn("video-background-removal", resolver.split("except", 1)[1])

    def _assert_call(self, text):
        body = slice_between(text, "def process_video_background(", "def get_original_filename")
        self.assertIn("background_removal_remote().remote(", body)
        self.assertIn("fps=0, fast_mode=True, max_workers=10", body)
        # A deployed function needs no app run context, locally or otherwise.
        self.assertNotIn("with app.run():", body)
        self.assertNotIn("modal.is_local()", body)

    def test_app_name_preserved_and_gpu_function_moved_out(self):
        text = read()
        self.assertIn('app = modal.App("uff-lesson-video")', text)
        # The T4 BiRefNet function moved to background_removal_app.py.
        self.assertNotIn("def process_video_background_modal", text)

    def test_deploy_graph_registers_no_gpu_function(self):
        # Task 3: the two modules that register `@app.function`s -- modal_app.py
        # and video_pipeline.py -- must register no GPU function.
        seen = 0
        for path in (PIPELINE, MODAL_APP):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("gpu=", text, str(path))
            for decorator in self._decorators(text):
                seen += 1
                self.assertNotIn("gpu", decorator, str(path))
        # The scan is not vacuous: the graph does register CPU functions.
        self.assertGreater(seen, 0)

    def test_resolves_the_deployed_function_by_name(self):
        self._assert_resolver(read())

    def test_background_removal_calls_deployed_function_without_app_run(self):
        self._assert_call(read())

    def test_guards_can_fail(self):
        good = read()
        resolver_literal = (
            'modal.Function.from_name("video-background-removal", "process_video_background_modal")')
        with self.assertRaises(AssertionError):
            self._assert_resolver("SENTINEL".join(good.split(resolver_literal)))
        with self.assertRaises(AssertionError):
            self._assert_call(good.replace(
                "output_bytes = background_removal_remote().remote(",
                "with app.run():\n            output_bytes = background_removal_remote().remote(",
            ))
        mutated_gpu = good.replace(
            'app = modal.App("uff-lesson-video")',
            'app = modal.App("uff-lesson-video")\n\n@app.function(gpu="T4")\ndef tmp_gpu(): ...',
        )
        self.assertIn("gpu=", mutated_gpu)
        with self.assertRaises(AssertionError):
            self.assertNotIn("gpu=", mutated_gpu)


class SyntaxGuardTest(unittest.TestCase):
    def test_pipeline_parses(self):
        ast.parse(read())


if __name__ == "__main__":
    unittest.main()
