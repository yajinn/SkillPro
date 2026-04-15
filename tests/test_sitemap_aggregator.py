"""Unit tests for the sitemap-aggregator source adapter."""
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from source_adapters.sitemap_aggregator import (  # noqa: E402
    DEFAULT_MAX_REPOS,
    SitemapAggregatorAdapter,
    extract_pair,
)


def make_sitemap(urls):
    entries = "\n".join(f"  <url><loc>{u}</loc></url>" for u in urls)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{entries}\n"
        "</urlset>\n"
    ).encode()


def make_http(route_map: dict):
    def _get(url: str) -> bytes:
        if url in route_map:
            value = route_map[url]
            if isinstance(value, Exception):
                raise value
            return value if isinstance(value, bytes) else value.encode()
        raise IOError(f"not found: {url}")
    return _get


class TestExtractPair(unittest.TestCase):
    def test_depth_3_matches(self):
        self.assertEqual(
            extract_pair("https://skills.sh/anthropics/skills/frontend-design"),
            ("anthropics", "skills"),
        )

    def test_depth_1_rejected(self):
        self.assertIsNone(extract_pair("https://skills.sh/picks"))

    def test_depth_2_rejected(self):
        self.assertIsNone(extract_pair("https://skills.sh/owner/repo"))

    def test_depth_4_rejected(self):
        self.assertIsNone(extract_pair("https://skills.sh/a/b/c/d"))

    def test_trailing_slash_allowed(self):
        self.assertEqual(
            extract_pair("https://skills.sh/owner/repo/skill/"),
            ("owner", "repo"),
        )

    def test_non_alphanumeric_segment_rejected(self):
        self.assertIsNone(
            extract_pair("https://skills.sh/owner/repo%20name/skill")
        )

    def test_http_scheme_accepted(self):
        self.assertEqual(
            extract_pair("http://example.com/a/b/c"),
            ("a", "b"),
        )

    def test_malformed_url_returns_none(self):
        self.assertIsNone(extract_pair(""))
        self.assertIsNone(extract_pair("not-a-url"))


class TestSitemapFetching(unittest.TestCase):
    def setUp(self):
        self.adapter = SitemapAggregatorAdapter()

    def test_sitemap_fetch_failure_returns_empty(self):
        def broken(url):
            raise IOError("connection refused")
        self.assertEqual(
            self.adapter.fetch("http://x/sitemap.xml", broken),
            [],
        )

    def test_malformed_xml_returns_empty(self):
        routes = {"http://x/sitemap.xml": b"not xml at all <<<"}
        self.assertEqual(
            self.adapter.fetch("http://x/sitemap.xml", make_http(routes)),
            [],
        )

    def test_empty_sitemap_returns_empty(self):
        routes = {"http://x/sitemap.xml": make_sitemap([])}
        self.assertEqual(
            self.adapter.fetch("http://x/sitemap.xml", make_http(routes)),
            [],
        )

    def test_no_skill_pattern_urls_returns_empty(self):
        routes = {
            "http://x/sitemap.xml": make_sitemap([
                "http://x/about",
                "http://x/contact",
                "http://x/owner/repo",
            ]),
        }
        self.assertEqual(
            self.adapter.fetch("http://x/sitemap.xml", make_http(routes)),
            [],
        )


class TestRepoGroupingAndDelegation(unittest.TestCase):
    def setUp(self):
        self.adapter = SitemapAggregatorAdapter()

    def test_groups_by_owner_repo_and_delegates(self):
        mp = json.dumps({
            "name": "anthropic",
            "plugins": [{
                "name": "p",
                "skills": [{
                    "id": "frontend-design",
                    "name": "Frontend Design",
                    "description": "",
                    "tags": [],
                    "default_for": [],
                    "install_url": "http://x/SKILL.md",
                }],
            }],
        }).encode()
        routes = {
            "http://x/sitemap.xml": make_sitemap([
                "https://skills.sh/anthropics/skills/frontend-design",
                "https://skills.sh/anthropics/skills/xlsx",
                "https://skills.sh/anthropics/skills/pdf",
                "https://skills.sh/owner2/repo2/skill-a",
            ]),
            "https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json": mp,
        }

        with patch(
            "source_adapters.marketplace._load_enrichment", return_value={}
        ):
            result = self.adapter.fetch(
                "http://x/sitemap.xml", make_http(routes)
            )

        ids = {e.id for e in result}
        self.assertIn("frontend-design", ids)

    def test_max_repos_cap_from_source_config(self):
        urls = [
            f"https://skills.sh/owner{i}/repo{i}/skill-{j}"
            for i in range(10)
            for j in range(3)
        ]
        routes = {"http://x/sitemap.xml": make_sitemap(urls)}
        probed = []

        def counting_http(url):
            if url in routes:
                return routes[url]
            if "raw.githubusercontent.com" in url:
                import re as _re
                m = _re.search(r"raw\.githubusercontent\.com/([^/]+)/([^/]+)/", url)
                if m:
                    probed.append((m.group(1), m.group(2)))
            raise IOError("not found")

        self.adapter.fetch(
            "http://x/sitemap.xml",
            counting_http,
            source={"max_repos": 3},
        )
        unique_probed = set(probed)
        self.assertLessEqual(len(unique_probed), 3)

    def test_default_max_repos_when_source_none(self):
        self.assertEqual(DEFAULT_MAX_REPOS, 15)
        urls = [
            f"https://skills.sh/owner{i}/repo{i}/skill"
            for i in range(100)
        ]
        routes = {"http://x/sitemap.xml": make_sitemap(urls)}
        probed = set()

        def counting_http(url):
            if url in routes:
                return routes[url]
            if "raw.githubusercontent.com" in url:
                import re as _re
                m = _re.search(r"raw\.githubusercontent\.com/([^/]+)/([^/]+)/", url)
                if m:
                    probed.add((m.group(1), m.group(2)))
            raise IOError("not found")

        self.adapter.fetch("http://x/sitemap.xml", counting_http)
        self.assertLessEqual(len(probed), DEFAULT_MAX_REPOS)

    def test_zero_max_repos_falls_back_to_default(self):
        urls = [f"https://skills.sh/o{i}/r/s" for i in range(80)]
        routes = {"http://x/sitemap.xml": make_sitemap(urls)}
        probed = set()

        def http(url):
            if url in routes:
                return routes[url]
            if "raw.githubusercontent.com" in url:
                import re as _re
                m = _re.search(r"raw\.githubusercontent\.com/([^/]+)/([^/]+)/", url)
                if m:
                    probed.add((m.group(1), m.group(2)))
            raise IOError("nf")

        self.adapter.fetch(
            "http://x/sitemap.xml",
            http,
            source={"max_repos": 0},
        )
        self.assertGreater(len(probed), 0)
        self.assertLessEqual(len(probed), DEFAULT_MAX_REPOS)


if __name__ == "__main__":
    unittest.main()
