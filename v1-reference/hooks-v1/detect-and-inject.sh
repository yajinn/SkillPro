#!/bin/bash
# ============================================================================
# Claude Code - Dynamic Skill Detection & Injection
# ============================================================================
# SessionStart hook: Detects project type, tech stack, and injects
# relevant context + skill recommendations into every session.
#
# Usage: Add to ~/.claude/settings.json under SessionStart hook
# ============================================================================

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REPORT=""

# ---------------------------------------------------------------------------
# 1. CORE LAYERS (Always injected regardless of project type)
# ---------------------------------------------------------------------------
CORE_SKILLS="security-guardian, performance-sentinel, git-safety, dependency-audit, testing-qa, accessibility-a11y, observability"

# ---------------------------------------------------------------------------
# 2. PROJECT TYPE DETECTION
# ---------------------------------------------------------------------------
PROJECT_TYPE="unknown"
FRAMEWORK=""
LANGUAGE=""
PACKAGE_MANAGER=""
DETECTED_SKILLS=""

# -- Package Manager Detection --
if [ -f "$PROJECT_DIR/pnpm-lock.yaml" ]; then
  PACKAGE_MANAGER="pnpm"
elif [ -f "$PROJECT_DIR/yarn.lock" ]; then
  PACKAGE_MANAGER="yarn"
elif [ -f "$PROJECT_DIR/bun.lockb" ]; then
  PACKAGE_MANAGER="bun"
elif [ -f "$PROJECT_DIR/package-lock.json" ]; then
  PACKAGE_MANAGER="npm"
elif [ -f "$PROJECT_DIR/Pipfile.lock" ]; then
  PACKAGE_MANAGER="pipenv"
elif [ -f "$PROJECT_DIR/poetry.lock" ]; then
  PACKAGE_MANAGER="poetry"
fi

# -- Framework Detection (ordered by specificity) --

# Next.js
if [ -f "$PROJECT_DIR/next.config.ts" ] || [ -f "$PROJECT_DIR/next.config.js" ] || [ -f "$PROJECT_DIR/next.config.mjs" ]; then
  PROJECT_TYPE="nextjs"
  FRAMEWORK="Next.js"
  LANGUAGE="TypeScript/JavaScript"

  # Detect App Router vs Pages Router
  if [ -d "$PROJECT_DIR/app" ] && [ -f "$PROJECT_DIR/app/layout.tsx" -o -f "$PROJECT_DIR/app/layout.jsx" ]; then
    FRAMEWORK="Next.js (App Router)"
  elif [ -d "$PROJECT_DIR/pages" ]; then
    FRAMEWORK="Next.js (Pages Router)"
  fi

  DETECTED_SKILLS="nextjs-conventions"

# React Native
elif [ -f "$PROJECT_DIR/react-native.config.js" ] || \
     ([ -f "$PROJECT_DIR/package.json" ] && grep -q '"react-native"' "$PROJECT_DIR/package.json" 2>/dev/null); then
  PROJECT_TYPE="react-native"
  FRAMEWORK="React Native"
  LANGUAGE="TypeScript/JavaScript"
  DETECTED_SKILLS="react-native-conventions"

  # Detect Expo vs CLI
  if [ -f "$PROJECT_DIR/app.json" ] && grep -q '"expo"' "$PROJECT_DIR/app.json" 2>/dev/null; then
    FRAMEWORK="React Native (Expo)"
  else
    FRAMEWORK="React Native (CLI)"
  fi

# Nuxt.js
elif [ -f "$PROJECT_DIR/nuxt.config.ts" ] || [ -f "$PROJECT_DIR/nuxt.config.js" ]; then
  PROJECT_TYPE="nuxtjs"
  FRAMEWORK="Nuxt.js"
  LANGUAGE="TypeScript/JavaScript"
  DETECTED_SKILLS="nuxtjs-conventions"

# Remix
elif [ -f "$PROJECT_DIR/remix.config.js" ] || \
     ([ -f "$PROJECT_DIR/package.json" ] && grep -q '"@remix-run"' "$PROJECT_DIR/package.json" 2>/dev/null); then
  PROJECT_TYPE="remix"
  FRAMEWORK="Remix"
  LANGUAGE="TypeScript/JavaScript"

# Astro
elif [ -f "$PROJECT_DIR/astro.config.mjs" ] || [ -f "$PROJECT_DIR/astro.config.ts" ]; then
  PROJECT_TYPE="astro"
  FRAMEWORK="Astro"
  LANGUAGE="TypeScript/JavaScript"

