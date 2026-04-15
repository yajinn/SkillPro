"""Tests for the marketplace.json source adapter."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from source_adapters.marketplace import MarketplaceAdapter  # noqa: E402
from source_adapters.base import SkillEntry  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "marketplace_sample.json"


def fake_http_get(url: str) -> bytes:
    return FIXTURE.read_bytes()


class TestMarketplaceAdapter(unittest.TestCase):
    def setUp(self):
        self.adapter = MarketplaceAdapter()

    def test_type_field(self):
        self.assertEqual(self.adapter.type, "marketplace")

    def test_fetch_returns_skill_entries(self):
        result = self.adapter.fetch("http://any", fake_http_get)
        self.assertEqual(len(result), 2)
        self.assertIsInstance(result[0], SkillEntry)
        ids = {e.id for e in result}
        self.assertEqual(ids, {"security-guardian", "git-safety"})

    def test_fetch_preserves_scoring_metadata(self):
        result = self.adapter.fetch("http://any", fake_http_get)
        sg = next(e for e in result if e.id == "security-guardian")
        self.assertIn("has_user_input", sg.tags)
        self.assertIn("serves_public", sg.boost_when)
        self.assertIn("backend-api", sg.default_for)
        self.assertEqual(sg.commit_sha, "deadbeef1234")

    def test_fetch_handles_missing_optional_fields(self):
        minimal = json.dumps({
            "name": "min",
            "plugins": [{
                "name": "p",
                "skills": [{
                    "id": "minimal",
                    "name": "Minimal",
                    "description": "",
                    "tags": [],
                    "default_for": [],
                    "install_url": "http://x/SKILL.md",
                }]
            }]
        }).encode()
        result = self.adapter.fetch("http://any", lambda u: minimal)
        self.assertEqual(len(result), 1)
        self.assertIsNone(result[0].version)
        self.assertIsNone(result[0].commit_sha)
        self.assertEqual(result[0].boost_when, [])

    def test_fetch_on_malformed_json_returns_empty(self):
        result = self.adapter.fetch("http://any", lambda u: b"not json at all")
        self.assertEqual(result, [])

    def test_fetch_on_missing_plugins_key_returns_empty(self):
        body = json.dumps({"name": "x"}).encode()
        result = self.adapter.fetch("http://any", lambda u: body)
        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
