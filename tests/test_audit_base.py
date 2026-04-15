"""Tests for audit_rules.base: Finding, AuditResult, decide_status, merge_results."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from audit_rules.base import (  # noqa: E402
    AuditResult, Finding, SEVERITY_ORDER, decide_status, merge_results,
)


class TestSeverityOrder(unittest.TestCase):
    def test_order(self):
        self.assertEqual(SEVERITY_ORDER[0], "info")
        self.assertEqual(SEVERITY_ORDER[-1], "critical")
        self.assertEqual(len(SEVERITY_ORDER), 5)


class TestFinding(unittest.TestCase):
    def test_basic(self):
        f = Finding(severity="high", rule="r1", file="x.md", line=3, details="bad")
        self.assertEqual(f.severity, "high")
        self.assertEqual(f.rule, "r1")


class TestDecideStatus(unittest.TestCase):
    def test_no_findings_passes(self):
        self.assertEqual(decide_status([]), "passed")

    def test_only_low_info_passes(self):
        fs = [Finding("low", "r", "f", None, "d"),
              Finding("info", "r", "f", None, "d")]
        self.assertEqual(decide_status(fs), "passed")

    def test_medium_only_passes(self):
        self.assertEqual(decide_status([Finding("medium", "r", "f", None, "d")]), "passed")

    def test_high_fails(self):
        self.assertEqual(decide_status([Finding("high", "r", "f", None, "d")]), "failed")

    def test_critical_fails(self):
        self.assertEqual(decide_status([Finding("critical", "r", "f", None, "d")]), "failed")

    def test_mixed_critical_wins(self):
        fs = [Finding("low", "r", "f", None, "d"),
              Finding("critical", "r", "f", None, "d")]
        self.assertEqual(decide_status(fs), "failed")


class TestAuditResultToDict(unittest.TestCase):
    def test_shape(self):
        r = AuditResult(
            status="passed", tool="heuristic",
            findings=[Finding("low", "r", "f", 1, "d")],
            details="summary",
        )
        d = r.to_dict()
        self.assertEqual(d["status"], "passed")
        self.assertEqual(d["tool"], "heuristic")
        self.assertEqual(d["details"], "summary")
        self.assertEqual(len(d["findings"]), 1)
        self.assertEqual(d["findings"][0]["rule"], "r")


class TestMergeResults(unittest.TestCase):
    def _tier1(self, findings=None):
        return AuditResult("passed", "heuristic", findings or [], "")

    def _tier2(self, tool, findings=None):
        return AuditResult("passed", tool, findings or [], "")

    def test_no_tier2_keeps_heuristic_label(self):
        t1 = self._tier1([Finding("low", "r", "f", None, "d")])
        merged = merge_results(t1, [])
        self.assertEqual(merged.tool, "heuristic")
        self.assertEqual(len(merged.findings), 1)

    def test_with_tier2_uses_combined_label(self):
        t1 = self._tier1()
        t2 = self._tier2("snyk-agent-scan", [Finding("high", "r", "f", None, "d")])
        merged = merge_results(t1, [t2])
        self.assertEqual(merged.tool, "combined")
        self.assertEqual(merged.status, "failed")
        self.assertEqual(len(merged.findings), 1)

    def test_multi_tier2_all_findings_preserved(self):
        t1 = self._tier1([Finding("low", "r1", "f", None, "d")])
        t2a = self._tier2("snyk-agent-scan", [Finding("medium", "r2", "f", None, "d")])
        t2b = self._tier2("skill-scanner", [Finding("info", "r3", "f", None, "d")])
        merged = merge_results(t1, [t2a, t2b])
        self.assertEqual(len(merged.findings), 3)
        self.assertEqual(merged.status, "passed")
        self.assertEqual(merged.tool, "combined")


if __name__ == "__main__":
    unittest.main()
