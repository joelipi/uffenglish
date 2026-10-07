"""Unit tests for docs/video-pipeline/pipeline_lib.py (story 040, Task 4).

Stdlib ``unittest`` only — no pytest, no modal/moviepy/torch — so this runs in
the Node ``pretest`` hook and in CI without any pip install.
"""

import ast
import os
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pipeline_lib as lib  # noqa: E402


class SlugRulesTest(unittest.TestCase):
    def test_accepts_bare_slugs(self):
        for good in ("lesson_01", "Take-3", "a"):
            self.assertTrue(lib.is_valid_slug(good), good)

    def test_rejects_bad_slugs(self):
        for bad in ("../x", "a/b", ".hidden", "", "a.mp4", "x" * 101):
            self.assertFalse(lib.is_valid_slug(bad), bad)

    def test_object_keys(self):
        self.assertEqual(lib.raw_take_key("lesson_01"), "raw/lesson_01.mp4")
        self.assertEqual(lib.published_video_key("lesson_01"), "assets/videos/lesson_01.mp4")
        self.assertEqual(lib.published_poster_key("lesson_01"), "assets/videos/lesson_01.jpg")
        self.assertEqual(lib.status_key("job-abc12345"), "raw/status/job-abc12345.json")

    def test_invalid_inputs_return_none(self):
        self.assertIsNone(lib.raw_take_key("../x"))
        self.assertIsNone(lib.published_video_key("a/b"))
        self.assertIsNone(lib.status_key("bad/id"))
        self.assertIsNone(lib.status_key("short"))

    def test_processed_web_name(self):
        self.assertEqual(
            lib.processed_web_name("lesson_01"),
            "processed_lesson_01_no_silence_bg_removed.mp4",
        )


class PrivateKeyRuleTest(unittest.TestCase):
    def test_private_keys(self):
        for key in ("raw/x.mp4", "raw/status/j.json", "pipeline-assets/audio/a.mp3"):
            self.assertTrue(lib.is_private_key(key), key)

    def test_public_keys(self):
        for key in ("assets/videos/x.mp4", "videos/x.mp4", "", None):
            self.assertFalse(lib.is_private_key(key), key)

    def test_bucket_for_key(self):
        self.assertEqual(lib.bucket_for_key("raw/x.mp4"), "private")
        self.assertEqual(lib.bucket_for_key("pipeline-assets/a.csv"), "private")
        self.assertEqual(lib.bucket_for_key("assets/videos/x.mp4"), "public")
        self.assertEqual(lib.bucket_for_key("videos/x.mp4"), "public")

    def test_prefixes_tuple(self):
        self.assertEqual(
            lib.PRIVATE_KEY_PREFIXES,
            (lib.RAW_PREFIX, lib.PIPELINE_ASSET_PREFIX),
        )
        self.assertIn(lib.RAW_PREFIX, lib.PRIVATE_KEY_PREFIXES)


