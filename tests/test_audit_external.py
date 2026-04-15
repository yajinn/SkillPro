"""Tests for external tool adapters (mocked subprocess)."""
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from audit_rules import external  # noqa: E402


class FakeProc:
    def __init__(self, returncode, stdout=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = ""


class TestSnykAdapter(unittest.TestCase):
    def test_returns_none_when_tool_missing(self):
        with patch("audit_rules.external.shutil.which", return_value=None):
            self.assertIsNone(external.run_snyk(Path("/tmp")))

    def test_parses_high_finding(self):
        doc = {
            "vulnerabilities": [
                {"severity": "high", "title": "dynamic eval on user input",
                 "from": "scripts/x.py", "line": 12}
            ]
        }
        with patch("audit_rules.external.shutil.which", return_value="/bin/fake-snyk"):
            with patch("audit_rules.external.subprocess.run",
                       return_value=FakeProc(1, json.dumps(doc))):
                result = external.run_snyk(Path("/tmp"))
        self.assertIsNotNone(result)
        self.assertEqual(result.status, "failed")
        self.assertEqual(result.tool, "snyk-agent-scan")
        self.assertEqual(len(result.findings), 1)
        self.assertEqual(result.findings[0].severity, "high")

    def test_clean_scan_returns_passed(self):
        doc = {"vulnerabilities": []}
        with patch("audit_rules.external.shutil.which", return_value="/bin/fake"):
            with patch("audit_rules.external.subprocess.run",
                       return_value=FakeProc(0, json.dumps(doc))):
                result = external.run_snyk(Path("/tmp"))
        self.assertIsNotNone(result)
        self.assertEqual(result.status, "passed")
        self.assertEqual(result.findings, [])

    def test_tool_error_returns_none(self):
        with patch("audit_rules.external.shutil.which", return_value="/bin/fake"):
            with patch("audit_rules.external.subprocess.run",
                       return_value=FakeProc(2, "")):
                self.assertIsNone(external.run_snyk(Path("/tmp")))

    def test_malformed_json_returns_none(self):
        with patch("audit_rules.external.shutil.which", return_value="/bin/fake"):
            with patch("audit_rules.external.subprocess.run",
                       return_value=FakeProc(0, "not json")):
                self.assertIsNone(external.run_snyk(Path("/tmp")))


class TestOrchestrator(unittest.TestCase):
    def test_empty_when_no_tools_installed(self):
        with patch("audit_rules.external.shutil.which", return_value=None):
            self.assertEqual(external.run_external_tools(Path("/tmp")), [])


if __name__ == "__main__":
    unittest.main()
