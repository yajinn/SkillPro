# Dynamic Skill Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commit policy (project-specific):** the user has a standing instruction to not create git commits during this session. Every task's final "commit" step is replaced with a staging-verification step. The engineer runs the test suite and leaves changes unstaged so the user can commit in one pass at the end.

**Goal:** Replace the static `config/catalog.json` model with a federated index fetched from external `marketplace.json` and awesome-list sources, scored against the project profile, installed on demand with an audit stub.

**Architecture:** A Python orchestrator (`refresh_index.py`) reads a source whitelist (`config/sources.json`), dispatches per-source adapters in a thread pool, dedupes results by skill id, and writes `~/.claude/skillforge/index.json`. `score.py` reads the same index instead of the old catalog. `install_skill.py` fetches a specific skill's files, runs an audit stub, writes to `~/.claude/skills/<id>/`, and records the install in `selections.json`. The `/skillforge` command orchestrates the whole flow with stale-while-revalidate caching.

**Tech Stack:** Python 3 stdlib only (`urllib`, `concurrent.futures`, `hashlib`, `json`, `re`, `pathlib`, `unittest`). No pip dependencies. Bash for the single entry hook (`hooks/detect.sh` unchanged).

---

## File structure

| Path | Responsibility |
|---|---|
| `config/sources.json` | Built-in source whitelist |
| `scripts/source_adapters/__init__.py` | Package marker |
| `scripts/source_adapters/base.py` | `SkillEntry` dataclass + `SourceAdapter` protocol + HTTP helper |
| `scripts/source_adapters/marketplace.py` | Parses `marketplace.json` into `SkillEntry` list |
| `scripts/source_adapters/awesome_list.py` | Extracts GitHub links from README, probes each for skills |
| `scripts/refresh_index.py` | Orchestrator: read sources → fetch parallel → dedupe → write `index.json` |
| `scripts/install_skill.py` | Fetch + audit + atomic write to `~/.claude/skills/<id>/` |
| `scripts/audit_skill.py` | Stub audit gate (returns `unavailable`) |
| `scripts/score.py` | **Edit** — read index instead of catalog |
| `commands/skillforge.md` | **Rewrite** — new argument set + stale-while-revalidate |
| `tests/__init__.py` | Package marker |
| `tests/fixtures/marketplace_sample.json` | Test input for marketplace adapter |
| `tests/fixtures/awesome_readme_sample.md` | Test input for awesome-list adapter |
| `tests/fixtures/skill_sample.md` | A fake SKILL.md served by the local HTTP server |
| `tests/test_base.py` | `SkillEntry` and HTTP helper tests |
| `tests/test_marketplace_adapter.py` | Marketplace adapter unit tests |
| `tests/test_awesome_list_adapter.py` | Awesome-list adapter unit tests |
| `tests/test_refresh_index.py` | Refresh orchestrator tests with injected HTTP |
| `tests/test_install_skill.py` | Install pipeline tests |
| `tests/test_score_v2.py` | Score.py regression test against index |
| `tests/test_end_to_end.py` | Full pipeline against a local HTTP server |
| `config/catalog.json` | **Delete** |
| `skills/git-safety/SKILL.md` | **Delete** (moves to separate repo, out of scope) |
| `skills/` | **Delete** (empty after above) |
| `PRD.md` | **Edit** — replace §Skill catalog with §Federated index |
| `README.md` | **Edit** — discovery-first model |

Tests live at the top level `tests/` directory. Each module under test has exactly one test file. Fixtures are plain files (JSON, markdown) — no fixture framework.

---

## Task 1: Scaffold tests directory and fixtures

**Files:**
- Create: `tests/__init__.py`
- Create: `tests/fixtures/marketplace_sample.json`
- Create: `tests/fixtures/awesome_readme_sample.md`
- Create: `tests/fixtures/skill_sample.md`

- [ ] **Step 1: Create empty package marker**

```bash
mkdir -p tests/fixtures
: > tests/__init__.py
```

- [ ] **Step 2: Create `tests/fixtures/marketplace_sample.json`**

```json
{
  "name": "fake-marketplace",
  "version": "1.0.0",
  "plugins": [
    {
      "name": "core-layers",
      "description": "Universal skills",
      "skills": [
        {
          "id": "security-guardian",
          "name": "Security Guardian",
          "description": "Secret detection, input validation, XSS/CSRF/SQLi, auth best practices",
          "tags": ["has_user_input", "has_api", "has_web", "has_db", "handles_auth"],
          "boost_when": ["serves_public", "has_ecommerce"],
          "penalize_when": [],
          "default_for": ["web-frontend", "backend-api", "mobile", "cms-web", "cli-tool"],
          "install_url": "http://127.0.0.1:$PORT/security-guardian/SKILL.md",
          "commit_sha": "deadbeef1234",
          "version": "1.0.0"
        },
        {
          "id": "git-safety",
          "name": "Git Safety",
          "description": "Branch protection, force-push prevention",
          "tags": ["any"],
          "boost_when": ["has_ci"],
          "penalize_when": [],
          "default_for": ["web-frontend", "backend-api", "mobile", "cli-tool", "library"],
          "install_url": "http://127.0.0.1:$PORT/git-safety/SKILL.md",
          "commit_sha": "cafef00d5678",
          "version": "1.0.0"
        }
      ]
    }
  ]
}
```

The `$PORT` placeholder is replaced at test time by the integration test (Task 14). Unit tests don't care about the URL contents.

- [ ] **Step 3: Create `tests/fixtures/awesome_readme_sample.md`**

```markdown
# Awesome Claude Skills

A curated list of skills for Claude Code.

## Core

- [security-guardian](https://github.com/alice/security-guardian) — secret scanning and input validation
- [git-safety](https://github.com/bob/git-safety) — branch protection rules

## Unrelated noise we should ignore

- [A regular blog post](https://example.com/post) — not a GitHub link
- [Internal docs](https://docs.internal.corp/x) — not GitHub
- See also: [owner-only](https://github.com/charlie) — a user page, not a repo

## Framework

- [nextjs-conventions](https://github.com/dave/nextjs-conventions) — Next.js patterns
```

- [ ] **Step 4: Create `tests/fixtures/skill_sample.md`**

```markdown
---
name: Security Guardian
description: Secret detection, input validation, XSS/CSRF/SQLi, auth best practices
---

# Security Guardian

A sample SKILL.md for testing the install pipeline.
```

- [ ] **Step 5: Verify files exist**

Run:
```bash
ls -la tests/ tests/fixtures/
```
Expected: both directories exist, each fixture file is non-empty.

- [ ] **Step 6: Stage (no commit per project policy)**

```bash
git status --short tests/
```
Expected: `??` on each new file.

---

## Task 2: Base adapter protocol and `SkillEntry` dataclass

**Files:**
- Create: `scripts/source_adapters/__init__.py`
- Create: `scripts/source_adapters/base.py`
- Create: `tests/test_base.py`

- [ ] **Step 1: Create package marker**

```bash
: > scripts/source_adapters/__init__.py
```

- [ ] **Step 2: Write failing test `tests/test_base.py`**

```python
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
```

- [ ] **Step 3: Run test, verify it fails**

Run:
```bash
python3 -m unittest tests.test_base -v
```
Expected: `ModuleNotFoundError: No module named 'source_adapters.base'`.

- [ ] **Step 4: Implement `scripts/source_adapters/base.py`**

```python
"""Shared data types and HTTP helper for source adapters."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Callable, List, Optional, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


@dataclass
class SkillEntry:
    id: str
    name: str
    description: str
    tags: List[str]
    boost_when: List[str]
    penalize_when: List[str]
    default_for: List[str]
    match_language: Optional[str]
    match_framework: Optional[str]
    match_sub_framework: Optional[str]
    install_url: str
    version: Optional[str]
    commit_sha: Optional[str]

    def to_dict(self) -> dict:
        return asdict(self)


HttpGet = Callable[[str], bytes]


class SourceAdapter(Protocol):
    type: str

    def fetch(self, url: str, http_get: HttpGet) -> List[SkillEntry]:
        ...


def http_get_default(url: str, timeout: float = 10.0) -> bytes:
    """Default HTTP GET used in production.

    Tests inject their own callable and never hit the network.
    """
    req = Request(url, headers={"User-Agent": "skillforge/1.0 (+https://skillforge.dev)"})
    try:
        with urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except (HTTPError, URLError) as exc:
        raise IOError(f"fetch failed for {url}: {exc}") from exc


def parse_json_bytes(body: bytes) -> dict:
    """Parse JSON bytes, raising ValueError with context on failure."""
    try:
        return json.loads(body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"invalid JSON payload: {exc}") from exc
```

