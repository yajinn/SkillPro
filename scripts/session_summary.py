#!/usr/bin/env python3
"""SkillForge — SessionStart post-scan summary hook.

Runs AFTER `hooks/detect.sh` writes `.claude/project-profile.json`.
Reads the profile, scores it against `~/.claude/skillforge/index.json`,
seeds `~/.claude/skillforge/pending.json` with recommended skills
pre-checked, and emits a one-line `additionalContext` JSON for
Claude Code to inject into the session.

Design invariants
-----------------
1. **Non-blocking.** Must never crash SessionStart. Any failure path
   emits a minimal fallback JSON and exits 0. If the index is missing,
   stale, or corrupt, the user still sees SOMETHING actionable.
2. **No network.** Never triggers a refresh. That's the user's call
   via `/skillforge:sf refresh` — SessionStart is not the place for
   multi-minute HTTP fetches.
3. **Reuses existing modules.** Imports `score.score_skill` / `classify`
   and `pending.cmd_seed` rather than re-implementing the pipeline.
4. **Terse output.** Single-line additionalContext, max ~140 chars.
   Bigger messages pollute every prompt the user sends.

Exit code is always 0; the JSON on stdout is the only signal.

Fallback cases
--------------
- Profile missing            → "SkillForge: project not detected, run /sf"
- Index missing              → "SkillForge: index missing, run /sf refresh"
- Index stale                → still scores + seeds, but appends "(stale)"
- Index corrupt / unreadable → "SkillForge: index unreadable, run /sf refresh"
- Empty recommendations      → "SkillForge: <lang>/<fw> · no matches, run /sf refresh"
- Score subprocess failure   → "SkillForge: scoring failed, run /sf"
- pending.py cmd_seed failure → same as above (caught + swallowed)

Happy path output shape
-----------------------
    SkillForge: <language> / <framework> · <N libs> ·
    <R> rec / <O> opt · run /skillforge:sf to review

Skipped segments:
- `<framework>` omitted if null/unknown
- `<N libs>` omitted if libraries list is empty
- `<O opt>` omitted if optional count is 0
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path

# Wiring: this script lives at scripts/session_summary.py and imports
# sibling modules. When run via hook, cwd is the user's project, not
# the plugin dir — so we add the plugin's scripts/ dir explicitly.
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))


MAX_LINE_LENGTH = 200  # hard cap so we don't flood the prompt


def _emit(text: str) -> None:
    """Print a single additionalContext JSON line and exit successfully."""
    text = text[:MAX_LINE_LENGTH]
    print(json.dumps({"additionalContext": text}))
    sys.exit(0)


from pipeline import (  # noqa: E402
    load_profile as _load_profile,
    load_index as _pipeline_load_index,
    score_and_classify,
    seed_pending,
    STATE_OK, STATE_STALE, STATE_MISSING, STATE_CORRUPT,
)


def _load_index() -> tuple[dict | None, str]:
    """Wrapper around pipeline.load_index with session_summary's (idx, state) return order."""
    state, idx = _pipeline_load_index()
    return idx, state


def _score_and_seed(profile: dict, index: dict, project_dir: Path) -> dict:
    """Score + seed using shared pipeline functions.

    Returns dict with keys: recommended (int), optional (int), and
    optionally 'error' (str) on failure. Never raises.
    """
    try:
        rec_entries, opt_entries = score_and_classify(profile, index)
    except Exception as exc:
        return {"recommended": 0, "optional": 0, "error": f"score: {exc}"}

    try:
        seed_pending(rec_entries, opt_entries, project_dir)
    except Exception:
        # Don't fail the summary if seeding breaks — Claude will still
        # see the one-line context and the user can run /sf setup manually.
        pass

    return {"recommended": len(rec_entries), "optional": len(opt_entries)}


def _format_summary(profile: dict, index_state: str, scores: dict) -> str:
    lang = profile.get("language") or "unknown"
    framework = profile.get("framework")
    libs = profile.get("libraries") or []
    rec = scores.get("recommended", 0)
    opt = scores.get("optional", 0)

    parts = [f"SkillForge: {lang}"]
    if framework:
        parts[0] += f" / {framework}"
    if libs:
        # Truncate long library lists to 3 + "+N"
        shown = libs[:3]
        suffix = f" +{len(libs) - 3}" if len(libs) > 3 else ""
        parts.append(f"{len(libs)} libs ({', '.join(shown)}{suffix})")

    if rec == 0 and opt == 0:
        parts.append("no matches")
        parts.append("run /sf refresh to pull more sources")
    else:
        score_part = f"{rec} rec"
        if opt:
            score_part += f" / {opt} opt"
        parts.append(score_part)
        parts.append("run /skillforge:sf to review")

    if index_state == "stale":
        parts.append("(index stale)")

    return " · ".join(parts)


def main() -> None:
    # Wrap everything in a try/except so we NEVER crash SessionStart
    try:
        project_dir = Path(
            sys.argv[1] if len(sys.argv) > 1
            else os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
        ).resolve()

        profile = _load_profile(project_dir)
        if profile is None:
            _emit("SkillForge: project not detected, run /skillforge:sf")

        index, state = _load_index()
        if state == "missing":
            lang = profile.get("language") or "unknown"
            framework = profile.get("framework")
            fw = f" / {framework}" if framework else ""
            _emit(f"SkillForge: {lang}{fw} · index missing, run /skillforge:sf refresh")
        if state == "corrupt":
            _emit("SkillForge: index unreadable, run /skillforge:sf refresh")

        scores = _score_and_seed(profile, index, project_dir)
        if "error" in scores:
            lang = profile.get("language") or "unknown"
            _emit(f"SkillForge: {lang} · scoring failed, run /skillforge:sf")

        _emit(_format_summary(profile, state, scores))
    except SystemExit:
        raise  # _emit() calls sys.exit(0), let it through
    except Exception:
        # Absolute last-resort: print a generic fallback and exit 0.
        # Never crash the SessionStart hook chain.
        print(json.dumps({
            "additionalContext": "SkillForge: summary error, run /skillforge:sf",
        }))
        # Write the traceback to stderr so it lands in claude-code logs
        # without breaking stdout JSON parsing.
        sys.stderr.write(traceback.format_exc())
        sys.exit(0)


if __name__ == "__main__":
    main()