class PlanPublishTest(unittest.TestCase):
    """The plan publishes the concatenated step/join videos the app references,
    not the per-take ``processed_*`` intermediates (which would 404 on R2)."""

    def setUp(self):
        self.rows = [
            {"filename": "lesson_01", "video_file": "wouldyourather_a01", "join": ""},
            {"filename": "lesson_02", "video_file": "wouldyourather_a02", "join": ""},
        ]
        self.step_01 = f"wouldyourather_a01_full{lib.VIDEO_EXTENSION}"
        self.step_02 = f"wouldyourather_a02_full{lib.VIDEO_EXTENSION}"

    def test_non_joined_step_publishes_the_concatenated_video(self):
        plan = lib.plan_publish(self.rows, [self.step_01, self.step_02])
        self.assertEqual(
            [e["slug"] for e in plan], ["wouldyourather_a01", "wouldyourather_a02"]
        )
        self.assertEqual(plan[0]["web_name"], self.step_01)
        # The published key drops the internal `_full` suffix.
        self.assertEqual(plan[0]["video_key"], "assets/videos/wouldyourather_a01.mp4")
        self.assertEqual(plan[0]["poster_key"], "assets/videos/wouldyourather_a01.jpg")
        self.assertNotIn("_full", plan[0]["video_key"])

    def test_joined_step_publishes_the_join_output_once(self):
        rows = [
            {"filename": "lesson_01", "video_file": "step_a", "join": "lessonFinal"},
            {"filename": "lesson_02", "video_file": "step_b", "join": "lessonFinal"},
        ]
        # Even with the per-step `_full` files present, the join replaces them.
        plan = lib.plan_publish(
            rows, ["lessonFinal.mp4", f"step_a_full{lib.VIDEO_EXTENSION}"]
        )
        self.assertEqual([e["slug"] for e in plan], ["lessonFinal"])
        self.assertEqual(plan[0]["web_name"], "lessonFinal.mp4")
        self.assertEqual(plan[0]["video_key"], "assets/videos/lessonFinal.mp4")

    def test_skips_a_step_whose_output_is_not_listed(self):
        plan = lib.plan_publish(self.rows, [self.step_01])
        self.assertEqual([e["slug"] for e in plan], ["wouldyourather_a01"])

    def test_never_emits_the_per_take_intermediate(self):
        listing = [lib.processed_web_name("lesson_01"), self.step_01]
        plan = lib.plan_publish(self.rows, listing)
        names = [e["web_name"] for e in plan]
        self.assertNotIn(lib.processed_web_name("lesson_01"), names)
        self.assertNotIn(lib.processed_web_name("lesson_02"), names)
        self.assertEqual(names, [self.step_01])

    def test_only_restricts_to_scoped_rows(self):
        plan = lib.plan_publish(
            self.rows, [self.step_01, self.step_02], only=["lesson_02"]
        )
        self.assertEqual([e["slug"] for e in plan], ["wouldyourather_a02"])

    def test_dedupes_by_slug_first_wins(self):
        # Two takes of the same step share a `video_file` -> one published entry.
        rows = [
            {"filename": "lesson_01", "video_file": "step_a", "join": ""},
            {"filename": "lesson_01b", "video_file": "step_a", "join": ""},
        ]
        plan = lib.plan_publish(rows, [f"step_a_full{lib.VIDEO_EXTENSION}"])
        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0]["slug"], "step_a")

    def test_skips_rows_with_neither_join_nor_video_file(self):
        plan = lib.plan_publish(
            [{"filename": "lesson_01"}], [f"lesson_01_full{lib.VIDEO_EXTENSION}"]
        )
        self.assertEqual(plan, [])

    def test_reads_rows_without_a_get_method(self):
        # The orchestrator passes pandas Series (they have `.get`), but the
        # accessor must also handle a plain `__getitem__`-only mapping row.
        class _Row:
            def __init__(self, **values):
                self._values = values

            def __getitem__(self, key):
                return self._values[key]

        plan = lib.plan_publish(
            [_Row(filename="lesson_01", video_file="step_a", join="")],
            [f"step_a_full{lib.VIDEO_EXTENSION}"],
        )
        self.assertEqual([e["slug"] for e in plan], ["step_a"])

    def test_never_emits_invalid_slug_or_wrong_namespace(self):
        rows = [
            {"filename": "x", "video_file": "../evil", "join": ""},
            {"filename": "y", "video_file": "step_ok", "join": ""},
        ]
        plan = lib.plan_publish(
            rows, [f"../evil_full{lib.VIDEO_EXTENSION}", f"step_ok_full{lib.VIDEO_EXTENSION}"]
        )
        slugs = [e["slug"] for e in plan]
        self.assertNotIn("../evil", slugs)
        for entry in plan:
            self.assertTrue(lib.is_valid_slug(entry["slug"]))
            self.assertFalse(entry["video_key"].startswith("videos/"))
            self.assertEqual(entry["video_key"], f"assets/videos/{entry['slug']}.mp4")
            self.assertEqual(entry["poster_key"], f"assets/videos/{entry['slug']}.jpg")


class PlanPublishSourceGuardTest(unittest.TestCase):
    """Guard: ``plan_publish`` targets the concatenated ``_full`` step/join videos
    and never the per-take ``processed_*`` intermediate. A regression here
    silently publishes slugs the app never references (R2 404), so the guard is
    proven failable by mutating the real source."""

    LIB = Path(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) / "pipeline_lib.py"

    def _guard(self, text):
        body = text[text.index("def plan_publish("):text.index("# ---", text.index("def plan_publish("))]
        # The step web_name is built from the `_full` output name; the per-take
        # intermediate (`PROCESSED_PREFIX` / `processed_web_name`) must not appear.
        self.assertIn('f"{video_file}_full{VIDEO_EXTENSION}"', body)
        self.assertNotIn("PROCESSED_PREFIX", body)
        self.assertNotIn("processed_web_name", body)

    def test_plan_publish_targets_concatenated_videos(self):
        self._guard(self.LIB.read_text(encoding="utf-8"))

    def test_guard_can_fail(self):
        source = self.LIB.read_text(encoding="utf-8")
        mutated = source.replace(
            'add(video_file, f"{video_file}_full{VIDEO_EXTENSION}")',
            'add(video_file, processed_web_name(video_file))',
        )
        self.assertNotEqual(mutated, source)
        with self.assertRaises(AssertionError):
            self._guard(mutated)


