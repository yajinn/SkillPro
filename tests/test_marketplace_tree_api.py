"""Unit tests for the Trees API fallback path in MarketplaceAdapter.

Covers three layers:

1. URL parsing — `_parse_github_raw_url` extracts (owner, repo, ref)
2. Tree API discovery — `_discover_skills_via_tree_api` walks a tree
   response and returns skill directory paths
3. Integration — `_skills_from_plugin` triggers Shape C (tree API) when
   a plugin has no explicit skills array, and delegates to Shape A/B
   when skills are present

All HTTP is mocked. No network calls.
"""
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from source_adapters.base import SkillEntry  # noqa: E402
from source_adapters.marketplace import (  # noqa: E402
    MarketplaceAdapter,
    _parse_github_raw_url,
    _reset_enrichment_cache,
    _reset_tree_api_rate_limit,
)
import tree_cache  # noqa: E402


def _isolate_tree_cache(test_instance):
    """Patch tree_cache._cache_path to a unique temp file per test.
    Call from setUp; teardown is handled by addCleanup."""
    import tempfile
    from unittest.mock import patch as _patch
    tmp = tempfile.mkdtemp()
    cache_file = Path(tmp) / "tree-cache.json"
    p = _patch.object(tree_cache, "_cache_path", return_value=cache_file)
    p.start()
    def _cleanup():
        p.stop()
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
    test_instance.addCleanup(_cleanup)


def make_http(route_map: dict):
    """Build a fake http_get that returns mapped bytes or raises IOError."""
    def _get(url: str) -> bytes:
        if url in route_map:
            value = route_map[url]
            if isinstance(value, Exception):
                raise value
            return value if isinstance(value, bytes) else value.encode()
        raise IOError(f"not found: {url}")
    return _get


class TestParseGithubRawUrl(unittest.TestCase):
    def test_valid_raw_url_with_nested_path(self):
        self.assertEqual(
            _parse_github_raw_url(
                "https://raw.githubusercontent.com/obra/superpowers/main/.claude-plugin/marketplace.json"
            ),
            ("obra", "superpowers", "main"),
        )

    def test_valid_raw_url_with_root_file(self):
        self.assertEqual(
            _parse_github_raw_url(
                "https://raw.githubusercontent.com/anthropics/skills/main/marketplace.json"
            ),
            ("anthropics", "skills", "main"),
        )

    def test_http_prefix_accepted(self):
        self.assertEqual(
            _parse_github_raw_url(
                "http://raw.githubusercontent.com/a/b/v1.2.3/marketplace.json"
            ),
            ("a", "b", "v1.2.3"),
        )

    def test_non_github_url_returns_none(self):
        self.assertIsNone(
            _parse_github_raw_url("https://example.com/foo/bar/baz/marketplace.json")
        )

    def test_malformed_url_returns_none(self):
        self.assertIsNone(_parse_github_raw_url("not a url"))
        self.assertIsNone(_parse_github_raw_url(""))
        self.assertIsNone(_parse_github_raw_url("https://github.com/owner/repo"))


