"""Tests for the awesome-list markdown source adapter."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from source_adapters.awesome_list import (  # noqa: E402
    AwesomeListAdapter,
    extract_github_repos,
)

README = (ROOT / "tests" / "fixtures" / "awesome_readme_sample.md").read_bytes()


def make_http_get(route_map: dict):
    """Build a fake http_get that returns mapped bytes or raises IOError for unknowns."""
    def _get(url: str) -> bytes:
        if url in route_map:
            return route_map[url]
        raise IOError(f"not found: {url}")
    return _get


class TestExtractGithubRepos(unittest.TestCase):
    def test_extracts_owner_repo_links(self):
        md = """
        - [foo](https://github.com/alice/foo)
        - [bar](https://github.com/bob/bar) text
        - not github: https://example.com/baz
        - user page: https://github.com/charlie
        """
        repos = extract_github_repos(md)
        self.assertIn(("alice", "foo"), repos)
        self.assertIn(("bob", "bar"), repos)
        self.assertNotIn(("charlie",), [r[:1] for r in repos])

    def test_dedupes(self):
        md = "- [x](https://github.com/a/b)\n- [y](https://github.com/a/b/tree/main)"
        repos = extract_github_repos(md)
        self.assertEqual(len(repos), 1)


class TestAwesomeListAdapter(unittest.TestCase):
    def setUp(self):
        self.adapter = AwesomeListAdapter()

    def test_type_field(self):
        self.assertEqual(self.adapter.type, "awesome-list")

    def test_fetch_probes_each_repo_for_marketplace_json(self):
        mp = json.dumps({
            "name": "alice-mp",
            "plugins": [{
                "name": "p",
                "skills": [{
                    "id": "security-guardian",
                    "name": "SG",
                    "description": "",
                    "tags": ["has_web"],
                    "default_for": ["web-frontend"],
                    "install_url": "https://raw.githubusercontent.com/alice/security-guardian/main/SKILL.md",
                }]
            }]
        }).encode()
        routes = {
            "http://readme": README,
            "https://raw.githubusercontent.com/alice/security-guardian/main/marketplace.json": mp,
        }
        result = self.adapter.fetch("http://readme", make_http_get(routes))
        ids = {e.id for e in result}
        self.assertIn("security-guardian", ids)

    def test_fetch_caps_probes_at_20_repos(self):
        """Cap is on REPOSITORIES probed (20), not raw HTTP requests.

        The adapter tries both `.claude-plugin/marketplace.json` and the
        legacy root `marketplace.json` per repo, so the raw HTTP count is
        at most 2 × 20 = 40. What matters for rate-limiting is that no
        more than 20 distinct repos are touched.
        """
        big_md = "\n".join(
            f"- [r{i}](https://github.com/owner/r{i})" for i in range(50)
        ).encode()
        seen_repos = set()

        def counting_http_get(url: str) -> bytes:
            if url == "http://big":
                return big_md
            # Extract the repo segment "owner/rX" from the probe URL
            m = __import__("re").search(r"github\.com/[^/]+/([^/]+)/([^/]+)/", url)
            if m:
                seen_repos.add(m.group(2))
            raise IOError("no marketplace")
        result = self.adapter.fetch("http://big", counting_http_get)
        self.assertEqual(result, [])
        self.assertLessEqual(len(seen_repos), 20)

    def test_fetch_on_readme_fail_returns_empty(self):
        def broken(url: str) -> bytes:
            raise IOError("oops")
        self.assertEqual(self.adapter.fetch("http://x", broken), [])


if __name__ == "__main__":
    unittest.main()
