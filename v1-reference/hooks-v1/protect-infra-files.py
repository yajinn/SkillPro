#!/usr/bin/env python3
"""
Claude Code Hook: Infrastructure File Protection
Runs on PreToolUse (Edit|Write) to block modifications to critical files
without explicit user approval in the same session.

Returns exit code 2 to block the operation with a message.
Returns exit code 0 to allow.
"""

import json
import sys
import os

# Critical files that require explicit approval before modification
PROTECTED_PATTERNS = [
    # Build & Config
    "next.config",
    "nuxt.config",
    "remix.config",
    "astro.config",
    "vite.config",
    "webpack.config",
    "metro.config",
    "babel.config",
    "tsconfig.json",
    "jest.config",

    # Environment
    ".env",
    ".env.local",
    ".env.production",
    ".env.staging",
    ".env.development",

    # Infrastructure
    "Dockerfile",
    "docker-compose",
    ".dockerignore",
    "Jenkinsfile",
    ".github/workflows",
    ".gitlab-ci",
    "k8s/",
    "kubernetes/",

    # Package Management
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",

    # App Identity
    "app.json",
    "app.config",
    "react-native.config",

    # Native Mobile
    "build.gradle",
    "settings.gradle",
    "gradle.properties",
    "AndroidManifest.xml",
    "Podfile",
    "Info.plist",
    ".pbxproj",

    # Database
    "prisma/schema.prisma",
    "drizzle.config",
    "migrations/",

    # Auth & Security
    "middleware.ts",
    "middleware.js",
    "auth.config",
    "next-auth",

    # Layout (affects all pages)
    "app/layout.tsx",
    "app/layout.jsx",
    "app/layout.ts",
    "app/layout.js",
    "pages/_app.tsx",
    "pages/_app.jsx",
    "pages/_document.tsx",
    "pages/_document.jsx",

    # CDN & Hosting
    "vercel.json",
    "netlify.toml",
    "nginx.conf",
    ".htaccess",

    # CI/CD Secrets
    ".npmrc",
    ".yarnrc",
]

def is_protected(file_path: str) -> bool:
    """Check if a file path matches any protected pattern."""
    normalized = file_path.replace("\\", "/").lower()
    for pattern in PROTECTED_PATTERNS:
        if pattern.lower() in normalized:
            return True
    return False

def get_protection_reason(file_path: str) -> str:
    """Get a human-readable reason why this file is protected."""
    normalized = file_path.lower()

    if ".env" in normalized:
        return "Environment configuration — may contain secrets and affect all environments"
    if "next.config" in normalized or "nuxt.config" in normalized:
        return "Framework configuration — affects entire build pipeline and all routes"
    if "dockerfile" in normalized or "docker-compose" in normalized:
        return "Container configuration — affects deployment and infrastructure"
    if "package.json" in normalized or "lock" in normalized:
        return "Dependency manifest — affects all packages and build reproducibility"
    if "layout" in normalized or "_app" in normalized or "_document" in normalized:
        return "Root layout — affects every page in the application"
    if "middleware" in normalized:
        return "Middleware — runs on every request, affects routing and auth"
    if "build.gradle" in normalized or "podfile" in normalized or ".pbxproj" in normalized:
        return "Native build configuration — affects app compilation and signing"
    if "prisma" in normalized or "migration" in normalized or "drizzle" in normalized:
        return "Database schema — may cause data loss or breaking changes"
    if "workflow" in normalized or "gitlab-ci" in normalized or "jenkinsfile" in normalized:
        return "CI/CD pipeline — affects deployment automation"

    return "Infrastructure file — may have wide-reaching impact"

def main():
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)  # Can't parse, allow

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})

    # Only check Edit and Write operations
    if tool_name not in ("Edit", "Write", "MultiEdit"):
        sys.exit(0)

    file_path = tool_input.get("file_path", "") or tool_input.get("path", "")

    if not file_path:
        sys.exit(0)

    if is_protected(file_path):
        reason = get_protection_reason(file_path)
        message = (
            f"🚨 PROTECTED FILE: {file_path}\n"
            f"Reason: {reason}\n\n"
            f"This file requires explicit user approval before modification.\n"
            f"Please explain WHAT changes you want to make and WHY, then wait for approval."
        )
        print(message, file=sys.stderr)
        sys.exit(2)  # Block the operation

    sys.exit(0)  # Allow

if __name__ == "__main__":
    main()
