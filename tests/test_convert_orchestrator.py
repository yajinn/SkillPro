"""Integration tests for scripts/convert.py — the multi-agent exporter.

These tests stage a fake ~/.claude/skills directory with a couple of
skill folders, point SKILLS_DIR / SELECTIONS_FILE at the temp locations
via patching, and exercise both the cursor and codex paths. We assert
files land at the right project-relative paths and the summary object
accurately reflects what happened.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import convert  # noqa: E402


SKILL_A_MD = """---
name: Skill A
description: First skill for testing
---

# Skill A

Body of A.
"""

SKILL_B_MD = """---
name: Skill B
description: Second skill for testing
---

# Skill B

Body of B.
"""


def _make_skills_home(tmp: Path) -> Path:
    """Populate a fake ~/.claude/skills layout under tmp/ and return it."""
    skills = tmp / "skills"
    (skills / "skill-a").mkdir(parents=True)
    (skills / "skill-a" / "SKILL.md").write_text(SKILL_A_MD)
    (skills / "skill-b").mkdir(parents=True)
    (skills / "skill-b" / "SKILL.md").write_text(SKILL_B_MD)
    # skill-b has a scripts/ dir to exercise the warning path
    (skills / "skill-b" / "scripts").mkdir()
    (skills / "skill-b" / "scripts" / "helper.py").write_text("# helper")
    return skills


def _make_selections(tmp: Path, enabled_ids: list) -> Path:
    """Write a minimal selections.json with the given ids enabled."""
    sel_dir = tmp / "skillforge"
    sel_dir.mkdir(parents=True, exist_ok=True)
    sel_path = sel_dir / "selections.json"
    sel_path.write_text(json.dumps({
        "version": 1,
        "selections": {
            sid: {"enabled": True} for sid in enabled_ids
        },
    }))
    return sel_path


class TestCursorExport(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.skills_dir = _make_skills_home(self.tmp)
        self.out = self.tmp / "project"
        self.out.mkdir()
        self._p1 = patch.object(convert, "SKILLS_DIR", self.skills_dir)
        self._p1.start()
        self.addCleanup(self._p1.stop)
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))

    def test_writes_one_mdc_per_skill(self):
        summary = convert.run_export(agent="cursor", out_dir=self.out)
        rules_dir = self.out / ".cursor" / "rules"
        self.assertTrue(rules_dir.exists())
        self.assertTrue((rules_dir / "skill-a.mdc").exists())
        self.assertTrue((rules_dir / "skill-b.mdc").exists())
        self.assertEqual(set(summary.exported_skill_ids), {"skill-a", "skill-b"})

    def test_mdc_content_has_frontmatter_and_body(self):
        convert.run_export(agent="cursor", out_dir=self.out)
        content = (self.out / ".cursor" / "rules" / "skill-a.mdc").read_text()
        self.assertIn("description:", content)
        self.assertIn("alwaysApply: false", content)
        self.assertIn("# Skill A", content)
        self.assertIn("Body of A.", content)

    def test_skill_with_scripts_raises_warning(self):
        summary = convert.run_export(agent="cursor", out_dir=self.out)
        self.assertTrue(any("skill-b" in w and "scripts/" in w
                            for w in summary.warnings))

    def test_only_filter(self):
        summary = convert.run_export(
            agent="cursor", out_dir=self.out, only=["skill-a"]
        )
        self.assertEqual(summary.exported_skill_ids, ["skill-a"])
        self.assertTrue((self.out / ".cursor" / "rules" / "skill-a.mdc").exists())
        self.assertFalse((self.out / ".cursor" / "rules" / "skill-b.mdc").exists())

    def test_selected_only_filter(self):
        sel_path = _make_selections(self.tmp, enabled_ids=["skill-a"])
        with patch.object(convert, "SELECTIONS_FILE", sel_path):
            summary = convert.run_export(
                agent="cursor", out_dir=self.out, selected_only=True
            )
        self.assertEqual(summary.exported_skill_ids, ["skill-a"])


class TestCodexExport(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.skills_dir = _make_skills_home(self.tmp)
        self.out = self.tmp / "project"
        self.out.mkdir()
        self._p1 = patch.object(convert, "SKILLS_DIR", self.skills_dir)
        self._p1.start()
        self.addCleanup(self._p1.stop)
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))

    def test_writes_single_agents_md(self):
        summary = convert.run_export(agent="codex", out_dir=self.out)
        agents = self.out / "AGENTS.md"
        self.assertTrue(agents.exists())
        content = agents.read_text()
        self.assertIn("## skill-a", content)
        self.assertIn("## skill-b", content)
        self.assertIn("<!-- skillforge:start -->", content)
        self.assertIn("<!-- skillforge:end -->", content)
        self.assertEqual(len(summary.written_files), 1)

    def test_preserves_existing_user_content(self):
        agents = self.out / "AGENTS.md"
        agents.write_text("# Project notes\n\nUse 2-space indent.\n")
        convert.run_export(agent="codex", out_dir=self.out)
        content = agents.read_text()
        self.assertIn("# Project notes", content)
        self.assertIn("Use 2-space indent.", content)
        self.assertIn("## skill-a", content)

    def test_re_export_replaces_managed_block(self):
        convert.run_export(agent="codex", out_dir=self.out)
        first = (self.out / "AGENTS.md").read_text()
        # Delete skill-b, re-export
        import shutil
        shutil.rmtree(self.skills_dir / "skill-b")
        convert.run_export(agent="codex", out_dir=self.out)
        second = (self.out / "AGENTS.md").read_text()
        self.assertIn("## skill-a", second)
        self.assertNotIn("## skill-b", second)
        # Single managed block
        self.assertEqual(second.count("<!-- skillforge:start -->"), 1)


class TestEmptyCases(unittest.TestCase):
    def test_empty_skills_dir_returns_zero_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            empty = tmp_path / "skills"
            empty.mkdir()
            out = tmp_path / "project"
            out.mkdir()
            with patch.object(convert, "SKILLS_DIR", empty):
                summary = convert.run_export(agent="cursor", out_dir=out)
            self.assertEqual(summary.exported_skill_ids, [])
            self.assertEqual(summary.written_files, [])

    def test_nonexistent_skills_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "project"
            out.mkdir()
            with patch.object(convert, "SKILLS_DIR", Path(tmp) / "does-not-exist"):
                summary = convert.run_export(agent="codex", out_dir=out)
            self.assertEqual(summary.exported_skill_ids, [])


class TestInvalidAgent(unittest.TestCase):
    def test_unknown_agent_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            with self.assertRaises(ValueError):
                convert.run_export(agent="gemini", out_dir=out)


if __name__ == "__main__":
    unittest.main()
