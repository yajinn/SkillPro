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
    # Presentation-layer fields (not used for primary scoring):
    #   category: single-level taxonomy for grouping (e.g. "language/python",
    #     "framework/flutter", "quality/review"). Populated by heuristic
    #     inference from description, optionally overridden by enrichment.
    #   popularity: tiebreaker signal. For skills discovered via sitemap-
    #     aggregator, this is the skill count of the host repo in the
    #     aggregator sitemap (higher = more skills = more "endorsed").
    #     Other sources default to 0.
    category: Optional[str] = None
    popularity: int = 0
    # Library anchoring — the skill is tied to specific libraries (detected
    # by detect.sh's deep library introspection). Semantics in score.py:
    #   match_libraries: hard anchor. Skill hidden unless the project uses
    #     at least one of these libraries.
    #   boost_libraries: soft nudge. Additive +5 if any overlap, otherwise
    #     the skill is scored on its normal tag/framework signals.
    # Both default to empty list for backward compatibility with existing
    # sources and enrichment entries.
    match_libraries: List[str] = field(default_factory=list)
    boost_libraries: List[str] = field(default_factory=list)

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

    If ``GITHUB_TOKEN`` is set in the environment and the target is
    api.github.com, the helper adds an ``Authorization: Bearer <token>``
    header. This raises the rate limit from 60 req/hour (unauthenticated)
    to 5000 req/hour, which is the practical requirement for walking
    large awesome-lists whose repos need Trees API discovery.
    """
    import os
    headers = {"User-Agent": "skillforge/1.0 (+https://skillforge.dev)"}
    token = os.environ.get("GITHUB_TOKEN")
    if token and "api.github.com" in url:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(url, headers=headers)
    try:
        with urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except HTTPError as exc:
        if exc.code == 403 and "api.github.com" in url:
            raise IOError(
                f"fetch failed for {url}: GitHub API rate limit exceeded "
                f"(set GITHUB_TOKEN env var to raise limit from 60/hr to 5000/hr)"
            ) from exc
        raise IOError(f"fetch failed for {url}: {exc}") from exc
    except URLError as exc:
        raise IOError(f"fetch failed for {url}: {exc}") from exc


def parse_json_bytes(body: bytes) -> dict:
    """Parse JSON bytes, raising ValueError with context on failure."""
    try:
        return json.loads(body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"invalid JSON payload: {exc}") from exc