class IntroPosterTest(unittest.TestCase):
    """Lesson intros come from the sheet's `intro_video` column, never a CSV
    row, so they miss `plan_publish` and the render plans their posters
    separately (story 055)."""

    rows = [
        {"filename": "a0101", "video_file": "a01", "intro_video": "friend"},
        {"filename": "a0102", "video_file": "a01", "intro_video": "friend"},
        {"filename": "b0101", "video_file": "b01", "intro_video": "{friendCode}resp"},
        {"filename": "c0101", "video_file": "c01", "intro_video": ""},
        {"filename": "d0101", "video_file": "d01", "intro_video": "intro"},
        {"filename": "e0101", "video_file": "e01", "intro_video": "bad/slug"},
    ]

    def test_literal_intro_slugs_are_deduped_in_first_seen_order(self):
        self.assertEqual(lib.intro_poster_slugs(self.rows), ["friend", "intro"])

    def test_blank_template_and_invalid_slugs_are_skipped(self):
        slugs = lib.intro_poster_slugs(self.rows)
        self.assertNotIn("{friendCode}resp", slugs)
        self.assertNotIn("bad/slug", slugs)
        self.assertNotIn("", slugs)

    def test_missing_poster_is_a_target(self):
        self.assertEqual(
            lib.plan_intro_posters(self.rows, {"friend": None, "intro": None}, {}),
            ["friend", "intro"],
        )

    def test_fresh_poster_is_not_a_target(self):
        fresh = datetime(2026, 1, 2)
        self.assertEqual(
            lib.plan_intro_posters(self.rows, {"friend": fresh, "intro": fresh},
                                   {"friend": datetime(2026, 1, 1)}),
            [],
        )

    def test_newer_source_video_makes_a_stale_poster_a_target(self):
        poster = datetime(2026, 1, 1)
        self.assertEqual(
            lib.plan_intro_posters(self.rows, {"friend": poster, "intro": poster},
                                   {"friend": datetime(2026, 1, 2), "intro": poster}),
            ["friend"],
        )


class SelectRowsTest(unittest.TestCase):
    def test_none_returns_every_row(self):
        rows = [{"filename": "a"}, {"filename": "b"}]
        self.assertEqual(lib.select_rows(rows), rows)

    def test_only_filters(self):
        rows = [{"filename": "lesson_01"}, {"filename": "lesson_02"}]
        self.assertEqual(lib.select_rows(rows, only=["lesson_02"]), [rows[1]])

    def test_empty_only_returns_empty(self):
        self.assertEqual(lib.select_rows([{"filename": "a"}], only=[]), [])