# Node.js API (Express, Fastify, Nest)
elif [ -f "$PROJECT_DIR/package.json" ]; then
  if grep -q '"@nestjs/core"' "$PROJECT_DIR/package.json" 2>/dev/null; then
    PROJECT_TYPE="node-api"
    FRAMEWORK="NestJS"
  elif grep -q '"fastify"' "$PROJECT_DIR/package.json" 2>/dev/null; then
    PROJECT_TYPE="node-api"
    FRAMEWORK="Fastify"
  elif grep -q '"express"' "$PROJECT_DIR/package.json" 2>/dev/null; then
    PROJECT_TYPE="node-api"
    FRAMEWORK="Express"
  fi
  LANGUAGE="TypeScript/JavaScript"
  DETECTED_SKILLS="node-api-conventions"

# Python (Django, FastAPI, Flask)
elif [ -f "$PROJECT_DIR/pyproject.toml" ] || [ -f "$PROJECT_DIR/requirements.txt" ] || [ -f "$PROJECT_DIR/setup.py" ]; then
  PROJECT_TYPE="python"
  LANGUAGE="Python"
  if grep -q "django" "$PROJECT_DIR/requirements.txt" 2>/dev/null || \
     grep -q "django" "$PROJECT_DIR/pyproject.toml" 2>/dev/null; then
    FRAMEWORK="Django"
  elif grep -q "fastapi" "$PROJECT_DIR/requirements.txt" 2>/dev/null || \
       grep -q "fastapi" "$PROJECT_DIR/pyproject.toml" 2>/dev/null; then
    FRAMEWORK="FastAPI"
  elif grep -q "flask" "$PROJECT_DIR/requirements.txt" 2>/dev/null || \
       grep -q "flask" "$PROJECT_DIR/pyproject.toml" 2>/dev/null; then
    FRAMEWORK="Flask"
  fi

# Go
elif [ -f "$PROJECT_DIR/go.mod" ]; then
  PROJECT_TYPE="go"
  LANGUAGE="Go"
  FRAMEWORK="Go"

# Rust
elif [ -f "$PROJECT_DIR/Cargo.toml" ]; then
  PROJECT_TYPE="rust"
  LANGUAGE="Rust"
  FRAMEWORK="Rust"
fi

# -- TypeScript Detection --
TS_ENABLED="false"
if [ -f "$PROJECT_DIR/tsconfig.json" ]; then
  TS_ENABLED="true"
  LANGUAGE="TypeScript"
fi

# ---------------------------------------------------------------------------
# 3. INFRASTRUCTURE & TOOLING DETECTION
# ---------------------------------------------------------------------------
INFRA_CONTEXT=""

# Docker
if [ -f "$PROJECT_DIR/Dockerfile" ] || [ -f "$PROJECT_DIR/docker-compose.yml" ] || [ -f "$PROJECT_DIR/docker-compose.yaml" ]; then
  INFRA_CONTEXT="${INFRA_CONTEXT}Docker, "
fi

