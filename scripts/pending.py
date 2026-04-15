#!/usr/bin/env python3
"""SkillForge — pre-checked checkbox UI staging area.

Motivation
----------
The original `/sf add <id>` flow was opt-IN: every recommended
skill required a separate command to install. With a federated index
producing 20+ recommendations per project, that scales poorly.

This module flips the model to opt-OUT. Run `/sf setup` once and
SkillForge writes a `pending.json` file at ``~/.claude/skillforge/pending.json``
with every recommended skill pre-checked. The user reviews the list,
unchecks anything they don't want, then runs `/sf confirm` to
batch-install everything still checked.

Schema
------
``pending.json`` is a single-project staging file:

    {
      "version": 1,
      "generated_at": "2026-04-15T12:34:56Z",
      "project_dir": "/path/to/project",
      "items": [
        {
          "id": "python-pro",
          "checked": true,
          "name": "Python Pro",
          "category": "language/python",
          "score": 100,
          "description": "Advanced Python patterns",
          "plugin": "anthropic-skills"
        },
        ...
      ]
    }

A single pending.json is sufficient — the file is rewritten on every
``setup``, so it always reflects the most recently scored project. The
`project_dir` field exists so confirm can warn if the user accidentally
runs it from a different directory than the one they reviewed.

Commands
--------
- ``seed <project_dir>``   — re-run score.py and rewrite pending.json
- ``render``               — print markdown checkbox list to stdout
- ``check <id>``           — flip an item back ON
- ``skip <id>``            — flip an item OFF
- ``confirm``              — install every checked item, clear file
- ``status``               — print N checked / N total
- ``clear``                — delete the pending file (cancel)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

PENDING_PATH = Path(os.path.expanduser("~/.claude/skillforge/pending.json"))
SCRIPTS_DIR = Path(__file__).resolve().parent


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load() -> Optional[dict]:
    if not PENDING_PATH.exists():
        return None
    try:
        with open(PENDING_PATH) as f:
            doc = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(doc, dict) or doc.get("version") != 1:
        return None
    if not isinstance(doc.get("items"), list):
        return None
    return doc


def _save(doc: dict) -> None:
    PENDING_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = PENDING_PATH.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump(doc, f, indent=2)
    os.replace(tmp, PENDING_PATH)


def _run_score(project_dir: str) -> dict:
    """Invoke score.py as a subprocess and parse its JSON output."""
    result = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "score.py"), project_dir],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"score.py failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


def cmd_seed(project_dir: str) -> int:
    """Score the project and write pending.json with all recommended pre-checked.

    Optional skills are included but unchecked by default — the user can
    flip them on with ``check <id>``. Not-relevant skills are excluded.
    """
    score_output = _run_score(project_dir)
    items: List[dict] = []
    for skill in score_output.get("skills", {}).get("recommended", []):
        items.append({
            "id": skill["id"],
            "checked": True,
            "name": skill.get("name", skill["id"]),
            "category": skill.get("category"),
            "score": skill.get("score", 0),
            "description": skill.get("description", ""),
            "plugin": skill.get("plugin", ""),
        })
    for skill in score_output.get("skills", {}).get("optional", []):
        items.append({
            "id": skill["id"],
            "checked": False,
            "name": skill.get("name", skill["id"]),
            "category": skill.get("category"),
            "score": skill.get("score", 0),
            "description": skill.get("description", ""),
            "plugin": skill.get("plugin", ""),
        })
    doc = {
        "version": 1,
        "generated_at": _now_iso(),
        "project_dir": str(Path(project_dir).resolve()),
        "items": items,
    }
    _save(doc)
    checked = sum(1 for it in items if it["checked"])
    print(f"pending: {checked} checked / {len(items)} total → {PENDING_PATH}")
    return 0


def cmd_render() -> int:
    """Print a markdown checkbox list grouped by category."""
    doc = _load()
    if not doc:
        print("no pending selections — run `/sf setup` to seed")
        return 1
    items = doc["items"]
    if not items:
        print("pending list is empty (no recommendations from score.py)")
        return 0

    # Group by category, "other" last
    by_cat: dict = {}
    for it in items:
        cat = it.get("category") or "other"
        by_cat.setdefault(cat, []).append(it)
    cats = sorted(by_cat.keys(), key=lambda c: (c == "other", c))

    checked_total = sum(1 for it in items if it["checked"])
    print(f"# Pending skill selections — {checked_total}/{len(items)} checked")
    print()
    print(f"_Project: `{doc['project_dir']}` · generated {doc['generated_at']}_")
    print()
    print("Edit selections:")
    print("- `/sf skip <id>` to uncheck an item")
    print("- `/sf check <id>` to re-check an item")
    print("- `/sf confirm` to install everything still checked")
    print("- `/sf clear` to cancel without installing")
    print()
    for cat in cats:
        cat_items = by_cat[cat]
        n_checked = sum(1 for it in cat_items if it["checked"])
        print(f"## {cat} ({n_checked}/{len(cat_items)})")
        print()
        for it in cat_items:
            mark = "x" if it["checked"] else " "
            desc = (it.get("description") or "").strip().replace("\n", " ")
            if len(desc) > 80:
                desc = desc[:77] + "..."
            score = it.get("score", 0)
            print(f"- [{mark}] **{it['id']}** _(score {score})_ — {desc}")
        print()
    return 0


def _set_checked(skill_id: str, value: bool) -> int:
    doc = _load()
    if not doc:
        print("no pending selections — run `/sf setup` first")
        return 1
    for it in doc["items"]:
        if it["id"] == skill_id:
            it["checked"] = value
            _save(doc)
            state = "checked" if value else "unchecked"
            print(f"{skill_id}: {state}")
            return 0
    print(f"id not found in pending: {skill_id}")
    return 1


def cmd_check(skill_id: str) -> int:
    return _set_checked(skill_id, True)


def cmd_skip(skill_id: str) -> int:
    return _set_checked(skill_id, False)


def cmd_status() -> int:
    doc = _load()
    if not doc:
        print("no pending selections")
        return 1
    items = doc["items"]
    checked = sum(1 for it in items if it["checked"])
    print(f"pending: {checked} checked / {len(items)} total")
    print(f"project: {doc['project_dir']}")
    print(f"generated: {doc['generated_at']}")
    return 0


def cmd_confirm() -> int:
    """Install every checked item, then clear the pending file.

    Each install is a separate subprocess call to install_skill.py so a
    failure in one skill doesn't abort the others. We collect failures
    and report them at the end.
    """
    doc = _load()
    if not doc:
        print("no pending selections — nothing to confirm")
        return 1
    to_install = [it for it in doc["items"] if it["checked"]]
    if not to_install:
        print("no items checked — nothing to install")
        return 0

    successes: List[str] = []
    failures: List[tuple] = []
    for it in to_install:
        skill_id = it["id"]
        print(f"installing {skill_id}...")
        result = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "install_skill.py"), skill_id],
            capture_output=True, text=True,
        )
        if result.returncode == 0:
            successes.append(skill_id)
        else:
            err = (result.stderr or result.stdout).strip().splitlines()
            tail = err[-1] if err else "unknown error"
            failures.append((skill_id, tail))

    print()
    print(f"installed: {len(successes)} / {len(to_install)}")
    if failures:
        print(f"failed: {len(failures)}")
        for fid, ferr in failures:
            print(f"  - {fid}: {ferr}")

    # Only clear the pending file on full success — partial failures leave
    # the file in place so the user can `confirm` again after fixing things
    if not failures:
        cmd_clear()
    return 0 if not failures else 2


def cmd_clear() -> int:
    if PENDING_PATH.exists():
        PENDING_PATH.unlink()
        print("pending cleared")
    else:
        print("no pending file to clear")
    return 0


USAGE = """usage: pending.py <command> [args]

commands:
  seed <project_dir>   re-score and write fresh pending.json (all checked)
  render               print markdown checkbox list
  check <id>           re-check a previously skipped item
  skip <id>            uncheck an item
  confirm              install every checked item
  status               summary line
  clear                delete pending file
"""


def main(argv: List[str]) -> int:
    if len(argv) < 2:
        print(USAGE, file=sys.stderr)
        return 2
    cmd = argv[1]
    args = argv[2:]
    try:
        if cmd == "seed":
            if len(args) != 1:
                print("seed requires <project_dir>", file=sys.stderr)
                return 2
            return cmd_seed(args[0])
        if cmd == "render":
            return cmd_render()
        if cmd == "check":
            if len(args) != 1:
                print("check requires <id>", file=sys.stderr)
                return 2
            return cmd_check(args[0])
        if cmd == "skip":
            if len(args) != 1:
                print("skip requires <id>", file=sys.stderr)
                return 2
            return cmd_skip(args[0])
        if cmd == "confirm":
            return cmd_confirm()
        if cmd == "status":
            return cmd_status()
        if cmd == "clear":
            return cmd_clear()
        print(f"unknown command: {cmd}", file=sys.stderr)
        print(USAGE, file=sys.stderr)
        return 2
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