- [ ] **Step 5: Run test again, verify it passes**

Run:
```bash
python3 -m unittest tests.test_base -v
```
Expected: 3 tests pass, 0 failures.

- [ ] **Step 6: Stage (no commit)**

```bash
git status --short scripts/source_adapters/ tests/test_base.py
```
Expected: untracked files listed.

---

## Task 3: Marketplace source adapter

**Files:**
- Create: `scripts/source_adapters/marketplace.py`
- Create: `tests/test_marketplace_adapter.py`

- [ ] **Step 1: Write failing test `tests/test_marketplace_adapter.py`**

```python
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
        # Marketplace entries may omit version / commit_sha / match_*
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
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
python3 -m unittest tests.test_marketplace_adapter -v
```
Expected: `ModuleNotFoundError: No module named 'source_adapters.marketplace'`.

- [ ] **Step 3: Implement `scripts/source_adapters/marketplace.py`**

```python
"""Adapter for Claude Code-style marketplace.json sources.

Schema assumed:
    {
      "name": str,
      "plugins": [
        {
          "name": str,
          "skills": [
            {
              "id": str,
              "name": str,
              "description": str,
              "tags": [str],
              "boost_when": [str]?,
              "penalize_when": [str]?,
              "default_for": [str],
              "match_language": str?,
              "match_framework": str?,
              "match_sub_framework": str?,
              "install_url": str,
              "version": str?,
              "commit_sha": str?
            }
          ]
        }
      ]
    }
"""
from __future__ import annotations

import sys
from typing import List

from .base import HttpGet, SkillEntry, parse_json_bytes


class MarketplaceAdapter:
    type = "marketplace"

    def fetch(self, url: str, http_get: HttpGet) -> List[SkillEntry]:
        try:
            body = http_get(url)
            doc = parse_json_bytes(body)
        except (IOError, ValueError) as exc:
            print(f"[marketplace] fetch/parse failed for {url}: {exc}", file=sys.stderr)
            return []

        plugins = doc.get("plugins")
        if not isinstance(plugins, list):
            print(f"[marketplace] {url}: no 'plugins' array", file=sys.stderr)
            return []

        entries: List[SkillEntry] = []
        for plugin in plugins:
            if not isinstance(plugin, dict):
                continue
            skills = plugin.get("skills") or []
            if not isinstance(skills, list):
                continue
            for skill in skills:
                if not isinstance(skill, dict):
                    continue
                try:
                    entries.append(self._to_entry(skill))
                except (KeyError, TypeError) as exc:
                    print(
                        f"[marketplace] skipping malformed skill in {url}: {exc}",
                        file=sys.stderr,
                    )
                    continue
        return entries

    @staticmethod
    def _to_entry(skill: dict) -> SkillEntry:
        return SkillEntry(
            id=skill["id"],
            name=skill["name"],
            description=skill.get("description", ""),
            tags=list(skill.get("tags") or []),
            boost_when=list(skill.get("boost_when") or []),
            penalize_when=list(skill.get("penalize_when") or []),
            default_for=list(skill.get("default_for") or []),
            match_language=skill.get("match_language"),
            match_framework=skill.get("match_framework"),
            match_sub_framework=skill.get("match_sub_framework"),
            install_url=skill["install_url"],
            version=skill.get("version"),
            commit_sha=skill.get("commit_sha"),
        )
```

- [ ] **Step 4: Run test again, verify it passes**

Run:
```bash
python3 -m unittest tests.test_marketplace_adapter -v
```
Expected: 6 tests pass.

- [ ] **Step 5: Stage (no commit)**

```bash
git status --short scripts/source_adapters/marketplace.py tests/test_marketplace_adapter.py
```

---

## Task 4: Awesome-list source adapter

**Files:**
- Create: `scripts/source_adapters/awesome_list.py`
- Create: `tests/test_awesome_list_adapter.py`

- [ ] **Step 1: Write failing test `tests/test_awesome_list_adapter.py`**

```python
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
            # bob and dave have no marketplace.json → 404
        }
        result = self.adapter.fetch("http://readme", make_http_get(routes))
        ids = {e.id for e in result}
        self.assertIn("security-guardian", ids)

    def test_fetch_caps_probes_at_20(self):
        big_md = "\n".join(
            f"- [r{i}](https://github.com/owner/r{i})" for i in range(50)
        ).encode()
        probes = {"type": "counter", "n": 0}

        def counting_http_get(url: str) -> bytes:
            if url == "http://big":
                return big_md
            probes["n"] += 1
            raise IOError("no marketplace")
        result = self.adapter.fetch("http://big", counting_http_get)
        self.assertEqual(result, [])
        self.assertLessEqual(probes["n"], 20)

    def test_fetch_on_readme_fail_returns_empty(self):
        def broken(url: str) -> bytes:
            raise IOError("oops")
        self.assertEqual(self.adapter.fetch("http://x", broken), [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
python3 -m unittest tests.test_awesome_list_adapter -v
```
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `scripts/source_adapters/awesome_list.py`**

```python
"""Adapter for curated awesome-* markdown README sources.

Strategy:
    1. Fetch README.
    2. Extract (owner, repo) pairs from GitHub links using a conservative regex.
    3. For each repo (capped at MAX_PROBES), probe raw.githubusercontent.com/
       <owner>/<repo>/main/marketplace.json. If present, delegate to the
       marketplace adapter to parse it. Repos without a marketplace.json at the
       conventional location are skipped silently.
"""
from __future__ import annotations

import re
import sys
from typing import List, Tuple

from .base import HttpGet, SkillEntry
from .marketplace import MarketplaceAdapter

MAX_PROBES = 20

# Match https://github.com/<owner>/<repo>[/...] where owner and repo are
# non-empty segments that don't contain slashes or whitespace.
_GH_RE = re.compile(
    r"https?://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?=[/)\s]|$)"
)


def extract_github_repos(markdown: str | bytes) -> List[Tuple[str, str]]:
    if isinstance(markdown, bytes):
        markdown = markdown.decode("utf-8", errors="replace")
    seen: List[Tuple[str, str]] = []
    for match in _GH_RE.finditer(markdown):
        owner, repo = match.group(1), match.group(2)
        # Strip a common trailing ".git"
        if repo.endswith(".git"):
            repo = repo[:-4]
        pair = (owner, repo)
        if pair not in seen:
            seen.append(pair)
    return seen


class AwesomeListAdapter:
    type = "awesome-list"

    def __init__(self) -> None:
        self._marketplace = MarketplaceAdapter()

    def fetch(self, url: str, http_get: HttpGet) -> List[SkillEntry]:
        try:
            body = http_get(url)
        except IOError as exc:
            print(f"[awesome-list] fetch failed for {url}: {exc}", file=sys.stderr)
            return []

        repos = extract_github_repos(body)[:MAX_PROBES]
        entries: List[SkillEntry] = []
        for owner, repo in repos:
            mp_url = (
                f"https://raw.githubusercontent.com/{owner}/{repo}/main/marketplace.json"
            )
            try:
                # Delegate parsing — the marketplace adapter already handles
                # malformed JSON, missing plugins, etc.
                entries.extend(self._marketplace.fetch(mp_url, http_get))
            except IOError:
                # Repo has no marketplace.json at the conventional location;
                # this is expected for most GitHub links.
                continue
        return entries
```

- [ ] **Step 4: Run test again, verify it passes**

Run:
```bash
python3 -m unittest tests.test_awesome_list_adapter -v
```
Expected: 5 tests pass.

- [ ] **Step 5: Stage (no commit)**

