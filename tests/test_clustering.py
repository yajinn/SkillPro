"""Tests for scripts/clustering.py — the presentation-layer grouping
logic that turns a flat scored skill list into category buckets with
variant collapsing and popularity tiebreaking.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from clustering import (  # noqa: E402
    DEFAULT_OTHER_CATEGORY,
    cluster_by_prefix,
    group_by_category,
    present_grouped,
    skill_prefix,
    tiebreaker_key,
)


def sk(id_, score=10, category=None, popularity=0, description=""):
    return {
        "id": id_,
        "score": score,
        "category": category,
        "popularity": popularity,
        "description": description,
    }


class TestSkillPrefix(unittest.TestCase):
    def test_dash_split(self):
        self.assertEqual(skill_prefix("mem0"), "mem0")
        self.assertEqual(skill_prefix("mem0-cli"), "mem0")
        self.assertEqual(skill_prefix("mem0-vercel-ai-sdk"), "mem0")

    def test_short_prefix_uses_whole_id(self):
        # "ci" is shorter than MIN_PREFIX_LEN=3
        self.assertEqual(skill_prefix("ci-setup"), "ci-setup")
        self.assertEqual(skill_prefix("go-expert"), "go-expert")  # "go" too short
        self.assertEqual(skill_prefix("rs-best"), "rs-best")

    def test_longer_prefix(self):
        self.assertEqual(skill_prefix("python-pro"), "python")
        self.assertEqual(skill_prefix("fastapi-templates"), "fastapi")

    def test_single_word_id(self):
        self.assertEqual(skill_prefix("brainstorming"), "brainstorming")


class TestTiebreaker(unittest.TestCase):
    def test_score_primary(self):
        a = sk("a", score=20)
        b = sk("b", score=10)
        self.assertLess(tiebreaker_key(a), tiebreaker_key(b))

    def test_popularity_secondary(self):
        a = sk("a", score=10, popularity=50)
        b = sk("b", score=10, popularity=10)
        self.assertLess(tiebreaker_key(a), tiebreaker_key(b))

    def test_id_tertiary(self):
        a = sk("alpha", score=10, popularity=5)
        b = sk("beta", score=10, popularity=5)
        self.assertLess(tiebreaker_key(a), tiebreaker_key(b))


class TestClusterByPrefix(unittest.TestCase):
    def test_mem0_variants_cluster(self):
        skills = [
            sk("mem0", score=100),
            sk("mem0-cli", score=100),
            sk("mem0-vercel-ai-sdk", score=100),
            sk("atheris", score=100),
        ]
        clusters = cluster_by_prefix(skills)
        self.assertEqual(len(clusters), 2)  # mem0 cluster + atheris
        mem0_cluster = next(c for c in clusters if c[0]["id"] == "mem0")
        self.assertEqual(len(mem0_cluster), 3)
        atheris_cluster = next(c for c in clusters if c[0]["id"] == "atheris")
        self.assertEqual(len(atheris_cluster), 1)

    def test_canonical_is_highest_score(self):
        skills = [
            sk("mem0-cli", score=50),
            sk("mem0", score=100),
            sk("mem0-vercel", score=75),
        ]
        clusters = cluster_by_prefix(skills)
        self.assertEqual(len(clusters), 1)
        canonical = clusters[0][0]
        self.assertEqual(canonical["id"], "mem0")

    def test_singleton_cluster(self):
        skills = [sk("solo-skill", score=10)]
        clusters = cluster_by_prefix(skills)
        self.assertEqual(len(clusters), 1)
        self.assertEqual(len(clusters[0]), 1)

    def test_short_prefix_no_false_merge(self):
        # "ci-one" and "ci-two" should NOT cluster (ci < MIN_PREFIX_LEN)
        skills = [sk("ci-one", score=10), sk("ci-two", score=10)]
        clusters = cluster_by_prefix(skills)
        self.assertEqual(len(clusters), 2)


class TestGroupByCategory(unittest.TestCase):
    def test_basic_grouping(self):
        skills = [
            sk("a", category="language/python"),
            sk("b", category="language/python"),
            sk("c", category="framework/fastapi"),
            sk("d", category=None),
        ]
        groups = group_by_category(skills)
        self.assertEqual(len(groups["language/python"]), 2)
        self.assertEqual(len(groups["framework/fastapi"]), 1)
        self.assertEqual(len(groups[DEFAULT_OTHER_CATEGORY]), 1)


class TestPresentGrouped(unittest.TestCase):
    def test_mem0_example(self):
        """The canonical test — real data from earlier FastAPI demo."""
        skills = [
            sk("mem0", score=100, category="meta/memory"),
            sk("mem0-cli", score=100, category="meta/memory"),
            sk("mem0-vercel-ai-sdk", score=100, category="meta/memory"),
            sk("atheris", score=100, category="quality/testing"),
            sk("temporal-python-testing", score=100, category="quality/testing"),
            sk("modern-python", score=100, category="language/python"),
            sk("python-pro", score=95, category="language/python"),
            sk("fastapi-templates", score=100, category="framework/fastapi"),
        ]
        result = present_grouped(skills, top_per_category=3)

        # Total input matches
        self.assertEqual(result["total_input"], 8)

        # 4 categories: meta/memory, quality/testing, language/python, framework/fastapi
        self.assertEqual(len(result["categories"]), 4)

        # meta/memory collapses 3 mem0-* into 1 canonical with 2 variants
        mem0_cat = next(c for c in result["categories"] if c["category"] == "meta/memory")
        self.assertEqual(mem0_cat["total_canonicals"], 1)
        self.assertEqual(mem0_cat["total_variants"], 2)
        self.assertEqual(mem0_cat["canonicals"][0]["id"], "mem0")
        self.assertEqual(mem0_cat["canonicals"][0]["variant_count"], 2)

        # quality/testing — 2 different prefixes, no clustering
        testing_cat = next(c for c in result["categories"] if c["category"] == "quality/testing")
        self.assertEqual(testing_cat["total_canonicals"], 2)

    def test_top_per_category_cap(self):
        """When a category has more canonicals than top_per_category, extras go to hidden."""
        # Use distinct-prefix ids so no clustering fires — each is its own canonical
        ids = [
            "alpha", "bravo", "charlie", "delta", "echo",
            "foxtrot", "golf", "hotel", "india", "juliet",
        ]
        skills = [
            sk(ids[i], score=100 - i, category="lang/python")
            for i in range(10)
        ]
        result = present_grouped(skills, top_per_category=3)
        cat = result["categories"][0]
        self.assertEqual(len(cat["canonicals"]), 3)
        self.assertEqual(len(cat["hidden"]), 7)
        self.assertEqual(cat["total_canonicals"], 10)

    def test_empty_input(self):
        result = present_grouped([])
        self.assertEqual(result["categories"], [])
        self.assertEqual(result["total_input"], 0)
        self.assertEqual(result["total_shown"], 0)

    def test_no_category_falls_to_other(self):
        skills = [
            sk("alpha", score=50),
            sk("bravo", score=40),
        ]
        result = present_grouped(skills)
        self.assertEqual(len(result["categories"]), 1)
        self.assertEqual(result["categories"][0]["category"], DEFAULT_OTHER_CATEGORY)

    def test_other_category_sorted_last(self):
        """The 'other' bucket is always pushed to the end regardless of score."""
        skills = [
            sk("alpha", score=50, category=None),  # goes to 'other'
            sk("bravo", score=40, category=None),
            sk("charlie", score=30, category="language/python"),
        ]
        result = present_grouped(skills)
        # "other" has higher-scored skills but should still be last
        self.assertEqual(result["categories"][-1]["category"], DEFAULT_OTHER_CATEGORY)
        self.assertEqual(result["categories"][0]["category"], "language/python")

    def test_popularity_tiebreaker(self):
        """Two skills with same score — higher popularity wins canonical."""
        skills = [
            sk("python-pro", score=100, popularity=10, category="language/python"),
            sk("modern-python", score=100, popularity=50, category="language/python"),
        ]
        result = present_grouped(skills, top_per_category=5)
        cat = result["categories"][0]
        # Both become canonicals (different prefixes), but popularity
        # determines listing order within the category
        ids = [c["id"] for c in cat["canonicals"]]
        self.assertEqual(ids[0], "modern-python")  # popularity 50 > 10

    def test_total_hidden_accounting(self):
        """total_hidden correctly counts variants + over-cap canonicals."""
        # Use prefixes of length >= MIN_PREFIX_LEN (3) so clustering fires
        skills = [
            sk("alpha-one", score=100, category="x"),
            sk("alpha-two", score=90, category="x"),   # variant of "alpha"
            sk("alpha-three", score=80, category="x"), # variant of "alpha"
            sk("bravo-one", score=70, category="x"),
            sk("charlie-one", score=60, category="x"),
            sk("delta-one", score=50, category="x"),   # goes to hidden (past top 3)
            sk("echo-one", score=40, category="x"),    # goes to hidden
        ]
        # After prefix clustering: alpha (with 2 variants), bravo, charlie, delta, echo = 5 canonicals
        # top_per_category=3 → alpha, bravo, charlie shown; delta, echo hidden
        result = present_grouped(skills, top_per_category=3)
        cat = result["categories"][0]
        self.assertEqual(cat["total_canonicals"], 5)
        self.assertEqual(cat["total_variants"], 2)  # alpha-two, alpha-three
        self.assertEqual(len(cat["canonicals"]), 3)
        self.assertEqual(len(cat["hidden"]), 2)


if __name__ == "__main__":
    unittest.main()
