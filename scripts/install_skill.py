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
from typing import Callable, Dict

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

    # Write to staging, audit, then atomically replace target directory.
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
