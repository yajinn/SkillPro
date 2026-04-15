"""Tests for the enrichment overlay in MarketplaceAdapter."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from source_adapters.base import SkillEntry  # noqa: E402
from source_adapters import marketplace  # noqa: E402


def base_entry(id_="xlsx"):
    return SkillEntry(
        id=id_, name=id_, description="some desc",
        tags=["has_web"], boost_when=[], penalize_when=[], default_for=[],
        match_language=None, match_framework=None, match_sub_framework=None,
        install_url="http://x/SKILL.md", version=None, commit_sha=None,
    )


class TestApplyEnrichment(unittest.TestCase):
    def setUp(self):
        marketplace._reset_enrichment_cache()

    def tearDown(self):
        marketplace._reset_enrichment_cache()

    def test_no_override_when_id_not_enriched(self):
        with patch.object(marketplace, "_load_enrichment", return_value={}):
            e = base_entry("unknown-skill")
            result = marketplace.apply_enrichment(e)
            self.assertEqual(result.tags, ["has_web"])
            self.assertEqual(result.default_for, [])

    def test_replaces_tags_when_provided(self):
        overlay = {"xlsx": {"tags": ["has_db", "data_pipeline"]}}
        with patch.object(marketplace, "_load_enrichment", return_value=overlay):
            result = marketplace.apply_enrichment(base_entry("xlsx"))
            self.assertEqual(result.tags, ["has_db", "data_pipeline"])

    def test_replaces_default_for(self):
        overlay = {"xlsx": {"default_for": ["backend-api", "data-ml"]}}
        with patch.object(marketplace, "_load_enrichment", return_value=overlay):
            result = marketplace.apply_enrichment(base_entry("xlsx"))
            self.assertEqual(result.default_for, ["backend-api", "data-ml"])

    def test_replaces_match_language(self):
        overlay = {"xlsx": {"match_language": "python"}}
        with patch.object(marketplace, "_load_enrichment", return_value=overlay):
            result = marketplace.apply_enrichment(base_entry("xlsx"))
            self.assertEqual(result.match_language, "python")

    def test_does_not_touch_unspecified_fields(self):
        overlay = {"xlsx": {"tags": ["has_api"]}}
        with patch.object(marketplace, "_load_enrichment", return_value=overlay):
            e = base_entry("xlsx")
            e.default_for = ["web-frontend"]
            result = marketplace.apply_enrichment(e)
            self.assertEqual(result.tags, ["has_api"])
            # default_for was inferred and must be preserved
            self.assertEqual(result.default_for, ["web-frontend"])

    def test_built_in_enrichment_loads_without_crash(self):
        # Real path, not mocked — verify config/enrichment.json parses
        marketplace._reset_enrichment_cache()
        enrichment = marketplace._load_enrichment()
        self.assertIsInstance(enrichment, dict)
        # xlsx is a known entry in config/enrichment.json
        self.assertIn("xlsx", enrichment)
        self.assertIn("default_for", enrichment["xlsx"])

    def test_user_override_takes_precedence(self):
        with tempfile.TemporaryDirectory() as tmp:
            user_path = Path(tmp) / ".claude" / "skillforge" / "enrichment.json"
            user_path.parent.mkdir(parents=True)
            user_path.write_text(json.dumps({
                "version": 1,
                "enrichment": {
                    "xlsx": {"tags": ["has_user_input"], "default_for": ["cli-tool"]}
                }
            }))
            fake_home = Path(tmp)
            with patch.dict(os.environ, {"HOME": str(fake_home)}):
                marketplace._reset_enrichment_cache()
                enrichment = marketplace._load_enrichment()
                self.assertEqual(enrichment["xlsx"]["default_for"], ["cli-tool"])
            marketplace._reset_enrichment_cache()


if __name__ == "__main__":
    unittest.main()
