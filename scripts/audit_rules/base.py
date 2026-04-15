"""Base types for the audit gate: Finding, AuditResult, severity helpers."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import List, Optional


SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"]
_FAILING_SEVERITIES = {"high", "critical"}


@dataclass
class Finding:
    severity: str
    rule: str
    file: str
    line: Optional[int]
    details: str


@dataclass
class AuditResult:
    status: str
    tool: str
    findings: List[Finding] = field(default_factory=list)
    details: str = ""

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "tool": self.tool,
            "findings": [asdict(f) for f in self.findings],
            "details": self.details,
        }


def decide_status(findings: List[Finding]) -> str:
    for f in findings:
        if f.severity in _FAILING_SEVERITIES:
            return "failed"
    return "passed"


def summarize(findings: List[Finding]) -> str:
    if not findings:
        return "no findings"
    counts: dict = {}
    for f in findings:
        counts[f.severity] = counts.get(f.severity, 0) + 1
    ordered = [f"{counts[s]} {s}" for s in reversed(SEVERITY_ORDER) if s in counts]
    return ", ".join(ordered)


def merge_results(tier1: AuditResult, tier2_results: List[AuditResult]) -> AuditResult:
    all_findings: List[Finding] = list(tier1.findings)
    tool_count = 1
    for r in tier2_results:
        all_findings.extend(r.findings)
        tool_count += 1
    tool = "heuristic" if tool_count == 1 else "combined"
    return AuditResult(
        status=decide_status(all_findings),
        tool=tool,
        findings=all_findings,
        details=summarize(all_findings),
    )
