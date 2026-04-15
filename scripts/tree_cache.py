"""Local disk cache for GitHub Trees API results.

Motivation
----------

SkillForge's federated discovery hits GitHub's unauthenticated
`api.github.com/repos/{owner}/{repo}/git/trees/{ref}` endpoint once per
repo that doesn't ship a `.claude-plugin/marketplace.json`. GitHub's
unauthenticated quota is 60 requests per hour per IP — enough for a
single full refresh, then the next refresh is rate-limited for up to
an hour.

This module caches each tree walk's result (the list of `skills/*/SKILL.md`
directory paths) to a local JSON file with a TTL. Subsequent refreshes
within the TTL window return the cached list immediately without any
network traffic, bringing the second-and-subsequent refresh budget
cost for tree walks down to **zero**.

Design
------

- Cache key: the full api.github.com URL string (includes owner/repo/ref).
- Cache value: `List[str]` of skill directory paths (e.g.
  `["skills/brainstorming", "skills/writing-plans"]`). An empty list is
  a valid cached result ("this repo has no skills at the conventional
  location, don't re-probe").
- TTL: 24 hours default, caller can override per lookup.
- Storage: `~/.claude/skillforge/tree-cache.json` with atomic write via
  tmp file + rename.
- Schema versioning: `version: 1` at the top of the file. Unknown
  versions are treated as empty (safe for forward migration).
- No persistent metadata — just a flat URL to entry map.

Concurrency
-----------

Atomic rename handles the common case. If two processes write
simultaneously, last-writer-wins without corruption. No explicit
locking — the cache is an optimization, not a source of truth.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import List, Optional


CACHE_VERSION = 1
CACHE_TTL_SECONDS = 24 * 3600  # 24 hours


def _cache_path() -> Path:
    """Path to the tree cache file.

    Patched by tests to redirect to a temporary directory.
    """
    return Path(os.path.expanduser("~/.claude/skillforge/tree-cache.json"))


def _load_cache() -> dict:
    """Return the full cache dict, or a fresh empty one on any failure."""
    path = _cache_path()
    if not path.exists():
        return {"version": CACHE_VERSION, "entries": {}}
    try:
        with open(path) as f:
            doc = json.load(f)
    except (json.JSONDecodeError, ValueError, OSError):
        return {"version": CACHE_VERSION, "entries": {}}
    if doc.get("version") != CACHE_VERSION:
        return {"version": CACHE_VERSION, "entries": {}}
    if not isinstance(doc.get("entries"), dict):
        return {"version": CACHE_VERSION, "entries": {}}
    return doc


def _save_cache(doc: dict) -> None:
    path = _cache_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump(doc, f, indent=2)
    os.replace(tmp, path)


def get(url: str, ttl_seconds: int = CACHE_TTL_SECONDS) -> Optional[List[str]]:
    """Return cached skill_dirs for url if fresh, otherwise None.

    Caller distinguishes three cases:
    - Return value is ``None``           → cache miss, fetch from network
    - Return value is a non-empty list   → cache hit, use it
    - Return value is ``[]``             → cached "no skills here" result

    Empty-list is a legitimate cache entry: the adapter walked this
    repo before and found zero SKILL.md files. Don't re-probe.
    """
    doc = _load_cache()
    entry = doc["entries"].get(url)
    if not entry or not isinstance(entry, dict):
        return None
    cached_at = entry.get("cached_at", 0)
    if not isinstance(cached_at, (int, float)):
        return None
    if time.time() - cached_at > ttl_seconds:
        return None
    skill_dirs = entry.get("skill_dirs")
    if not isinstance(skill_dirs, list):
        return None
    return skill_dirs


def put(url: str, skill_dirs: List[str]) -> None:
    """Store skill_dirs for url in cache with current timestamp.

    Overwrites any existing entry for the same URL. Empty lists are
    cached deliberately — they represent "we walked this repo and
    found nothing".
    """
    doc = _load_cache()
    doc["entries"][url] = {
        "cached_at": time.time(),
        "skill_dirs": list(skill_dirs),
    }
    _save_cache(doc)


def clear() -> None:
    """Delete the cache file. No-op if it doesn't exist."""
    path = _cache_path()
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def stats(ttl_seconds: int = CACHE_TTL_SECONDS) -> dict:
    """Return diagnostic info: total entries + fresh vs stale counts."""
    doc = _load_cache()
    entries = doc["entries"]
    now = time.time()
    fresh = 0
    stale = 0
    for entry in entries.values():
        if isinstance(entry, dict):
            cached_at = entry.get("cached_at", 0)
        else:
            cached_at = 0
        if now - cached_at <= ttl_seconds:
            fresh += 1
        else:
            stale += 1
    return {
        "entries": len(entries),
        "fresh": fresh,
        "stale": stale,
    }