```bash
git status --short scripts/source_adapters/awesome_list.py tests/test_awesome_list_adapter.py
```

---

## Task 5: `config/sources.json`

**Files:**
- Create: `config/sources.json`

- [ ] **Step 1: Delete old `config/catalog.json`**

```bash
rm config/catalog.json
```

- [ ] **Step 2: Write `config/sources.json`**

```json
{
  "version": 1,
  "defaults": [
    {
      "type": "marketplace",
      "name": "Anthropic Skills",
      "url": "https://raw.githubusercontent.com/anthropics/skills/main/marketplace.json",
      "require_audit": false
    },
    {
      "type": "awesome-list",
      "name": "awesome-claude-skills",
      "url": "https://raw.githubusercontent.com/travisvn/awesome-claude-skills/main/README.md",
      "require_audit": false
    },
    {
      "type": "awesome-list",
      "name": "awesome-claude-plugins",
      "url": "https://raw.githubusercontent.com/quemsah/awesome-claude-plugins/main/README.md",
      "require_audit": false
    }
  ]
}
```

- [ ] **Step 3: Verify JSON is valid**

Run:
```bash
jq . config/sources.json >/dev/null && echo "ok"
```
Expected: `ok`.

- [ ] **Step 4: Delete the stale `skills/` directory from previous work**

```bash
rm -rf skills/
```

- [ ] **Step 5: Stage (no commit)**

```bash
git status --short config/ skills/
```
Expected: `config/catalog.json` and `skills/git-safety/SKILL.md` gone (untracked so they just disappear), `config/sources.json` untracked.

---

## Task 6: Refresh index orchestrator

**Files:**
- Create: `scripts/refresh_index.py`
- Create: `tests/test_refresh_index.py`

- [ ] **Step 1: Write failing test `tests/test_refresh_index.py`**

```python
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
        # A wins → tags from A
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
        a = FakeAdapter("marketplace", [entry("foo")])
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "index.json"
            refresh_index.write_index(
                {"version": 1, "skills": [{"id": "foo"}], "sources": [], "conflicts": [], "partial": False, "fetched_at": "now", "ttl_seconds": 604800},
                out,
            )
            self.assertTrue(out.exists())
            loaded = json.loads(out.read_text())
            self.assertEqual(loaded["skills"][0]["id"], "foo")
            # tmp file must be cleaned up
            self.assertFalse((Path(tmp) / "index.json.tmp").exists())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
python3 -m unittest tests.test_refresh_index -v
```
Expected: `ModuleNotFoundError: No module named 'refresh_index'`.

- [ ] **Step 3: Implement `scripts/refresh_index.py`**

```python
#!/usr/bin/env python3
"""SkillForge federated index builder.

Reads config/sources.json (or ~/.claude/skillforge/sources.json if present),
dispatches registered adapters in parallel, dedupes by skill id, and writes
~/.claude/skillforge/index.json atomically.

CLI:
    python3 refresh_index.py [--force] [--verbose]

Exit codes:
    0 = at least one skill retrieved (full or partial success)
    1 = every source failed and no usable output was produced
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

# Ensure sibling package is importable when the script is run directly.
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from source_adapters.base import SkillEntry, http_get_default  # noqa: E402
from source_adapters.marketplace import MarketplaceAdapter  # noqa: E402
from source_adapters.awesome_list import AwesomeListAdapter  # noqa: E402


DEFAULT_TTL_SECONDS = 7 * 24 * 3600  # 7 days
FETCH_TIMEOUT_SECONDS = 10
MAX_WORKERS = 4

ADAPTERS = {
    "marketplace": MarketplaceAdapter(),
    "awesome-list": AwesomeListAdapter(),
}


def skillforge_dir() -> Path:
    return Path(os.path.expanduser("~/.claude/skillforge"))


def index_path() -> Path:
    return skillforge_dir() / "index.json"


def sources_path() -> Path:
    user = skillforge_dir() / "sources.json"
    if user.exists():
        return user
    return Path(__file__).resolve().parent.parent / "config" / "sources.json"


def load_sources() -> List[dict]:
    path = sources_path()
    with open(path) as f:
        doc = json.load(f)
    defaults = doc.get("defaults")
    if not isinstance(defaults, list):
        raise ValueError(f"sources.json at {path} has no 'defaults' array")
    return defaults


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _fetch_one(source: dict, adapter, http_get) -> tuple:
    """Run one adapter with a timeout. Returns (source_meta, entries_or_None)."""
    t0 = time.monotonic()
    try:
        entries = adapter.fetch(source["url"], http_get)
        meta = {
            "name": source["name"],
            "type": source["type"],
            "url": source["url"],
            "fetched_at": now_iso(),
            "status": "ok",
            "skill_count": len(entries),
            "duration_s": round(time.monotonic() - t0, 3),
        }
        return meta, entries
    except Exception as exc:  # noqa: BLE001 — adapter errors must never escape
        meta = {
            "name": source["name"],
            "type": source["type"],
            "url": source["url"],
            "fetched_at": now_iso(),
            "status": "failed",
            "error": str(exc),
            "duration_s": round(time.monotonic() - t0, 3),
        }
        return meta, None


def build_index(
    sources: List[dict],
    adapters: Dict[str, object] = None,
    http_get=None,
) -> dict:
    """Pure function: given sources + adapters, return an index dict.

    Separated from I/O so tests can drive it with fakes.
    """
    adapters = adapters or ADAPTERS
    http_get = http_get or http_get_default

    skills_by_id: Dict[str, dict] = {}
    skill_source: Dict[str, str] = {}
    conflicts: List[dict] = []
    source_metas: List[dict] = []
    partial = False

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = []
        for source in sources:
            adapter = adapters.get(source["type"])
            if adapter is None:
                source_metas.append({
                    "name": source["name"],
                    "type": source["type"],
                    "url": source["url"],
                    "fetched_at": now_iso(),
                    "status": "failed",
                    "error": f"unknown adapter type: {source['type']}",
                })
                partial = True
                continue
            futures.append((source, pool.submit(_fetch_one, source, adapter, http_get)))

        # Gather in source order (not completion order) so first-source-wins
        # is deterministic even if a later source finishes first.
        for source, future in futures:
            try:
                meta, entries = future.result(timeout=FETCH_TIMEOUT_SECONDS)
            except concurrent.futures.TimeoutError:
                meta = {
                    "name": source["name"],
                    "type": source["type"],
                    "url": source["url"],
                    "fetched_at": now_iso(),
                    "status": "failed",
                    "error": f"timeout after {FETCH_TIMEOUT_SECONDS}s",
                }
                entries = None
            source_metas.append(meta)
            if entries is None:
                partial = True
                continue
            for entry in entries:
                if entry.id in skills_by_id:
                    # First source already wins; record the loser.
                    existing = next(
                        (c for c in conflicts if c["id"] == entry.id),
                        None,
                    )
                    if existing is None:
                        conflicts.append({
                            "id": entry.id,
                            "winner": skill_source[entry.id],
                            "losers": [source["name"]],
                        })
                    else:
                        existing["losers"].append(source["name"])
                    continue
                d = entry.to_dict()
                d["source"] = {
                    "name": source["name"],
                    "install_url": entry.install_url,
                    "commit_sha": entry.commit_sha,
                    "version": entry.version,
                }
                d["audit"] = {
                    "status": "unaudited",
                    "tool": None,
                    "scanned_at": None,
                }
                skills_by_id[entry.id] = d
                skill_source[entry.id] = source["name"]

    return {
        "version": 1,
        "fetched_at": now_iso(),
        "ttl_seconds": DEFAULT_TTL_SECONDS,
        "partial": partial,
        "sources": source_metas,
        "conflicts": conflicts,
        "skills": list(skills_by_id.values()),
    }


def write_index(index: dict, path: Path) -> None:
    """Atomic write: tmp file + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_str = tempfile.mkstemp(
        prefix="index.json.", suffix=".tmp", dir=str(path.parent)
    )
    tmp = Path(tmp_str)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(index, f, indent=2)
        os.replace(tmp, path)
    except Exception:
        if tmp.exists():
            tmp.unlink()
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--force", action="store_true", help="ignore TTL, refresh anyway")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    out = index_path()

    # TTL check
    if not args.force and out.exists():
        try:
            existing = json.loads(out.read_text())
            fetched_at = existing.get("fetched_at", "")
            ttl = existing.get("ttl_seconds", DEFAULT_TTL_SECONDS)
            if fetched_at:
                t = datetime.strptime(fetched_at, "%Y-%m-%dT%H:%M:%SZ").replace(
                    tzinfo=timezone.utc
                )
                age = (datetime.now(timezone.utc) - t).total_seconds()
                if age < ttl:
                    if args.verbose:
                        print(f"Index is fresh ({int(age)}s old, ttl {ttl}s) — skipping refresh")
                    return 0
        except (json.JSONDecodeError, ValueError, OSError):
            pass  # fall through to full refresh

    try:
        sources = load_sources()
    except (OSError, ValueError) as exc:
        print(f"ERROR: cannot load sources: {exc}", file=sys.stderr)
        return 1

    if args.verbose:
        print(f"Refreshing index from {len(sources)} source(s)")

    index = build_index(sources)
    if not index["skills"]:
        print("ERROR: no skills retrieved from any source", file=sys.stderr)
        return 1

    write_index(index, out)
    if args.verbose:
        print(f"Wrote {len(index['skills'])} skills to {out}")
        for src in index["sources"]:
            print(f"  {src['status']:>7}  {src['name']} ({src.get('skill_count', 0)} skills)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run test again, verify it passes**

Run:
```bash
python3 -m unittest tests.test_refresh_index -v
```
Expected: 4 tests pass.

- [ ] **Step 5: Smoke-run the CLI against the real sources.json (may fail — that's ok)**

Run:
```bash
python3 scripts/refresh_index.py --verbose --force 2>&1 | head -20
```
Expected: either a successful summary with skill counts, or per-source failed status lines (if the real sources are unreachable from this machine). Script must exit 0 if any skill returned, 1 otherwise. A non-zero exit here is acceptable as long as the stderr output is clear — the test suite already proved the logic.

- [ ] **Step 6: Stage (no commit)**

```bash
git status --short scripts/refresh_index.py tests/test_refresh_index.py
```

---

## Task 7: Audit stub

**Files:**
- Create: `scripts/audit_skill.py`
- Create: `tests/test_audit_stub.py`

- [ ] **Step 1: Write failing test `tests/test_audit_stub.py`**

```python
"""Tests for the audit gate stub."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from audit_skill import audit_file  # noqa: E402


class TestAuditStub(unittest.TestCase):
    def test_shape(self):
        result = audit_file("/tmp/does-not-matter")
        self.assertIn("status", result)
        self.assertIn("tool", result)
        self.assertIn("details", result)
        self.assertEqual(result["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test, verify it fails**

```bash
python3 -m unittest tests.test_audit_stub -v
```
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `scripts/audit_skill.py`**

```python
#!/usr/bin/env python3
"""SkillForge audit gate — Phase 7 placeholder.

