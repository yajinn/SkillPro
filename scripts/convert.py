#!/usr/bin/env python3
"""SkillForge — multi-agent skill exporter.

Converts the skills currently installed in `~/.claude/skills/<id>/` into
the on-disk format that another agent (Cursor, Codex CLI, …) expects,
writing the result to the project directory so that agent can pick it up.

Contract
--------
- Single source of truth: the SKILL.md files under `~/.claude/skills/`.
  Run `/sf confirm` first to install skills there; this exporter
  never downloads or installs anything itself.
- Target directory: defaults to cwd, overridable with `--out <dir>`.
- Selection list: by default every skill in `~/.claude/skills/` is
  exported; `--only <id[,id,...]>` trims the list, and `--selected`
  filters to skills marked enabled in `selections.json`.

CLI
---
    python3 convert.py --agent <cursor|codex> [--out DIR] [--selected]
                        [--only id1,id2] [--json]

Exit codes
----------
    0  success, at least one skill exported
    1  usage error / no target agent
    2  no skills found (installation dir empty or selection empty)
    3  converter raised an exception for every skill (total failure)

The `--json` flag switches the human-readable summary to a JSON object
so the /skillforge command can consume it without screen-scraping.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from converters import cursor as cursor_converter  # noqa: E402
from converters import codex as codex_converter  # noqa: E402


SKILLS_DIR = Path(os.path.expanduser("~/.claude/skills"))
SELECTIONS_FILE = Path(os.path.expanduser("~/.claude/skillforge/selections.json"))


@dataclass
class ExportSummary:
    """Result of a full export run — consumed by /skillforge."""
    agent: str = ""
    out_dir: str = ""
    written_files: List[str] = field(default_factory=list)
    exported_skill_ids: List[str] = field(default_factory=list)
    skipped_skill_ids: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "agent": self.agent,
            "out_dir": self.out_dir,
            "written_files": self.written_files,
            "exported_skill_ids": self.exported_skill_ids,
            "skipped_skill_ids": self.skipped_skill_ids,
            "warnings": self.warnings,
            "errors": self.errors,
        }


def _load_installed_skills(
    only: Optional[List[str]] = None,
    selected_only: bool = False,
) -> List[Path]:
    """Return sorted list of skill directories to export.

    Args:
        only: If set, restrict to these skill ids (missing ids are dropped
            with no error — callers should check the returned list).
        selected_only: If True, filter to ids marked enabled in
            selections.json. Silently returns all installed skills when
            selections.json doesn't exist or is malformed.
    """
    if not SKILLS_DIR.exists():
        return []
    all_dirs = sorted(
        d for d in SKILLS_DIR.iterdir()
        if d.is_dir() and (d / "SKILL.md").exists()
    )

    if only:
        wanted = set(only)
        all_dirs = [d for d in all_dirs if d.name in wanted]

    if selected_only and SELECTIONS_FILE.exists():
        try:
            with open(SELECTIONS_FILE) as f:
                sel = json.load(f)
            enabled = {
                sid for sid, meta in (sel.get("selections") or {}).items()
                if isinstance(meta, dict) and meta.get("enabled", False)
            }
            all_dirs = [d for d in all_dirs if d.name in enabled]
        except (OSError, json.JSONDecodeError, KeyError):
            pass  # fall back to full list

    return all_dirs


def _export_cursor(
    skill_dirs: List[Path],
    out_dir: Path,
) -> ExportSummary:
    """Write one .mdc per skill under <out_dir>/.cursor/rules/."""
    summary = ExportSummary(agent="cursor", out_dir=str(out_dir))
    rules_dir = out_dir / ".cursor" / "rules"
    rules_dir.mkdir(parents=True, exist_ok=True)

    for skill_dir in skill_dirs:
        skill_id = skill_dir.name
        try:
            skill_md_text = (skill_dir / "SKILL.md").read_text()
        except OSError as exc:
            summary.errors.append(f"{skill_id}: could not read SKILL.md ({exc})")
            summary.skipped_skill_ids.append(skill_id)
            continue

        has_scripts = (skill_dir / "scripts").is_dir()
        has_references = (skill_dir / "references").is_dir()

        result = cursor_converter.convert_skill(
            skill_id=skill_id,
            skill_md_text=skill_md_text,
            has_scripts=has_scripts,
            has_references=has_references,
        )
        if result.skipped:
            summary.skipped_skill_ids.append(skill_id)
            summary.warnings.extend(result.warnings)
            continue

        target = rules_dir / result.filename
        target.write_text(result.content)
        summary.written_files.append(str(target))
        summary.exported_skill_ids.append(skill_id)
        summary.warnings.extend(result.warnings)

    return summary


def _export_codex(
    skill_dirs: List[Path],
    out_dir: Path,
) -> ExportSummary:
    """Merge all skills into <out_dir>/AGENTS.md managed section."""
    summary = ExportSummary(agent="codex", out_dir=str(out_dir))
    agents_path = out_dir / "AGENTS.md"

    inputs: List[codex_converter.SkillInput] = []
    for skill_dir in skill_dirs:
        skill_id = skill_dir.name
        try:
            skill_md_text = (skill_dir / "SKILL.md").read_text()
        except OSError as exc:
            summary.errors.append(f"{skill_id}: could not read SKILL.md ({exc})")
            summary.skipped_skill_ids.append(skill_id)
            continue
        inputs.append(codex_converter.SkillInput(
            id=skill_id,
            skill_md_text=skill_md_text,
            has_scripts=(skill_dir / "scripts").is_dir(),
            has_references=(skill_dir / "references").is_dir(),
        ))
        summary.exported_skill_ids.append(skill_id)

    existing = ""
    if agents_path.exists():
        try:
            existing = agents_path.read_text()
        except OSError as exc:
            summary.errors.append(f"could not read existing AGENTS.md: {exc}")

    bundle = codex_converter.bundle_skills(inputs, existing_agents_md=existing)
    agents_path.parent.mkdir(parents=True, exist_ok=True)
    agents_path.write_text(bundle.content)
    summary.written_files.append(str(agents_path))
    summary.warnings.extend(bundle.warnings)
    return summary


def run_export(
    agent: str,
    out_dir: Path,
    only: Optional[List[str]] = None,
    selected_only: bool = False,
) -> ExportSummary:
    """High-level export entry point. Importable from tests."""
    skill_dirs = _load_installed_skills(only=only, selected_only=selected_only)
    if agent == "cursor":
        return _export_cursor(skill_dirs, out_dir)
    if agent == "codex":
        return _export_codex(skill_dirs, out_dir)
    raise ValueError(f"unknown agent: {agent}")


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Export installed SkillForge skills to another agent's format",
    )
    parser.add_argument("--agent", required=True, choices=["cursor", "codex"])
    parser.add_argument("--out", default=".", help="Target project directory")
    parser.add_argument("--only", help="Comma-separated skill ids to export")
    parser.add_argument("--selected", action="store_true",
                        help="Only export skills marked enabled in selections.json")
    parser.add_argument("--json", action="store_true",
                        help="Emit a JSON summary instead of a text summary")
    args = parser.parse_args(argv[1:])

    out_dir = Path(args.out).resolve()
    only = [s.strip() for s in args.only.split(",")] if args.only else None

    summary = run_export(
        agent=args.agent,
        out_dir=out_dir,
        only=only,
        selected_only=args.selected,
    )

    if args.json:
        print(json.dumps(summary.to_dict(), indent=2))
    else:
        _print_text_summary(summary)

    if summary.errors and not summary.exported_skill_ids:
        return 3
    if not summary.exported_skill_ids and not summary.written_files:
        return 2
    return 0


def _print_text_summary(summary: ExportSummary) -> None:
    n_exp = len(summary.exported_skill_ids)
    n_skip = len(summary.skipped_skill_ids)
    print(f"agent: {summary.agent}")
    print(f"out:   {summary.out_dir}")
    print(f"exported: {n_exp} skill(s)")
    if n_skip:
        print(f"skipped:  {n_skip} ({', '.join(summary.skipped_skill_ids)})")
    for f in summary.written_files:
        print(f"  + {f}")
    for w in summary.warnings:
        print(f"  ! {w}")
    for e in summary.errors:
        print(f"  x {e}")


if __name__ == "__main__":
    sys.exit(main(sys.argv))
