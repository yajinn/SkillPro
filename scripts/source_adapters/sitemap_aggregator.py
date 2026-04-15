"""Adapter for sitemap.xml aggregator sites like skills.sh.

These sites don't host skill content themselves — they index GitHub
repositories that do. The adapter pipeline:

1. Fetch the sitemap.xml.
2. Parse `<loc>` entries into URLs.
3. Keep only depth-3 URLs matching `{host}/{owner}/{repo}/{skill_name}`
   (skips `/picks`, `/about`, or any deeper/shallower path).
4. Group by (owner, repo) and count skills per pair.
5. Sort pairs by skill count descending (most-populated repos first).
6. Cap at `max_repos` from the source config (default 50).
7. For each (owner, repo), probe in order:
     a. raw.githubusercontent.com/{owner}/{repo}/main/.claude-plugin/marketplace.json
     b. raw.githubusercontent.com/{owner}/{repo}/main/marketplace.json (legacy)
   Sub-probes run in an 8-worker thread pool so the source-level
   timeout budget is respected.
8. Delegate each successful probe to MarketplaceAdapter, which handles
   all three shape variants (self-authored, path-based, Tree API).

No HTML scraping. No content on the aggregator site is touched beyond
the sitemap. If the site ever changes its URL pattern, the adapter
silently produces zero results rather than crashing — caller sees
the source as failed/empty and falls back to other sources.
"""
from __future__ import annotations

import concurrent.futures
import re
import sys
from collections import Counter
from typing import List, Optional
from urllib.parse import urlparse

from .base import HttpGet, SkillEntry
from .marketplace import MarketplaceAdapter


DEFAULT_MAX_REPOS = 15
SUBPROBE_WORKERS = 8

_SITEMAP_LOC_RE = re.compile(r"<loc>([^<]+)</loc>")
_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def extract_pair(loc: str):
    """Return (owner, repo) if the URL matches the depth-3 skill pattern.

    Valid:   https://skills.sh/owner/repo/skill
    Invalid: https://skills.sh/picks  (depth 1)
             https://skills.sh/a/b    (depth 2)
             https://skills.sh/a/b/c/d (depth 4)
             https://skills.sh/a/b/c with non-alphanumeric segments
    """
    try:
        parsed = urlparse(loc)
    except ValueError:
        return None
    segments = [s for s in parsed.path.split("/") if s]
    if len(segments) != 3:
        return None
    owner, repo, skill = segments
    if not all(_SEGMENT_RE.match(s) for s in (owner, repo, skill)):
        return None
    return (owner, repo)


class SitemapAggregatorAdapter:
    type = "sitemap-aggregator"

    def __init__(self) -> None:
        self._marketplace = MarketplaceAdapter()

    def fetch(
        self,
        url: str,
        http_get: HttpGet,
        source: Optional[dict] = None,
    ) -> List[SkillEntry]:
        try:
            body = http_get(url)
        except IOError as exc:
            print(
                f"[sitemap-aggregator] fetch failed for {url}: {exc}",
                file=sys.stderr,
            )
            return []

        try:
            text = body.decode("utf-8", errors="replace")
        except Exception:
            return []

        locs = _SITEMAP_LOC_RE.findall(text)
        if not locs:
            print(
                f"[sitemap-aggregator] no <loc> entries in sitemap at {url}",
                file=sys.stderr,
            )
            return []

        pairs: Counter = Counter()
        for loc in locs:
            pair = extract_pair(loc)
            if pair is not None:
                pairs[pair] += 1

        if not pairs:
            print(
                f"[sitemap-aggregator] no skill-pattern URLs found in {url}",
                file=sys.stderr,
            )
            return []

        max_repos = DEFAULT_MAX_REPOS
        if source and isinstance(source.get("max_repos"), int) and source["max_repos"] > 0:
            max_repos = source["max_repos"]

        top_repos = [pair for pair, _count in pairs.most_common(max_repos)]

        candidate_paths = [".claude-plugin/marketplace.json", "marketplace.json"]

        def probe_repo(owner_repo):
            owner, repo = owner_repo
            # Fast path: try the conventional marketplace.json locations.
            for candidate in candidate_paths:
                mp_url = (
                    f"https://raw.githubusercontent.com/{owner}/{repo}/main/{candidate}"
                )
                found = self._marketplace.fetch(mp_url, http_get)
                if found:
                    return found
            # Fallback: walk the repo tree directly. The sitemap told us
            # this repo has skills, so we don't need a marketplace.json —
            # just enumerate skills/*/SKILL.md via Trees API.
            return self._marketplace.fetch_repo_via_tree_api(
                owner, repo, "main", http_get
            )

        entries: List[SkillEntry] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=SUBPROBE_WORKERS) as pool:
            for result in pool.map(probe_repo, top_repos):
                entries.extend(result)
        return entries
