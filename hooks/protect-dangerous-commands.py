#!/usr/bin/env python3
"""
SkillForge Hook: Dangerous Command Protection (PreToolUse: Bash)

Reads the Bash tool_input from stdin, matches the command string against a
curated blocklist, and exits with code 2 (blocking) when a destructive pattern
is detected. Exits 0 for every safe command and for every parse/edge-case error
— this hook never gets in the way of normal work, only stops obvious footguns.

Universal: does not depend on project language or framework. Same patterns for
Go, PHP, Python, Rust, JavaScript, etc.
"""

import json
import re
import sys

BLOCKED_PATTERNS = [
    # --- Destructive file operations ---
    (r"\brm\s+-[rRf]*r[rRf]*f[^\s]*\s+/(?:\s|$)",
     "rm -rf on filesystem root"),
    (r"\brm\s+-[rRf]*r[rRf]*f[^\s]*\s+~(?:\s|$)",
     "rm -rf on $HOME"),
    (r"\brm\s+-[rRf]*r[rRf]*f[^\s]*\s+\*",
     "rm -rf with unquoted wildcard"),
    (r"\brm\s+-[rRf]*r[rRf]*f[^\s]*\s+\.(?:\s|$)",
     "rm -rf on the current directory"),
    (r">\s*/dev/sd[a-z]",
     "writing directly to a disk device"),
    (r"\bmkfs\.",
     "formatting a filesystem"),
    (r"\bdd\s+if=",
     "low-level disk copy with dd"),

    # --- Git destructive ---
    (r"\bgit\s+push\s+(?:[^&;|]*\s)?--force(?!-with-lease)\b",
     "git push --force without --force-with-lease"),
    (r"\bgit\s+push\s+(?:[^&;|]*\s)?-f(?:\s|$)",
     "git push -f (use --force-with-lease)"),
    (r"\bgit\s+reset\s+--hard\s+origin\b",
     "git reset --hard to remote (drops local commits)"),
    (r"\bgit\s+clean\s+-[fdx]*f[fdx]*d",
     "git clean -fd (removes untracked files)"),
    (r"\bgit\s+checkout\s+(?:--|\.)",
     "git checkout -- / . (discards working changes)"),
    (r"\bgit\s+branch\s+-D\b",
     "git branch -D (force delete, no safety check)"),

    # --- SQL destructive ---
    (r"\bDROP\s+DATABASE\b",
     "DROP DATABASE"),
    (r"\bDROP\s+TABLE\s+(?!IF\s+EXISTS)",
     "DROP TABLE without IF EXISTS"),
    (r"\bTRUNCATE\s+TABLE\b",
     "TRUNCATE TABLE (irreversible)"),
    (r"\bDELETE\s+FROM\s+[\w.`\"]+\s*(?:;|$)",
     "DELETE without WHERE"),
    (r"\bUPDATE\s+[\w.`\"]+\s+SET\s+[^;]*?(?:;|$)(?!.*\bWHERE\b)",
     "UPDATE without WHERE"),

    # --- System permissions ---
    (r"\bchmod\s+-R\s+[0-7]*777",
     "chmod -R 777 (world-writable)"),
    (r"\bchown\s+-R\s+[^\s]+\s+/(?:\s|$)",
     "chown -R on filesystem root"),

    # --- Secret exfiltration via pipe ---
    (r"echo\s+[^|]*(?:password|secret|token|api[_-]?key|bearer)\b[^|]*\|",
     "piping a credential to another command"),
    (r"\bcurl\s+[^|]*-d\s+[^|]*(?:password|secret|token|api[_-]?key)",
     "sending a credential in a curl body"),

    # --- Package manager danger ---
    (r"\bnpm\s+publish\b(?!.*--dry-run)",
     "npm publish without --dry-run"),
    (r"\bcurl\s+[^|]*\|\s*(?:sudo\s+)?(?:bash|sh|zsh)\b",
     "piping remote content to a shell interpreter"),
]

MAX_LEN = 300  # truncate long commands in the error message


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        # Unparseable input is not our problem — don't block.
        sys.exit(0)

    if data.get("tool_name") != "Bash":
        sys.exit(0)

    command = (data.get("tool_input") or {}).get("command", "")
    if not command or not isinstance(command, str):
        sys.exit(0)

    for pattern, reason in BLOCKED_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            shown = command if len(command) <= MAX_LEN else command[:MAX_LEN] + "…"
            sys.stderr.write(
                "🚨 BLOCKED COMMAND (SkillForge guard)\n"
                f"Reason: {reason}\n"
                f"Command: {shown}\n\n"
                "If this is genuinely intended, explain the context to the user\n"
                "and wait for explicit approval before retrying.\n"
            )
            sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
