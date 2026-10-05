"""Source guards for the cloud-pipeline docs and product entry (story 040,
Task 9). Stdlib only so they run in the Python pretest hook.
"""

import os
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
README = REPO_ROOT / "docs" / "video-pipeline" / "README.md"
PRODUCT = REPO_ROOT / "docs" / "product.md"
ENV_EXAMPLE = REPO_ROOT / ".env.example"
LEARNINGS = REPO_ROOT / "docs" / "learnings.md"
STORY = REPO_ROOT / "stories" / "040-modal-lesson-video-pipeline" / "story.md"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class ReadmeGuardTest(unittest.TestCase):
    def test_cloud_pipeline_section_names_the_essentials(self):
        text = read(README)
        self.assertIn("Cloud pipeline", text)
        for token in ("Modal", "raw/", "pipeline-assets/", "uff-r2",
                      "modal deploy docs/video-pipeline/modal_app.py",
                      "npm run pipeline:upload-assets", "operator key"):
            self.assertIn(token, text, token)


class ProductGuardTest(unittest.TestCase):
    def test_features_list_links_the_story(self):
        text = read(PRODUCT)
        self.assertIn("stories/040-modal-lesson-video-pipeline/story.md", text)


class EnvExampleGuardTest(unittest.TestCase):
    def test_lists_pipeline_secrets_as_comments(self):
        text = read(ENV_EXAMPLE)
        for name in ("OPERATOR_KEY", "MODAL_RENDER_URL", "MODAL_PROXY_TOKEN_ID",
                     "MODAL_PROXY_TOKEN_SECRET"):
            line = next((l for l in text.splitlines() if name in l), None)
            self.assertIsNotNone(line, name)
            self.assertTrue(line.lstrip().startswith("#"), name)


class LearningsGuardTest(unittest.TestCase):
    def test_has_a_modal_or_pipeline_entry(self):
        text = read(LEARNINGS)
        self.assertTrue(("Modal" in text) or ("pipeline" in text.lower()))
        for token in ("operator", "48h", "--no-sandbox"):
            self.assertIn(token, text, token)


class StoryNotesGuardTest(unittest.TestCase):
    def test_measured_cost_note_is_recorded(self):
        text = read(STORY)
        self.assertIn("Measured cost", text)
        # The note must not remain the bare `_pending` placeholder.
        self.assertNotIn("_pending — representative clip", text)


if __name__ == "__main__":
    unittest.main()