# Kubernetes
if [ -d "$PROJECT_DIR/k8s" ] || [ -d "$PROJECT_DIR/kubernetes" ] || ls "$PROJECT_DIR"/*.yaml 2>/dev/null | grep -q "kind: Deployment"; then
  INFRA_CONTEXT="${INFRA_CONTEXT}Kubernetes, "
fi

# CI/CD
if [ -d "$PROJECT_DIR/.github/workflows" ]; then
  INFRA_CONTEXT="${INFRA_CONTEXT}GitHub Actions, "
elif [ -f "$PROJECT_DIR/.gitlab-ci.yml" ]; then
  INFRA_CONTEXT="${INFRA_CONTEXT}GitLab CI, "
elif [ -f "$PROJECT_DIR/Jenkinsfile" ]; then
  INFRA_CONTEXT="${INFRA_CONTEXT}Jenkins, "
fi

# CDN / Hosting
if [ -f "$PROJECT_DIR/vercel.json" ]; then
  INFRA_CONTEXT="${INFRA_CONTEXT}Vercel, "
elif [ -f "$PROJECT_DIR/netlify.toml" ]; then
  INFRA_CONTEXT="${INFRA_CONTEXT}Netlify, "
fi

# Coolify
if grep -rq "coolify" "$PROJECT_DIR/docker-compose.yml" 2>/dev/null; then
  INFRA_CONTEXT="${INFRA_CONTEXT}Coolify, "
fi

# Database
if [ -d "$PROJECT_DIR/prisma" ] || [ -f "$PROJECT_DIR/prisma/schema.prisma" ]; then
  INFRA_CONTEXT="${INFRA_CONTEXT}Prisma ORM, "
elif [ -d "$PROJECT_DIR/drizzle" ]; then
  INFRA_CONTEXT="${INFRA_CONTEXT}Drizzle ORM, "
fi

# Monorepo
if [ -f "$PROJECT_DIR/lerna.json" ] || [ -f "$PROJECT_DIR/pnpm-workspace.yaml" ] || \
   ([ -f "$PROJECT_DIR/package.json" ] && grep -q '"workspaces"' "$PROJECT_DIR/package.json" 2>/dev/null); then
  INFRA_CONTEXT="${INFRA_CONTEXT}Monorepo, "
fi

# Trim trailing comma
INFRA_CONTEXT="${INFRA_CONTEXT%, }"

# ---------------------------------------------------------------------------
# 4. SECURITY QUICK SCAN
# ---------------------------------------------------------------------------
SECURITY_FLAGS=""

# Check for .env in git
if [ -d "$PROJECT_DIR/.git" ]; then
  if git -C "$PROJECT_DIR" ls-files --cached | grep -qE '\.env$|\.env\.local$|\.env\.production$' 2>/dev/null; then
    SECURITY_FLAGS="${SECURITY_FLAGS}⚠️ .env file tracked in git! "
  fi
fi

# Check for hardcoded secrets patterns
if grep -rn "AKIA[0-9A-Z]\{16\}" "$PROJECT_DIR/src" "$PROJECT_DIR/app" 2>/dev/null | head -1 > /dev/null 2>&1; then
  SECURITY_FLAGS="${SECURITY_FLAGS}⚠️ Possible AWS key in source! "
fi

# Check for outdated lockfile
if [ -f "$PROJECT_DIR/package-lock.json" ]; then
  LOCK_AGE=$(find "$PROJECT_DIR/package-lock.json" -mtime +90 2>/dev/null)
  if [ -n "$LOCK_AGE" ]; then
    SECURITY_FLAGS="${SECURITY_FLAGS}⚠️ package-lock.json >90 days old. "
  fi
fi

# ---------------------------------------------------------------------------
# 5. GIT CONTEXT
# ---------------------------------------------------------------------------
GIT_CONTEXT=""
if [ -d "$PROJECT_DIR/.git" ]; then
  CURRENT_BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo "unknown")
  UNCOMMITTED=$(git -C "$PROJECT_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  LAST_COMMIT=$(git -C "$PROJECT_DIR" log -1 --oneline 2>/dev/null || echo "no commits")
  GIT_CONTEXT="Branch: $CURRENT_BRANCH | Uncommitted files: $UNCOMMITTED | Last: $LAST_COMMIT"
fi

# ---------------------------------------------------------------------------
# 6. COMPOSE ADDITIONAL CONTEXT OUTPUT
# ---------------------------------------------------------------------------
ALL_SKILLS="$CORE_SKILLS"
if [ -n "$DETECTED_SKILLS" ]; then
  ALL_SKILLS="$ALL_SKILLS, $DETECTED_SKILLS"
fi

CONTEXT="🔍 PROJECT ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Type: $PROJECT_TYPE | Framework: ${FRAMEWORK:-none} | Lang: ${LANGUAGE:-unknown}
Package Manager: ${PACKAGE_MANAGER:-unknown} | TypeScript: $TS_ENABLED
Infra: ${INFRA_CONTEXT:-none detected}
Git: ${GIT_CONTEXT:-not a git repo}
${SECURITY_FLAGS:+Security: $SECURITY_FLAGS}

🛡️ ACTIVE CORE LAYERS (always loaded):
  - security-guardian: Secret detection, input validation, dependency audit rules
  - performance-sentinel: Bundle size, memory leaks, N+1 query detection
  - git-safety: Branch protection, force-push prevention, .env guard
  - dependency-audit: Outdated/vulnerable package detection
  - testing-qa: Test coverage, TDD patterns, edge case enforcement
  - accessibility-a11y: WCAG AA, keyboard nav, screen reader, contrast
  - observability: Structured logging, error boundaries, health checks

📦 PROJECT-SPECIFIC SKILLS: ${DETECTED_SKILLS:-none (generic mode)}

⚡ ALL RECOMMENDED SKILLS: $ALL_SKILLS

IMPORTANT: Before modifying any infrastructure file (next.config.*, Dockerfile, docker-compose.*, .env*, package.json major deps, layout.tsx, database schemas), STOP and explain what changes will be made and why. Wait for explicit approval."

echo "{\"additionalContext\": $(echo "$CONTEXT" | jq -Rs .)}"