class EnvSeamTest(unittest.TestCase):
    def test_resolve_work_dir(self):
        self.assertEqual(lib.resolve_work_dir({}), Path.cwd())
        self.assertEqual(lib.resolve_work_dir({"PIPELINE_WORKDIR": "/tmp/x"}), Path("/tmp/x"))

    def test_resolve_web_profile(self):
        self.assertEqual(lib.resolve_web_profile({}), (1280, "128k"))
        self.assertEqual(
            lib.resolve_web_profile(
                {"PIPELINE_WEB_TARGET_LONG_EDGE": "720", "PIPELINE_WEB_AUDIO_BITRATE": "96k"}
            ),
            (720, "96k"),
        )

    def test_chrome_flags(self):
        base = lib.chrome_flags({})
        self.assertNotIn("--no-sandbox", base)
        self.assertIn("--default-background-color=00000000", base)
        container = lib.chrome_flags({"PIPELINE_CHROME_NO_SANDBOX": "1"})
        self.assertIn("--no-sandbox", container)
        self.assertIn("--default-background-color=00000000", container)

    def test_missing_required_fonts(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = lib.missing_required_fonts(tmp)
            self.assertEqual(sorted(missing), sorted(lib.REQUIRED_FONTS))
            for name in lib.REQUIRED_FONTS:
                (Path(tmp) / name).write_bytes(b"x")
            self.assertEqual(lib.missing_required_fonts(tmp), [])


class SheetUrlTest(unittest.TestCase):
    """Story 052: the render's sheet URL, with an env override."""

    def test_defaults_to_the_published_master(self):
        self.assertEqual(lib.resolve_sheet_url({}), lib.SHEET_URL)
        self.assertIn("2PACX-1vQZ7jFMJNnmylDoHxaqb1W8VyXi0OV4pSubCbqMGYkRgGimqWx3cs74n43-cFxqfue4KCiqWlhzvPkK",
                      lib.SHEET_URL)
        self.assertIn("gid=242913338", lib.SHEET_URL)
        self.assertTrue(lib.SHEET_URL.endswith("output=csv"))

    def test_pipeline_sheet_url_overrides_the_default(self):
        self.assertEqual(
            lib.resolve_sheet_url({"PIPELINE_SHEET_URL": "https://example.com/other.csv"}),
            "https://example.com/other.csv",
        )


class _FakeResponse:
    def __init__(self, status, body=b"", headers=None, url=None):
        self.status = status
        self._body = body
        self.headers = headers or {}
        self.url = url

    def read(self):
        return self._body


class FetchSheetCsvTest(unittest.TestCase):
    """Story 052: fetch the published CSV, following redirects, and fail loudly
    on a broken publish instead of feeding HTML/empty bodies into pandas."""

    CSV = "filename,phrase\nlesson_01,Hi\n"

    def test_follows_a_307_redirect_to_the_final_csv(self):
        calls = []

        def fetch_impl(url):
            calls.append(url)
            if len(calls) == 1:
                return _FakeResponse(307, b"", {"Location": "https://doc-0s.googleusercontent.com/abc"})
            return _FakeResponse(200, self.CSV.encode("utf-8"),
                                 {"Content-Type": "text/csv; charset=utf-8"})

        text = lib.fetch_sheet_csv("https://docs.google.com/spreadsheets/d/e/X/pub?output=csv", fetch_impl)
        self.assertEqual(text, self.CSV)
        self.assertEqual(calls[0], "https://docs.google.com/spreadsheets/d/e/X/pub?output=csv")
        self.assertEqual(calls[1], "https://doc-0s.googleusercontent.com/abc")

    def test_follows_a_relative_redirect(self):
        calls = []

        def fetch_impl(url):
            calls.append(url)
            if len(calls) == 1:
                return _FakeResponse(302, b"", {"Location": "/final.csv"})
            return _FakeResponse(200, self.CSV.encode("utf-8"), {"Content-Type": "text/csv"})

        self.assertEqual(lib.fetch_sheet_csv("https://example.com/a/pub", fetch_impl), self.CSV)
        self.assertEqual(calls[1], "https://example.com/final.csv")

    def test_raises_on_an_html_body(self):
        def fetch_impl(url):
            return _FakeResponse(200, b"<!DOCTYPE html><html>Sign in</html>",
                                 {"Content-Type": "text/html; charset=utf-8"})

        with self.assertRaises(RuntimeError) as ctx:
            lib.fetch_sheet_csv("https://docs.google.com/x", fetch_impl)
        self.assertIn("HTML", str(ctx.exception))

    def test_raises_on_html_without_a_content_type(self):
        def fetch_impl(url):
            return _FakeResponse(200, b"  <html>not published</html>", {})

        with self.assertRaises(RuntimeError):
            lib.fetch_sheet_csv("https://docs.google.com/x", fetch_impl)

    def test_raises_on_an_empty_body(self):
        def fetch_impl(url):
            return _FakeResponse(200, b"", {"Content-Type": "text/csv; charset=utf-8"})

        with self.assertRaises(RuntimeError) as ctx:
            lib.fetch_sheet_csv("https://docs.google.com/x", fetch_impl)
        self.assertIn("empty", str(ctx.exception).lower())

    def test_raises_on_a_whitespace_only_body(self):
        def fetch_impl(url):
            return _FakeResponse(200, b"\n  \n", {"Content-Type": "text/csv"})

        with self.assertRaises(RuntimeError):
            lib.fetch_sheet_csv("https://docs.google.com/x", fetch_impl)

    def test_raises_on_a_non_2xx_final_response(self):
        def fetch_impl(url):
            return _FakeResponse(404, b"not found", {"Content-Type": "text/plain"})

        with self.assertRaises(RuntimeError) as ctx:
            lib.fetch_sheet_csv("https://docs.google.com/x", fetch_impl)
        self.assertIn("404", str(ctx.exception))

    def test_raises_on_a_redirect_without_a_location(self):
        def fetch_impl(url):
            return _FakeResponse(307, b"", {})

        with self.assertRaises(RuntimeError):
            lib.fetch_sheet_csv("https://docs.google.com/x", fetch_impl)

    def test_raises_when_redirects_never_resolve(self):
        def fetch_impl(url):
            return _FakeResponse(307, b"", {"Location": "https://example.com/loop"})

        with self.assertRaises(RuntimeError):
            lib.fetch_sheet_csv("https://docs.google.com/x", fetch_impl)


class WebBudgetTest(unittest.TestCase):
    def test_within_budget(self):
        self.assertTrue(lib.is_within_web_budget(
            {"width": 720, "height": 1280, "totalBitrateBps": 1_400_000, "faststart": True}
        ))

    def test_over_width(self):
        self.assertFalse(lib.is_within_web_budget(
            {"width": 1080, "height": 1920, "totalBitrateBps": 1_400_000, "faststart": True}
        ))

    def test_over_bitrate(self):
        self.assertFalse(lib.is_within_web_budget(
            {"width": 720, "height": 1280, "totalBitrateBps": 1_600_000, "faststart": True}
        ))

    def test_not_faststart(self):
        self.assertFalse(lib.is_within_web_budget(
            {"width": 720, "height": 1280, "totalBitrateBps": 1_400_000, "faststart": False}
        ))

    def test_missing_data_is_not_within_budget(self):
        self.assertFalse(lib.is_within_web_budget(None))
        self.assertFalse(lib.is_within_web_budget({"width": 720}))


class FfmpegArgsTest(unittest.TestCase):
    def test_reencode_web_args(self):
        args = " ".join(lib.reencode_web_args("in.mp4", "out.mp4"))
        for token in ("libx264", "-crf 26", "-maxrate 1.5M", "-bufsize 3M",
                      "-profile:v main", "yuv420p", "+faststart"):
            self.assertIn(token, args)
        self.assertEqual(args.split()[-1], "out.mp4")

    def test_poster_args(self):
        args = " ".join(lib.poster_args("in.mp4", "out.jpg"))
        for token in ("-ss 0.2", "-vframes 1", "scale=640:-2", "-q:v 8"):
            self.assertIn(token, args)


class CostTest(unittest.TestCase):
    def test_estimate_cost_exact(self):
        expected = 120 * 0.000164 + 2400 * 0.0000131 + 4800 * 0.00000222
        self.assertAlmostEqual(
            lib.estimate_cost({"gpu_seconds": 120, "cpu_core_seconds": 2400,
                               "memory_gib_seconds": 4800}),
            expected,
            places=12,
        )

    def test_representative_cost_band(self):
        self.assertGreaterEqual(lib.estimate_cost(lib.REPRESENTATIVE_METRICS), 0.05)
        self.assertLessEqual(lib.estimate_cost(lib.REPRESENTATIVE_METRICS), 0.10)


class StatusTest(unittest.TestCase):
    def test_round_trip(self):
        status = {"status": "done", "stage": "publish", "jobId": "job-abc12345"}
        self.assertEqual(lib.parse_status(lib.serialize_status(status)), status)

    def test_parse_rejects_malformed_or_missing_status(self):
        self.assertIsNone(lib.parse_status("{not json"))
        self.assertIsNone(lib.parse_status('{"stage": "publish"}'))
        self.assertIsNone(lib.parse_status(None))


class StdlibOnlyTest(unittest.TestCase):
    def test_pipeline_lib_imports_only_stdlib(self):
        path = Path(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) / "pipeline_lib.py"
        tree = ast.parse(path.read_text(encoding="utf-8"))
        modules = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                modules.add(node.module.split(".")[0])
        allowed = {"__future__", "json", "os", "re", "pathlib", "typing", "collections",
                   "urllib"}
        self.assertLessEqual(modules, allowed, f"unexpected imports: {modules - allowed}")


if __name__ == "__main__":
    unittest.main()
