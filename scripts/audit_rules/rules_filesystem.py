"""Filesystem structure rule functions."""
from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import List

from .base import Finding


def scan_filesystem(root: Path) -> List[Finding]:
    findings: List[Finding] = []
    root = root.resolve()

    for entry in root.rglob("*"):
        if entry.is_symlink():
            try:
                target = (entry.parent / os.readlink(entry)).resolve()
            except OSError:
                continue
            try:
                target.relative_to(root)
            except ValueError:
                findings.append(Finding(
                    severity="critical",
                    rule="symlink-escape",
                    file=str(entry.relative_to(root)),
                    line=None,
                    details=f"symlink target escapes skill root: {target}",
                ))
            continue

        if not entry.is_file():
            continue

        try:
            st = entry.stat()
        except OSError:
            continue

        if st.st_mode & stat.S_ISUID:
            findings.append(Finding(
                severity="high",
                rule="setuid-file",
                file=str(entry.relative_to(root)),
                line=None,
                details=f"file has SUID bit set (mode {oct(st.st_mode)})",
            ))

        if st.st_mode & 0o111:
            rel = entry.relative_to(root)
            if "scripts" not in rel.parts:
                findings.append(Finding(
                    severity="low",
                    rule="executable-outside-scripts",
                    file=str(rel),
                    line=None,
                    details="executable bit set outside scripts/ directory",
                ))

        try:
            head = entry.read_bytes()[:512]
        except OSError:
            continue
        if head:
            if b"\x00" in head:
                findings.append(Finding(
                    severity="medium",
                    rule="binary-content",
                    file=str(entry.relative_to(root)),
                    line=None,
                    details="file contains null bytes in first 512 bytes",
                ))
            else:
                non_ascii = sum(1 for b in head if b > 127)
                if len(head) > 0 and non_ascii / len(head) > 0.30:
                    findings.append(Finding(
                        severity="medium",
                        rule="binary-content",
                        file=str(entry.relative_to(root)),
                        line=None,
                        details=f"high non-ASCII ratio: {non_ascii}/{len(head)}",
                    ))

    return findings