Contract: takes a file path (or later, bytes + URL) and returns a dict of the
form {"status": "passed"|"failed"|"unavailable", "tool": str|None, "details": str}.

The stub always returns 'unavailable'. The install pipeline treats 'unavailable'
as pass-through unless the source is marked require_audit=true in sources.json,
in which case the install is blocked.

Phase 7 drops in real integrations (Snyk Agent Scan, Repello SkillCheck) here
without touching install_skill.py.
"""
from __future__ import annotations

import sys
from typing import Dict, Optional


def audit_file(path: str) -> Dict[str, Optional[str]]:
    return {
        "status": "unavailable",
        "tool": None,
        "details": "audit gate not implemented (Phase 7 stub)",
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: audit_skill.py <file>", file=sys.stderr)
        return 2
    result = audit_file(sys.argv[1])
    print(result)
    return 0 if result["status"] in ("passed", "unavailable") else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run test again, verify it passes**

```bash
python3 -m unittest tests.test_audit_stub -v
```
Expected: 1 test passes.

- [ ] **Step 5: Stage (no commit)**

---

## Task 8: Install skill pipeline

**Files:**
- Create: `scripts/install_skill.py`
- Create: `tests/test_install_skill.py`

- [ ] **Step 1: Write failing test `tests/test_install_skill.py`**

```python
"""Tests for the install_skill pipeline."""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import install_skill  # noqa: E402


SAMPLE_SKILL_BODY = (ROOT / "tests" / "fixtures" / "skill_sample.md").read_bytes()
SAMPLE_SHA = hashlib.sha256(SAMPLE_SKILL_BODY).hexdigest()


def make_index(extra=None):
    entry = {
        "id": "security-guardian",
        "name": "Security Guardian",
        "description": "",
        "tags": ["has_user_input"],
        "boost_when": [], "penalize_when": [], "default_for": [],
        "match_language": None, "match_framework": None, "match_sub_framework": None,
        "source": {
            "name": "test",
            "install_url": "http://local/SKILL.md",
            "commit_sha": None,
            "version": "1.0.0",
        },
        "audit": {"status": "unaudited", "tool": None, "scanned_at": None},
    }
    if extra:
        entry["source"].update(extra)
    return {
        "version": 1,
        "fetched_at": "now",
        "ttl_seconds": 604800,
        "partial": False,
        "sources": [{"name": "test", "type": "marketplace", "url": "http://local", "status": "ok", "require_audit": False}],
        "conflicts": [],
        "skills": [entry],
    }


class TestInstallSkill(unittest.TestCase):
    def test_install_writes_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            skills_dir = Path(tmp) / "skills"
            selections = Path(tmp) / "selections.json"
            install_skill.install(
                skill_id="security-guardian",
                index=make_index(),
                skills_dir=skills_dir,
                selections_path=selections,
                http_get=lambda u: SAMPLE_SKILL_BODY,
                dry_run=False,
            )
            target = skills_dir / "security-guardian" / "SKILL.md"
            self.assertTrue(target.exists())
            self.assertEqual(target.read_bytes(), SAMPLE_SKILL_BODY)
            sel = json.loads(selections.read_text())
            self.assertTrue(sel["selections"]["security-guardian"]["enabled"])
            self.assertEqual(sel["selections"]["security-guardian"]["sha"], SAMPLE_SHA)

    def test_dry_run_does_not_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            skills_dir = Path(tmp) / "skills"
            selections = Path(tmp) / "selections.json"
            result = install_skill.install(
                skill_id="security-guardian",
                index=make_index(),
                skills_dir=skills_dir,
                selections_path=selections,
                http_get=lambda u: SAMPLE_SKILL_BODY,
                dry_run=True,
            )
            self.assertEqual(result["status"], "dry-run")
            self.assertFalse(skills_dir.exists())
            self.assertFalse(selections.exists())

    def test_sha_mismatch_aborts(self):
        idx = make_index(extra={"commit_sha": "deadbeef"})
        with tempfile.TemporaryDirectory() as tmp:
            skills_dir = Path(tmp) / "skills"
            selections = Path(tmp) / "selections.json"
            with self.assertRaises(install_skill.TamperError):
                install_skill.install(
                    skill_id="security-guardian",
                    index=idx,
                    skills_dir=skills_dir,
                    selections_path=selections,
                    http_get=lambda u: SAMPLE_SKILL_BODY,
                    dry_run=False,
                )
            self.assertFalse((skills_dir / "security-guardian" / "SKILL.md").exists())

    def test_unknown_skill_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(install_skill.SkillNotFound):
                install_skill.install(
                    skill_id="nope",
                    index=make_index(),
                    skills_dir=Path(tmp) / "skills",
                    selections_path=Path(tmp) / "selections.json",
                    http_get=lambda u: b"",
                    dry_run=False,
                )

    def test_reinstall_overwrites_existing_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            skills_dir = Path(tmp) / "skills"
            selections = Path(tmp) / "selections.json"
            # Pre-seed with stale content
            target_dir = skills_dir / "security-guardian"
            target_dir.mkdir(parents=True)
            (target_dir / "stale.md").write_text("old")
            install_skill.install(
                skill_id="security-guardian",
                index=make_index(),
                skills_dir=skills_dir,
                selections_path=selections,
                http_get=lambda u: SAMPLE_SKILL_BODY,
                dry_run=False,
            )
            self.assertFalse((target_dir / "stale.md").exists())
            self.assertTrue((target_dir / "SKILL.md").exists())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test, verify it fails**

```bash
python3 -m unittest tests.test_install_skill -v
```
Expected: `ModuleNotFoundError: No module named 'install_skill'`.

- [ ] **Step 3: Implement `scripts/install_skill.py`**

```python
#!/usr/bin/env python3
"""Fetch a skill from its source URL, audit it, and write it to
~/.claude/skills/<id>/. Record the installation in selections.json.

