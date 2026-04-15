"""Tests for scripts/converters/codex.py.

The Codex converter merges multiple skills into one AGENTS.md with
HTML-comment markers. Tests cover: clean creation, replacement of an
existing managed section, append when markers are missing, and
preservation of user content outside the markers.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from converters import codex  # noqa: E402


def _skill(id: str, description: str, body: str = "Body content", **kwargs) -> codex.SkillInput:
    md = (
        "---\n"
        f"name: {id}\n"
        f"description: {description}\n"
        "---\n\n"
        f"{body}\n"
    )
    return codex.SkillInput(id=id, skill_md_text=md, **kwargs)


class TestBundleFreshFile(unittest.TestCase):
    def test_empty_agents_md_creates_managed_block(self):
        skills = [
            _skill("python-pro", "Advanced Python", body="# Python\n\nStuff"),
            _skill("fastapi", "FastAPI patterns", body="# FastAPI\n\nRoutes"),
        ]
        result = codex.bundle_skills(skills, existing_agents_md="")
        self.assertIn(codex.START_MARKER, result.content)
        self.assertIn(codex.END_MARKER, result.content)
        self.assertIn("## python-pro", result.content)
        self.assertIn("## fastapi", result.content)
        self.assertIn("_Activate when: Advanced Python_", result.content)
        self.assertIn("_Activate when: FastAPI patterns_", result.content)
        self.assertIn("# Python", result.content)

    def test_empty_skill_list_produces_placeholder(self):
        result = codex.bundle_skills([], existing_agents_md="")
        self.assertIn("No skills installed", result.content)
        self.assertIn(codex.START_MARKER, result.content)

    def test_sections_separated_by_rule(self):
        skills = [
            _skill("a", "A desc", body="A body"),
            _skill("b", "B desc", body="B body"),
        ]
        result = codex.bundle_skills(skills)
        # Horizontal rule between sections
        between = result.content.split("## a")[1].split("## b")[0]
        self.assertIn("---", between)


class TestExistingFileWithoutMarkers(unittest.TestCase):
    def test_appends_managed_block_preserving_user_content(self):
        existing = "# My project instructions\n\nUse tabs for indentation.\n"
        skills = [_skill("x", "X desc", body="X body")]
        result = codex.bundle_skills(skills, existing_agents_md=existing)
        self.assertIn("# My project instructions", result.content)
        self.assertIn("Use tabs for indentation.", result.content)
        self.assertIn(codex.START_MARKER, result.content)
        # User content comes before the managed block
        user_pos = result.content.find("My project instructions")
        marker_pos = result.content.find(codex.START_MARKER)
        self.assertLess(user_pos, marker_pos)


class TestExistingFileWithMarkers(unittest.TestCase):
    def test_replaces_managed_section_leaving_user_content_intact(self):
        existing = (
            "# Top of file\n\n"
            "Some user notes.\n\n"
            + codex.START_MARKER + "\n"
            + "# SkillForge skills\n\n"
            + "## old-skill\n_Activate when: stale_\n\nold body\n"
            + codex.END_MARKER + "\n\n"
            + "User content below markers.\n"
        )
        skills = [_skill("new-skill", "Fresh", body="new body")]
        result = codex.bundle_skills(skills, existing_agents_md=existing)

        # Old skill section is gone
        self.assertNotIn("## old-skill", result.content)
        self.assertNotIn("stale", result.content)
        # New skill is present
        self.assertIn("## new-skill", result.content)
        self.assertIn("Fresh", result.content)
        # User content above AND below is preserved
        self.assertIn("# Top of file", result.content)
        self.assertIn("Some user notes.", result.content)
        self.assertIn("User content below markers.", result.content)

    def test_round_trip_does_not_accumulate_markers(self):
        """Running the converter twice should not duplicate the block."""
        skills = [_skill("x", "X", body="x")]
        first = codex.bundle_skills(skills, existing_agents_md="").content
        second = codex.bundle_skills(skills, existing_agents_md=first).content
        self.assertEqual(second.count(codex.START_MARKER), 1)
        self.assertEqual(second.count(codex.END_MARKER), 1)


class TestWarnings(unittest.TestCase):
    def test_scripts_dir_warning_propagates(self):
        skills = [_skill("s", "desc", has_scripts=True)]
        result = codex.bundle_skills(skills)
        self.assertTrue(any("scripts/" in w for w in result.warnings))

    def test_missing_description_warning(self):
        skill_md = "---\nname: x\n---\n\nbody\n"
        skills = [codex.SkillInput(id="x", skill_md_text=skill_md)]
        result = codex.bundle_skills(skills)
        self.assertTrue(any("no description" in w for w in result.warnings))
        # Body still bundled
        self.assertIn("## x", result.content)


if __name__ == "__main__":
    unittest.main()
