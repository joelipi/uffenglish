#!/usr/bin/env python3
"""The render cache must be safe by construction: a fingerprint that misses a
render input would restore a stale video, and one that includes a pipeline
OUTPUT would invalidate itself after every successful run (sync-srt writes
`srt`, translate-master writes the `_<lang>` cells) so no retry would ever hit.
Both directions are asserted here.
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import render_cache as rc  # noqa: E402  (path set up above)


ROW = {
    "filename": "cartoon-preferences-a-01-01",
    "video_file": "cartoon-preferences-a-01",
    "phrase": "Mickey Mouse or Bugs Bunny?",
    "subtitle_text": "<aside>Mickey Mouse or Bugs Bunny?</aside>",
    "course_id": "cartoon-preferences",
    "lesson_id": "a",
    "order": "1",
    "effect": "none",
    # derived / copy columns — must NOT affect the fingerprint
    "srt": "1\n00:00:00,000 --> 00:00:03,500\nhello\n\n",
    "srt_es": "1\n00:00:00,000 --> 00:00:03,500\nhola\n\n",
    "cue_es": "¿Mickey Mouse o Bugs Bunny?",
    "lesson_title_pt": "Preferências A",
}

TAKES = {"cartoon-preferences-a-01-01": {"etag": '"abc"', "size": 1234}}


class FingerprintTest(unittest.TestCase):
    def fp(self, rows=None, takes=None, version=rc.RENDER_CACHE_VERSION):
        return rc.inputs_fingerprint(rows or [ROW], takes or TAKES, version=version)

    def test_is_deterministic(self):
        self.assertEqual(self.fp(), self.fp())

    def test_ignores_derived_and_translated_columns(self):
        before = self.fp()
        changed = dict(ROW)
        changed["srt"] = "1\n00:00:00,000 --> 00:00:09,000\nDIFFERENT\n\n"
        changed["srt_es"] = "different"
        changed["cue_es"] = "diferente"
        changed["lesson_title_pt"] = "Outro título"
        self.assertEqual(before, self.fp([changed]),
                         "a pipeline output / translation must not invalidate the cache")

    def test_changes_with_a_render_input(self):
        for column, value in (
            ("phrase", "Bugs Bunny or Mickey Mouse?"),
            ("subtitle_text", "<aside>different</aside>"),
            ("video_file", "cartoon-preferences-a-02"),
            ("filename", "cartoon-preferences-a-01-02"),
            ("effect", "zoom"),
            ("order", "2"),
        ):
            changed = dict(ROW)
            changed[column] = value
            self.assertNotEqual(self.fp(), self.fp([changed]), f"{column} must change the fingerprint")

    def test_changes_with_row_order(self):
        other = dict(ROW, filename="cartoon-preferences-a-01-02")
        self.assertNotEqual(self.fp([ROW, other]), self.fp([other, ROW]),
                            "row order drives joins, so it must invalidate")

    def test_changes_with_a_re_recorded_take(self):
        self.assertNotEqual(self.fp(), rc.inputs_fingerprint([ROW], {
            "cartoon-preferences-a-01-01": {"etag": '"def"', "size": 1234}}))
        self.assertNotEqual(self.fp(), rc.inputs_fingerprint([ROW], {
            "cartoon-preferences-a-01-01": {"etag": '"abc"', "size": 999}}))

    def test_changes_with_the_pipeline_version(self):
        self.assertNotEqual(self.fp(), self.fp(version=rc.RENDER_CACHE_VERSION + 1))


class KeyLayoutTest(unittest.TestCase):
    def test_prefix_is_course_and_fingerprint_scoped(self):
        self.assertEqual(rc.cache_prefix("c", "fp"), "pipeline-assets/render-cache/c/fp/")
        self.assertEqual(rc.cache_key("c", "fp", "bg/x.mp4"),
                         "pipeline-assets/render-cache/c/fp/bg/x.mp4")

    def test_every_kind_of_entry_has_a_key(self):
        for key in (
            rc.manifest_key("c", "fp"),
            rc.srt_key("c", "fp"),
            rc.bg_key("c", "fp", "take"),
            rc.output_key("c", "fp", "web", "step.mp4"),
            rc.output_key("c", "fp", "social", "step.mp4"),
        ):
            self.assertTrue(key.startswith("pipeline-assets/render-cache/c/fp/"))
            self.assertTrue(key.endswith((".json", ".mp4")))

    def test_rejects_an_unknown_output_kind(self):
        with self.assertRaises(ValueError):
            rc.output_key("c", "fp", "posters", "x.jpg")


class PublishIdempotenceTest(unittest.TestCase):
    def test_missing_object_uploads(self):
        self.assertTrue(rc.should_upload(None, "sha"))

    def test_object_without_a_digest_uploads(self):
        # Written by an older pipeline: existence is not identity.
        self.assertTrue(rc.should_upload({"metadata": {}}, "sha"))
        self.assertTrue(rc.should_upload({"metadata": {"sha256": ""}}, "sha"))

    def test_same_digest_skips(self):
        self.assertFalse(rc.should_upload({"metadata": {"sha256": "sha"}}, "sha"))

    def test_different_digest_uploads(self):
        self.assertTrue(rc.should_upload({"metadata": {"sha256": "old"}}, "sha"))


class ManifestTest(unittest.TestCase):
    PLAN = [{
        "slug": "s", "web_name": "s.mp4",
        "video_key": "assets/videos/s.mp4", "poster_key": "assets/videos/s.jpg",
        "social_video_key": "pipeline-assets/social/s.mp4",
        "social_poster_key": "pipeline-assets/social/s.jpg",
    }]

    def manifest(self, **kw):
        args = dict(course_id="c", fingerprint="fp", plan=self.PLAN,
                    objects={"assets/videos/s.mp4": "sha"}, srt_by_prefix={"s": "1\n..."},
                    take_ids=TAKES)
        args.update(kw)
        return rc.manifest_payload(**args)

    def test_round_trips_plan_objects_srt_and_takes(self):
        m = self.manifest()
        self.assertEqual(rc.plan_from_manifest(m), self.PLAN)
        self.assertEqual(rc.objects_from_manifest(m), {"assets/videos/s.mp4": "sha"})
        self.assertEqual(rc.srt_from_manifest(m), {"s": "1\n..."})
        self.assertEqual(m["takes"]["cartoon-preferences-a-01-01"],
                         {"etag": '"abc"', "size": 1234})

    def test_a_version_change_discards_the_plan(self):
        m = self.manifest()
        m["version"] = rc.RENDER_CACHE_VERSION + 1
        self.assertEqual(rc.plan_from_manifest(m), [])

    def test_garbage_manifests_are_ignored(self):
        for bad in (None, {}, {"plan": "nope"}, []):
            self.assertEqual(rc.plan_from_manifest(bad), [])
            self.assertEqual(rc.objects_from_manifest(bad), {})
            self.assertEqual(rc.srt_from_manifest(bad), {})

    def test_missing_objects_reports_only_digest_mismatches(self):
        m = self.manifest(objects={"a": "sha-a", "b": "sha-b", "c": "sha-c"})
        heads = {
            "a": {"metadata": {"sha256": "sha-a"}},   # published
            "b": {"metadata": {"sha256": "stale"}},   # changed bytes
            # c absent
        }
        self.assertEqual(rc.missing_objects(m, heads), ["b", "c"])

    def test_missing_objects_is_empty_when_everything_is_published(self):
        m = self.manifest()
        self.assertEqual(rc.missing_objects(m, {"assets/videos/s.mp4": {"metadata": {"sha256": "sha"}}}), [])


class EvictionScopeTest(unittest.TestCase):
    def test_matches_only_the_same_take_set(self):
        m = {"files": ["b", "a"]}
        self.assertTrue(rc.shares_file_set(m, ["a", "b"]))
        self.assertFalse(rc.shares_file_set(m, ["a"]), "a per-lesson job must not evict siblings")
        self.assertFalse(rc.shares_file_set(m, ["a", "b", "c"]))
        self.assertFalse(rc.shares_file_set({}, ["a"]))
        self.assertFalse(rc.shares_file_set({"files": "a"}, ["a"]))
        self.assertFalse(rc.shares_file_set(None, ["a"]))


if __name__ == "__main__":
    unittest.main()
