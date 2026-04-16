"""Shared pipeline functions for scan.py and session_summary.py.

Both scripts need to: load the index, check staleness, score skills
against a profile, and seed pending.json. This module extracts that
shared logic so neither script has to reimplement it.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Tuple


# ─── Canonical paths ─────────────────────────────────────────────────

def index_path() -> Path:
    """Canonical index.json path. Matches refresh_index.index_path()."""
    return Path(os.path.expanduser("~/.claude/skillforge/index.json"))


def profile_path(project_dir: Path) -> Path:
    return project_dir / ".claude" / "project-profile.json"


# ─── Index loading ───────────────────────────────────────────────────

# Index state constants — avoid stringly-typed comparisons
STATE_OK = "ok"
STATE_STALE = "stale"
STATE_MISSING = "missing"
STATE_CORRUPT = "corrupt"


def load_index() -> Tuple[str, Optional[dict]]:
    """Return (state, index_dict) where state is one of STATE_* constants.

    Returns (STATE_MISSING, None) if the file doesn't exist,
    (STATE_CORRUPT, None) on parse failure, (STATE_STALE, dict) if
    TTL exceeded, (STATE_OK, dict) otherwise.
    """
    path = index_path()
    if not path.exists():
        return STATE_MISSING, None
    try:
        idx = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return STATE_CORRUPT, None

    try:
        fetched = datetime.strptime(
            idx.get("fetched_at", "1970-01-01T00:00:00Z"),
            "%Y-%m-%dT%H:%M:%SZ",
        ).replace(tzinfo=timezone.utc)
        ttl = idx.get("ttl_seconds", 604800)
        age = (datetime.now(timezone.utc) - fetched).total_seconds()
        if age > ttl:
            return STATE_STALE, idx
    except Exception:
        pass
    return STATE_OK, idx


# ─── Profile loading ────────────────────────────────────────────────

def load_profile(project_dir: Path) -> Optional[dict]:
    path = profile_path(project_dir)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


# ─── Scoring ─────────────────────────────────────────────────────────

# Default thresholds — single source of truth. score.py's main() reads
# these from the index if present, falling back to these values.
DEFAULT_THRESHOLDS = {
    "recommended": 10,
    "optional": 1,
    "not_relevant": 0,
}


def score_and_classify(
    profile: dict,
    index: dict,
) -> Tuple[List[dict], List[dict]]:
    """Score every skill in the index against the profile.

    Returns (recommended_entries, optional_entries) where each entry
    is a dict with keys: id, name, category, score, description, plugin.
    Both lists are sorted by score descending.
    """
    from score import score_skill, classify  # lazy import avoids circular

    thresholds = index.get("scoring_rules", {}).get("thresholds", DEFAULT_THRESHOLDS)

    rec: List[dict] = []
    opt: List[dict] = []
    for skill in index.get("skills", []):
        try:
            s = score_skill(skill, profile)
        except Exception:
            continue
        cat = classify(s, thresholds)
        entry = {
            "id": skill.get("id", "?"),
            "name": skill.get("name", skill.get("id", "?")),
            "category": skill.get("category"),
            "score": s,
            "description": skill.get("description", ""),
            "plugin": skill.get("plugin", ""),
        }
        if cat == "recommended":
            rec.append(entry)
        elif cat == "optional":
            opt.append(entry)

    rec.sort(key=lambda x: -x["score"])
    opt.sort(key=lambda x: -x["score"])
    return rec, opt


# ─── Pending seeding ─────────────────────────────────────────────────

def seed_pending(
    recommended: List[dict],
    optional: List[dict],
    project_dir: Path,
) -> Path:
    """Write pending.json with recommended items checked, optional unchecked.

    Returns the path to the written file. Uses pending._save for
    atomic write.
    """
    import pending  # lazy import

    items = []
    for e in recommended:
        items.append({**e, "checked": True})
    for e in optional:
        items.append({**e, "checked": False})

    doc = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "project_dir": str(project_dir.resolve()),
        "items": items,
    }
    pending._save(doc)
    return pending.PENDING_PATH
