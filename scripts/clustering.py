"""Presentation-layer clustering for SkillForge recommendations.

Takes the flat scored skill list from score.py and produces a
structured output for display:

  1. Within each category, cluster skills that share an id prefix
     (e.g. `mem0`, `mem0-cli`, `mem0-vercel-ai-sdk`). The highest-
     scored member becomes the canonical representative; the rest
     are "variants" hidden behind a collapse.

  2. Canonicals within a category are sorted by (score desc,
     popularity desc, id asc). Top N per category are shown; the
     rest fall into the "hidden" bucket for that category.

  3. Categories themselves are sorted by (highest canonical score desc,
     category id asc) so the most relevant groups appear first.

The output is a dict designed to be consumed by the /skillforge
command's rendering logic. It preserves every input skill (nothing
is dropped silently), just arranges them hierarchically.

No external dependencies — pure stdlib.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Tuple


DEFAULT_OTHER_CATEGORY = "other"
DEFAULT_TOP_PER_CATEGORY = 3
MIN_PREFIX_LEN = 3  # prefixes shorter than this don't cluster


def skill_prefix(skill_id: str) -> str:
    """Extract the clustering prefix from a skill id.

    Rule: the first dash-separated segment, if it's at least
    MIN_PREFIX_LEN characters. Otherwise fall back to the full id
    (so short prefixes like "ci-" or "go-" don't wrongly merge
    unrelated skills).
    """
    if "-" not in skill_id:
        return skill_id
    head = skill_id.split("-", 1)[0]
    if len(head) < MIN_PREFIX_LEN:
        return skill_id
    return head


def tiebreaker_key(skill: dict) -> Tuple[int, int, str]:
    """Sort key: score desc, popularity desc, id asc."""
    return (-skill.get("score", 0), -skill.get("popularity", 0), skill.get("id", ""))


def cluster_by_prefix(skills: List[dict]) -> List[List[dict]]:
    """Group skills sharing a prefix into clusters.

    Each returned cluster is sorted by tiebreaker_key; the first
    member is the canonical. Clusters are returned in tiebreaker
    order of their canonicals so that higher-scoring clusters come
    first.
    """
    buckets: Dict[str, List[dict]] = defaultdict(list)
    for skill in skills:
        buckets[skill_prefix(skill["id"])].append(skill)

    clusters: List[List[dict]] = []
    for members in buckets.values():
        members.sort(key=tiebreaker_key)
        clusters.append(members)

    clusters.sort(key=lambda c: tiebreaker_key(c[0]))
    return clusters


def group_by_category(skills: List[dict]) -> Dict[str, List[dict]]:
    """Bucket skills by their category field.

    Skills with no category (None, empty string) go into
    DEFAULT_OTHER_CATEGORY so they're still rendered.
    """
    groups: Dict[str, List[dict]] = defaultdict(list)
    for skill in skills:
        category = skill.get("category") or DEFAULT_OTHER_CATEGORY
        groups[category].append(skill)
    return groups


def present_grouped(
    skills: List[dict],
    top_per_category: int = DEFAULT_TOP_PER_CATEGORY,
) -> dict:
    """Build a presentation-layer structure from a flat skill list."""
    if not skills:
        return {
            "total_input": 0,
            "total_shown": 0,
            "total_hidden": 0,
            "categories": [],
        }

    groups = group_by_category(skills)
    out_categories: List[dict] = []
    total_shown = 0
    total_hidden = 0

    for category, members in groups.items():
        clusters = cluster_by_prefix(members)
        canonical_entries: List[dict] = []
        for cluster in clusters:
            canonical = dict(cluster[0])
            variants = cluster[1:]
            canonical["variant_count"] = len(variants)
            canonical["variants_preview"] = [v["id"] for v in variants[:5]]
            canonical_entries.append(canonical)

        total_canonicals = len(canonical_entries)
        total_variants = sum(e["variant_count"] for e in canonical_entries)

        shown = canonical_entries[:top_per_category]
        hidden = canonical_entries[top_per_category:]

        total_shown += len(shown)
        total_hidden += total_variants + len(hidden)

        out_categories.append({
            "category": category,
            "total_canonicals": total_canonicals,
            "total_variants": total_variants,
            "canonicals": shown,
            "hidden": hidden,
        })

    # Sort categories by the tiebreaker of their top canonical —
    # most relevant group first. The "other" bucket is always pushed
    # to the end regardless of its score, because it represents skills
    # the heuristic couldn't categorize. Real categories rank above it
    # so the user sees the curated structure first.
    def cat_sort_key(c):
        is_other = c["category"] == DEFAULT_OTHER_CATEGORY
        if c["canonicals"]:
            tk = tiebreaker_key(c["canonicals"][0])
        else:
            tk = (0, 0, c["category"])
        return (is_other, *tk)
    out_categories.sort(key=cat_sort_key)

    return {
        "total_input": len(skills),
        "total_shown": total_shown,
        "total_hidden": total_hidden,
        "categories": out_categories,
    }
