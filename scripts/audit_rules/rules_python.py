"""Python AST-based rule functions."""
from __future__ import annotations

import ast
from pathlib import Path
from typing import List

from .base import Finding
from . import patterns as p


def scan_python(path: Path, content: bytes) -> List[Finding]:
    findings: List[Finding] = []
    try:
        text = content.decode("utf-8", errors="replace")
    except Exception:
        return findings

    path_str = str(path)

    try:
        tree = ast.parse(text, filename=str(path))
    except SyntaxError as exc:
        return [Finding(
            severity="medium",
            rule="python-syntax-error",
            file=path_str,
            line=exc.lineno,
            details=f"could not parse: {exc.msg}",
        )]

    visitor = _RuleVisitor(path_str)
    visitor.visit(tree)

    if visitor.reads_env and visitor.imports_http_client:
        findings.append(Finding(
            severity="critical",
            rule="env-var-exfiltration-py",
            file=path_str,
            line=None,
            details="module reads os.environ and uses an HTTP client",
        ))

    findings.extend(visitor.findings)
    return findings


class _RuleVisitor(ast.NodeVisitor):
    def __init__(self, path_str: str):
        self.path = path_str
        self.findings: List[Finding] = []
        self.reads_env = False
        self.imports_http_client = False

    def visit_Import(self, node: ast.Import):
        for alias in node.names:
            if alias.name in p.PY_HTTP_CLIENT_MODULES:
                self.imports_http_client = True
            if alias.name in p.PY_DESERIALIZER_MODULES:
                self.findings.append(Finding(
                    severity="medium",
                    rule="suspicious-import",
                    file=self.path,
                    line=node.lineno,
                    details=f"imports low-level deserializer: {alias.name}",
                ))
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom):
        mod = node.module or ""
        if mod in p.PY_HTTP_CLIENT_MODULES:
            self.imports_http_client = True
        if mod in p.PY_DESERIALIZER_MODULES:
            self.findings.append(Finding(
                severity="medium",
                rule="suspicious-import",
                file=self.path,
                line=node.lineno,
                details=f"imports low-level deserializer: {mod}",
            ))
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute):
        if (isinstance(node.value, ast.Name)
                and node.value.id == "os"
                and node.attr == "environ"):
            self.reads_env = True
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call):
        func = node.func
        if isinstance(func, ast.Name) and func.id in p.PY_EVALEXEC_NAMES:
            self.findings.append(Finding(
                severity="high",
                rule="python-evalexec",
                file=self.path,
                line=node.lineno,
                details=f"direct call to {func.id} builtin",
            ))
        if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
            if func.value.id == "subprocess" and func.attr in ("run", "call", "Popen"):
                for kw in node.keywords:
                    if kw.arg == "shell":
                        val = kw.value
                        if isinstance(val, ast.Constant) and val.value is True:
                            self.findings.append(Finding(
                                severity="medium",
                                rule="subprocess-shell-true",
                                file=self.path,
                                line=node.lineno,
                                details="subprocess spawn with shell=True",
                            ))
        self.generic_visit(node)
