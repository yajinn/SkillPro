#!/usr/bin/env python3
"""
Claude Code Hook: Dangerous Command Protection
Blocks destructive bash commands that could cause data loss or security issues.
"""

import json
import sys
import re

BLOCKED_PATTERNS = [
    # Destructive file operations
    (r"rm\s+-rf\s+[/~]", "Recursive force-delete on root or home directory"),
    (r"rm\s+-rf\s+\.", "Recursive force-delete on current directory"),
    (r"rm\s+-rf\s+\*", "Recursive force-delete with wildcard"),
    (r">\s*/dev/sd", "Writing directly to disk device"),
    (r"mkfs\.", "Formatting filesystem"),
    (r"dd\s+if=", "Low-level disk copy (potentially destructive)"),

    # Git destructive operations
    (r"git\s+push\s+.*--force(?!\-with-lease)", "Force push without lease protection"),
    (r"git\s+push\s+-f\b", "Force push (use --force-with-lease instead)"),
    (r"git\s+reset\s+--hard\s+origin", "Hard reset to remote (loses local changes)"),
    (r"git\s+clean\s+-fd", "Force clean untracked files"),

    # Database destructive
    (r"DROP\s+DATABASE", "Dropping entire database"),
    (r"DROP\s+TABLE\s+(?!IF\s+EXISTS)", "Dropping table without IF EXISTS"),
    (r"TRUNCATE\s+TABLE", "Truncating table (irreversible)"),
    (r"DELETE\s+FROM\s+\w+\s*(?:;|$)", "DELETE without WHERE clause"),

    # System dangerous
    (r"chmod\s+-R\s+777", "Setting world-writable permissions recursively"),
    (r"chown\s+-R\s+.*\s+/(?:$|\s)", "Recursive ownership change on root"),

    # Secret exposure
    (r"echo\s+.*(?:password|secret|token|api_key).*\|", "Piping secrets to another command"),
    (r"curl.*-d.*(?:password|secret|token)", "Sending secrets in curl request"),

    # npm/package dangerous
    (r"npm\s+publish\s+(?!--dry-run)", "Publishing to npm (use --dry-run first)"),
    (r"npx\s+[^\s]+@latest\s+init\s+--force", "Force-initializing over existing project"),
]

# Commands that are blocked in production-like directories
PROD_BLOCKED = [
    (r"npm\s+install\s+(?!--save-dev)", "Installing prod dependency without review"),
]

def main():
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    tool_input = data.get("tool_input", {})
    command = tool_input.get("command", "")

    if not command:
        sys.exit(0)

    for pattern, reason in BLOCKED_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            message = (
                f"🚨 BLOCKED COMMAND\n"
                f"Command: {command[:200]}\n"
                f"Reason: {reason}\n\n"
                f"This command could cause data loss or security issues.\n"
                f"If you need to run this, please ask the user for explicit approval first."
            )
            print(message, file=sys.stderr)
            sys.exit(2)

    sys.exit(0)

if __name__ == "__main__":
    main()
