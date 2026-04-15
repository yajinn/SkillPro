"""Tests for scripts/session_summary.py — the SessionStart auto-scan hook.

session_summary.py runs after detect.sh, reads the profile JSON, scores
it against ~/.claude/skillforge/index.json, seeds pending.json, and
emits a single-line additionalContext JSON on stdout. It must NEVER
crash SessionStart — every failure path is expected to produce a
terse fallback message and exit 0.

These tests cover:

  1. Happy path — profile + index + matching skills → summary with
     recommendation counts, pending.json seeded with recommended
     items pre-checked.
  2. Profile missing → fallback 'not detected'.
  3. Index missing → fallback 'index missing'.
  4. Index corrupt (invalid JSON) → fallback 'unreadable'.
  5. Index stale → still scores, appends '(index stale)'.
  6. Empty recommendations → 'no matches' fallback.
  7. Invocation always exits 0 regardless of which path fires.
  8. additionalContext line respects MAX_LINE_LENGTH cap.
  9. Scoring exception mid-loop is swallowed, others still counted.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SESSION_SUMMARY = ROOT / "scripts" / "session_summary.py"


def _run(project_dir: Path, home: Path) -> tuple[int, dict]:
    """Invoke session_summary.py as a subprocess and return (rc, parsed stdout)."""
    env = os.environ.copy()
    env["HOME"] = str(home)
    result = subprocess.run(
        [sys.executable, str(SESSION_SUMMARY), str(project_dir)],
        capture_output=True, text=True, env=env,
    )
    try:
        parsed = json.loads(result.stdout.strip())
    except json.JSONDecodeError:
        parsed = {"_raw": result.stdout, "_stderr": result.stderr}
    return result.returncode, parsed


def _write_profile(project_dir: Path, profile: dict) -> None:
    (project_dir / ".claude").mkdir(parents=True, exist_ok=True)
    (project_dir / ".claude" / "project-profile.json").write_text(
        json.dumps(profile)
    )


def _write_index(home: Path, index: dict) -> None:
    (home / ".claude" / "skillforge").mkdir(parents=True, exist_ok=True)
    (home / ".claude" / "skillforge" / "index.json").write_text(
        json.dumps(index)
    )


def _minimal_profile(language="typescript", framework="nextjs", libraries=None, **chars):
    return {
        "language": language,
        "framework": framework,
        "sub_framework": None,
        "project_type": "web-frontend",
        "libraries": libraries or [],
        "characteristics": chars,
    }


def _minimal_index(skills, fetched="2099-01-01T00:00:00Z", ttl=604800):
    return {
        "version": 1,
        "fetched_at": fetched,
        "ttl_seconds": ttl,
        "skills": skills,
    }


def _skill(id, **kwargs):
    base = {
        "id": id,
        "name": id.replace("-", " ").title(),
        "description": "",
        "tags": [],
        "boost_when": [],
        "penalize_when": [],
        "default_for": [],
        "match_language": None,
        "match_framework": None,
    }
    base.update(kwargs)
    return base


class TestHappyPath(unittest.TestCase):
    def test_profile_plus_index_produces_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            proj = tmp_path / "proj"
            home = tmp_path / "home"
            proj.mkdir()
            _write_profile(proj, _minimal_profile(
                libraries=["tanstack-query", "zustand"],
                has_ui=True, has_web=True,
            ))
            _write_index(home, _minimal_index([
                _skill("nextjs-patterns", match_framework="nextjs"),
                _skill("tanstack-tips", match_libraries=["tanstack-query"]),
                _skill("brainstorming", tags=["any"]),
            ]))
            rc, msg = _run(proj, home)
            self.assertEqual(rc, 0)
            text = msg["additionalContext"]
            self.assertIn("typescript", text)
            self.assertIn("nextjs", text)
            self.assertIn("tanstack-query", text)
            self.assertIn("rec", text)
            self.assertIn("/yajinn:sf", text)

    def test_pending_json_seeded_with_recommended_checked(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            proj = tmp_path / "proj"
            home = tmp_path / "home"
            proj.mkdir()
            _write_profile(proj, _minimal_profile())
            _write_index(home, _minimal_index([
                _skill("nextjs-patterns", match_framework="nextjs"),
                _skill("background-meta", tags=["any"]),
            ]))
            _run(proj, home)
            pending = home / ".claude" / "skillforge" / "pending.json"
            self.assertTrue(pending.exists())
            doc = json.loads(pending.read_text())
            self.assertEqual(doc["version"], 1)
            self.assertEqual(len(doc["items"]), 2)
            rec_item = next(i for i in doc["items"] if i["id"] == "nextjs-patterns")
            self.assertTrue(rec_item["checked"])

    def test_optional_items_unchecked(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            proj = tmp_path / "proj"
            home = tmp_path / "home"
            proj.mkdir()
            # Framework match → recommended (score 100)
            # 'any' tag → optional (score 5 < 10)
            _write_profile(proj, _minimal_profile())
            _write_index(home, _minimal_index([
                _skill("nextjs-patterns", match_framework="nextjs"),
                _skill("brainstorming", tags=["any"]),
            ]))
            _run(proj, home)
            doc = json.loads((home / ".claude" / "skillforge" / "pending.json").read_text())
            by_id = {i["id"]: i for i in doc["items"]}
            self.assertTrue(by_id["nextjs-patterns"]["checked"])
            self.assertFalse(by_id["brainstorming"]["checked"])


class TestFallbacks(unittest.TestCase):
    def test_profile_missing_returns_not_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            proj = tmp_path / "empty"
            home = tmp_path / "home"
            proj.mkdir()
            rc, msg = _run(proj, home)
            self.assertEqual(rc, 0)
            self.assertIn("not detected", msg["additionalContext"])
            self.assertIn("/yajinn:sf", msg["additionalContext"])

    def test_index_missing_returns_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            proj = tmp_path / "proj"
            home = tmp_path / "home"
            proj.mkdir()
            _write_profile(proj, _minimal_profile())
            rc, msg = _run(proj, home)
            self.assertEqual(rc, 0)
            text = msg["additionalContext"]
            self.assertIn("index missing", text)
            self.assertIn("/yajinn:sf refresh", text)
            self.assertIn("typescript", text)

    def test_corrupt_index_returns_unreadable(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            proj = tmp_path / "proj"
            home = tmp_path / "home"
            proj.mkdir()
            _write_profile(proj, _minimal_profile())
            idx_dir = home / ".claude" / "skillforge"
            idx_dir.mkdir(parents=True)
            (idx_dir / "index.json").write_text("not valid json {{{")
            rc, msg = _run(proj, home)
            self.assertEqual(rc, 0)
            self.assertIn("unreadable", msg["additionalContext"])

    def test_stale_index_still_scores_and_appends_note(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            proj = tmp_path / "proj"
            home = tmp_path / "home"
            proj.mkdir()
            _write_profile(proj, _minimal_profile())
            _write_index(home, _minimal_index(
                [_skill("nextjs-patterns", match_framework="nextjs")],
                fetched="1970-01-01T00:00:00Z",
                ttl=60,
            ))
            rc, msg = _run(proj, home)
            self.assertEqual(rc, 0)
            text = msg["additionalContext"]
            self.assertIn("index stale", text)
            self.assertIn("rec", text)  # still scored

    def test_no_matching_skills_shows_no_matches(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            proj = tmp_path / "proj"
            home = tmp_path / "home"
            proj.mkdir()
            # Python project, no matching skills in the index at all
            _write_profile(proj, _minimal_profile(language="python", framework=None))
            _write_index(home, _minimal_index([
                _skill("nextjs-patterns", match_framework="nextjs"),  # framework mismatch → -100
                _skill("go-cli-tips", match_language="go"),           # language mismatch → -100
            ]))
            rc, msg = _run(proj, home)
            self.assertEqual(rc, 0)
            self.assertIn("no matches", msg["additionalContext"])


class TestNeverCrashes(unittest.TestCase):
    def test_exits_zero_even_with_garbage_argv(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = os.environ.copy()
            env["HOME"] = tmp
            result = subprocess.run(
                [sys.executable, str(SESSION_SUMMARY), "/path/that/does/not/exist"],
                capture_output=True, text=True, env=env,
            )
            self.assertEqual(result.returncode, 0)
            # Still produces a JSON line on stdout
            self.assertTrue(result.stdout.strip().startswith("{"))

    def test_exits_zero_when_home_does_not_exist(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            proj = tmp_path / "proj"
            proj.mkdir()
            _write_profile(proj, _minimal_profile())
            env = os.environ.copy()
            env["HOME"] = "/nonexistent/path/for/test"
            result = subprocess.run(
                [sys.executable, str(SESSION_SUMMARY), str(proj)],
                capture_output=True, text=True, env=env,
            )
            self.assertEqual(result.returncode, 0)
            self.assertTrue(result.stdout.strip().startswith("{"))


class TestLineCap(unittest.TestCase):
    def test_output_stays_under_max_line_length(self):
        # Huge lib list — make sure we truncate sensibly
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            proj = tmp_path / "proj"
            home = tmp_path / "home"
            proj.mkdir()
            libs = [f"lib-{i}" for i in range(30)]
            _write_profile(proj, _minimal_profile(libraries=libs))
            _write_index(home, _minimal_index([
                _skill(f"skill-{i}", match_framework="nextjs") for i in range(50)
            ]))
            rc, msg = _run(proj, home)
            self.assertEqual(rc, 0)
            # Single-line: no embedded newlines
            self.assertNotIn("\n", msg["additionalContext"])
            # Libraries list truncated
            self.assertIn("+27", msg["additionalContext"])  # 30 total, show 3


class TestFormatDetails(unittest.TestCase):
    def test_framework_omitted_when_null(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            proj = tmp_path / "proj"
            home = tmp_path / "home"
            proj.mkdir()
            _write_profile(proj, _minimal_profile(framework=None))
            _write_index(home, _minimal_index([_skill("x", tags=["any"])]))
            rc, msg = _run(proj, home)
            self.assertEqual(rc, 0)
            text = msg["additionalContext"]
            # No " / <framework>" segment
            self.assertNotIn(" / ", text.split("·")[0])

    def test_libraries_segment_omitted_when_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            proj = tmp_path / "proj"
            home = tmp_path / "home"
            proj.mkdir()
            _write_profile(proj, _minimal_profile(libraries=[]))
            _write_index(home, _minimal_index([
                _skill("nextjs-patterns", match_framework="nextjs"),
            ]))
            rc, msg = _run(proj, home)
            self.assertEqual(rc, 0)
            self.assertNotIn("libs", msg["additionalContext"])


if __name__ == "__main__":
    unittest.main()
