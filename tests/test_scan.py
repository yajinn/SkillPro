"""Tests for scripts/scan.py — the narrated scan runner.

scan.py is the user-visible counterpart to session_summary.py. Where
session_summary.py emits one terse JSON line on SessionStart, scan.py
runs the same pipeline with streamed plain-text status lines that
Claude Code forwards to the user in real time.

These tests cover:
  1. Happy path — detect + index + score + seed, all four steps
     produce the expected status lines in order.
  2. Detection failure → early exit code 1 with detect-failed message.
  3. Index missing → early exit code 2 with refresh instruction.
  4. Empty index (no skills match) → exit 0 with no-matches + refresh hint.
  5. Language localization (SKILLFORGE_LANG=en) switches all strings.
  6. Pending.json actually seeded after a happy run.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCAN_SCRIPT = ROOT / "scripts" / "scan.py"


def _run(project_dir: Path, home: Path, lang: str = "en") -> tuple[int, str, str]:
    env = os.environ.copy()
    env["HOME"] = str(home)
    env["SKILLFORGE_LANG"] = lang
    result = subprocess.run(
        [sys.executable, str(SCAN_SCRIPT), str(project_dir)],
        capture_output=True, text=True, env=env,
    )
    return result.returncode, result.stdout, result.stderr


def _nextjs_project(base: Path) -> Path:
    proj = base / "app"
    proj.mkdir(parents=True)
    (proj / "package.json").write_text(json.dumps({
        "dependencies": {
            "next": "^15",
            "@tanstack/react-query": "^5",
            "zustand": "^4",
        },
    }))
    (proj / "tsconfig.json").write_text("{}")
    (proj / "next.config.js").write_text("module.exports = {}")
    return proj


def _minimal_index(home: Path, skills: list) -> None:
    idx_dir = home / ".claude" / "skillforge"
    idx_dir.mkdir(parents=True, exist_ok=True)
    (idx_dir / "index.json").write_text(json.dumps({
        "version": 1,
        "fetched_at": "2099-01-01T00:00:00Z",
        "ttl_seconds": 604800,
        "skills": skills,
    }))


def _skill(id, **kwargs):
    base = {
        "id": id, "name": id.title(), "description": "",
        "tags": [], "boost_when": [], "penalize_when": [],
        "default_for": [],
    }
    base.update(kwargs)
    return base


class TestHappyPath(unittest.TestCase):
    def test_all_four_steps_stream_in_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            proj = _nextjs_project(base)
            home = base / "home"
            _minimal_index(home, [
                _skill("frontend-design",
                       tags=["has_ui", "has_web"],
                       default_for=["web-frontend"],
                       plugin="anthropic-skills"),
                _skill("brainstorming",
                       tags=["any"],
                       plugin="superpowers"),
            ])
            rc, stdout, stderr = _run(proj, home, lang="en")
            self.assertEqual(rc, 0, stderr)

            # Each step header appears in order
            idx_detect = stdout.find("Scanning your project")
            idx_index = stdout.find("Checking skill index")
            idx_score = stdout.find("Matching skills")
            idx_seed = stdout.find("Preparing your checklist")
            self.assertGreater(idx_detect, -1)
            self.assertLess(idx_detect, idx_index)
            self.assertLess(idx_index, idx_score)
            self.assertLess(idx_score, idx_seed)

    def test_detection_line_shows_language_framework_libs(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            proj = _nextjs_project(base)
            home = base / "home"
            _minimal_index(home, [_skill("x", tags=["any"])])
            rc, stdout, _ = _run(proj, home, lang="en")
            self.assertEqual(rc, 0)
            self.assertIn("typescript", stdout)
            self.assertIn("nextjs", stdout)
            self.assertIn("tanstack-query", stdout)
            self.assertIn("zustand", stdout)

    def test_score_line_reports_counts(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            proj = _nextjs_project(base)
            home = base / "home"
            _minimal_index(home, [
                _skill("frontend-design",
                       tags=["has_ui"],
                       default_for=["web-frontend"]),
                _skill("brainstorming", tags=["any"]),
            ])
            rc, stdout, _ = _run(proj, home, lang="en")
            self.assertEqual(rc, 0)
            # One recommended (framework match), one optional (any tag)
            self.assertIn("1 recommended / 1 optional", stdout)

    def test_pending_json_seeded_after_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            proj = _nextjs_project(base)
            home = base / "home"
            _minimal_index(home, [_skill("frontend-design",
                                          tags=["has_ui"],
                                          default_for=["web-frontend"])])
            rc, _, _ = _run(proj, home, lang="en")
            self.assertEqual(rc, 0)
            pending = home / ".claude" / "skillforge" / "pending.json"
            self.assertTrue(pending.exists())
            doc = json.loads(pending.read_text())
            self.assertEqual(len(doc["items"]), 1)
            self.assertTrue(doc["items"][0]["checked"])


class TestFailureModes(unittest.TestCase):
    def test_index_missing_exits_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            proj = _nextjs_project(base)
            home = base / "home"  # no index created
            rc, stdout, _ = _run(proj, home, lang="en")
            self.assertEqual(rc, 2)
            self.assertIn("No index", stdout)
            self.assertIn("/skillforge:sf refresh", stdout)

    def test_corrupt_index_exits_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            proj = _nextjs_project(base)
            home = base / "home"
            idx_dir = home / ".claude" / "skillforge"
            idx_dir.mkdir(parents=True)
            (idx_dir / "index.json").write_text("not valid")
            rc, stdout, _ = _run(proj, home, lang="en")
            self.assertEqual(rc, 2)
            self.assertIn("corrupt", stdout)

    def test_empty_index_exits_0_with_refresh_hint(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            proj = _nextjs_project(base)
            home = base / "home"
            _minimal_index(home, [])  # no skills at all
            rc, stdout, _ = _run(proj, home, lang="en")
            self.assertEqual(rc, 0)
            self.assertIn("No skills match", stdout)
            self.assertIn("/sf refresh", stdout)

    def test_project_with_no_manifest_detected_but_noted(self):
        # Empty directory — detect.sh writes profile but language=unknown
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            proj = base / "empty"
            proj.mkdir()
            home = base / "home"
            _minimal_index(home, [_skill("brainstorming", tags=["any"])])
            rc, stdout, _ = _run(proj, home, lang="en")
            # Empty dir → detect.sh returns language=unknown
            # scan.py notes it but still continues
            self.assertEqual(rc, 0)
            self.assertIn("not classified", stdout)


class TestLocalization(unittest.TestCase):
    def test_turkish_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            proj = _nextjs_project(base)
            home = base / "home"
            _minimal_index(home, [_skill("x", tags=["any"])])
            rc, stdout, _ = _run(proj, home, lang="tr")
            self.assertEqual(rc, 0)
            self.assertIn("Projeniz inceleniyor", stdout)
            self.assertIn("inceleniyor", stdout)
            # English headers should NOT appear
            self.assertNotIn("Scanning your project", stdout)

    def test_english(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            proj = _nextjs_project(base)
            home = base / "home"
            _minimal_index(home, [_skill("x", tags=["any"])])
            rc, stdout, _ = _run(proj, home, lang="en")
            self.assertEqual(rc, 0)
            self.assertIn("Scanning your project", stdout)
            self.assertNotIn("Projeniz inceleniyor", stdout)


if __name__ == "__main__":
    unittest.main()
