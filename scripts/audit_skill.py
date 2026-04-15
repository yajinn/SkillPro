#!/usr/bin/env python3
"""SkillForge audit gate — public entry points.

Exports:
    audit(path)       -> AuditResult object
    audit_file(path)  -> dict (backward compat)

Both accept a directory or a single file. When given a file, the parent
directory is scanned so the full skill context is evaluated.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Dict, Union

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from audit_rules.base import AuditResult, merge_results  # noqa: E402
from audit_rules.heuristic import scan as heuristic_scan  # noqa: E402
from audit_rules.external import run_external_tools  # noqa: E402


def audit(target: Union[str, Path]) -> AuditResult:
    path = Path(target)
    if not path.exists():
        return AuditResult(
            status="failed", tool="none",
            details=f"path does not exist: {path}",
        )
    scan_root = path if path.is_dir() else path.parent
    tier1 = heuristic_scan(scan_root)
    tier2 = run_external_tools(scan_root)
    return merge_results(tier1, tier2)


def audit_file(path: str) -> Dict:
    """Backward-compat wrapper returning a dict."""
    return audit(path).to_dict()


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: audit_skill.py <path>", file=sys.stderr)
        return 2
    result = audit(sys.argv[1])
    print(json.dumps(result.to_dict(), indent=2))
    return 0 if result.status == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
