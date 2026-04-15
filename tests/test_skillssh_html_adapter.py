"""Tests for scripts/source_adapters/skillssh_html.py — the skills.sh
HTML parser that avoids the GitHub Tree API rate limit.

The adapter walks skills.sh/sitemap.xml, extracts depth-3 skill URLs,
fetches each HTML page, and parses:
  - install command (via regex → github owner/repo + skill id)
  - h1 → skill name
  - summary section or og:description → description

All HTTP is mocked. These tests don't hit the real skills.sh.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from source_adapters.skillssh_html import (  # noqa: E402
    SkillsShHtmlAdapter,
    _parse_sitemap,
    _parse_skill_page,
    _infer_install_url,
    SkillPageUrl,
)


SAMPLE_SITEMAP = b"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://skills.sh/picks</loc></url>
<url><loc>https://skills.sh/anthropics/skills/frontend-design</loc></url>
<url><loc>https://skills.sh/vercel-labs/skills/find-skills</loc></url>
<url><loc>https://skills.sh/obra/superpowers/writing-plans</loc></url>
<url><loc>https://skills.sh/about</loc></url>
</urlset>"""


# Simplified version of a real skills.sh page — regexes match the
# same HTML structure as the live site.
def _skill_page_html(skill_id: str, github_url: str, summary: str) -> str:
    return f"""<!DOCTYPE html>
<html><head>
<meta property="og:description" content="Discover and install skills for AI agents."/>
</head><body>
<h1 class="text-4xl">{skill_id}</h1>
<div>Installation</div>
<button title="Copy to clipboard">
  <code><span class="opacity-50">$</span> <!-- -->npx skills add {github_url} --skill {skill_id}</code>
</button>
<div>Summary</div>
<div class="summary">
  <div class="prose">
    <p><strong>{summary}</strong></p>
  </div>
</div>
</body></html>"""


class TestSitemapParsing(unittest.TestCase):
    def test_extracts_depth_3_urls_only(self):
        pages = _parse_sitemap(SAMPLE_SITEMAP)
        skill_ids = {p.skill_id for p in pages}
        self.assertIn("frontend-design", skill_ids)
        self.assertIn("find-skills", skill_ids)
        self.assertIn("writing-plans", skill_ids)
        # Depth-1 and depth-2 paths excluded
        self.assertNotIn("picks", skill_ids)
        self.assertNotIn("about", skill_ids)

    def test_owner_repo_extraction(self):
        pages = _parse_sitemap(SAMPLE_SITEMAP)
        by_id = {p.skill_id: p for p in pages}
        self.assertEqual(by_id["frontend-design"].owner, "anthropics")
        self.assertEqual(by_id["frontend-design"].repo, "skills")
        self.assertEqual(by_id["writing-plans"].owner, "obra")
        self.assertEqual(by_id["writing-plans"].repo, "superpowers")

    def test_malformed_xml_returns_empty(self):
        self.assertEqual(_parse_sitemap(b"not xml"), [])

    def test_empty_sitemap_returns_empty(self):
        self.assertEqual(_parse_sitemap(
            b'<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>'
        ), [])


class TestInferInstallUrl(unittest.TestCase):
    def test_standard_github_url(self):
        result = _infer_install_url(
            "https://github.com/anthropics/skills", "frontend-design"
        )
        self.assertEqual(
            result,
            "https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md",
        )

    def test_trailing_slash_stripped(self):
        result = _infer_install_url(
            "https://github.com/obra/superpowers/", "writing-plans"
        )
        self.assertEqual(
            result,
            "https://raw.githubusercontent.com/obra/superpowers/main/skills/writing-plans/SKILL.md",
        )

    def test_git_suffix_stripped(self):
        result = _infer_install_url(
            "https://github.com/vercel-labs/skills.git", "find-skills"
        )
        self.assertIn("vercel-labs/skills/main", result)
        # The repo path segment must be "skills", not "skills.git"
        self.assertNotIn("skills.git/", result)


