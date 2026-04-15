"""Codex CLI converter — bundle N SKILL.md files into a single AGENTS.md.

Codex CLI reads `AGENTS.md` at the project root as a single context file
(there's no per-skill activation — the LLM sees everything at once). Our
job is to consolidate multiple installed skills into that file WITHOUT
clobbering content the user already wrote.

Strategy: managed section with HTML-comment markers.

    <!-- skillforge:start -->
    # SkillForge skills
    ... generated content ...
    <!-- skillforge:end -->

    User content lives outside the markers and survives re-runs.

Merge semantics on re-convert:
    - If AGENTS.md exists and already has a managed section → replace the
      section content, leave everything else alone.
    - If AGENTS.md exists with no markers → append the managed section at
      the end, preceded by a blank line.
    - If AGENTS.md doesn't exist → create a new file with just the
      managed section.

Per-skill format inside the managed section:
    ## <skill id>
    _Activate when: <description>_

    <skill body>

    ---
    (next skill)

Scripts/references dirs are still non-portable — Codex's single-file
model can't carry executable assets. The converter emits a warning for
each skipped asset dir, same as the Cursor converter.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Tuple

from .cursor import _parse_frontmatter  # reuse the frontmatter parser


START_MARKER = "<!-- skillforge:start -->"
END_MARKER = "<!-- skillforge:end -->"


@dataclass
class SkillInput:
    """Input for one skill passed to bundle_skills."""
    id: str
    skill_md_text: str
    has_scripts: bool = False
    has_references: bool = False


@dataclass
class BundleResult:
    """Full AGENTS.md content to write, plus any warnings."""
    content: str = ""
    warnings: List[str] = field(default_factory=list)


def _render_skill_section(skill: SkillInput) -> Tuple[str, List[str]]:
    """Render one skill as a `## <id>` section. Returns (markdown, warnings)."""
    warnings: List[str] = []
    fm, body = _parse_frontmatter(skill.skill_md_text)
    description = fm.get("description", "").strip()
    if not description:
        description = skill.id
        warnings.append(
            f"{skill.id}: no description in SKILL.md frontmatter — "
            f"Codex section uses id as fallback activation hint"
        )
    if skill.has_scripts:
        warnings.append(
            f"{skill.id}: scripts/ not portable to Codex — section "
            f"contains only the markdown body"
        )
    if skill.has_references:
        warnings.append(
            f"{skill.id}: references/ not portable to Codex — section "
            f"contains only the markdown body"
        )
    body_stripped = body.strip("\n")
    section = (
        f"## {skill.id}\n"
        f"_Activate when: {description}_\n\n"
        f"{body_stripped}\n"
    )
    return section, warnings


def _render_managed_section(skills: List[SkillInput]) -> Tuple[str, List[str]]:
    """Build the full managed block bracketed by markers."""
    all_warnings: List[str] = []
    sections: List[str] = []
    for skill in skills:
        section, warnings = _render_skill_section(skill)
        all_warnings.extend(warnings)
        sections.append(section)

    if not sections:
        inner = "_No skills installed. Run `/sf confirm` first._\n"
    else:
        inner = "# SkillForge skills\n\n" + "\n---\n\n".join(sections)

    block = f"{START_MARKER}\n{inner}\n{END_MARKER}"
    return block, all_warnings


# Matches the managed block with DOTALL so the inner markdown (which
# contains plenty of newlines) is captured entirely.
_MANAGED_RE = re.compile(
    re.escape(START_MARKER) + r".*?" + re.escape(END_MARKER),
    re.DOTALL,
)


def bundle_skills(
    skills: List[SkillInput],
    existing_agents_md: str = "",
) -> BundleResult:
    """Produce the full AGENTS.md content, preserving user content.

    Args:
        skills: Ordered list of skills to include. Order determines the
            section order in the output, so callers can sort by whatever
            makes sense (score, name, category).
        existing_agents_md: The current contents of AGENTS.md, or an
            empty string if the file doesn't exist.

    Returns:
        BundleResult with the merged content and any warnings collected
        from per-skill rendering.
    """
    managed_block, warnings = _render_managed_section(skills)

    if not existing_agents_md.strip():
        # Brand new file — just the managed block with a trailing newline
        content = managed_block + "\n"
        return BundleResult(content=content, warnings=warnings)

    if _MANAGED_RE.search(existing_agents_md):
        # Replace the existing managed section in place
        merged = _MANAGED_RE.sub(
            lambda _: managed_block,
            existing_agents_md,
            count=1,
        )
        if not merged.endswith("\n"):
            merged += "\n"
        return BundleResult(content=merged, warnings=warnings)

    # Existing file with no markers — append the managed block
    separator = "\n\n" if not existing_agents_md.endswith("\n\n") else ""
    appended = existing_agents_md.rstrip() + "\n\n" + managed_block + "\n"
    return BundleResult(content=appended, warnings=warnings)
