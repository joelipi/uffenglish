"""Behavioral + source tests for the pipeline step key (story 050).

The key logic lives in the stdlib-only ``pipeline_lib`` (``video_pipeline``
imports modal/moviepy/torch, which CI cannot load), so the rule itself is tested
behaviorally and the wiring in the import-heavy script is pinned by source
guards. One key must drive the rendered video, the join and the SRT so they
cannot disagree on granularity.
"""

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pipeline_lib as lib  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[3]
PIPELINE = REPO_ROOT / "docs" / "video-pipeline" / "video_pipeline.py"
MODAL_APP = REPO_ROOT / "docs" / "video-pipeline" / "modal_app.py"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def slice_between(text: str, start: str, end: str) -> str:
    i = text.index(start)
    j = text.index(end, i + len(start))
    return text[i:j]


class GroupKeyBehaviorTest(unittest.TestCase):
    def test_uses_video_file_when_present(self):
        mapping = {"wouldyourather_b01_i01": "wouldyourather_b01_i"}
        self.assertEqual(
            lib.group_key_for_filename("wouldyourather_b01_i01", mapping),
            "wouldyourather_b01_i",
        )

    def test_real_master_filenames_do_not_collapse_to_lesson(self):
        # The legacy prefix rule collapses a whole lesson (`wouldyourather_b`);
        # the video_file key keeps the option videos distinct.
        mapping = {
            "wouldyourather_b01_i01": "wouldyourather_b01_i",
            "wouldyourather_b01_ii01": "wouldyourather_b01_ii",
            "wouldyourather_b02_i01": "wouldyourather_b02_i",
        }
        keys = {lib.group_key_for_filename(name, mapping) for name in mapping}
        self.assertEqual(
            keys,
            {"wouldyourather_b01_i", "wouldyourather_b01_ii", "wouldyourather_b02_i"},
        )
        self.assertEqual(lib.group_prefix_for_filename("wouldyourather_b01_i01"), "wouldyourather_b")

    def test_falls_back_to_prefix_without_map_or_blank_value(self):
        self.assertEqual(lib.group_key_for_filename("demo-a0101", None), "demo-a")
        self.assertEqual(lib.group_key_for_filename("demo-a0101", {}), "demo-a")
        self.assertEqual(lib.group_key_for_filename("demo-a0101", {"demo-a0101": ""}), "demo-a")
        self.assertEqual(lib.group_key_for_filename("demo-a0101", {"demo-a0101": "   "}), "demo-a")

    def test_prefix_rule_matches_the_legacy_behavior(self):
        self.assertEqual(lib.group_prefix_for_filename("demo-a0101"), "demo-a")
        self.assertEqual(lib.group_prefix_for_filename("demo-a0101_no_silence_bg_removed.mp4"), "demo-a")


class PipelineWiringSourceGuardTest(unittest.TestCase):
    """Every stage that groups clips must call the one shared key."""

    def test_group_videos_by_prefix_keys_by_group_key(self):
        body = slice_between(read(PIPELINE), "def group_videos_by_prefix(", "def resolve_music_path(")
        self.assertIn("group_key_for_filename(", body)
        self.assertIn("processed_to_original(", body)

    def test_load_join_plan_keys_by_group_key(self):
        body = slice_between(read(PIPELINE), "def load_join_plan(", "def get_join_music_from_csv(")
        self.assertIn("group_key_for_filename(", body)
        self.assertIn("load_video_file_map", read(PIPELINE))

    def test_write_srt_column_keys_by_group_key(self):
        body = slice_between(read(PIPELINE), "def write_srt_column(", "def _concat_video_files(")
        self.assertIn("group_key_for_filename(", body)
        self.assertIn("video_file_map", body)

    def test_concatenate_all_processed_videos_passes_the_map(self):
        body = slice_between(read(PIPELINE), "def concatenate_all_processed_videos(", "# ===")
        self.assertIn("group_videos_by_prefix(str(SOCIAL_DIR), video_file_map)", body)

    def test_modal_orchestrator_passes_the_map(self):
        body = slice_between(read(MODAL_APP), "def orchestrator(spec: dict):", "def _publish(")
        self.assertIn("pipeline.load_video_file_map(csv_file)", body)
        self.assertIn("joined_prefixes, phrase_map, video_file_map", body)
        self.assertIn("pipeline.write_srt_column(csv_file, srt_by_prefix, video_file_map)", body)

    def test_guard_can_fail(self):
        # Mutating the shared-key call out of a stage body must trip the guard.
        good = read(PIPELINE)
        mutated = good.replace(
            "group_videos_by_prefix(str(SOCIAL_DIR), video_file_map)",
            "group_videos_by_prefix(str(SOCIAL_DIR))",
        )
        self.assertNotEqual(good, mutated)
        body = slice_between(mutated, "def concatenate_all_processed_videos(", "# ===")
        self.assertNotIn("group_videos_by_prefix(str(SOCIAL_DIR), video_file_map)", body)


if __name__ == "__main__":
    unittest.main()
