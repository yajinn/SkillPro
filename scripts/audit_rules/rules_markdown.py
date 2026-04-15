"""Markdown scanner rule functions."""
from __future__ import annotations

from pathlib import Path
from typing import List

from .base import Finding
from . import patterns as p


def _line_of(content: str, index: int) -> int:
    return content[:index].count("\n") + 1


def scan_markdown(path: Path, content: bytes) -> List[Finding]:
    findings: List[Finding] = []
    try:
        text = content.decode("utf-8", errors="replace")
    except Exception:
        return findings

    path_str = str(path)

    for rx in p.PROMPT_INJECTION_PHRASES:
        m = rx.search(text)
        if m:
            findings.append(Finding(
                severity="high",
                rule="prompt-injection-keyword",
                file=path_str,
                line=_line_of(text, m.start()),
                details="matched injection phrase",
            ))
            break

    for ch in p.INVISIBLE_CHARS:
        if ch in text:
            idx = text.index(ch)
            findings.append(Finding(
                severity="medium",
                rule="invisible-characters",
                file=path_str,
                line=_line_of(text, idx),
                details=f"invisible character U+{ord(ch):04X}",
            ))
            break

    m = p.BASE64_BLOB_RE.search(text)
    if m:
        findings.append(Finding(
            severity="medium",
            rule="base64-blob",
            file=path_str,
            line=_line_of(text, m.start()),
            details=f"base64-like run of {m.end() - m.start()} chars",
        ))

    for m in p.HIDDEN_HTML_COMMENT_RE.finditer(text):
        body = m.group(1)
        if p.HTML_COMMENT_IMPERATIVE_RE.search(body):
            findings.append(Finding(
                severity="high",
                rule="hidden-html-comment-directive",
                file=path_str,
                line=_line_of(text, m.start()),
                details="HTML comment contains imperative verb",
            ))
            break

    m = p.SUSPICIOUS_URL_SCHEME_RE.search(text)
    if m:
        findings.append(Finding(
            severity="high",
            rule="suspicious-url-scheme",
            file=path_str,
            line=_line_of(text, m.start()),
            details=f"suspicious URL scheme: {m.group(0)}",
        ))

    return findings
