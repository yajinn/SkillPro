#!/usr/bin/env python3
"""
SkillForge — Relevance Scoring Engine
Takes a project profile and skill catalog, computes relevance scores,
and outputs grouped recommendations (recommended / optional / not-relevant).

Usage: python3 score.py [project_dir]
Output: JSON to stdout + writes .claude/skill-recommendations.json
"""

import json
import os
import re
import sys

# Presentation-layer clustering — imported lazily so score.py stays
# usable as a pure scoring engine if clustering is unavailable.
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)
try:
    from clustering import present_grouped  # noqa: E402
except ImportError:
    present_grouped = None  # type: ignore

def load_json(path):
    with open(path) as f:
        return json.load(f)

def score_skill(skill, profile):
    """Compute relevance score for a skill given a project profile."""
    chars = profile.get("characteristics", {})
    project_type = profile.get("project_type", "unknown")
    language = profile.get("language") or "unknown"
    framework = profile.get("framework") or ""
    sub_framework = profile.get("sub_framework") or ""

    score = 0

    # --- Language match (auto-recommend language skills) ---
    match_lang = skill.get("match_language", "")
    if match_lang:
        if language == match_lang:
            return 100  # Always recommended for matching language
        else:
            return -100  # Never show for non-matching language

    # --- Framework match (auto-recommend framework skills) ---
    match_fw = skill.get("match_framework", "")
    if match_fw:
        patterns = match_fw.split("|")
        if framework in patterns:
            return 100
        else:
            return -100

    # --- Sub-framework match ---
    match_sub = skill.get("match_sub_framework", "")
    if match_sub:
        if sub_framework and match_sub in sub_framework:
            return 100
        else:
            return -100

    # --- Tag matching ---
    tags = skill.get("tags", [])
    if "any" in tags:
        score += 5  # Universal base
    else:
        for tag in tags:
            if chars.get(tag, False):
                score += 2

    # --- Boost matching ---
    for boost in skill.get("boost_when", []):
        if chars.get(boost, False):
            score += 3

    # --- Penalize matching ---
    for pen in skill.get("penalize_when", []):
        if chars.get(pen, False):
            score -= 5

    # --- Default-for matching ---
    default_for = skill.get("default_for", [])
    if project_type in default_for:
        score += 10

    return score

def classify(score, thresholds):
    """Classify score into recommended/optional/not-relevant."""
    if score >= thresholds["recommended"]:
        return "recommended"
    elif score >= thresholds["optional"]:
        return "optional"
    else:
        return "not_relevant"

def main():
    project_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())

    profile_path = os.path.join(project_dir, ".claude", "project-profile.json")
    index_path = os.path.join(os.path.expanduser("~"), ".claude", "skillforge", "index.json")

    if not os.path.exists(profile_path):
        print(json.dumps({"error": "No project profile found. Run detect.sh first."}))
        sys.exit(1)

    if not os.path.exists(index_path):
        print(json.dumps({
            "error": "No federated index found. Run /skillforge refresh first.",
            "hint": "python3 scripts/refresh_index.py --force"
        }))
        sys.exit(1)

    profile = load_json(profile_path)
    catalog = load_json(index_path)

    thresholds = catalog.get("scoring_rules", {}).get("thresholds", {
        "recommended": 10,
        "optional": 1,
        "not_relevant": 0
    })

    results = {
        "recommended": [],
        "optional": [],
        "not_relevant": []
    }

    all_scores = []

    for skill in catalog.get("skills", []):
        score = score_skill(skill, profile)
        category = classify(score, thresholds)

        entry = {
            "id": skill["id"],
            "name": skill["name"],
            "category": skill.get("category", None),
            "description": skill["description"],
            "score": score,
            "relevance": category,
            "plugin": skill.get("plugin", ""),
            "has_lang_refs": skill.get("has_lang_refs", False),
            "popularity": skill.get("popularity", 0),
        }

        results[category].append(entry)
        all_scores.append(entry)

    # Sort each group by score descending
    for group in results:
        results[group].sort(key=lambda x: x["score"], reverse=True)

    output = {
        "profile_summary": {
            "language": profile.get("language"),
            "framework": profile.get("framework"),
            "sub_framework": profile.get("sub_framework"),
            "project_type": profile.get("project_type"),
        },
        "counts": {
            "recommended": len(results["recommended"]),
            "optional": len(results["optional"]),
            "not_relevant": len(results["not_relevant"]),
            "total": len(all_scores)
        },
        "skills": results
    }

    # Presentation-layer grouping: cluster by category + prefix, cap per
    # category, tiebreak by popularity. Consumed by /skillforge UI.
    if present_grouped is not None:
        output["grouped"] = {
            "recommended": present_grouped(results["recommended"]),
            "optional": present_grouped(results["optional"]),
            # not_relevant is intentionally NOT grouped — it's the "hidden"
            # bucket and the UI collapses it entirely. Grouping wastes CPU.
        }

    # Write to file
    rec_path = os.path.join(project_dir, ".claude", "skill-recommendations.json")
    os.makedirs(os.path.dirname(rec_path), exist_ok=True)
    with open(rec_path, "w") as f:
        json.dump(output, f, indent=2)

    # Print to stdout
    print(json.dumps(output, indent=2))

if __name__ == "__main__":
    main()
