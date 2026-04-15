#!/usr/bin/env bash
# ============================================================================
# SkillForge Hook: Auto-format (PostToolUse: Edit|Write|MultiEdit)
# ============================================================================
# Reads the tool_input from stdin, picks the right formatter based on the file
# extension, and runs it in place. Silently no-ops when:
#   - the tool payload is malformed
#   - the file path is missing or doesn't exist
#   - the matching formatter is not installed
#
# The hook NEVER fails the Claude operation — it always exits 0. The worst case
# is an unformatted file, which is infinitely better than breaking the edit.
# ============================================================================

set -uo pipefail

# jq is used to read stdin; if it's missing, silently pass through
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

payload=$(cat 2>/dev/null || true)
[ -z "$payload" ] && exit 0

file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

# Pick formatter by extension. The `command -v` check makes every branch a
# silent no-op when the tool isn't installed.
run() { command -v "$1" >/dev/null 2>&1 && "$@" >/dev/null 2>&1 || true; }

case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.md|*.css|*.scss|*.html|*.yaml|*.yml)
    run npx --no-install prettier --write "$file" ;;
  *.py)
    run black --quiet "$file" || run ruff format "$file" ;;
  *.go)
    run gofmt -w "$file" ;;
  *.rs)
    run rustfmt --edition 2021 "$file" ;;
  *.rb)
    run rubocop --autocorrect "$file" ;;
  *.php)
    run php-cs-fixer fix --quiet "$file" ;;
  *.java|*.kt)
    run google-java-format --replace "$file" ;;
  *.sh|*.bash)
    run shfmt -w "$file" ;;
esac

exit 0
