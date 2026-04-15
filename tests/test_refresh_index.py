"""Tests for the refresh_index orchestrator."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import refresh_index  # noqa: E402
from source_adapters.base import SkillEntry  # noqa: E402


def entry(id_: str, tags=None) -> SkillEntry:
    return SkillEntry(
        id=id_, name=id_, description="",
        tags=tags or [], boost_when=[], penalize_when=[], default_for=[],
        match_language=None, match_framework=None, match_sub_framework=None,
        install_url=f"http://x/{id_}", version=None, commit_sha=None,
    )


class FakeAdapter:
    def __init__(self, type_: str, entries):
        self.type = type_
        self._entries = entries
        self.calls = 0

    def fetch(self, url, http_get):
        self.calls += 1
        if self._entries is None:
            raise IOError("boom")
        return list(self._entries)


class TestRefreshIndex(unittest.TestCase):
    def test_merge_multiple_sources(self):
        a = FakeAdapter("marketplace", [entry("foo"), entry("bar")])
        b = FakeAdapter("awesome-list", [entry("baz")])
        sources = [
            {"type": "marketplace", "name": "A", "url": "http://a"},
            {"type": "awesome-list", "name": "B", "url": "http://b"},
        ]
        result = refresh_index.build_index(
            sources, adapters={"marketplace": a, "awesome-list": b},
            http_get=lambda u: b"",
        )
        ids = {s["id"] for s in result["skills"]}
        self.assertEqual(ids, {"foo", "bar", "baz"})
        self.assertFalse(result["partial"])

    def test_dedupe_first_source_wins(self):
        a = FakeAdapter("marketplace", [entry("foo", tags=["has_web"])])
        b = FakeAdapter("awesome-list", [entry("foo", tags=["has_api"])])
        sources = [
            {"type": "marketplace", "name": "A", "url": "http://a"},
            {"type": "awesome-list", "name": "B", "url": "http://b"},
        ]
        result = refresh_index.build_index(
            sources, adapters={"marketplace": a, "awesome-list": b},
            http_get=lambda u: b"",
        )
        self.assertEqual(len(result["skills"]), 1)
        self.assertEqual(result["skills"][0]["tags"], ["has_web"])
        self.assertEqual(len(result["conflicts"]), 1)
        self.assertEqual(result["conflicts"][0]["id"], "foo")
        self.assertEqual(result["conflicts"][0]["winner"], "A")
        self.assertEqual(result["conflicts"][0]["losers"], ["B"])

    def test_failing_source_marks_partial(self):
        a = FakeAdapter("marketplace", [entry("foo")])
        b = FakeAdapter("awesome-list", None)  # raises
        sources = [
            {"type": "marketplace", "name": "A", "url": "http://a"},
            {"type": "awesome-list", "name": "B", "url": "http://b"},
        ]
        result = refresh_index.build_index(
            sources, adapters={"marketplace": a, "awesome-list": b},
            http_get=lambda u: b"",
        )
        self.assertTrue(result["partial"])
        statuses = {s["name"]: s["status"] for s in result["sources"]}
        self.assertEqual(statuses["A"], "ok")
        self.assertEqual(statuses["B"], "failed")

    def test_atomic_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "index.json"
            refresh_index.write_index(
                {
                    "version": 1, "skills": [{"id": "foo"}], "sources": [],
                    "conflicts": [], "partial": False, "fetched_at": "now",
                    "ttl_seconds": 604800
                },
                out,
            )
            self.assertTrue(out.exists())
            loaded = json.loads(out.read_text())
            self.assertEqual(loaded["skills"][0]["id"], "foo")
            # No leftover tmp files in the directory
            tmp_files = [p for p in Path(tmp).iterdir() if p.name.endswith(".tmp")]
            self.assertEqual(tmp_files, [])


if __name__ == "__main__":
    unittest.main()
