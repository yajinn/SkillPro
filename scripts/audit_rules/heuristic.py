"""Tier 1 heuristic scanner orchestrator."""
from __future__ import annotations

from pathlib import Path
from typing import List

from .base import AuditResult, Finding, decide_status, summarize
from .rules_markdown import scan_markdown
from .rules_shell import scan_shell
from .rules_python import scan_python
from .rules_js import scan_js
from .rules_filesystem import scan_filesystem


_MARKDOWN_EXTS = {".md", ".markdown"}
_SHELL_EXTS = {".sh", ".bash", ".zsh"}
_PY_EXTS = {".py"}
_JS_EXTS = {".js", ".ts", ".mjs", ".cjs", ".jsx", ".tsx"}


def scan(root: Path) -> AuditResult:
    root = Path(root).resolve()
    findings: List[Finding] = []

    findings.extend(scan_filesystem(root))

    for entry in root.rglob("*"):
        if entry.is_symlink() or not entry.is_file():
            continue
        ext = entry.suffix.lower()
        try:
            content = entry.read_bytes()
        except OSError:
            continue

        if ext in _MARKDOWN_EXTS or entry.name.upper() == "SKILL.MD":
            findings.extend(scan_markdown(entry, content))
        elif ext in _SHELL_EXTS:
            findings.extend(scan_shell(entry, content))
        elif ext in _PY_EXTS:
            findings.extend(scan_python(entry, content))
        elif ext in _JS_EXTS:
            findings.extend(scan_js(entry, content))

    return AuditResult(
        status=decide_status(findings),
        tool="heuristic",
        findings=findings,
        details=summarize(findings),
    )
