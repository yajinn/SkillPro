"""Tests for the SkillEntry dataclass, SourceAdapter protocol, and http_get helper."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from source_adapters.base import SkillEntry, http_get_default  # noqa: E402


class TestSkillEntry(unittest.TestCase):
    def test_minimal_fields(self):
        entry = SkillEntry(
            id="foo",
            name="Foo",
            description="desc",
            tags=["has_web"],
            boost_when=[],
            penalize_when=[],
            default_for=["web-frontend"],
            match_language=None,
            match_framework=None,
            match_sub_framework=None,
            install_url="https://example.com/SKILL.md",
            version="1.0.0",
            commit_sha="abc",
        )
        self.assertEqual(entry.id, "foo")
        self.assertEqual(entry.tags, ["has_web"])
        self.assertIsNone(entry.match_language)

    def test_to_dict_round_trip(self):
        entry = SkillEntry(
            id="bar", name="Bar", description="",
            tags=[], boost_when=[], penalize_when=[], default_for=[],
            match_language="php", match_framework=None, match_sub_framework=None,
            install_url="https://x", version=None, commit_sha=None,
        )
        d = entry.to_dict()
        self.assertEqual(d["id"], "bar")
        self.assertEqual(d["match_language"], "php")
        self.assertIn("install_url", d)


class TestHttpGetDefault(unittest.TestCase):
    def test_returns_callable(self):
        self.assertTrue(callable(http_get_default))


if __name__ == "__main__":
    unittest.main()