class TestDiscoverSkillsViaTreeApi(unittest.TestCase):
    def setUp(self):
        _reset_tree_api_rate_limit()
        _isolate_tree_cache(self)

    def test_extracts_skill_dirs_from_tree_response(self):
        tree_doc = {
            "tree": [
                {"path": "README.md", "type": "blob"},
                {"path": "skills/brainstorming/SKILL.md", "type": "blob"},
                {"path": "skills/brainstorming/helper.md", "type": "blob"},
                {"path": "skills/writing-plans/SKILL.md", "type": "blob"},
                {"path": "skills/writing-plans/references/a.md", "type": "blob"},
                {"path": "docs/overview.md", "type": "blob"},
            ]
        }
        route = {
            "https://api.github.com/repos/obra/superpowers/git/trees/main?recursive=1":
                json.dumps(tree_doc),
        }
        result = MarketplaceAdapter._discover_skills_via_tree_api(
            "obra", "superpowers", "main", make_http(route)
        )
        self.assertEqual(result, ["skills/brainstorming", "skills/writing-plans"])

    def test_handles_top_level_skill_md(self):
        tree_doc = {"tree": [{"path": "SKILL.md", "type": "blob"}]}
        route = {
            "https://api.github.com/repos/a/b/git/trees/main?recursive=1":
                json.dumps(tree_doc),
        }
        result = MarketplaceAdapter._discover_skills_via_tree_api(
            "a", "b", "main", make_http(route)
        )
        self.assertEqual(result, [""])

    def test_deduplicates_skill_dirs(self):
        tree_doc = {
            "tree": [
                {"path": "skills/x/SKILL.md"},
                {"path": "skills/x/SKILL.md"},
                {"path": "skills/x/README.md"},
                {"path": "skills/y/SKILL.md"},
            ]
        }
        route = {
            "https://api.github.com/repos/a/b/git/trees/main?recursive=1":
                json.dumps(tree_doc),
        }
        result = MarketplaceAdapter._discover_skills_via_tree_api(
            "a", "b", "main", make_http(route)
        )
        self.assertEqual(result, ["skills/x", "skills/y"])

    def test_rate_limit_returns_empty(self):
        route = {
            "https://api.github.com/repos/a/b/git/trees/main?recursive=1":
                IOError("HTTP Error 403: rate limit exceeded"),
        }
        result = MarketplaceAdapter._discover_skills_via_tree_api(
            "a", "b", "main", make_http(route)
        )
        self.assertEqual(result, [])

    def test_404_returns_empty(self):
        def http(url):
            raise IOError("HTTP Error 404: Not Found")
        result = MarketplaceAdapter._discover_skills_via_tree_api(
            "a", "b", "main", http
        )
        self.assertEqual(result, [])

    def test_malformed_json_returns_empty(self):
        route = {
            "https://api.github.com/repos/a/b/git/trees/main?recursive=1": b"not json",
        }
        result = MarketplaceAdapter._discover_skills_via_tree_api(
            "a", "b", "main", make_http(route)
        )
        self.assertEqual(result, [])

    def test_missing_tree_key_returns_empty(self):
        route = {
            "https://api.github.com/repos/a/b/git/trees/main?recursive=1":
                json.dumps({"sha": "abc", "url": "https://..."}),
        }
        result = MarketplaceAdapter._discover_skills_via_tree_api(
            "a", "b", "main", make_http(route)
        )
        self.assertEqual(result, [])

    def test_tree_with_no_skill_md(self):
        tree_doc = {
            "tree": [
                {"path": "README.md"},
                {"path": "src/main.py"},
                {"path": "tests/test_main.py"},
            ]
        }
        route = {
            "https://api.github.com/repos/a/b/git/trees/main?recursive=1":
                json.dumps(tree_doc),
        }
        result = MarketplaceAdapter._discover_skills_via_tree_api(
            "a", "b", "main", make_http(route)
        )
        self.assertEqual(result, [])


SAMPLE_SKILL_MD = b"""---
name: brainstorming
description: Explore user intent, requirements, and design before implementation.
---

# Brainstorming

Body of the skill.
"""

SAMPLE_SKILL_MD_2 = b"""---
name: writing-plans
description: Use when you have a spec for a multi-step task, before touching code.
---

# Writing Plans
"""


