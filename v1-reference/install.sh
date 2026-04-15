#!/bin/bash
# ============================================================================
# Claude Code Dynamic Skill Ecosystem - Installer
# ============================================================================
# Usage: bash install.sh [--merge | --overwrite]
#
# --merge:     Merge hooks into existing settings.json (default)
# --overwrite: Replace existing settings.json entirely
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
MODE="${1:---merge}"

echo "🧠 Claude Code Dynamic Skill Ecosystem Installer"
echo "================================================="
echo ""

# Create directories
echo "📁 Creating directories..."
mkdir -p "$CLAUDE_DIR/skills"
mkdir -p "$CLAUDE_DIR/hooks"
mkdir -p "$CLAUDE_DIR/logs"

# Copy core skills
echo "🛡️  Installing core skills..."
for skill in security-guardian performance-sentinel git-safety dependency-audit testing-qa accessibility-a11y observability; do
  if [ -d "$CLAUDE_DIR/skills/$skill" ]; then
    echo "   ⚠️  $skill already exists — backing up and replacing"
    cp -r "$CLAUDE_DIR/skills/$skill" "$CLAUDE_DIR/skills/${skill}.bak.$(date +%s)"
  fi
  cp -r "$SCRIPT_DIR/skills/_core/$skill" "$CLAUDE_DIR/skills/"
  echo "   ✅ $skill"
done

# Copy project-type skills
echo "📦 Installing project-type skills..."
for skill_dir in "$SCRIPT_DIR/skills/_project-types/"*/; do
  skill_name=$(basename "$skill_dir")
  skill_target="$CLAUDE_DIR/skills/${skill_name}-conventions"
  if [ -d "$skill_target" ]; then
    echo "   ⚠️  ${skill_name}-conventions already exists — backing up and replacing"
    cp -r "$skill_target" "${skill_target}.bak.$(date +%s)"
  fi
  cp -r "$skill_dir" "$skill_target"
  echo "   ✅ ${skill_name}-conventions"
done

# Copy hooks
echo "🔒 Installing hooks..."
for hook in detect-and-inject.sh protect-infra-files.py protect-dangerous-commands.py; do
  cp "$SCRIPT_DIR/hooks/$hook" "$CLAUDE_DIR/hooks/"
  chmod +x "$CLAUDE_DIR/hooks/$hook"
  echo "   ✅ $hook"
done

# Handle settings.json
echo "⚙️  Configuring settings..."
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
NEW_SETTINGS="$SCRIPT_DIR/config/settings.json"

if [ "$MODE" = "--overwrite" ]; then
  if [ -f "$SETTINGS_FILE" ]; then
    cp "$SETTINGS_FILE" "${SETTINGS_FILE}.bak.$(date +%s)"
    echo "   📋 Backed up existing settings.json"
  fi
  cp "$NEW_SETTINGS" "$SETTINGS_FILE"
  echo "   ✅ settings.json installed (overwrite mode)"
elif [ -f "$SETTINGS_FILE" ]; then
  # Check if jq is available for merge
  if command -v jq &> /dev/null; then
    cp "$SETTINGS_FILE" "${SETTINGS_FILE}.bak.$(date +%s)"
    jq -s '.[0] * .[1]' "$SETTINGS_FILE.bak."* "$NEW_SETTINGS" > "$SETTINGS_FILE" 2>/dev/null || {
      echo "   ⚠️  jq merge failed — copying new settings (backup created)"
      cp "$NEW_SETTINGS" "$SETTINGS_FILE"
    }
    echo "   ✅ settings.json merged with existing"
  else
    echo "   ⚠️  jq not found — please manually merge:"
    echo "   📋 New settings: $NEW_SETTINGS"
    echo "   📋 Your settings: $SETTINGS_FILE"
  fi
else
  cp "$NEW_SETTINGS" "$SETTINGS_FILE"
  echo "   ✅ settings.json installed (new)"
fi

echo ""
echo "✨ Installation complete!"
echo ""
echo "Installed:"
echo "  Skills: $(ls -d "$CLAUDE_DIR/skills/"*/ 2>/dev/null | wc -l | tr -d ' ') skills"
echo "  Hooks:  $(ls "$CLAUDE_DIR/hooks/"* 2>/dev/null | wc -l | tr -d ' ') hooks"
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code for hooks to take effect"
echo "  2. Run 'claude' in any project to see the detection in action"
echo "  3. Add project-specific skills to your repo's .claude/skills/ folder"
echo ""
echo "To uninstall:"
echo "  rm -rf ~/.claude/skills/{security-guardian,performance-sentinel,git-safety,dependency-audit}"
echo "  rm -rf ~/.claude/skills/*-conventions"
echo "  rm ~/.claude/hooks/{detect-and-inject.sh,protect-infra-files.py,protect-dangerous-commands.py}"
echo "  # Then remove hook entries from ~/.claude/settings.json"
