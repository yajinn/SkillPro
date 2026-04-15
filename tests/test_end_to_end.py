"""End-to-end smoke test: run a local HTTP server serving a fake marketplace,
run the refresh + score + install pipeline against it, and assert that the
right skill files end up in a temp HOME."""
import contextlib
import http.server
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures"


def free_port() -> int:
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):  # silence access log
        pass


def serve(directory: Path, port: int):
    handler = lambda *a, **kw: QuietHandler(*a, directory=str(directory), **kw)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


class TestEndToEnd(unittest.TestCase):
    def test_full_pipeline(self):
        port = free_port()
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            web = tmp_path / "web"
            web.mkdir()

            # Generate marketplace.json with live port substituted and
            # commit_sha nulled out. The fixture hardcodes a placeholder sha
            # ("deadbeef1234") for unit tests, but here we do a real fetch
            # and want install to succeed — leaving commit_sha null disables
            # the tamper check for this smoke test. SHA enforcement is
            # already covered in test_install_skill.test_sha_mismatch_aborts.
            raw = (FIXTURES / "marketplace_sample.json").read_text()
            mp_doc = json.loads(raw.replace("$PORT", str(port)))
            for plugin in mp_doc["plugins"]:
                for skill in plugin["skills"]:
                    skill["commit_sha"] = None
            (web / "marketplace.json").write_text(json.dumps(mp_doc))

            # Serve a SKILL.md at each install_url path
            for skill_id in ("security-guardian", "git-safety"):
                skill_dir = web / skill_id
                skill_dir.mkdir()
                (skill_dir / "SKILL.md").write_bytes(
                    (FIXTURES / "skill_sample.md").read_bytes()
                )

            server = serve(web, port)
            try:
                time.sleep(0.1)  # let the server bind

                home = tmp_path / "home"
                (home / ".claude" / "skillforge").mkdir(parents=True)
                sources = {
                    "version": 1,
                    "defaults": [{
                        "type": "marketplace",
                        "name": "Local Fake",
                        "url": f"http://127.0.0.1:{port}/marketplace.json",
                        "require_audit": False,
                    }]
                }
                (home / ".claude" / "skillforge" / "sources.json").write_text(
                    json.dumps(sources)
                )

                env = os.environ.copy()
                env["HOME"] = str(home)

                # 1. Refresh
                r = subprocess.run(
                    [sys.executable, str(ROOT / "scripts" / "refresh_index.py"),
                     "--force", "--verbose"],
                    env=env, capture_output=True, text=True,
                )
                self.assertEqual(r.returncode, 0, r.stderr)
                index = json.loads(
                    (home / ".claude" / "skillforge" / "index.json").read_text()
                )
                ids = {s["id"] for s in index["skills"]}
                self.assertEqual(ids, {"security-guardian", "git-safety"})

                # 2. Fake project profile (cli-tool Go, matches PRD Phase 1-2 fixture)
                proj = tmp_path / "proj"
                (proj / ".claude").mkdir(parents=True)
                profile = {
                    "language": "go",
                    "framework": "cobra-cli",
                    "project_type": "cli-tool",
                    "characteristics": {
                        "cli_only": True,
                        "has_user_input": True,
                        "has_ci": True
                    },
                }
                (proj / ".claude" / "project-profile.json").write_text(json.dumps(profile))

                # 3. Score
                r = subprocess.run(
                    [sys.executable, str(ROOT / "scripts" / "score.py"), str(proj)],
                    env=env, capture_output=True, text=True,
                )
                self.assertEqual(r.returncode, 0, r.stderr)
                scored = json.loads(r.stdout)
                rec = [s["id"] for s in scored["skills"]["recommended"]]
                # Both sample skills have default_for: ["cli-tool"] so both recommend
                self.assertIn("security-guardian", rec)
                self.assertIn("git-safety", rec)

                # 4. Install
                r = subprocess.run(
                    [sys.executable, str(ROOT / "scripts" / "install_skill.py"),
                     "security-guardian"],
                    env=env, capture_output=True, text=True,
                )
                self.assertEqual(r.returncode, 0, r.stderr)
                installed = home / ".claude" / "skills" / "security-guardian" / "SKILL.md"
                self.assertTrue(installed.exists())
                selections = json.loads(
                    (home / ".claude" / "skillforge" / "selections.json").read_text()
                )
                self.assertTrue(selections["selections"]["security-guardian"]["enabled"])
            finally:
                server.shutdown()


if __name__ == "__main__":
    unittest.main()
