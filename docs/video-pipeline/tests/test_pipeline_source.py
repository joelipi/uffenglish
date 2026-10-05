"""Source guards for docs/video-pipeline/video_pipeline.py (story 040, Task 5).

The pure decisions live in pipeline_lib and are unit-tested there; these guards
prove the wiring is actually present in the (import-heavy) pipeline script that
CI cannot execute without moviepy/modal/torch. Guards are written to be able to
fail: each slices the specific region and asserts a token that exists once.
"""

import ast
import os
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PIPELINE = REPO_ROOT / "docs" / "video-pipeline" / "video_pipeline.py"


def read() -> str:
    return PIPELINE.read_text(encoding="utf-8")


def slice_between(text: str, start: str, end: str) -> str:
    i = text.index(start)
    j = text.index(end, i + len(start))
    return text[i:j]


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

    def test_web_profile_and_chrome_flags_wired(self):
        text = read()
        self.assertIn("resolve_web_profile(os.environ)", text)
        self.assertIn("chrome_flags(os.environ)", text)
        self.assertNotIn("'--default-background-color=00000000']", text)


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
    def test_gpu_function_and_app_name_preserved(self):
        text = read()
        self.assertIn('app = modal.App("uff-lesson-video")', text)
        self.assertNotIn("video-background-removal", text)
        self.assertIn("def process_video_background_modal", text)
        self.assertIn('gpu="T4"', text)

    def test_local_gpu_call_guarded_by_modal_is_local(self):
        text = read()
        body = slice_between(text, "def process_video_background(", "def get_original_filename")
        self.assertIn("modal.is_local()", body)
        self.assertIn("with app.run():", body)
        self.assertIn(".remote(", body)


class SyntaxGuardTest(unittest.TestCase):
    def test_pipeline_parses(self):
        ast.parse(read())


if __name__ == "__main__":
    unittest.main()
