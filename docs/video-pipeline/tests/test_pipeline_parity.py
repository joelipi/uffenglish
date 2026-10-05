"""Parity tests: the Python web/poster constants must equal the JS sources of
truth (scripts/lib/video-optimize-utils.js, scripts/lib/poster-utils.js). Story
040, Task 4. If either side drifts, this fails instead of publishing media that
misses the 032 web budget or a differently-sized poster.
"""

import os
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pipeline_lib as lib  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[3]
VIDEO_UTILS = REPO_ROOT / "scripts" / "lib" / "video-optimize-utils.js"
POSTER_UTILS = REPO_ROOT / "scripts" / "lib" / "poster-utils.js"
PIPELINE_KEYS = REPO_ROOT / "src" / "modules" / "video" / "pipeline-keys.js"


def read_const(path: Path, name: str):
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"export const {name}\s*=\s*([0-9_.]+)", text)
    if not match:
        raise AssertionError(f"{name} not found in {path}")
    raw = match.group(1).replace("_", "")
    return float(raw) if "." in raw else int(raw)


def read_js_regex_source(path: Path, name: str) -> str:
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"export const {name}\s*=\s*/(.+?)/;", text)
    if not match:
        raise AssertionError(f"{name} not found in {path}")
    return match.group(1)


class VideoBudgetParityTest(unittest.TestCase):
    def test_web_budget_constants_match_js(self):
        self.assertEqual(lib.MAX_VIDEO_WIDTH, read_const(VIDEO_UTILS, "MAX_VIDEO_WIDTH"))
        self.assertEqual(lib.MAX_TOTAL_BITRATE_BPS, read_const(VIDEO_UTILS, "MAX_TOTAL_BITRATE_BPS"))
        self.assertEqual(lib.X264_CRF, read_const(VIDEO_UTILS, "X264_CRF"))
        # Sanity: the pinned values the story names.
        self.assertEqual(lib.MAX_VIDEO_WIDTH, 720)
        self.assertEqual(lib.MAX_TOTAL_BITRATE_BPS, 1_500_000)
        self.assertEqual(lib.X264_CRF, 26)


class PosterParityTest(unittest.TestCase):
    def test_poster_constants_match_js(self):
        self.assertAlmostEqual(lib.FRAME_AT_SECONDS, read_const(POSTER_UTILS, "FRAME_AT_SECONDS"))
        self.assertEqual(lib.POSTER_WIDTH, read_const(POSTER_UTILS, "POSTER_WIDTH"))
        self.assertEqual(lib.POSTER_QUALITY, read_const(POSTER_UTILS, "POSTER_QUALITY"))


class KeyPatternParityTest(unittest.TestCase):
    """The JS Pages Functions and the Python runner must agree on the slug and
    job-id rules. Both sides use an explicit end anchor (JS `(?![\s\S])`, Python
    `\\Z`) so that "lesson_01\\n" is rejected — plain `$` matches before a
    trailing newline in both languages. This asserts the two agree on the same
    accept/reject set (the raw pattern text differs per language)."""

    def _js_accepts(self, name: str, value: str) -> bool:
        source = read_js_regex_source(PIPELINE_KEYS, name)
        js = (
            "(value) => { const re = new RegExp(" + repr(source) + "); return re.test(value); }"
        )
        import subprocess
        result = subprocess.run(
            ["node", "-e", f"const f = {js}; process.stdout.write(String(f({value!r})))"],
            capture_output=True, text=True, check=True,
        )
        return result.stdout.strip() == "true"

    def test_slug_accept_reject_set_matches_js(self):
        cases = ["lesson_01", "Take-3", "a", "lesson_01\n", "../evil", "a/b",
                 ".hidden", "", "a.mp4"]
        for value in cases:
            self.assertEqual(lib.is_valid_slug(value), self._js_accepts("PIPELINE_SLUG_PATTERN", value),
                             f"slug mismatch for {value!r}")

    def test_job_id_accept_reject_set_matches_js(self):
        cases = ["job-abc12345", "job-abc12345\n", "bad/id", "short"]
        for value in cases:
            self.assertEqual(lib.is_valid_job_id(value),
                             self._js_accepts("PIPELINE_JOB_ID_PATTERN", value),
                             f"job-id mismatch for {value!r}")

    def test_trailing_newline_is_rejected(self):
        # `$` would accept these; the explicit end anchor must not.
        self.assertFalse(lib.is_valid_slug("lesson_01\n"))
        self.assertFalse(lib.is_valid_job_id("job-abc12345\n"))


if __name__ == "__main__":
    unittest.main()