class TestPageParsing(unittest.TestCase):
    def test_happy_path(self):
        html = _skill_page_html(
            "frontend-design",
            "https://github.com/anthropics/skills",
            "Distinctive, production-grade frontend interfaces.",
        )
        url = SkillPageUrl("https://skills.sh/anthropics/skills/frontend-design",
                           "anthropics", "skills", "frontend-design")
        entry = _parse_skill_page(html, url)
        self.assertIsNotNone(entry)
        self.assertEqual(entry.id, "frontend-design")
        self.assertIn("frontend interfaces", entry.description)
        self.assertIn("anthropics/skills/main/skills/frontend-design", entry.install_url)

    def test_fallback_to_og_description(self):
        # No summary section at all — should fall back to og:description
        html = """<html><head>
<meta property="og:description" content="Custom skill specific description here"/>
</head><body>
<h1>test-skill</h1>
<code>npx skills add https://github.com/foo/bar --skill test-skill</code>
</body></html>"""
        url = SkillPageUrl("https://skills.sh/foo/bar/test-skill",
                           "foo", "bar", "test-skill")
        entry = _parse_skill_page(html, url)
        self.assertIsNotNone(entry)
        self.assertEqual(entry.description, "Custom skill specific description here")

    def test_generic_og_description_filtered(self):
        # If og:description is the generic one, use the fallback string
        html = """<html><head>
<meta property="og:description" content="Discover and install skills for AI agents."/>
</head><body>
<h1>test-skill</h1>
<code>npx skills add https://github.com/foo/bar --skill test-skill</code>
</body></html>"""
        url = SkillPageUrl("https://skills.sh/foo/bar/test-skill",
                           "foo", "bar", "test-skill")
        entry = _parse_skill_page(html, url)
        self.assertIsNotNone(entry)
        # Falls back to "<skill-id> (via skills.sh)"
        self.assertIn("skills.sh", entry.description)

    def test_no_install_command_returns_none(self):
        html = "<html><body>404 not found</body></html>"
        url = SkillPageUrl("https://skills.sh/foo/bar/baz", "foo", "bar", "baz")
        self.assertIsNone(_parse_skill_page(html, url))

    def test_description_capped_at_500(self):
        long_summary = "x" * 1000
        html = _skill_page_html("x", "https://github.com/a/b", long_summary)
        url = SkillPageUrl("https://skills.sh/a/b/x", "a", "b", "x")
        entry = _parse_skill_page(html, url)
        self.assertLessEqual(len(entry.description), 500)


class TestAdapterFetch(unittest.TestCase):
    def _make_http(self, pages: dict) -> callable:
        """Build a fake http_get that serves sitemap + skill pages."""
        def _get(url: str) -> bytes:
            if url.endswith("/sitemap.xml"):
                return SAMPLE_SITEMAP
            if url in pages:
                return pages[url].encode()
            raise IOError(f"no route: {url}")
        return _get

    def test_fetches_and_parses_all_skills(self):
        pages = {
            "https://skills.sh/anthropics/skills/frontend-design": _skill_page_html(
                "frontend-design",
                "https://github.com/anthropics/skills",
                "Distinctive frontend interfaces.",
            ),
            "https://skills.sh/vercel-labs/skills/find-skills": _skill_page_html(
                "find-skills",
                "https://github.com/vercel-labs/skills",
                "Find the skills you need for your project.",
            ),
            "https://skills.sh/obra/superpowers/writing-plans": _skill_page_html(
                "writing-plans",
                "https://github.com/obra/superpowers",
                "Turn specs into implementation plans.",
            ),
        }
        adapter = SkillsShHtmlAdapter()
        entries = adapter.fetch(
            "https://skills.sh/sitemap.xml",
            self._make_http(pages),
        )
        self.assertEqual(len(entries), 3)
        ids = {e.id for e in entries}
        self.assertEqual(ids, {"frontend-design", "find-skills", "writing-plans"})

    def test_respects_max_skills_cap(self):
        # 3 pages in sitemap, max_skills=2 → only first 2 fetched
        pages = {
            "https://skills.sh/anthropics/skills/frontend-design": _skill_page_html(
                "frontend-design", "https://github.com/anthropics/skills", "x"),
            "https://skills.sh/vercel-labs/skills/find-skills": _skill_page_html(
                "find-skills", "https://github.com/vercel-labs/skills", "x"),
            "https://skills.sh/obra/superpowers/writing-plans": _skill_page_html(
                "writing-plans", "https://github.com/obra/superpowers", "x"),
        }
        adapter = SkillsShHtmlAdapter()
        entries = adapter.fetch(
            "https://skills.sh/sitemap.xml",
            self._make_http(pages),
            source={"max_skills": 2},
        )
        self.assertLessEqual(len(entries), 2)

    def test_empty_sitemap_returns_empty(self):
        def http(url):
            if url.endswith("/sitemap.xml"):
                return b'<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>'
            raise IOError(f"no route: {url}")
        adapter = SkillsShHtmlAdapter()
        entries = adapter.fetch("https://skills.sh/sitemap.xml", http)
        self.assertEqual(entries, [])

    def test_sitemap_fetch_failure_returns_empty(self):
        def http(url):
            raise IOError("network down")
        adapter = SkillsShHtmlAdapter()
        entries = adapter.fetch("https://skills.sh/sitemap.xml", http)
        self.assertEqual(entries, [])

    def test_skill_page_failure_is_non_fatal(self):
        # One page 404s, others succeed — adapter returns the successes
        pages = {
            "https://skills.sh/anthropics/skills/frontend-design": _skill_page_html(
                "frontend-design", "https://github.com/anthropics/skills", "x"),
        }
        adapter = SkillsShHtmlAdapter()
        entries = adapter.fetch(
            "https://skills.sh/sitemap.xml",
            self._make_http(pages),
        )
        # Only one page fetched successfully; the other 2 return 404
        # but that's not a fatal adapter error
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].id, "frontend-design")


if __name__ == "__main__":
    unittest.main()
