"""Adapter for curated awesome-* markdown README sources.

Strategy:
    1. Fetch README.
    2. Extract (owner, repo) pairs from GitHub links using a conservative regex.
    3. For each repo (capped at MAX_PROBES), probe the Claude Code plugin
       convention locations in order:
         a. `.claude-plugin/marketplace.json` (current convention)
         b. `marketplace.json` (legacy / SkillForge-authored shape)
       Sub-probes run in parallel across a small thread pool so the whole
       awesome-list walk fits within the source-level timeout budget.
    4. If either path hits, delegate parsing to the marketplace adapter.
       Repos that have neither are skipped silently.
"""
from __future__ import annotations

import concurrent.futures
import re
import sys
from typing import List, Tuple, Union

from .base import HttpGet, SkillEntry
from .marketplace import MarketplaceAdapter

MAX_PROBES = 20
SUBPROBE_WORKERS = 8

# Match https://github.com/<owner>/<repo>[/...] where owner and repo are
# non-empty segments that don't contain slashes or whitespace.
_GH_RE = re.compile(
    r"https?://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?=[/)\s]|$)"
)


def extract_github_repos(markdown: Union[str, bytes]) -> List[Tuple[str, str]]:
    if isinstance(markdown, bytes):
        markdown = markdown.decode("utf-8", errors="replace")
    seen: List[Tuple[str, str]] = []
    for match in _GH_RE.finditer(markdown):
        owner, repo = match.group(1), match.group(2)
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

    def fetch(self, url: str, http_get: HttpGet, source=None) -> List[SkillEntry]:
        try:
            body = http_get(url)
        except IOError as exc:
            print(f"[awesome-list] fetch failed for {url}: {exc}", file=sys.stderr)
            return []

        repos = extract_github_repos(body)[:MAX_PROBES]
        if not repos:
            return []

        # Claude Code convention is .claude-plugin/marketplace.json in the repo
        # root. Older/alternative: root marketplace.json. We try both, but in
        # parallel so the whole walk completes within the source-level timeout.
        candidate_paths = [
            ".claude-plugin/marketplace.json",
            "marketplace.json",
        ]

        def probe_repo(owner_repo):
            owner, repo = owner_repo
            for candidate in candidate_paths:
                mp_url = (
                    f"https://raw.githubusercontent.com/{owner}/{repo}/main/{candidate}"
                )
                found = self._marketplace.fetch(mp_url, http_get)
                if found:
                    return found  # first hit wins per repo
            return []

        entries: List[SkillEntry] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=SUBPROBE_WORKERS) as pool:
            for result in pool.map(probe_repo, repos):
                entries.extend(result)
        return entries
