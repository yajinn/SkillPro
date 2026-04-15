"""External CLI tool adapters."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Callable, List, Optional

from .base import AuditResult, Finding, decide_status, summarize


TIMEOUT_SECONDS = 30


def run_snyk(skill_dir: Path) -> Optional[AuditResult]:
    exe = shutil.which("snyk-agent-scan")
    if not exe:
        return None
    try:
        proc = subprocess.run(
            [exe, "--format", "json", str(skill_dir)],
            capture_output=True, text=True, timeout=TIMEOUT_SECONDS,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if proc.returncode not in (0, 1):
        return None
    try:
        doc = json.loads(proc.stdout)
    except (json.JSONDecodeError, ValueError):
        return None
    return _doc_to_result(doc, "snyk-agent-scan")


def run_skill_scanner(skill_dir: Path) -> Optional[AuditResult]:
    exe = shutil.which("skill-scanner")
    if not exe:
        return None
    try:
        proc = subprocess.run(
            [exe, "--json", str(skill_dir)],
            capture_output=True, text=True, timeout=TIMEOUT_SECONDS,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if proc.returncode not in (0, 1):
        return None
    try:
        doc = json.loads(proc.stdout)
    except (json.JSONDecodeError, ValueError):
        return None
    return _doc_to_result(doc, "skill-scanner")


def _doc_to_result(doc: dict, tool: str) -> AuditResult:
    findings: List[Finding] = []
    vulns = doc.get("vulnerabilities") or doc.get("findings") or []
    if not isinstance(vulns, list):
        vulns = []
    for v in vulns:
        if not isinstance(v, dict):
            continue
        severity = v.get("severity", "low")
        if severity not in ("info", "low", "medium", "high", "critical"):
            severity = "low"
        findings.append(Finding(
            severity=severity,
            rule=v.get("rule", v.get("id", "external")),
            file=v.get("from", v.get("file", "unknown")),
            line=v.get("line"),
            details=v.get("title", v.get("message", "external finding")),
        ))
    return AuditResult(
        status=decide_status(findings),
        tool=tool,
        findings=findings,
        details=summarize(findings),
    )


_TOOL_FNS: List[Callable[[Path], Optional[AuditResult]]] = [
    run_snyk,
    run_skill_scanner,
]


def run_external_tools(skill_dir: Path) -> List[AuditResult]:
    results: List[AuditResult] = []
    for fn in _TOOL_FNS:
        result = fn(skill_dir)
        if result is not None:
            results.append(result)
    return results
