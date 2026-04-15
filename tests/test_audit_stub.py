"""Regression tests: audit gate public API on clean + malicious fixtures."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from audit_skill import audit, audit_file  # noqa: E402

CLEAN = ROOT / "tests" / "fixtures" / "audit" / "clean"
MAL = ROOT / "tests" / "fixtures" / "audit" / "malicious"


class TestAuditPublic(unittest.TestCase):
    def test_clean_dir_passes(self):
        r = audit(CLEAN)
        self.assertEqual(r.status, "passed")
        self.assertEqual(r.tool, "heuristic")
        self.assertEqual(r.findings, [])

    def test_clean_file_scans_parent(self):
        r = audit(CLEAN / "SKILL.md")
        self.assertEqual(r.status, "passed")

    def test_audit_file_dict_shape(self):
        d = audit_file(str(CLEAN))
        self.assertIn("status", d)
        self.assertIn("tool", d)
        self.assertIn("findings", d)
        self.assertIn("details", d)
        self.assertEqual(d["status"], "passed")

    def test_nonexistent_path_fails(self):
        r = audit(ROOT / "tests" / "fixtures" / "audit" / "does-not-exist")
        self.assertEqual(r.status, "failed")
        self.assertEqual(r.tool, "none")

    def test_malicious_prompt_injection_fails(self):
        r = audit(MAL / "prompt-injection")
        self.assertEqual(r.status, "failed")
        rule_ids = {f.rule for f in r.findings}
        self.assertIn("prompt-injection-keyword", rule_ids)

    def test_malicious_curl_pipe_shell_fails(self):
        r = audit(MAL / "curl-pipe-shell")
        self.assertEqual(r.status, "failed")
        self.assertIn("curl-pipe-to-shell", {f.rule for f in r.findings})

    def test_malicious_env_exfil_py_fails(self):
        r = audit(MAL / "env-exfil-py")
        self.assertEqual(r.status, "failed")
        self.assertIn("env-var-exfiltration-py", {f.rule for f in r.findings})

    def test_invisible_chars_alone_passes(self):
        # Medium-only finding should not fail the status.
        r = audit(MAL / "invisible-chars")
        self.assertEqual(r.status, "passed")
        self.assertIn("invisible-characters", {f.rule for f in r.findings})


if __name__ == "__main__":
    unittest.main()