CLI:
    python3 install_skill.py <skill-id> [--dry-run]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, Optional

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from source_adapters.base import http_get_default  # noqa: E402
from audit_skill import audit_file  # noqa: E402


class SkillNotFound(Exception):
    pass


class TamperError(Exception):
    pass


class AuditBlocked(Exception):
    pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _skillforge_dir() -> Path:
    return Path(os.path.expanduser("~/.claude/skillforge"))


def _default_skills_dir() -> Path:
    return Path(os.path.expanduser("~/.claude/skills"))


def _default_selections_path() -> Path:
    return _skillforge_dir() / "selections.json"


def _default_index_path() -> Path:
    return _skillforge_dir() / "index.json"


def _source_requires_audit(index: dict, source_name: str) -> bool:
    for s in index.get("sources", []):
        if s.get("name") == source_name:
            return bool(s.get("require_audit", False))
    return False


def install(
    *,
    skill_id: str,
    index: dict,
    skills_dir: Path,
    selections_path: Path,
    http_get: Callable[[str], bytes],
    dry_run: bool = False,
) -> Dict[str, str]:
    """Core install function. Pure enough to test with fakes."""
    match = next((s for s in index.get("skills", []) if s.get("id") == skill_id), None)
    if match is None:
        raise SkillNotFound(f"skill '{skill_id}' not in index — run /skillforge refresh")

    install_url = match["source"]["install_url"]
    expected_sha = match["source"].get("commit_sha")
    source_name = match["source"]["name"]

    body = http_get(install_url)
    actual_sha = hashlib.sha256(body).hexdigest()
    if expected_sha and expected_sha != actual_sha:
        raise TamperError(
            f"SHA mismatch for {skill_id}: expected {expected_sha}, got {actual_sha}"
        )

    if dry_run:
        return {
            "status": "dry-run",
            "skill_id": skill_id,
            "bytes": str(len(body)),
            "sha": actual_sha,
        }

    # Write to temp location, audit, then atomically replace target directory.
    target_dir = skills_dir / skill_id
    staging_dir = skills_dir / f".{skill_id}.staging"
    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    staging_dir.mkdir(parents=True)
    staging_path = staging_dir / "SKILL.md"
    staging_path.write_bytes(body)

    audit_result = audit_file(str(staging_path))
    if audit_result["status"] == "failed":
        shutil.rmtree(staging_dir)
        raise AuditBlocked(f"audit failed for {skill_id}: {audit_result['details']}")
    if audit_result["status"] == "unavailable" and _source_requires_audit(index, source_name):
        shutil.rmtree(staging_dir)
        raise AuditBlocked(
            f"source '{source_name}' requires audit, but audit gate is unavailable"
        )

    # Atomic replace: remove old, rename staging to target
    if target_dir.exists():
        shutil.rmtree(target_dir)
    staging_dir.rename(target_dir)

    _record_selection(
        selections_path=selections_path,
        skill_id=skill_id,
        sha=actual_sha,
        source_name=source_name,
        audit_status=audit_result["status"],
    )

    return {
        "status": "installed",
        "skill_id": skill_id,
        "path": str(target_dir / "SKILL.md"),
        "sha": actual_sha,
        "audit": audit_result["status"],
    }


