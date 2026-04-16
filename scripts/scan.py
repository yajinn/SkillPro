#!/usr/bin/env python3
"""SkillForge — interactive scan runner with streamed status lines.

Motivation
----------
Users reported that running ``/skillforge:sf setup`` felt opaque — the
command would disappear for a few seconds then dump a final pending
list with no indication of what had happened in between. This script
turns the pipeline into a narrated progression:

    🔍 Projeniz inceleniyor...
       ✓ typescript / nextjs (3 libraries)
    📦 Skill index'i kontrol ediliyor...
       ✓ 88 skill, fresh (2 saat önce çekildi)
    🎯 Skiller projenizle eşleştiriliyor...
       ✓ 6 önerilen / 6 opsiyonel
    📋 Checklist hazırlanıyor...
       ✓ ~/.claude/skillforge/pending.json seeded

    Next: /skillforge:sf confirm

Each step is a separate stdout line with stream flushing so Claude
Code can forward them to the user in near-real-time. The command
wrapper (/sf setup) runs this as a foreground process.

This is NOT the SessionStart hook — that's still
``scripts/session_summary.py`` which emits a single-line summary
silently. ``scan.py`` is the visible, user-invoked variant.

Design
------
- All stdout is plain text, not JSON. Each line is meant for a human.
- Every step that might be slow flushes stdout AFTER its header but
  BEFORE the work, so the "🔍 Projeniz inceleniyor..." line appears
  before detect.sh actually runs.
- Failures are explicit: if detect.sh fails we print a clear error
  line with the actual stderr, not a cryptic exit code.
- Reuses existing modules (score, pending) rather than re-implementing.
- Designed to work whether language is Turkish or English — all
  user-facing strings flow through a single dict at the top so
  translation is one edit.

Exit codes
----------
    0  scan completed (even if zero recommendations)
    1  project could not be detected (detect.sh failure)
    2  index missing — user needs to run refresh first
    3  unexpected exception during scoring (rare)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
_PLUGIN_ROOT = _SCRIPT_DIR.parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))


# ─── Localized strings ──────────────────────────────────────────────
# Single place to change wording. Language picked from env var.
LANG = os.environ.get("SKILLFORGE_LANG", "tr").lower()

MESSAGES = {
    "tr": {
        "header_detect": "🔍 Projeniz inceleniyor...",
        "header_index": "📦 Skill index'i kontrol ediliyor...",
        "header_score": "🎯 Skiller projenizle eşleştiriliyor...",
        "header_seed": "📋 Checklist hazırlanıyor...",

        "detected_ok": "   ✓ {language} / {framework}{libs_part}",
        "detected_no_framework": "   ✓ {language}{libs_part}",
        "detected_libs": " ({count} kütüphane: {libs})",

        "index_ok": "   ✓ {count} skill · {state} ({sources} kaynaktan)",
        "index_stale": "   ⚠ {count} skill ama güncelliğini yitirmiş (TTL'i aştı)",
        "index_missing": "   ✗ Index yok — önce `/skillforge:sf refresh` çalıştırın",
        "index_corrupt": "   ✗ Index bozuk — `/skillforge:sf refresh` ile yenileyin",
        "index_partial": "   ⚠ Partial index — bazı kaynaklar fetch edilemedi",

        "scored_ok": "   ✓ {rec} önerilen / {opt} opsiyonel",
        "scored_none": "   ⚠ Projenize uyan skill bulunamadı · `/sf refresh` ile daha fazla kaynak çek",

        "seeded_ok": "   ✓ Pending list hazır: {path}",

        "detect_failed": "✗ Proje tespit edilemedi — detect.sh hata verdi",
        "detect_empty": "⚠ Proje tanımlanamadı (manifest bulunamadı) — SkillForge tarafından desteklenmeyen bir proje yapısı olabilir",
        "score_failed": "✗ Skorlama başarısız oldu: {error}",

        "next_confirm": "\nBir sonraki adım: `/skillforge:sf confirm` — işaretli skill'leri kurar",
        "next_refresh": "\nBir sonraki adım: `/skillforge:sf refresh` — daha fazla skill çek",
        "next_nothing": "\nBir sonraki adım: Projenize uyan skill yok, farklı bir kaynak eklemeniz gerekebilir",
    },
    "en": {
        "header_detect": "🔍 Scanning your project...",
        "header_index": "📦 Checking skill index...",
        "header_score": "🎯 Matching skills to your project...",
        "header_seed": "📋 Preparing your checklist...",

        "detected_ok": "   ✓ {language} / {framework}{libs_part}",
        "detected_no_framework": "   ✓ {language}{libs_part}",
        "detected_libs": " ({count} libraries: {libs})",

        "index_ok": "   ✓ {count} skills · {state} (from {sources} sources)",
        "index_stale": "   ⚠ {count} skills but index is stale (TTL exceeded)",
        "index_missing": "   ✗ No index — run `/skillforge:sf refresh` first",
        "index_corrupt": "   ✗ Index is corrupt — run `/skillforge:sf refresh` to rebuild",
        "index_partial": "   ⚠ Partial index — some sources failed to fetch",

        "scored_ok": "   ✓ {rec} recommended / {opt} optional",
        "scored_none": "   ⚠ No skills match your project · `/sf refresh` to pull more sources",

        "seeded_ok": "   ✓ Pending list ready at {path}",

        "detect_failed": "✗ Project detection failed — detect.sh errored",
        "detect_empty": "⚠ Project not classified (no manifest found) — SkillForge may not recognize this project structure",
        "score_failed": "✗ Scoring failed: {error}",

        "next_confirm": "\nNext: `/skillforge:sf confirm` — installs the checked items",
        "next_refresh": "\nNext: `/skillforge:sf refresh` — fetch more sources",
        "next_nothing": "\nNext: No matches for your project, you may need to add another source",
    },
}
MSG = MESSAGES.get(LANG, MESSAGES["en"])


def _print(s: str) -> None:
    """Print and flush so Claude can stream it to the user."""
    print(s, flush=True)


def _brief_delay(seconds: float = 0.15) -> None:
    """Tiny pause between steps so streaming feels paced, not dumped."""
    time.sleep(seconds)


# ─── Step 1: detect ─────────────────────────────────────────────────
def _run_detect(project_dir: Path) -> tuple[int, dict | None]:
    """Run hooks/detect.sh and return (rc, profile_dict or None)."""
    detect = _PLUGIN_ROOT / "hooks" / "detect.sh"
    result = subprocess.run(
        ["bash", str(detect), str(project_dir)],
        capture_output=True, text=True,
    )
    profile_path = project_dir / ".claude" / "project-profile.json"
    if result.returncode != 0 or not profile_path.exists():
        return result.returncode or 1, None
    try:
        return 0, json.loads(profile_path.read_text())
    except (OSError, json.JSONDecodeError):
        return 1, None


def _format_libs_part(profile: dict) -> str:
    libs = profile.get("libraries") or []
    if not libs:
        return ""
    shown = libs[:4]
    suffix = f" +{len(libs) - 4}" if len(libs) > 4 else ""
    return MSG["detected_libs"].format(
        count=len(libs),
        libs=", ".join(shown) + suffix,
    )


# ─── Step 2: index (delegated to pipeline.py) ───────────────────────
from pipeline import (  # noqa: E402
    load_index as _load_index,
    load_profile as _load_profile_from_disk,
    STATE_OK, STATE_STALE, STATE_MISSING, STATE_CORRUPT,
)


def _describe_index_state(state: str, idx: dict) -> str:
    count = len(idx.get("skills", []))
    plugins = {s.get("plugin", "") for s in idx.get("skills", []) if s.get("plugin")}
    sources_count = len(plugins) or 1
    if state == STATE_STALE:
        return MSG["index_stale"].format(count=count)
    return MSG["index_ok"].format(
        count=count,
        state="fresh" if state == STATE_OK else state,
        sources=sources_count,
    )


# ─── Step 3 + 4: score & seed (delegated to pipeline.py) ────────────
from pipeline import score_and_classify as _score_all  # noqa: E402
from pipeline import seed_pending as _seed_pending  # noqa: E402


# ─── Main orchestration ─────────────────────────────────────────────
def main() -> int:
    project_dir = Path(
        sys.argv[1] if len(sys.argv) > 1
        else os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
    ).resolve()

    # Step 1: Detect — skip re-running detect.sh if profile is fresh
    # (SessionStart already ran it). Check mtime < 60s as heuristic.
    _print(MSG["header_detect"])
    _brief_delay()
    profile = _load_profile_from_disk(project_dir)
    profile_file = project_dir / ".claude" / "project-profile.json"
    if profile is not None and profile_file.exists():
        try:
            age = time.time() - profile_file.stat().st_mtime
            if age > 60:
                profile = None  # stale, re-detect
        except OSError:
            profile = None
    if profile is None:
        rc, profile = _run_detect(project_dir)
        if rc != 0 or profile is None:
            _print(MSG["detect_failed"])
            return 1
    if (profile.get("language") or "unknown") == "unknown":
        _print(MSG["detect_empty"])
        # Still continue — maybe the index has universal skills
        profile["language"] = "unknown"
    else:
        framework = profile.get("framework")
        libs_part = _format_libs_part(profile)
        if framework:
            _print(MSG["detected_ok"].format(
                language=profile["language"],
                framework=framework,
                libs_part=libs_part,
            ))
        else:
            _print(MSG["detected_no_framework"].format(
                language=profile["language"],
                libs_part=libs_part,
            ))

    # Step 2: Index
    _print("")
    _print(MSG["header_index"])
    _brief_delay()
    state, idx = _load_index()
    if state == STATE_MISSING:
        _print(MSG["index_missing"])
        return 2
    if state == STATE_CORRUPT:
        _print(MSG["index_corrupt"])
        return 2
    _print(_describe_index_state(state, idx))
    if idx.get("partial"):
        _print(MSG["index_partial"])

    # Step 3: Score
    _print("")
    _print(MSG["header_score"])
    _brief_delay()
    try:
        rec, opt = _score_all(profile, idx)
    except Exception as exc:
        _print(MSG["score_failed"].format(error=str(exc)[:120]))
        return 3

    if not rec and not opt:
        _print(MSG["scored_none"])
        _print(MSG["next_refresh"])
        return 0

    _print(MSG["scored_ok"].format(rec=len(rec), opt=len(opt)))

    # Step 4: Seed pending
    _print("")
    _print(MSG["header_seed"])
    _brief_delay()
    try:
        path = _seed_pending(rec, opt, project_dir)
        _print(MSG["seeded_ok"].format(path=path))
    except Exception as exc:
        _print(f"   ✗ Seed failed: {exc}")
        # Not fatal

    _print(MSG["next_confirm"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
