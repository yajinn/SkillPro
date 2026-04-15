"""Shell scanner rule functions."""
from __future__ import annotations

from pathlib import Path
from typing import List

from .base import Finding
from . import patterns as p


def _line_of(content: str, index: int) -> int:
    return content[:index].count("\n") + 1


def scan_shell(path: Path, content: bytes) -> List[Finding]:
    findings: List[Finding] = []
    try:
        text = content.decode("utf-8", errors="replace")
    except Exception:
        return findings

    path_str = str(path)

    rules = [
        ("curl-pipe-to-shell", "critical", p.PIPE_TO_SHELL_RE,
         "network download piped to shell interpreter"),
        ("env-var-exfiltration", "critical", p.ENV_EXFIL_SHELL_RE,
         "network upload references shell environment variable"),
        ("shell-evalexec-with-input", "high", p.SHELL_EVAL_WITH_INPUT_RE,
         "dynamic shell code evaluation on untrusted input"),
        ("rm-rf-suspicious", "high", p.RM_RF_SUSPICIOUS_RE,
         "destructive recursive delete of sensitive path"),
        ("network-download-execute", "critical", p.DOWNLOAD_EXECUTE_RE,
         "downloaded script chained into immediate execution"),
    ]

    for rule_id, severity, rx, details in rules:
        m = rx.search(text)
        if m:
            findings.append(Finding(
                severity=severity,
                rule=rule_id,
                file=path_str,
                line=_line_of(text, m.start()),
                details=details,
            ))

    return findings
