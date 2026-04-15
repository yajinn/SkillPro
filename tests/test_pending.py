"""Tests for scripts/pending.py — the pre-checked checkbox staging area.

We patch PENDING_PATH to a temp file per test so nothing touches the real
~/.claude/skillforge directory. score.py / install_skill.py subprocess
calls are mocked through patching `pending._run_score` and
`pending.subprocess.run` so tests stay hermetic.
"""
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import pending  # noqa: E402


def _patch_pending_path(test_instance):
    tmp = tempfile.mkdtemp()
    path = Path(tmp) / "pending.json"
    p = patch.object(pending, "PENDING_PATH", path)
    p.start()
    def _cleanup():
        p.stop()
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
    test_instance.addCleanup(_cleanup)
    return path


def _capture(fn, *args):
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = fn(*args)
    return rc, buf.getvalue()


SAMPLE_SCORE_OUTPUT = {
    "skills": {
        "recommended": [
            {
                "id": "python-pro",
                "name": "Python Pro",
                "category": "language/python",
                "score": 100,
                "description": "Advanced Python patterns and idioms",
                "plugin": "anthropic-skills",
            },
            {
                "id": "fastapi-patterns",
                "name": "FastAPI Patterns",
                "category": "framework/fastapi",
                "score": 100,
                "description": "FastAPI-specific best practices",
                "plugin": "enrichment",
            },
        ],
        "optional": [
            {
                "id": "pytest-tips",
                "name": "Pytest Tips",
                "category": "quality/testing",
                "score": 5,
                "description": "Pytest patterns and fixtures",
                "plugin": "anthropic-skills",
            },
        ],
        "not_relevant": [],
    }
}


class TestSeed(unittest.TestCase):
    def setUp(self):
        self.path = _patch_pending_path(self)

    def test_seed_writes_pending_with_recommended_checked(self):
        with patch.object(pending, "_run_score", return_value=SAMPLE_SCORE_OUTPUT):
            rc, out = _capture(pending.cmd_seed, "/some/proj")
        self.assertEqual(rc, 0)
        self.assertTrue(self.path.exists())
        doc = json.loads(self.path.read_text())
        self.assertEqual(doc["version"], 1)
        self.assertEqual(len(doc["items"]), 3)
        # Recommended items pre-checked, optional unchecked
        by_id = {it["id"]: it for it in doc["items"]}
        self.assertTrue(by_id["python-pro"]["checked"])
        self.assertTrue(by_id["fastapi-patterns"]["checked"])
        self.assertFalse(by_id["pytest-tips"]["checked"])
        self.assertIn("2 checked", out)
        self.assertIn("3 total", out)

    def test_seed_overwrites_existing_pending(self):
        # Pre-seed with stale content
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({
            "version": 1, "generated_at": "2020-01-01T00:00:00Z",
            "project_dir": "/old", "items": [{"id": "old", "checked": True}],
        }))
        with patch.object(pending, "_run_score", return_value=SAMPLE_SCORE_OUTPUT):
            pending.cmd_seed("/some/proj")
        doc = json.loads(self.path.read_text())
        ids = {it["id"] for it in doc["items"]}
        self.assertNotIn("old", ids)
        self.assertIn("python-pro", ids)

    def test_seed_with_empty_recommendations(self):
        empty = {"skills": {"recommended": [], "optional": [], "not_relevant": []}}
        with patch.object(pending, "_run_score", return_value=empty):
            rc, _ = _capture(pending.cmd_seed, "/some/proj")
        self.assertEqual(rc, 0)
        doc = json.loads(self.path.read_text())
        self.assertEqual(doc["items"], [])


class TestRender(unittest.TestCase):
    def setUp(self):
        self.path = _patch_pending_path(self)

    def _seed(self):
        with patch.object(pending, "_run_score", return_value=SAMPLE_SCORE_OUTPUT):
            pending.cmd_seed("/proj")

    def test_render_groups_by_category(self):
        self._seed()
        rc, out = _capture(pending.cmd_render)
        self.assertEqual(rc, 0)
        self.assertIn("language/python", out)
        self.assertIn("framework/fastapi", out)
        self.assertIn("quality/testing", out)

    def test_render_uses_checkbox_syntax(self):
        self._seed()
        _, out = _capture(pending.cmd_render)
        # Pre-checked recommended items render as [x]
        self.assertIn("[x] **python-pro**", out)
        self.assertIn("[x] **fastapi-patterns**", out)
        # Optional items render as [ ]
        self.assertIn("[ ] **pytest-tips**", out)

    def test_render_with_no_pending_returns_error(self):
        rc, out = _capture(pending.cmd_render)
        self.assertEqual(rc, 1)
        self.assertIn("no pending", out)

    def test_render_other_category_sorts_last(self):
        # Item with no category → "other"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({
            "version": 1, "generated_at": "x", "project_dir": "/p",
            "items": [
                {"id": "a", "checked": True, "name": "A", "category": "other", "score": 1, "description": ""},
                {"id": "b", "checked": True, "name": "B", "category": "language/python", "score": 1, "description": ""},
            ],
        }))
        _, out = _capture(pending.cmd_render)
        self.assertLess(out.find("language/python"), out.find("## other"))


