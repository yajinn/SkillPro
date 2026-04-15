"""Cursor Rules converter — SKILL.md → .cursor/rules/<id>.mdc

Cursor's rules format is per-file (one `.mdc` per rule), with YAML
frontmatter that Cursor reads to decide when to apply the rule. Each
rule becomes a small markdown document Cursor loads into its context
when the description or globs match.

Frontmatter fields we emit:
    description  — copied from SKILL.md `description`. Cursor shows
                   this in its UI and uses it for description-based
                   activation.
    alwaysApply  — always false. We don't want rules to load on every
                   request; let Cursor decide based on description.
    globs        — optional. If the skill has a match_language we can
                   infer a reasonable glob (e.g. python → **/*.py),
                   but the mapping isn't lossless so MVP skips globs
                   and relies on description matching.

Body handling:
    - YAML frontmatter is stripped from the input
    - The remaining markdown body is copied verbatim
    - If the skill directory has scripts/ or references/, the converter
      records a warning — those assets don't travel with Cursor rules

The converter is pure: no file I/O, no directory traversal. Callers
pass in the raw SKILL.md bytes and the converter returns a
ConversionResult dataclass describing the generated .mdc content plus
any warnings.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional

FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)


@dataclass
class ConversionResult:
    """Return value from convert_skill.

    content   The full .mdc file content ready to write to disk.
    filename  The filename relative to `.cursor/rules/`, e.g. "python-pro.mdc".
    warnings  Non-fatal issues the caller should surface to the user.
    skipped   True if the converter decided not to produce a rule.
    """
    content: str = ""
    filename: str = ""
    warnings: List[str] = field(default_factory=list)
    skipped: bool = False


def _parse_frontmatter(body: str) -> tuple[dict, str]:
    """Return (frontmatter_dict, body_without_frontmatter).

    Minimal parser: only handles `key: value` pairs on single lines.
    Matches the parser SkillForge uses elsewhere — no multi-line values,
    no nesting. That's sufficient for SKILL.md's `name` and `description`.
    """
    match = FRONTMATTER_RE.search(body)
    if not match:
        return {}, body
    fm_text = match.group(1)
    rest = body[match.end():]
    fm: dict = {}
    for line in fm_text.splitlines():
        kv = re.match(r"^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$", line)
        if not kv:
            continue
        key, val = kv.group(1), kv.group(2).strip()
        # Strip matching quotes Cursor parses raw strings anyway
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        fm[key] = val
    return fm, rest


def _escape_yaml_string(s: str) -> str:
    """Quote a string for YAML frontmatter emission.

    We always double-quote to avoid edge cases with colons, hashes,
    leading whitespace, or anything else YAML might interpret. Escape
    backslashes and double quotes inside the string.
    """
    escaped = s.replace("\\", "\\\\").replace("\"", "\\\"")
    return f"\"{escaped}\""


def convert_skill(
    skill_id: str,
    skill_md_text: str,
    has_scripts: bool = False,
    has_references: bool = False,
) -> ConversionResult:
    """Convert a single SKILL.md to a Cursor .mdc rule.

    Args:
        skill_id: Canonical skill id (used as filename stem).
        skill_md_text: Full SKILL.md file content as a string.
        has_scripts: True if the source skill directory had scripts/.
        has_references: True if the source skill directory had references/.

    Returns:
        ConversionResult with content, filename, and any warnings.
        If the skill has no frontmatter or no description, the result is
        returned with a warning but still produces output — Cursor will
        just show an empty description in its UI.
    """
    result = ConversionResult(filename=f"{skill_id}.mdc")
    fm, body = _parse_frontmatter(skill_md_text)

    description = fm.get("description", "").strip()
    if not description:
        result.warnings.append(
            f"{skill_id}: no description in SKILL.md frontmatter — "
            f"Cursor will show an empty tooltip"
        )
        description = skill_id  # fall back to id so the field isn't empty

    if has_scripts:
        result.warnings.append(
            f"{skill_id}: scripts/ directory not portable to Cursor — "
            f"skipped (only the markdown body was copied)"
        )
    if has_references:
        result.warnings.append(
            f"{skill_id}: references/ directory not portable to Cursor — "
            f"skipped (only the markdown body was copied)"
        )

    # Trim leading/trailing whitespace but preserve internal blank lines
    body_stripped = body.strip("\n")

    header = (
        "---\n"
        f"description: {_escape_yaml_string(description)}\n"
        "alwaysApply: false\n"
        "---\n\n"
    )
    result.content = header + body_stripped + "\n"
    return result
