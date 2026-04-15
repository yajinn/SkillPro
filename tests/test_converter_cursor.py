"""Tests for scripts/converters/cursor.py.

The Cursor converter is pure (no I/O) so these tests feed strings and
assert on the returned ConversionResult. Covers: basic frontmatter
mapping, missing description, scripts/references warnings, and body
passthrough.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from converters import cursor  # noqa: E402


SAMPLE_SKILL_MD = """---
name: Python Pro
description: Advanced Python patterns for production codebases
version: 1.0.0
---

# Python Pro

Guidelines for writing idiomatic Python.

## Type hints

Always annotate function signatures.
"""


class TestConvertSkill(unittest.TestCase):
    def test_basic_conversion(self):
        result = cursor.convert_skill("python-pro", SAMPLE_SKILL_MD)
        self.assertEqual(result.filename, "python-pro.mdc")
        self.assertFalse(result.skipped)
        self.assertEqual(result.warnings, [])
        self.assertIn("---\n", result.content)
        self.assertIn("description:", result.content)
        self.assertIn("alwaysApply: false", result.content)
        self.assertIn("# Python Pro", result.content)
        self.assertIn("Always annotate function signatures.", result.content)

    def test_description_is_yaml_quoted(self):
        result = cursor.convert_skill("x", SAMPLE_SKILL_MD)
        # Double-quoted form avoids YAML gotchas with colons/hashes
        self.assertIn(
            'description: "Advanced Python patterns for production codebases"',
            result.content,
        )

    def test_description_with_quotes_is_escaped(self):
        skill_md = (
            '---\n'
            'name: x\n'
            'description: Use when "edge case" handling matters\n'
            '---\n\n'
            'body\n'
        )
        result = cursor.convert_skill("x", skill_md)
        self.assertIn(r'\"edge case\"', result.content)

    def test_missing_frontmatter_warns_and_uses_id(self):
        result = cursor.convert_skill("lonely", "# just a body\n")
        self.assertEqual(len(result.warnings), 1)
        self.assertIn("no description", result.warnings[0])
        self.assertIn('description: "lonely"', result.content)

    def test_scripts_dir_warning(self):
        result = cursor.convert_skill("s", SAMPLE_SKILL_MD, has_scripts=True)
        self.assertTrue(any("scripts/" in w for w in result.warnings))

    def test_references_dir_warning(self):
        result = cursor.convert_skill("s", SAMPLE_SKILL_MD, has_references=True)
        self.assertTrue(any("references/" in w for w in result.warnings))

    def test_both_script_and_reference_warnings(self):
        result = cursor.convert_skill(
            "s", SAMPLE_SKILL_MD, has_scripts=True, has_references=True,
        )
        self.assertEqual(len(result.warnings), 2)

    def test_body_preserved_verbatim(self):
        skill_md = (
            '---\n'
            'description: x\n'
            '---\n\n'
            '# Heading\n\n'
            'Paragraph with **bold** and `code`.\n\n'
            '- list item 1\n'
            '- list item 2\n'
        )
        result = cursor.convert_skill("b", skill_md)
        self.assertIn("**bold**", result.content)
        self.assertIn("`code`", result.content)
        self.assertIn("- list item 1", result.content)

    def test_quoted_frontmatter_values_unquoted(self):
        skill_md = (
            '---\n'
            'description: "Already quoted value"\n'
            '---\n\n'
            'body\n'
        )
        result = cursor.convert_skill("q", skill_md)
        # After parse we re-emit with our own quoting — inner content intact
        self.assertIn('description: "Already quoted value"', result.content)

    def test_output_ends_with_newline(self):
        result = cursor.convert_skill("x", SAMPLE_SKILL_MD)
        self.assertTrue(result.content.endswith("\n"))


if __name__ == "__main__":
    unittest.main()
