"""Unit tests for score_skill's library-aware scoring.

Covers three semantic behaviors:
1. `match_libraries` is a HARD anchor — skill returns -100 if no overlap,
   +100 if any overlap.
2. `boost_libraries` is a SOFT nudge — adds +5 to whatever the skill would
   have scored on its other signals; never penalizes.
3. Skills with neither field are unaffected by the libraries array.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from score import score_skill  # noqa: E402


def _profile(libs=None, **chars):
    return {
        "language": "typescript",
        "framework": "nextjs",
        "sub_framework": "",
        "project_type": "web-frontend",
        "characteristics": chars,
        "libraries": libs or [],
    }


def _skill(**kwargs):
    base = {
        "id": "x",
        "tags": [],
        "boost_when": [],
        "penalize_when": [],
        "default_for": [],
    }
    base.update(kwargs)
    return base


class TestMatchLibraries(unittest.TestCase):
    def test_match_libraries_hard_anchor_hides_when_absent(self):
        skill = _skill(match_libraries=["tanstack-query"])
        prof = _profile(libs=["zod", "zustand"])
        self.assertEqual(score_skill(skill, prof), -100)

    def test_match_libraries_returns_100_on_any_overlap(self):
        skill = _skill(match_libraries=["tanstack-query"])
        prof = _profile(libs=["tanstack-query", "zustand"])
        self.assertEqual(score_skill(skill, prof), 100)

    def test_match_libraries_multiple_targets_or_semantics(self):
        skill = _skill(match_libraries=["flutter-bloc", "bloc"])
        # Either being present is enough
        self.assertEqual(score_skill(skill, _profile(libs=["bloc"])), 100)
        self.assertEqual(score_skill(skill, _profile(libs=["flutter-bloc"])), 100)
        self.assertEqual(score_skill(skill, _profile(libs=["riverpod"])), -100)

    def test_match_libraries_with_no_libraries_in_profile(self):
        skill = _skill(match_libraries=["fastapi"])
        self.assertEqual(score_skill(skill, _profile(libs=[])), -100)

    def test_match_libraries_takes_precedence_over_match_language(self):
        # If both are set, match_libraries wins because it's checked first
        # (more specific signal). A library-anchored skill that also names
        # a language should still hide when the library is missing.
        skill = _skill(
            match_libraries=["fastapi"],
            match_language="python",
        )
        prof = _profile(libs=[])
        prof["language"] = "python"
        self.assertEqual(score_skill(skill, prof), -100)


class TestBoostLibraries(unittest.TestCase):
    def test_boost_libraries_adds_5_on_overlap(self):
        skill = _skill(
            boost_libraries=["vitest"],
            tags=["any"],  # base score 5
        )
        prof = _profile(libs=["vitest"])
        # +5 base (any tag) + 5 (boost_libraries hit) = 10
        self.assertEqual(score_skill(skill, prof), 10)

    def test_boost_libraries_no_effect_when_absent(self):
        skill = _skill(
            boost_libraries=["playwright"],
            tags=["any"],
        )
        prof = _profile(libs=["jest"])
        self.assertEqual(score_skill(skill, prof), 5)  # only base, no boost

    def test_boost_libraries_does_not_negate_score(self):
        # Unlike match_libraries, boost_libraries never returns -100
        skill = _skill(boost_libraries=["fastapi"])
        prof = _profile(libs=["zod"])
        result = score_skill(skill, prof)
        self.assertGreaterEqual(result, 0)


class TestNoLibraryFields(unittest.TestCase):
    def test_skill_without_library_fields_unaffected(self):
        skill = _skill(tags=["has_api"])
        prof = _profile(libs=["fastapi"], has_api=True)
        # Tag match: +2. No library semantics involved.
        self.assertEqual(score_skill(skill, prof), 2)

    def test_profile_without_libraries_field(self):
        # Old profiles (pre-library detection) should still score normally
        skill = _skill(tags=["has_api"])
        prof = {
            "language": "python",
            "framework": "fastapi",
            "sub_framework": "",
            "project_type": "backend-api",
            "characteristics": {"has_api": True},
            # no "libraries" key
        }
        self.assertEqual(score_skill(skill, prof), 2)


if __name__ == "__main__":
    unittest.main()