def _record_selection(
    *,
    selections_path: Path,
    skill_id: str,
    sha: str,
    source_name: str,
    audit_status: str,
) -> None:
    selections_path.parent.mkdir(parents=True, exist_ok=True)
    if selections_path.exists():
        try:
            doc = json.loads(selections_path.read_text())
        except (json.JSONDecodeError, OSError):
            doc = {}
    else:
        doc = {}
    doc.setdefault("version", 1)
    doc.setdefault("selections", {})
    doc["updated"] = _now_iso()
    doc["selections"][skill_id] = {
        "enabled": True,
        "installed_at": _now_iso(),
        "source": source_name,
        "sha": sha,
        "audit_status": audit_status,
    }
    tmp = selections_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=2))
    tmp.replace(selections_path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("skill_id")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        with open(_default_index_path()) as f:
            index = json.load(f)
    except OSError:
        print("ERROR: no index found. Run /skillforge refresh first.", file=sys.stderr)
        return 1

    try:
        result = install(
            skill_id=args.skill_id,
            index=index,
            skills_dir=_default_skills_dir(),
            selections_path=_default_selections_path(),
            http_get=http_get_default,
            dry_run=args.dry_run,
        )
    except (SkillNotFound, TamperError, AuditBlocked) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    except IOError as exc:
        print(f"ERROR: network fetch failed: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run test again, verify it passes**

```bash
python3 -m unittest tests.test_install_skill -v
```
Expected: 5 tests pass.

- [ ] **Step 5: Stage (no commit)**

---

## Task 9: Point `score.py` at the federated index

**Files:**
- Modify: `scripts/score.py`
- Create: `tests/test_score_v2.py`

- [ ] **Step 1: Write failing test `tests/test_score_v2.py`**

```python
"""Regression test: score.py must read the federated index and still produce
the same shape of output that the /skillforge command expects."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class TestScoreV2(unittest.TestCase):
    def test_reads_federated_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Build a fake home so score.py finds our index
            home = Path(tmp) / "home"
            (home / ".claude" / "skillforge").mkdir(parents=True)
            index = {
                "version": 1,
                "skills": [
                    {
                        "id": "security-guardian",
                        "name": "Security Guardian",
                        "description": "",
                        "category": "security",
                        "tags": ["has_user_input", "has_api"],
                        "boost_when": [],
                        "penalize_when": [],
                        "default_for": ["backend-api"],
                        "match_language": None,
                        "match_framework": None,
                        "match_sub_framework": None,
                    }
                ],
            }
            (home / ".claude" / "skillforge" / "index.json").write_text(json.dumps(index))

            # Build a fake project with a profile
            proj = Path(tmp) / "proj"
            (proj / ".claude").mkdir(parents=True)
            profile = {
                "language": "python",
                "framework": "fastapi",
                "sub_framework": None,
                "project_type": "backend-api",
                "characteristics": {
                    "has_api": True,
                    "has_user_input": True,
                },
            }
            (proj / ".claude" / "project-profile.json").write_text(json.dumps(profile))

            env = os.environ.copy()
            env["HOME"] = str(home)
            result = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "score.py"), str(proj)],
                env=env, capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            out = json.loads(result.stdout)
            rec_ids = [s["id"] for s in out["skills"]["recommended"]]
            self.assertIn("security-guardian", rec_ids)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test, verify it fails**

```bash
python3 -m unittest tests.test_score_v2 -v
```
Expected: fail because current `score.py` reads `config/catalog.json`, which no longer exists after Task 5.

- [ ] **Step 3: Edit `scripts/score.py`**

Open `scripts/score.py` and replace the catalog-loading block. Find:

```python
    profile_path = os.path.join(project_dir, ".claude", "project-profile.json")
    catalog_path = os.path.join(os.path.dirname(__file__), "..", "config", "catalog.json")

    # Fallback catalog path
    if not os.path.exists(catalog_path):
        catalog_path = os.path.join(os.path.expanduser("~"), ".claude", "skillforge", "catalog.json")

    if not os.path.exists(profile_path):
        print(json.dumps({"error": "No project profile found. Run detect.sh first."}))
        sys.exit(1)

    if not os.path.exists(catalog_path):
        print(json.dumps({"error": f"Catalog not found at {catalog_path}"}))
        sys.exit(1)

    profile = load_json(profile_path)
    catalog = load_json(catalog_path)
```

Replace with:

```python
    profile_path = os.path.join(project_dir, ".claude", "project-profile.json")
    index_path = os.path.join(os.path.expanduser("~"), ".claude", "skillforge", "index.json")

    if not os.path.exists(profile_path):
        print(json.dumps({"error": "No project profile found. Run detect.sh first."}))
        sys.exit(1)

    if not os.path.exists(index_path):
        print(json.dumps({
            "error": "No federated index found. Run /skillforge refresh first.",
            "hint": "python3 scripts/refresh_index.py --force"
        }))
        sys.exit(1)

    profile = load_json(profile_path)
    catalog = load_json(index_path)
```

The variable is still called `catalog` below that line — it's just now populated from the index file. The rest of score.py reads `catalog.get("skills", [])` which matches the index schema exactly, so no further changes are required.

Also update the thresholds fallback block. Find:

```python
    thresholds = catalog.get("scoring_rules", {}).get("thresholds", {
        "recommended": 10,
        "optional": 1,
        "not_relevant": 0
    })
```

Leave this as-is — the old `scoring_rules.thresholds` key is absent in the index, so the default kicks in, which is correct.

- [ ] **Step 4: Run test again, verify it passes**

```bash
python3 -m unittest tests.test_score_v2 -v
```
Expected: 1 test passes.

- [ ] **Step 5: Run the full test suite so far**

```bash
python3 -m unittest discover tests -v
```
Expected: all tests from Tasks 2–9 pass. Any regression here is a signal that Task 9 broke something — investigate before moving on.

- [ ] **Step 6: Stage (no commit)**

---

## Task 10: Rewrite `/skillforge` slash command

**Files:**
- Modify: `commands/skillforge.md` (full rewrite)

- [ ] **Step 1: Replace `commands/skillforge.md` contents**

```markdown
---
description: Detect the current project and manage SkillForge's federated skill index
argument-hint: "[setup|refresh|sources|add <id>|remove <id>|audit|profile]"
allowed-tools: Bash, Read, Write, Edit
---

# /skillforge

You are running the SkillForge command. SkillForge ships with no skills of
its own — it fetches a federated index from external sources listed in
`config/sources.json` (or `~/.claude/skillforge/sources.json`), scores the
index against the detected project profile, and installs skills on demand.

## Argument routing

- (no argument) or `status` → show detected project + installed skills + recommendation summary
- `setup` → refresh the index if TTL expired, then show interactive recommendations
- `refresh` → force-refresh the index, ignoring TTL
- `sources` → print the active source list + last fetch status per source
- `add <id>` → install a single skill by id
- `remove <id>` → uninstall and drop from selections
- `audit` → run the audit gate on every installed skill (Phase 7 stub, reports "unavailable")
- `profile` → dump the full `.claude/project-profile.json`

## Live state

Project profile (regenerated each invocation):
!`bash "${CLAUDE_PLUGIN_ROOT:-$PWD}/hooks/detect.sh" "$PWD" >/dev/null 2>&1 && cat .claude/project-profile.json 2>/dev/null || echo '{"error":"detect.sh failed"}'`

Index freshness (stale-while-revalidate: this command both reports staleness and triggers a background refresh if needed):
!`python3 -c "
import json, os, sys
from datetime import datetime, timezone
p = os.path.expanduser('~/.claude/skillforge/index.json')
if not os.path.exists(p):
    print(json.dumps({'state': 'missing'}))
    sys.exit(0)
try:
    with open(p) as f: idx = json.load(f)
    t = datetime.strptime(idx['fetched_at'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    age = (datetime.now(timezone.utc) - t).total_seconds()
    ttl = idx.get('ttl_seconds', 604800)
    print(json.dumps({'state': 'stale' if age > ttl else 'fresh', 'age_s': int(age), 'ttl_s': ttl, 'skills': len(idx.get('skills', [])), 'partial': idx.get('partial', False)}))
except Exception as e:
    print(json.dumps({'state': 'corrupt', 'error': str(e)}))
"`

Skill recommendations (blank if index is missing — tell the user to run /skillforge refresh):
!`python3 "${CLAUDE_PLUGIN_ROOT:-$PWD}/scripts/score.py" "$PWD" 2>/dev/null || echo '{}'`

Selections (persistent across sessions):
!`cat ~/.claude/skillforge/selections.json 2>/dev/null || echo '{}'`

## Behavior

1. **Parse the argument** from `$ARGUMENTS`.

2. **If the index is `missing`:**
   - If argument is `refresh` or `setup`, run `python3 "${CLAUDE_PLUGIN_ROOT:-$PWD}/scripts/refresh_index.py" --force --verbose` and wait for it to finish, then re-read state.
   - For any other argument, tell the user the index is missing and suggest `/skillforge refresh`, then stop.

3. **If the index is `stale`:** silently run `python3 "${CLAUDE_PLUGIN_ROOT:-$PWD}/scripts/refresh_index.py" &` to kick off a background refresh. Serve the cached index in the meantime.

4. **Routing:**
   - `profile` → dump the profile JSON verbatim as a fenced block. Stop.
   - `sources` → list active sources, their types, their last fetch status. Stop.
   - `refresh` → run `refresh_index.py --force --verbose`, report the outcome. Stop.
   - `add <id>` → run `python3 "${CLAUDE_PLUGIN_ROOT:-$PWD}/scripts/install_skill.py" <id>`, report the outcome, then show the updated selections count.
   - `remove <id>` → run `rm -rf ~/.claude/skills/<id>` and update `~/.claude/skillforge/selections.json` to drop the id. No confirmation prompt; this is explicit user intent.
   - `audit` → for each installed skill, invoke `scripts/audit_skill.py`. Report a table. In this iteration every row reports `unavailable`.
   - `status` / (empty) → proceed to step 5.
   - `setup` → proceed to step 5 with the explicit invitation "Which skills do you want? Reply `/skillforge add <id>` for each."

5. **Render recommendations.** Group as:

```
### ✅ Recommended (N)
| Skill | Score | Source | Description |
|-------|-------|--------|-------------|

### ⚡ Optional (N)
...

<details>
<summary>💤 Not relevant (N) — click to expand</summary>
...
</details>
```

Sort within each group by score descending. Prefix installed skill ids with ✓. If a skill carries `audit.status == "failed"`, prefix it with ⚠️ and say so in the description.

6. **Footer lines:**
   - "Index: N skills from M sources, fetched <relative time> ago."
   - If `partial: true`: "⚠️ Partial index — some sources failed to fetch. Run `/skillforge sources` to see which."
   - "Run `/skillforge add <id>` to install. Selections persist in `~/.claude/skillforge/selections.json`."

7. **Never install anything automatically.** Recommendations are suggestions, not actions.
```

- [ ] **Step 2: Verify the file is well-formed markdown**

```bash
head -5 commands/skillforge.md
wc -l commands/skillforge.md
```
Expected: starts with `---`, has `description:` / `argument-hint:` / `allowed-tools:` in frontmatter, body is ≥80 lines.

- [ ] **Step 3: Stage (no commit)**

---

## Task 11: End-to-end smoke test with local HTTP server

**Files:**
- Create: `tests/test_end_to_end.py`

- [ ] **Step 1: Write failing test `tests/test_end_to_end.py`**

```python
"""End-to-end smoke test: run a local HTTP server serving a fake marketplace,
run the refresh + score + install pipeline against it, and assert that the
right skill files end up in a temp HOME."""
import contextlib
import http.server
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures"


def free_port() -> int:
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def serve(directory: Path, port: int):
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(
        *a, directory=str(directory), **kw
    )
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


class TestEndToEnd(unittest.TestCase):
    def test_full_pipeline(self):
        port = free_port()
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            web = tmp_path / "web"
            web.mkdir()

            # Generate marketplace.json with the live port substituted in
            raw = (FIXTURES / "marketplace_sample.json").read_text()
            (web / "marketplace.json").write_text(raw.replace("$PORT", str(port)))

            # Serve a SKILL.md at each install_url path
            for skill_id in ("security-guardian", "git-safety"):
                skill_dir = web / skill_id
                skill_dir.mkdir()
                (skill_dir / "SKILL.md").write_bytes(
                    (FIXTURES / "skill_sample.md").read_bytes()
                )

            server = serve(web, port)
            try:
                time.sleep(0.1)  # let the server bind

                home = tmp_path / "home"
                (home / ".claude" / "skillforge").mkdir(parents=True)
                sources = {
                    "version": 1,
                    "defaults": [{
                        "type": "marketplace",
                        "name": "Local Fake",
                        "url": f"http://127.0.0.1:{port}/marketplace.json",
                        "require_audit": False,
                    }]
                }
                (home / ".claude" / "skillforge" / "sources.json").write_text(json.dumps(sources))

                env = os.environ.copy()
                env["HOME"] = str(home)

                # 1. Refresh
                r = subprocess.run(
                    [sys.executable, str(ROOT / "scripts" / "refresh_index.py"), "--force", "--verbose"],
                    env=env, capture_output=True, text=True,
                )
                self.assertEqual(r.returncode, 0, r.stderr)
                index = json.loads((home / ".claude" / "skillforge" / "index.json").read_text())
                ids = {s["id"] for s in index["skills"]}
                self.assertEqual(ids, {"security-guardian", "git-safety"})

                # 2. Fake project profile (cli-tool Go, like PRD Phase 1-2 validation)
                proj = tmp_path / "proj"
                (proj / ".claude").mkdir(parents=True)
                profile = {
                    "language": "go",
                    "framework": "cobra-cli",
                    "project_type": "cli-tool",
                    "characteristics": {"cli_only": True, "has_user_input": True, "has_ci": True},
                }
                (proj / ".claude" / "project-profile.json").write_text(json.dumps(profile))

                # 3. Score
                r = subprocess.run(
                    [sys.executable, str(ROOT / "scripts" / "score.py"), str(proj)],
                    env=env, capture_output=True, text=True,
                )
                self.assertEqual(r.returncode, 0, r.stderr)
                scored = json.loads(r.stdout)
                rec = [s["id"] for s in scored["skills"]["recommended"]]
                # Both sample skills have default_for: ["cli-tool"] so both should recommend
                self.assertIn("security-guardian", rec)
                self.assertIn("git-safety", rec)

                # 4. Install
                r = subprocess.run(
                    [sys.executable, str(ROOT / "scripts" / "install_skill.py"), "security-guardian"],
                    env=env, capture_output=True, text=True,
                )
                self.assertEqual(r.returncode, 0, r.stderr)
                installed = home / ".claude" / "skills" / "security-guardian" / "SKILL.md"
                self.assertTrue(installed.exists())
                selections = json.loads((home / ".claude" / "skillforge" / "selections.json").read_text())
                self.assertTrue(selections["selections"]["security-guardian"]["enabled"])
            finally:
                server.shutdown()


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the end-to-end test**

```bash
python3 -m unittest tests.test_end_to_end -v
```
Expected: 1 test passes. The whole detect → refresh → score → install pipeline works against a local HTTP server with no internet access.

- [ ] **Step 3: Run the full test suite one more time**

```bash
python3 -m unittest discover tests -v
```
Expected: every test in tests/ passes. Count should be: 3 (base) + 6 (marketplace) + 5 (awesome_list) + 4 (refresh) + 1 (audit) + 5 (install) + 1 (score v2) + 1 (e2e) = 26 tests.

- [ ] **Step 4: Stage (no commit)**

---

## Task 12: Update `PRD.md` — replace §Skill catalog with §Federated index

**Files:**
- Modify: `PRD.md`

- [ ] **Step 1: Locate the "Skill catalog" section**

```bash
grep -n "^## Skill catalog\|^### Category:\|27 skills\|has_lang_refs" PRD.md
```

- [ ] **Step 2: Replace the whole section**

Using `Edit` tool with replace_all false on the following block:

Find (the full `## Skill catalog` section starting at "## Skill catalog" through the end of "### Category: Infrastructure (3 skills)" subsection and its table — roughly PRD.md:237-318 in the original):

Replace that entire section with:

```markdown
## Federated skill index

SkillForge ships with **zero self-authored skills**. The tool is infrastructure:
detector, scorer, installer, and runtime guards. Skill content lives in external
sources — `marketplace.json` files in GitHub repositories and curated
awesome-list READMEs — which SkillForge fetches, scores against the project
profile, and installs on demand.

### Sources

`config/sources.json` ships a built-in whitelist. Users can override it by
creating `~/.claude/skillforge/sources.json`, which fully replaces the defaults.
Each source entry has:

```json
{
  "type": "marketplace" | "awesome-list",
  "name": "...",
  "url": "https://...",
  "require_audit": false
}
```

Two adapter types ship today:

- **marketplace** — parses Claude Code-style `marketplace.json` files with the
  `plugins[].skills[]` shape. One HTTP GET per source.
- **awesome-list** — extracts GitHub repo links from a README, caps probes at
  20, and looks for `marketplace.json` at the conventional location in each
  repo's `main` branch. Repos without one are skipped silently.

Adding a new source type requires one file under `scripts/source_adapters/`
and one line in the adapter registry in `scripts/refresh_index.py`. No other
changes.

### Federated index (`~/.claude/skillforge/index.json`)

```json
{
  "version": 1,
  "fetched_at": "2026-04-15T14:00:00Z",
  "ttl_seconds": 604800,
  "partial": false,
  "sources": [ ... ],
  "conflicts": [ ... ],
  "skills": [
    {
      "id": "security-guardian",
      "name": "Security Guardian",
      "description": "...",
      "tags": [...], "boost_when": [...], "penalize_when": [...],
      "default_for": [...],
      "match_language": null, "match_framework": null, "match_sub_framework": null,
      "source": {
        "name": "...",
        "install_url": "https://...",
        "commit_sha": "...",
        "version": "1.0.0"
      },
      "audit": { "status": "unaudited", "tool": null, "scanned_at": null }
    }
  ]
}
```

When the same skill id appears in multiple sources, the first source in the
sources list wins. Conflicts are recorded in the top-level `conflicts[]` array
so users can diagnose unexpected version skew without losing information.

### Refresh cadence

- TTL default: 7 days.
- `/skillforge` uses stale-while-revalidate: a cached index serves reads while
  a background refresh runs if the cache is stale.
- `/skillforge refresh` forces a sync refresh regardless of TTL.
- Unreachable sources mark the index `partial: true`; the command surfaces a
  warning banner.

### Audit gate (stub → Phase 7)

Every install passes through `scripts/audit_skill.py`, which currently returns
`{"status": "unavailable"}`. When a source has `require_audit: true`, an
unavailable or failed audit aborts the install. Phase 7 drops in real
integrations (Snyk Agent Scan, Repello SkillCheck) without touching the
install pipeline.

### Migration note

Earlier revisions of this document listed 27 self-authored skills (7 universal
+ 7 language + 10 framework + 3 infrastructure). That static catalog was a
temporary scaffold and has been removed. If maintainers want to publish a
first-party skill set, they do it the same way anyone else would: a separate
`skillforge-skills` repository with its own `marketplace.json`, listed as one
entry in `sources.json`.
```

- [ ] **Step 3: Also update references further down in the PRD**

```bash
grep -n "27 skills\|27 SKILL\|catalog.json\|Phase 2 ✅" PRD.md
```

For each of the earlier references added by the previous session (e.g. Phase 2 deliverables line mentioning "27 skills defined"), change "defined" to "seeded" and add the clause "(now removed — migrated to federated index model, see §Federated skill index)". For the Phase 5 deliverable "27 SKILL.md files", replace with:

```
**Phase 5: Publish optional skillforge-skills repository**

**Deliverable:** a separate Git repository, outside the SkillForge tool, that
publishes the maintainer-curated skill set as a standard `marketplace.json`.
SkillForge consumes it like any other source — nothing in the tool depends on
it, and users who do not want maintainer-published content simply drop it from
their `sources.json`.
```

- [ ] **Step 4: Verify the PRD is still valid markdown**

```bash
wc -l PRD.md
grep -c "^## " PRD.md
```
Expected: section count reasonable (should go up by 1 because §Federated skill index replaces §Skill catalog one-to-one), total line count should drop noticeably since the 27-skill tables are gone.

- [ ] **Step 5: Stage (no commit)**

---

## Task 13: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the status table**

Find the existing status table in `README.md` (the `| Phase | Deliverable | Status |` block) and replace with:

```markdown
| Phase | Deliverable | Status |
|-------|-------------|--------|
| 1 | Universal project detector (`hooks/detect.sh`) | ✅ Complete |
| 2 | Relevance engine (`scripts/score.py`) + index schema | ✅ Complete |
| 3 | `/skillforge` slash command | ✅ Complete (terminal UI; browser wizard later) |
| 4 | Selection persistence (`~/.claude/skillforge/selections.json`) | ✅ Complete |
| 5 | Federated discovery (`refresh_index.py` + source adapters) | ✅ Complete |
| 6 | Runtime hooks v2 (profile-driven guards + auto-format) | ✅ Complete |
| 7 | Audit gate (currently stub) | ⏳ Pluggable interface ready; real integration pending |
| 8 | Publish to Claude Code plugin marketplace | ⏳ Not started |
```

- [ ] **Step 2: Replace the architecture diagram**

Find the diagram under "## How it works" and replace with:

```markdown
## How it works

```
sources.json ──▶ refresh_index.py ──▶ index.json ──▶ score.py ──▶ /skillforge UI
                   │                                                    │
                   ├─ marketplace adapter                                ├─ add <id>
                   └─ awesome-list adapter                               │      │
                                                                        │      ▼
                                                                        │  install_skill.py
                                                                        │      │
                                                                        │      ▼
                                                                        │  ~/.claude/skills/<id>/
                                                                        │
                                                                        └─ selections.json
```

1. **Detect**: On session start, `hooks/detect.sh` writes `.claude/project-profile.json`.
2. **Federate**: On first run or TTL expiry, `scripts/refresh_index.py` fetches skills from every source in `config/sources.json` and writes `~/.claude/skillforge/index.json`.
3. **Score**: `scripts/score.py` multiplies the profile against the federated index and emits grouped recommendations.
4. **Install**: The user picks skills via `/skillforge add <id>`. `scripts/install_skill.py` fetches, audits, and writes to `~/.claude/skills/<id>/`.
```

- [ ] **Step 3: Replace the "Try it now" block**

```markdown
## Try it now

```bash
# One-time: fetch the federated index from the default sources
python3 scripts/refresh_index.py --force --verbose

# See what the scoring engine would recommend for any project
bash hooks/detect.sh /path/to/your/project
python3 scripts/score.py /path/to/your/project

# Install a specific skill
python3 scripts/install_skill.py <skill-id>
```

The index lives at `~/.claude/skillforge/index.json`. Installed skills land in
`~/.claude/skills/<id>/`. Edit `~/.claude/skillforge/sources.json` to use a
different source set.
```

- [ ] **Step 4: Replace the repository layout block**

```markdown
## Repository layout

```
skillforge/
├── PRD.md
├── README.md
├── config/
│   ├── sources.json        # Built-in source whitelist
│   └── settings.json       # Claude Code hook template
├── hooks/                  # Runtime hooks
│   ├── detect.sh
│   ├── protect-infra-files.py
│   ├── protect-dangerous-commands.py
│   └── auto-format.sh
├── scripts/
│   ├── refresh_index.py        # Federated index builder
│   ├── score.py                # Relevance scoring
│   ├── install_skill.py        # Fetch + audit + install
│   ├── audit_skill.py          # Audit gate stub
│   └── source_adapters/
│       ├── base.py
│       ├── marketplace.py
│       └── awesome_list.py
├── commands/
│   └── skillforge.md
├── tests/                  # Unit + integration tests (stdlib only)
├── docs/
│   └── superpowers/
│       ├── specs/
│       └── plans/
└── v1-reference/           # Legacy v1/v2 artifacts
```

- [ ] **Step 5: Update requirements block**

```markdown
## Requirements

- `bash`, `jq` (for detect.sh)
- `python3` (stdlib only — no pip dependencies)
- Network access for the first `/skillforge refresh`. Offline afterwards unless the index goes stale.
```

- [ ] **Step 6: Stage (no commit)**

---

## Task 14: Final validation sweep

**Files:** no new files — this task runs the full suite and hand-checks critical paths.

- [ ] **Step 1: Run the full test suite**

```bash
python3 -m unittest discover tests -v
```
Expected: 26 tests, 0 failures, 0 errors.

- [ ] **Step 2: Verify detect.sh still works untouched**

```bash
bash hooks/detect.sh $(pwd) 2>&1
jq . .claude/project-profile.json >/dev/null && echo "profile ok"
```

- [ ] **Step 3: Verify protect-*.py hooks still pass their smoke tests**

```bash
printf '%s' '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' | python3 hooks/protect-dangerous-commands.py
echo "exit=$?  (expect 2)"
printf '%s' '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' | python3 hooks/protect-dangerous-commands.py
echo "exit=$?  (expect 0)"
```

- [ ] **Step 4: Verify auto-format hook still no-ops safely**

```bash
printf '' | bash hooks/auto-format.sh
echo "exit=$?  (expect 0)"
```

- [ ] **Step 5: Snapshot the final tree**

```bash
find . -type f -not -path './.git/*' -not -path './v1-reference/*' -not -path './.claude/*' -not -name '.DS_Store' | sort
git status --short
```

Expected files (new or modified):
- `config/sources.json` (new)
- `scripts/refresh_index.py`, `install_skill.py`, `audit_skill.py` (new)
- `scripts/source_adapters/__init__.py`, `base.py`, `marketplace.py`, `awesome_list.py` (new)
- `scripts/score.py` (modified)
- `commands/skillforge.md` (modified)
- `tests/**` (new — 8 test files + 3 fixtures + __init__)
- `PRD.md`, `README.md` (modified)
- `docs/superpowers/specs/2026-04-15-dynamic-skill-discovery-design.md` (already present)
- `docs/superpowers/plans/2026-04-15-dynamic-skill-discovery.md` (this file)
- `config/catalog.json` and `skills/git-safety/SKILL.md` (deleted — won't appear)

- [ ] **Step 6: Report to user**

Produce a final summary:
- Test count passing
- Total lines of new code
- Files deleted (catalog.json, skills/git-safety/SKILL.md)
- Phase status update (5, 6 now complete; 7 stub, 8 not started)
- Any follow-up issues noted during implementation
- Explicit reminder that **nothing has been committed** — the user can inspect
  `git status` and decide whether to commit in one pass or stage selectively.

---

## Self-review checklist (author-side, done after writing this plan)

- **Spec coverage:**
  - Goals 1-5: Tasks 5, 6, 10, 8+7 respectively ✓
  - Non-goals: none introduced ✓
  - Components 1-9: Tasks 5 (sources.json), 2 (base), 3 (marketplace), 4 (awesome_list), 6 (refresh_index), 9 (score), 7 (audit), 8 (install), 10 (command) ✓
  - Index schema: Task 6 (write), Tasks 3/4 (adapter output shape) ✓
  - Data flows (first run, warm, stale): Task 11 covers first run; Task 6 unit tests cover dedupe and partial ✓
  - Error handling table: every row appears in a test case in Tasks 3/4/6/8 ✓
  - Testing plan: matches Tasks 2-11 one-to-one ✓
  - Migration table: Tasks 5 (delete catalog/skills), 9, 10, 12, 13 ✓
  - Open questions: none at spec time ✓
- **Placeholder scan:** no "TODO", "TBD", "implement later" in any task body. Code blocks are complete. ✓
- **Type consistency:**
  - `SkillEntry` fields identical across base.py, marketplace.py, tests ✓
  - `build_index()` return shape matches `write_index()` input, matches index.json schema, matches score.py's `catalog.get("skills", [])` read ✓
  - `install()` signature matches test calls ✓
  - `http_get` callable shape (`(str) -> bytes`) consistent across every adapter and test ✓
  - Exception class names (`SkillNotFound`, `TamperError`, `AuditBlocked`) defined once in Task 8, referenced only there ✓

No unresolved issues.
