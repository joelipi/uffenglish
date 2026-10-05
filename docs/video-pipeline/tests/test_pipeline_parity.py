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


def read_const(path: Path, name: str):
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"export const {name}\s*=\s*([0-9_.]+)", text)
    if not match:
        raise AssertionError(f"{name} not found in {path}")
    raw = match.group(1).replace("_", "")
    return float(raw) if "." in raw else int(raw)


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


if __name__ == "__main__":
    unittest.main()