class TestShapeCIntegration(unittest.TestCase):
    def setUp(self):
        _reset_enrichment_cache()
        _reset_tree_api_rate_limit()
        _isolate_tree_cache(self)
        self.adapter = MarketplaceAdapter()

    def tearDown(self):
        _reset_enrichment_cache()

    def test_empty_skills_triggers_tree_api(self):
        marketplace_doc = {
            "name": "superpowers-dev",
            "plugins": [{
                "name": "superpowers",
                "source": "./",
                "description": "Core skills library",
            }],
        }
        tree_doc = {
            "tree": [
                {"path": "skills/brainstorming/SKILL.md"},
                {"path": "skills/writing-plans/SKILL.md"},
            ]
        }
        mp_url = "https://raw.githubusercontent.com/obra/superpowers/main/.claude-plugin/marketplace.json"
        route = {
            mp_url: json.dumps(marketplace_doc).encode(),
            "https://api.github.com/repos/obra/superpowers/git/trees/main?recursive=1":
                json.dumps(tree_doc).encode(),
            "https://raw.githubusercontent.com/obra/superpowers/main/skills/brainstorming/SKILL.md":
                SAMPLE_SKILL_MD,
            "https://raw.githubusercontent.com/obra/superpowers/main/skills/writing-plans/SKILL.md":
                SAMPLE_SKILL_MD_2,
        }
        with patch("source_adapters.marketplace._load_enrichment", return_value={}):
            result = self.adapter.fetch(mp_url, make_http(route))
        ids = {e.id for e in result}
        self.assertEqual(ids, {"brainstorming", "writing-plans"})

    def test_explicit_skills_list_skips_tree_api(self):
        marketplace_doc = {
            "name": "test",
            "plugins": [{
                "name": "test-plugin",
                "source": "./",
                "skills": ["./skills/x"],
            }],
        }
        tree_called = {"count": 0}

        def http(url):
            if "api.github.com" in url:
                tree_called["count"] += 1
                return json.dumps({"tree": []}).encode()
            if url.endswith("/marketplace.json"):
                return json.dumps(marketplace_doc).encode()
            if url.endswith("/skills/x/SKILL.md"):
                return SAMPLE_SKILL_MD
            raise IOError(f"no route: {url}")

        mp_url = "https://raw.githubusercontent.com/a/b/main/.claude-plugin/marketplace.json"
        with patch("source_adapters.marketplace._load_enrichment", return_value={}):
            result = self.adapter.fetch(mp_url, http)
        self.assertEqual(tree_called["count"], 0)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, "brainstorming")

    def test_non_github_url_with_empty_skills_returns_empty(self):
        marketplace_doc = {
            "name": "local",
            "plugins": [{"name": "p", "source": "./"}],
        }
        mp_url = "https://example.com/some/path/marketplace.json"
        route = {mp_url: json.dumps(marketplace_doc).encode()}
        result = self.adapter.fetch(mp_url, make_http(route))
        self.assertEqual(result, [])

    def test_tree_api_failure_returns_empty_gracefully(self):
        marketplace_doc = {
            "name": "test",
            "plugins": [{"name": "p", "source": "./"}],
        }

        def http(url):
            if "api.github.com" in url:
                raise IOError("HTTP Error 403: rate limit exceeded")
            if url.endswith("/marketplace.json"):
                return json.dumps(marketplace_doc).encode()
            raise IOError(f"no route: {url}")

        mp_url = "https://raw.githubusercontent.com/obra/superpowers/main/.claude-plugin/marketplace.json"
        result = self.adapter.fetch(mp_url, http)
        self.assertEqual(result, [])

    def test_tree_api_cap_respected(self):
        marketplace_doc = {
            "name": "huge",
            "plugins": [{"name": "p", "source": "./"}],
        }
        tree_doc = {
            "tree": [{"path": f"skills/s{i}/SKILL.md"} for i in range(100)],
        }

        def http(url):
            if "api.github.com" in url:
                return json.dumps(tree_doc).encode()
            if url.endswith("/marketplace.json"):
                return json.dumps(marketplace_doc).encode()
            if "/SKILL.md" in url:
                return SAMPLE_SKILL_MD
            raise IOError(f"no route: {url}")

        mp_url = "https://raw.githubusercontent.com/a/huge/main/.claude-plugin/marketplace.json"
        with patch("source_adapters.marketplace._load_enrichment", return_value={}):
            result = self.adapter.fetch(mp_url, http)
        self.assertLessEqual(
            len(result),
            MarketplaceAdapter.MAX_SKILLS_PER_PLUGIN_FROM_TREE,
        )

    def test_shape_c_produces_entry_with_inferred_tags(self):
        marketplace_doc = {
            "name": "test",
            "plugins": [{"name": "p", "source": "./"}],
        }
        tree_doc = {"tree": [{"path": "skills/web-testing/SKILL.md"}]}
        skill_md = b"""---
name: web-testing
description: Testing web applications with Playwright. Use for any frontend or backend web project.
---
"""
        route = {
            "https://raw.githubusercontent.com/a/b/main/.claude-plugin/marketplace.json":
                json.dumps(marketplace_doc).encode(),
            "https://api.github.com/repos/a/b/git/trees/main?recursive=1":
                json.dumps(tree_doc).encode(),
            "https://raw.githubusercontent.com/a/b/main/skills/web-testing/SKILL.md":
                skill_md,
        }
        with patch("source_adapters.marketplace._load_enrichment", return_value={}):
            result = self.adapter.fetch(
                "https://raw.githubusercontent.com/a/b/main/.claude-plugin/marketplace.json",
                make_http(route),
            )
        self.assertEqual(len(result), 1)
        entry = result[0]
        self.assertEqual(entry.id, "web-testing")
        self.assertIn("has_web", entry.tags)
        self.assertIn("backend-api", entry.default_for)


if __name__ == "__main__":
    unittest.main()
