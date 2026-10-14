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
GENERATE_CONFIG = REPO_ROOT / "scripts" / "generate-config-from-sheet.mjs"
RECORDER_HTML = REPO_ROOT / "public" / "recorder.html"


def read_generator_csv_rel(text: str) -> str:
    """The ``MASTER_CSV_REL = '<path>';`` literal in the config generator."""
    match = re.search(r"MASTER_CSV_REL\s*=\s*'([^']+)'", text)
    if not match:
        raise AssertionError("MASTER_CSV_REL not found in generate-config-from-sheet.mjs")
    return match.group(1)


def read_recorder_csv_rel(text: str) -> str:
    """The ``var spreadsheet_url = '<path>';`` literal in the recorder page."""
    match = re.search(r"var spreadsheet_url = '([^']+)'", text)
    if not match:
        raise AssertionError("spreadsheet_url not found in public/recorder.html")
    return match.group(1)


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


def read_js_string_array(path: Path, name: str) -> list:
    """Read an `export const NAME = ['a', 'b'];` literal from JS source."""
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"export const {name}\s*=\s*\[(.*?)\];", text, re.DOTALL)
    if not match:
        raise AssertionError(f"{name} not found in {path}")
    return re.findall(r"'([^']*)'|\"([^\"]*)\"", match.group(1))


def _normalize_pairs(pairs: list):
    return [a or b for a, b in pairs]


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


class SheetUrlParityTest(unittest.TestCase):
    """Story 065: the Python render, the JS config generator and the recorder
    must all read the same committed master CSV. The render fetches it over
    HTTP (so its side pins the full URL); the generator and the recorder pin
    the committed path, which must be a suffix of the render URL. Guards read
    the raw source (URLs contain ``//``) and are proven failable by mutating
    the real text on any side."""

    def _assert_parity(self, py_url: str, cli_text: str, recorder_text: str):
        for text in (cli_text, recorder_text):
            self.assertNotIn("2PACX", text)
            self.assertNotIn("gid=242913338", text)
            self.assertNotIn("docs.google.com", text)
        generator_rel = read_generator_csv_rel(cli_text)
        recorder_rel = read_recorder_csv_rel(recorder_text)
        self.assertEqual(generator_rel, "public/wouldyourather.master.csv")
        self.assertEqual(recorder_rel, "wouldyourather.master.csv")
        # No absolute URL on the same-origin readers: a `://` would bypass the
        # committed file for a remote copy.
        self.assertNotIn("://", generator_rel)
        self.assertNotIn("://", recorder_rel)
        self.assertTrue(py_url.startswith("https://raw.githubusercontent.com/"), py_url)
        self.assertTrue(py_url.endswith("/" + generator_rel), py_url)
        self.assertTrue(py_url.endswith("/" + recorder_rel), py_url)

    def test_master_csv_url_matches_the_js_generator_and_recorder(self):
        self._assert_parity(
            lib.MASTER_CSV_URL,
            GENERATE_CONFIG.read_text(encoding="utf-8"),
            RECORDER_HTML.read_text(encoding="utf-8"),
        )

    def test_guard_can_fail_on_either_side(self):
        cli = GENERATE_CONFIG.read_text(encoding="utf-8")
        recorder = RECORDER_HTML.read_text(encoding="utf-8")
        cases = [
            (lib.MASTER_CSV_URL + "x", cli, recorder),                        # Python drift
            (lib.MASTER_CSV_URL, cli.replace("public/wouldyourather.master.csv",
                                             "public/other.csv"), recorder),  # generator drift
            (lib.MASTER_CSV_URL, cli, recorder.replace("wouldyourather.master.csv",
                                                       "other.csv")),         # recorder drift
        ]
        for py_url, cli_text, recorder_text in cases:
            with self.assertRaises(AssertionError):
                self._assert_parity(py_url, cli_text, recorder_text)


class PrivateKeyParityTest(unittest.TestCase):
    """Story 041: the JS Pages Functions and the Python runner must agree on
    which keys are private (raw takes/status markers/pipeline assets) so no
    caller can route a raw key to the public bucket."""

    KEYS = ["raw/x.mp4", "raw/status/j.json", "pipeline-assets/a.csv",
            "assets/videos/x.mp4", "videos/x.mp4", ""]

    def _js_is_private(self, value: str) -> bool:
        # Call the REAL exported isPrivateKey (not a re-implementation), so a
        # change to its body is caught here, not silently ignored.
        import subprocess
        script = (
            "import(" + repr(PIPELINE_KEYS.as_uri()) + ").then((m) => "
            "process.stdout.write(String(m.isPrivateKey(" + repr(value) + "))))"
        )
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            capture_output=True, text=True, check=True,
        )
        return result.stdout.strip() == "true"

    def test_is_private_key_matches_js(self):
        for key in self.KEYS:
            self.assertEqual(lib.is_private_key(key), self._js_is_private(key),
                             f"private-key mismatch for {key!r}")

    def test_private_prefix_lists_are_equal(self):
        source = read_js_string_array(PIPELINE_KEYS, "PRIVATE_KEY_PREFIXES")
        self.assertEqual(_normalize_pairs(source), list(lib.PRIVATE_KEY_PREFIXES))


if __name__ == "__main__":
    unittest.main()
