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

from source_adapters.base import http_get_default  # noqa: E402
from source_adapters.marketplace import MarketplaceAdapter  # noqa: E402
from source_adapters.awesome_list import AwesomeListAdapter  # noqa: E402


DEFAULT_TTL_SECONDS = 7 * 24 * 3600  # 7 days
# Increased from 10s to 30s to accommodate awesome-list sources that walk
# many repos with tree API + SKILL.md frontmatter fetches. Within the
# stale-while-revalidate model, first-run latency is acceptable since
# subsequent /skillforge calls serve cache.
FETCH_TIMEOUT_SECONDS = 30
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
            for skill_entry in entries:
                if skill_entry.id in skills_by_id:
                    # First source already wins; record the loser.
                    existing = next(
                        (c for c in conflicts if c["id"] == skill_entry.id),
                        None,
                    )
                    if existing is None:
                        conflicts.append({
                            "id": skill_entry.id,
                            "winner": skill_source[skill_entry.id],
                            "losers": [source["name"]],
                        })
                    else:
                        existing["losers"].append(source["name"])
                    continue
                d = skill_entry.to_dict()
                d["source"] = {
                    "name": source["name"],
                    "install_url": skill_entry.install_url,
                    "commit_sha": skill_entry.commit_sha,
                    "version": skill_entry.version,
                }
                d["audit"] = {
                    "status": "unaudited",
                    "tool": None,
                    "scanned_at": None,
                }
                skills_by_id[skill_entry.id] = d
                skill_source[skill_entry.id] = source["name"]

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
