"""Source guards for the cloud-pipeline docs and product entry (story 040,
Task 9). Stdlib only so they run in the Python pretest hook.
"""

import os
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
README = REPO_ROOT / "docs" / "video-pipeline" / "README.md"
PRODUCT = REPO_ROOT / "docs" / "product.md"
ENV_EXAMPLE = REPO_ROOT / ".env.example"
LEARNINGS = REPO_ROOT / "docs" / "learnings.md"
STORY = REPO_ROOT / "stories" / "040-modal-lesson-video-pipeline" / "story.md"
STORY_041 = REPO_ROOT / "stories" / "041-private-raw-takes" / "story.md"
WRANGLER = REPO_ROOT / "wrangler.toml"


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

    def test_private_bucket_is_documented(self):
        # Story 041: raw takes/assets live in a non-public bucket; the public
        # CDN cannot serve them; published media stays in uff.
        text = read(README)
        for token in ("PIPELINE_R2", "uff-private", "R2_PRIVATE_BUCKET",
                      "PIPELINE_PRIVATE_BUCKET"):
            self.assertIn(token, text, token)
        self.assertIn("r2.ultrafastfluency.com", text)
        self.assertIn("48h", text)


class WranglerGuardTest(unittest.TestCase):
    def test_binds_public_and_private_buckets(self):
        text = read(WRANGLER)
        self.assertIn('binding = "UFF_R2"', text)
        self.assertIn('bucket_name = "uff"', text)
        self.assertIn('binding = "PIPELINE_R2"', text)
        self.assertIn('bucket_name = "uff-private"', text)
        # The comment documents the no-public-domain rule.
        self.assertIn("r2.ultrafastfluency.com", text)
        self.assertIn("NO public custom domain", text)

    def test_documents_the_raw_lifecycle_command(self):
        text = read(WRANGLER) + read(README)
        self.assertIn(
            'wrangler r2 bucket lifecycle add uff-private raw-takes-7d',
            text,
        )
        self.assertIn('--prefix "raw/"', text)
        self.assertIn("--expire-days 7", text)
        # The public videos/ 48h rule stays on the public bucket.
        self.assertIn("videos/", text)

    def test_private_bucket_name_is_consistent_across_layers(self):
        # The Pages binding, the Node uploader and the docs must name the same
        # private bucket; if one drifts, objects are written to a bucket the
        # orchestrator never reads.
        binding = re.search(r'binding = "PIPELINE_R2"\s*\n\s*bucket_name = "([^"]+)"', read(WRANGLER))
        self.assertIsNotNone(binding)
        name = binding.group(1)

        uploader = read(REPO_ROOT / "scripts" / "upload-pipeline-assets.mjs")
        default = re.search(r'DEFAULT_PRIVATE_BUCKET = \'([^\']+)\'', uploader)
        self.assertIsNotNone(default)
        self.assertEqual(default.group(1), name)

        self.assertIn(name, read(README))


class ProductGuardTest(unittest.TestCase):
    def test_features_list_links_the_story(self):
        text = read(PRODUCT)
        self.assertIn("stories/040-modal-lesson-video-pipeline/story.md", text)

    def test_features_list_links_the_private_raw_takes_story(self):
        text = read(PRODUCT)
        self.assertIn("stories/041-private-raw-takes/story.md", text)


class EnvExampleGuardTest(unittest.TestCase):
    def test_lists_pipeline_secrets_as_comments(self):
        text = read(ENV_EXAMPLE)
        for name in ("OPERATOR_KEY", "MODAL_RENDER_URL", "MODAL_PROXY_TOKEN_ID",
                     "MODAL_PROXY_TOKEN_SECRET", "PIPELINE_PRIVATE_BUCKET"):
            line = next((l for l in text.splitlines() if name in l), None)
            self.assertIsNotNone(line, name)
            self.assertTrue(line.lstrip().startswith("#"), name)
        # PIPELINE_PRIVATE_BUCKET default is uff-private.
        line = next(l for l in text.splitlines() if "PIPELINE_PRIVATE_BUCKET" in l)
        self.assertIn("uff-private", line)


class LearningsGuardTest(unittest.TestCase):
    def test_has_a_modal_or_pipeline_entry(self):
        text = read(LEARNINGS)
        self.assertTrue(("Modal" in text) or ("pipeline" in text.lower()))
        for token in ("operator", "48h", "--no-sandbox"):
            self.assertIn(token, text, token)

    def test_has_a_bucket_scoped_learnings_entry(self):
        # Story 041: the bucket-scoped-binding lesson must be recorded.
        text = read(LEARNINGS)
        self.assertIn("bucket-scoped", text)
        self.assertIn("r2.ultrafastfluency.com", text)
        self.assertIn("raw/", text)
        self.assertIn("48h", text)


class StoryNotesGuardTest(unittest.TestCase):
    def test_measured_cost_note_is_truthful(self):
        # The measurement is an operator out-of-band step (no Modal/R2 creds in
        # CI). This guard pins the note to a truthful state: it must say what
        # feeds the estimate and must not claim a measured number it does not
        # have. It deliberately does NOT pass/fail on the presence of a dollar
        # value, which CI cannot produce.
        text = read(STORY)
        self.assertIn("Measured cost", text)
        self.assertIn("gpu_seconds", text)
        self.assertIn("operator", text.lower())
        # No fabricated dollar figure while the run is still pending.
        self.assertNotIn("_pending — representative clip", text)

    def test_private_raw_takes_operator_check_is_marked_manual(self):
        # Story 041's live curl 404/200 check needs real Cloudflare creds and a
        # deploy; it must stay documented as an operator out-of-band step, not
        # fabricated as passing.
        text = read(STORY_041)
        self.assertIn("operator out-of-band", text)
        self.assertIn("404", text)
        self.assertIn("curl", text)


if __name__ == "__main__":
    unittest.main()