class TestSkipCheck(unittest.TestCase):
    def setUp(self):
        self.path = _patch_pending_path(self)
        with patch.object(pending, "_run_score", return_value=SAMPLE_SCORE_OUTPUT):
            pending.cmd_seed("/proj")

    def test_skip_unchecks_item(self):
        rc, _ = _capture(pending.cmd_skip, "python-pro")
        self.assertEqual(rc, 0)
        doc = json.loads(self.path.read_text())
        by_id = {it["id"]: it for it in doc["items"]}
        self.assertFalse(by_id["python-pro"]["checked"])

    def test_check_rechecks_skipped_item(self):
        pending.cmd_skip("python-pro")
        rc, _ = _capture(pending.cmd_check, "python-pro")
        self.assertEqual(rc, 0)
        doc = json.loads(self.path.read_text())
        by_id = {it["id"]: it for it in doc["items"]}
        self.assertTrue(by_id["python-pro"]["checked"])

    def test_skip_unknown_id_returns_error(self):
        rc, out = _capture(pending.cmd_skip, "nonexistent")
        self.assertEqual(rc, 1)
        self.assertIn("not found", out)

    def test_skip_with_no_pending_returns_error(self):
        pending.cmd_clear()
        rc, _ = _capture(pending.cmd_skip, "anything")
        self.assertEqual(rc, 1)


class TestConfirm(unittest.TestCase):
    def setUp(self):
        self.path = _patch_pending_path(self)
        with patch.object(pending, "_run_score", return_value=SAMPLE_SCORE_OUTPUT):
            pending.cmd_seed("/proj")

    def test_confirm_installs_only_checked(self):
        # python-pro and fastapi-patterns are checked; pytest-tips is not
        called_ids = []
        def fake_run(cmd, **kwargs):
            called_ids.append(cmd[-1])
            class R: returncode = 0; stdout = ""; stderr = ""
            return R()
        with patch.object(pending.subprocess, "run", side_effect=fake_run):
            rc, out = _capture(pending.cmd_confirm)
        self.assertEqual(rc, 0)
        self.assertEqual(set(called_ids), {"python-pro", "fastapi-patterns"})
        self.assertNotIn("pytest-tips", called_ids)
        self.assertIn("2 / 2", out)
        # Pending cleared on success
        self.assertFalse(self.path.exists())

    def test_confirm_keeps_pending_on_partial_failure(self):
        def fake_run(cmd, **kwargs):
            sid = cmd[-1]
            class R:
                returncode = 0 if sid == "python-pro" else 1
                stdout = ""
                stderr = "audit failed: critical"
            return R()
        with patch.object(pending.subprocess, "run", side_effect=fake_run):
            rc, out = _capture(pending.cmd_confirm)
        self.assertEqual(rc, 2)
        self.assertIn("failed: 1", out)
        self.assertIn("fastapi-patterns", out)
        # File stays so user can retry
        self.assertTrue(self.path.exists())

    def test_confirm_with_nothing_checked(self):
        pending.cmd_skip("python-pro")
        pending.cmd_skip("fastapi-patterns")
        rc, out = _capture(pending.cmd_confirm)
        self.assertEqual(rc, 0)
        self.assertIn("nothing to install", out)

    def test_confirm_without_pending_returns_error(self):
        pending.cmd_clear()
        rc, _ = _capture(pending.cmd_confirm)
        self.assertEqual(rc, 1)


class TestClearAndStatus(unittest.TestCase):
    def setUp(self):
        self.path = _patch_pending_path(self)

    def test_clear_removes_file(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text("{}")
        pending.cmd_clear()
        self.assertFalse(self.path.exists())

    def test_clear_when_no_file_is_noop(self):
        rc, out = _capture(pending.cmd_clear)
        self.assertEqual(rc, 0)
        self.assertIn("no pending", out)

    def test_status_with_pending(self):
        with patch.object(pending, "_run_score", return_value=SAMPLE_SCORE_OUTPUT):
            pending.cmd_seed("/proj")
        rc, out = _capture(pending.cmd_status)
        self.assertEqual(rc, 0)
        self.assertIn("2 checked", out)
        self.assertIn("3 total", out)


if __name__ == "__main__":
    unittest.main()
