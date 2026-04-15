"""JS/TS regex-based rule functions."""
from __future__ import annotations

from pathlib import Path
from typing import List

from .base import Finding
from . import patterns as p


def _line_of(text: str, idx: int) -> int:
    return text[:idx].count("\n") + 1


def scan_js(path: Path, content: bytes) -> List[Finding]:
    findings: List[Finding] = []
    try:
        text = content.decode("utf-8", errors="replace")
    except Exception:
        return findings

    path_str = str(path)

    m = p.JS_DYNAMIC_EVAL_RE.search(text)
    if m:
        findings.append(Finding(
            severity="high",
            rule="js-dynamic-eval",
            file=path_str,
            line=_line_of(text, m.start()),
            details="direct call to the JS dynamic code-evaluation builtin",
        ))

    m = p.JS_FUNCTION_CONSTRUCTOR_RE.search(text)
    if m:
        findings.append(Finding(
            severity="high",
            rule="js-function-constructor",
            file=path_str,
            line=_line_of(text, m.start()),
            details="dynamic code synthesis via runtime constructor",
        ))

    for m in p.JS_FETCH_RE.finditer(text):
        host = m.group(1)
        if host not in p.JS_ALLOWED_HOSTS:
            findings.append(Finding(
                severity="medium",
                rule="js-fetch-unknown-origin",
                file=path_str,
                line=_line_of(text, m.start()),
                details=f"fetch to non-allowlisted host: {host}",
            ))
            break

    return findings
