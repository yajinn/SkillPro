"""Regression test: score.py must read the federated index and still produce
the same shape of output that the /sf command expects."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class TestScoreV2(unittest.TestCase):
    def test_reads_federated_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "home"
            (home / ".claude" / "skillforge").mkdir(parents=True)
            index = {
                "version": 1,
                "skills": [
                    {
                        "id": "security-guardian",
                        "name": "Security Guardian",
                        "description": "",
                        "category": "security",
                        "tags": ["has_user_input", "has_api"],
                        "boost_when": [],
                        "penalize_when": [],
                        "default_for": ["backend-api"],
                        "match_language": None,
                        "match_framework": None,
                        "match_sub_framework": None,
                    }
                ],
            }
            (home / ".claude" / "skillforge" / "index.json").write_text(json.dumps(index))

            proj = Path(tmp) / "proj"
            (proj / ".claude").mkdir(parents=True)
            profile = {
                "language": "python",
                "framework": "fastapi",
                "sub_framework": None,
                "project_type": "backend-api",
                "characteristics": {
                    "has_api": True,
                    "has_user_input": True,
                },
            }
            (proj / ".claude" / "project-profile.json").write_text(json.dumps(profile))

            env = os.environ.copy()
            env["HOME"] = str(home)
            result = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "score.py"), str(proj)],
                env=env, capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            out = json.loads(result.stdout)
            rec_ids = [s["id"] for s in out["skills"]["recommended"]]
            self.assertIn("security-guardian", rec_ids)


if __name__ == "__main__":
    unittest.main()
