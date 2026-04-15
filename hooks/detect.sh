#!/bin/bash
# ============================================================================
# SkillForge — Universal Project Detector v3
# ============================================================================
# Analyzes the current project directory and outputs a structured JSON profile
# with language, framework, characteristics, critical files, and audit commands.
#
# Usage: bash detect.sh [project_dir]
# Output: Writes .claude/project-profile.json + prints additionalContext JSON
#
# Design principles:
#   - Fast: < 3 seconds on any project
#   - Resilient: handles missing tools, empty dirs, permission errors
#   - No false positives: only flags what's confirmed by file markers
#   - Characteristics-first: project traits matter more than labels
# ============================================================================

set -uo pipefail

PROJECT_DIR="${1:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
PROFILE_DIR="$PROJECT_DIR/.claude"
PROFILE_FILE="$PROFILE_DIR/project-profile.json"

# jq is required for JSON construction — fail fast with a readable error
if ! command -v jq >/dev/null 2>&1; then
  echo '{"additionalContext": "SkillForge: jq not installed — install with `brew install jq` or `apt install jq` and restart the session."}'
  exit 0
fi

# ---------------------------------------------------------------------------
# Helper: check if file content contains pattern (case-insensitive)
# ---------------------------------------------------------------------------
file_contains() {
  grep -qi "$2" "$1" 2>/dev/null
}

pkg_has() {
  # Check if package.json contains a dependency name (prod or dev)
  [ -f "$PROJECT_DIR/package.json" ] && grep -q "$1" "$PROJECT_DIR/package.json" 2>/dev/null
}

composer_has() {
  [ -f "$PROJECT_DIR/composer.json" ] && grep -q "$1" "$PROJECT_DIR/composer.json" 2>/dev/null
}

pip_has() {
  ([ -f "$PROJECT_DIR/requirements.txt" ] && grep -qi "$1" "$PROJECT_DIR/requirements.txt" 2>/dev/null) || \
  ([ -f "$PROJECT_DIR/pyproject.toml" ] && grep -qi "$1" "$PROJECT_DIR/pyproject.toml" 2>/dev/null) || \
  ([ -f "$PROJECT_DIR/Pipfile" ] && grep -qi "$1" "$PROJECT_DIR/Pipfile" 2>/dev/null)
}

pub_has() {
  # Check if pubspec.yaml contains a Dart/Flutter dependency name
  [ -f "$PROJECT_DIR/pubspec.yaml" ] && grep -qi "^\s*$1:" "$PROJECT_DIR/pubspec.yaml" 2>/dev/null
}

gem_has() {
  [ -f "$PROJECT_DIR/Gemfile" ] && grep -qi "^\s*gem\s*['\"]$1['\"]" "$PROJECT_DIR/Gemfile" 2>/dev/null
}

go_mod_has() {
  [ -f "$PROJECT_DIR/go.mod" ] && grep -q "$1" "$PROJECT_DIR/go.mod" 2>/dev/null
}

cargo_has() {
  [ -f "$PROJECT_DIR/Cargo.toml" ] && grep -q "^\s*$1\s*=" "$PROJECT_DIR/Cargo.toml" 2>/dev/null
}

gradle_has() {
  # Searches pom.xml AND build.gradle(.kts) for a dependency pattern.
  # Java/Kotlin projects may use either, or both in multi-module setups.
  {
    [ -f "$PROJECT_DIR/pom.xml" ] && grep -q "$1" "$PROJECT_DIR/pom.xml" 2>/dev/null
  } || {
    [ -f "$PROJECT_DIR/build.gradle" ] && grep -q "$1" "$PROJECT_DIR/build.gradle" 2>/dev/null
  } || {
    [ -f "$PROJECT_DIR/build.gradle.kts" ] && grep -q "$1" "$PROJECT_DIR/build.gradle.kts" 2>/dev/null
  } || {
    [ -f "$PROJECT_DIR/app/build.gradle" ] && grep -q "$1" "$PROJECT_DIR/app/build.gradle" 2>/dev/null
  } || {
    [ -f "$PROJECT_DIR/app/build.gradle.kts" ] && grep -q "$1" "$PROJECT_DIR/app/build.gradle.kts" 2>/dev/null
  }
}

nuget_has() {
  # Search any .csproj file (up to depth 2) for a PackageReference include
  find "$PROJECT_DIR" -maxdepth 2 -name "*.csproj" -exec grep -l "$1" {} \; 2>/dev/null | head -1 | grep -q .
}

dir_exists() {
  [ -d "$PROJECT_DIR/$1" ]
}

file_exists() {
  [ -f "$PROJECT_DIR/$1" ]
}

any_file_exists() {
  for f in "$@"; do
    [ -f "$PROJECT_DIR/$f" ] && return 0
  done
  return 1
}

# ---------------------------------------------------------------------------
# 1. LANGUAGE DETECTION
# ---------------------------------------------------------------------------
LANGUAGE="unknown"
LANGUAGE_VERSION=""

# PHP
if any_file_exists "composer.json" "index.php" "wp-config.php" "artisan"; then
  LANGUAGE="php"
  LANGUAGE_VERSION=$(php -v 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "")

# Python
elif any_file_exists "pyproject.toml" "requirements.txt" "setup.py" "Pipfile" "manage.py"; then
  LANGUAGE="python"
  LANGUAGE_VERSION=$(python3 --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "")

# Go
elif file_exists "go.mod"; then
  LANGUAGE="go"
  LANGUAGE_VERSION=$(go version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "")

# Rust
elif file_exists "Cargo.toml"; then
  LANGUAGE="rust"
  LANGUAGE_VERSION=$(rustc --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "")

# Java / Kotlin
elif any_file_exists "pom.xml" "build.gradle" "build.gradle.kts" "settings.gradle"; then
  if find "$PROJECT_DIR/src" -name "*.kt" 2>/dev/null | head -1 | grep -q .; then
    LANGUAGE="kotlin"
  else
    LANGUAGE="java"
  fi
  LANGUAGE_VERSION=$(java --version 2>/dev/null | head -1 | grep -oE '[0-9]+' | head -1 || echo "")

# Ruby
elif any_file_exists "Gemfile" "Rakefile" "config.ru"; then
  LANGUAGE="ruby"
  LANGUAGE_VERSION=$(ruby -v 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "")

# C# / .NET (csproj/sln are globs — probe via find)
elif file_exists "global.json" || \
     find "$PROJECT_DIR" -maxdepth 2 \( -name "*.csproj" -o -name "*.sln" \) -print -quit 2>/dev/null | grep -q .; then
  LANGUAGE="csharp"
  LANGUAGE_VERSION=$(dotnet --version 2>/dev/null || echo "")

# JavaScript / TypeScript (last — many projects have package.json alongside other langs)
elif file_exists "package.json"; then
  if file_exists "tsconfig.json"; then
    LANGUAGE="typescript"
  else
    LANGUAGE="javascript"
  fi
  LANGUAGE_VERSION=$(node -v 2>/dev/null | tr -d 'v' || echo "")

# Dart / Flutter
elif file_exists "pubspec.yaml"; then
  LANGUAGE="dart"
fi

# TypeScript override: if tsconfig exists alongside any language
if [ "$LANGUAGE" != "typescript" ] && file_exists "tsconfig.json"; then
  # Could be a multi-lang project with TS build tools
  HAS_TYPESCRIPT="true"
else
  HAS_TYPESCRIPT="false"
fi
[ "$LANGUAGE" = "typescript" ] && HAS_TYPESCRIPT="true"

# ---------------------------------------------------------------------------
# 2. FRAMEWORK DETECTION
# ---------------------------------------------------------------------------
FRAMEWORK=""
SUB_FRAMEWORK=""

case "$LANGUAGE" in
  php)
    if file_exists "wp-config.php" || dir_exists "wp-content"; then
      FRAMEWORK="wordpress"
      if dir_exists "wp-content/plugins/woocommerce" || composer_has "woocommerce"; then
        SUB_FRAMEWORK="woocommerce"
      fi
      if dir_exists "wp-content/plugins/elementor"; then SUB_FRAMEWORK="${SUB_FRAMEWORK:+$SUB_FRAMEWORK,}elementor"; fi
    elif file_exists "artisan"; then
      FRAMEWORK="laravel"
      if composer_has "livewire"; then SUB_FRAMEWORK="livewire"; fi
      if composer_has "inertia"; then SUB_FRAMEWORK="${SUB_FRAMEWORK:+$SUB_FRAMEWORK,}inertia"; fi
    elif composer_has "symfony/framework-bundle"; then
      FRAMEWORK="symfony"
    elif composer_has "drupal/core"; then
      FRAMEWORK="drupal"
    fi
    ;;

  python)
    if pip_has "django" || file_exists "manage.py"; then
      FRAMEWORK="django"
      if pip_has "djangorestframework"; then SUB_FRAMEWORK="drf"; fi
      if pip_has "wagtail"; then SUB_FRAMEWORK="${SUB_FRAMEWORK:+$SUB_FRAMEWORK,}wagtail"; fi
    elif pip_has "fastapi"; then
      FRAMEWORK="fastapi"
    elif pip_has "flask"; then
      FRAMEWORK="flask"
    elif pip_has "streamlit"; then
      FRAMEWORK="streamlit"
    elif pip_has "jupyter" || file_exists "*.ipynb" || find "$PROJECT_DIR" -maxdepth 2 -name "*.ipynb" 2>/dev/null | head -1 | grep -q .; then
      FRAMEWORK="jupyter"
    elif pip_has "torch" || pip_has "tensorflow" || pip_has "transformers"; then
      FRAMEWORK="ml-pipeline"
    fi
    ;;

  javascript|typescript)
    if any_file_exists "next.config.ts" "next.config.js" "next.config.mjs"; then
      FRAMEWORK="nextjs"
      if dir_exists "app" && any_file_exists "app/layout.tsx" "app/layout.jsx"; then
        SUB_FRAMEWORK="app-router"
      elif dir_exists "pages"; then
        SUB_FRAMEWORK="pages-router"
      fi
    elif file_exists "react-native.config.js" || pkg_has "react-native"; then
      FRAMEWORK="react-native"
      if file_exists "app.json" && file_contains "$PROJECT_DIR/app.json" "expo"; then
        SUB_FRAMEWORK="expo"
      else
        SUB_FRAMEWORK="cli"
      fi
    elif any_file_exists "nuxt.config.ts" "nuxt.config.js"; then
      FRAMEWORK="nuxtjs"
    elif any_file_exists "astro.config.mjs" "astro.config.ts"; then
      FRAMEWORK="astro"
    elif any_file_exists "remix.config.js" "remix.config.ts"; then
      FRAMEWORK="remix"
    elif any_file_exists "svelte.config.js" "svelte.config.ts"; then
      FRAMEWORK="sveltekit"
    elif any_file_exists "angular.json" ".angular-cli.json"; then
      FRAMEWORK="angular"
    elif any_file_exists "vue.config.js" "vite.config.ts" "vite.config.js"; then
      if pkg_has "vue"; then FRAMEWORK="vue"; else FRAMEWORK="vite"; fi
    elif pkg_has "@nestjs/core"; then
      FRAMEWORK="nestjs"
    elif pkg_has "fastify"; then
      FRAMEWORK="fastify"
    elif pkg_has "express"; then
      FRAMEWORK="express"
    elif pkg_has "electron"; then
      FRAMEWORK="electron"
    elif pkg_has "tauri"; then
      FRAMEWORK="tauri"
    fi
    ;;

  go)
    if file_contains "$PROJECT_DIR/go.mod" "gin-gonic"; then FRAMEWORK="gin"
    elif file_contains "$PROJECT_DIR/go.mod" "labstack/echo"; then FRAMEWORK="echo"
    elif file_contains "$PROJECT_DIR/go.mod" "gofiber"; then FRAMEWORK="fiber"
    elif file_contains "$PROJECT_DIR/go.mod" "cobra"; then FRAMEWORK="cobra-cli"
    fi
    ;;

  rust)
    if file_contains "$PROJECT_DIR/Cargo.toml" "actix-web"; then FRAMEWORK="actix"
    elif file_contains "$PROJECT_DIR/Cargo.toml" "axum"; then FRAMEWORK="axum"
    elif file_contains "$PROJECT_DIR/Cargo.toml" "tauri"; then FRAMEWORK="tauri"
    elif file_contains "$PROJECT_DIR/Cargo.toml" "clap"; then FRAMEWORK="clap-cli"
    fi
    ;;

  ruby)
    if file_exists "config/routes.rb" || file_exists "bin/rails"; then
      FRAMEWORK="rails"
    elif file_exists "config.ru" && (file_contains "$PROJECT_DIR/Gemfile" "sinatra"); then
      FRAMEWORK="sinatra"
    fi
    ;;

  java|kotlin)
    if file_contains "$PROJECT_DIR/pom.xml" "spring-boot" 2>/dev/null || \
       file_contains "$PROJECT_DIR/build.gradle" "org.springframework.boot" 2>/dev/null; then
      FRAMEWORK="spring-boot"
    elif dir_exists "app/src/main/java" || dir_exists "app/src/main/kotlin"; then
      FRAMEWORK="android-native"
    fi
    ;;

  dart)
    if file_contains "$PROJECT_DIR/pubspec.yaml" "flutter"; then
      FRAMEWORK="flutter"
      # Detect state management sub-framework (non-exclusive: comma-joined)
      if pub_has "flutter_redux" || pub_has "redux"; then
        SUB_FRAMEWORK="redux"
      fi
      if pub_has "flutter_bloc" || pub_has "bloc"; then
        SUB_FRAMEWORK="${SUB_FRAMEWORK:+$SUB_FRAMEWORK,}bloc"
      fi
      if pub_has "riverpod" || pub_has "flutter_riverpod"; then
        SUB_FRAMEWORK="${SUB_FRAMEWORK:+$SUB_FRAMEWORK,}riverpod"
      fi
      if pub_has "provider"; then
        SUB_FRAMEWORK="${SUB_FRAMEWORK:+$SUB_FRAMEWORK,}provider"
      fi
      if pub_has "get_it" || pub_has "getx"; then
        SUB_FRAMEWORK="${SUB_FRAMEWORK:+$SUB_FRAMEWORK,}getx"
      fi
    fi
    ;;

  csharp)
    if find "$PROJECT_DIR" -name "*.csproj" -exec grep -l "Microsoft.AspNetCore" {} \; 2>/dev/null | head -1 | grep -q .; then
      FRAMEWORK="aspnet"
    elif find "$PROJECT_DIR" -name "*.csproj" -exec grep -l "Xamarin\|MAUI" {} \; 2>/dev/null | head -1 | grep -q .; then
      FRAMEWORK="maui"
    fi
    ;;
esac

# ---------------------------------------------------------------------------
# 3. PROJECT TYPE CLASSIFICATION
# ---------------------------------------------------------------------------
PROJECT_TYPE="unknown"

case "$FRAMEWORK" in
  nextjs|nuxtjs|astro|remix|sveltekit|angular|vue|vite)
    PROJECT_TYPE="web-frontend" ;;
  react-native|flutter|android-native|maui)
    PROJECT_TYPE="mobile" ;;
  express|fastify|nestjs|fastapi|flask|gin|echo|fiber|actix|axum|rails|sinatra|spring-boot|aspnet|django)
    # Could be API or fullstack
    if [ "$FRAMEWORK" = "django" ] && dir_exists "templates"; then
      PROJECT_TYPE="web-fullstack"
    elif [ "$FRAMEWORK" = "rails" ] && dir_exists "app/views"; then
      PROJECT_TYPE="web-fullstack"
    else
      PROJECT_TYPE="backend-api"
    fi
    ;;
  wordpress|drupal)
    PROJECT_TYPE="cms-web" ;;
  electron|tauri)
    PROJECT_TYPE="desktop" ;;
  cobra-cli|clap-cli)
    PROJECT_TYPE="cli-tool" ;;
  jupyter|ml-pipeline|streamlit)
    PROJECT_TYPE="data-ml" ;;
esac

# Fallback classification by file patterns
if [ "$PROJECT_TYPE" = "unknown" ]; then
  if file_exists "main.go" && [ -z "$FRAMEWORK" ]; then PROJECT_TYPE="cli-tool"
  elif dir_exists "src" && file_exists "Cargo.toml" && [ -z "$FRAMEWORK" ]; then PROJECT_TYPE="cli-tool"
  elif file_exists "setup.py" || file_exists "setup.cfg"; then PROJECT_TYPE="library"
  elif file_exists "package.json" && file_contains "$PROJECT_DIR/package.json" '"main"'; then PROJECT_TYPE="library"
  fi
fi

# ---------------------------------------------------------------------------
# 4. PACKAGE MANAGER DETECTION
# ---------------------------------------------------------------------------
PACKAGE_MANAGER="unknown"
if file_exists "pnpm-lock.yaml"; then PACKAGE_MANAGER="pnpm"
elif file_exists "yarn.lock"; then PACKAGE_MANAGER="yarn"
elif file_exists "bun.lockb"; then PACKAGE_MANAGER="bun"
elif file_exists "package-lock.json"; then PACKAGE_MANAGER="npm"
elif file_exists "composer.lock" || file_exists "composer.json"; then PACKAGE_MANAGER="composer"
elif file_exists "Pipfile.lock"; then PACKAGE_MANAGER="pipenv"
elif file_exists "poetry.lock"; then PACKAGE_MANAGER="poetry"
elif file_exists "uv.lock"; then PACKAGE_MANAGER="uv"
elif file_exists "requirements.txt"; then PACKAGE_MANAGER="pip"
elif file_exists "Gemfile.lock"; then PACKAGE_MANAGER="bundler"
elif file_exists "go.sum"; then PACKAGE_MANAGER="go-mod"
elif file_exists "Cargo.lock"; then PACKAGE_MANAGER="cargo"
elif file_exists "pom.xml"; then PACKAGE_MANAGER="maven"
elif any_file_exists "build.gradle" "build.gradle.kts"; then PACKAGE_MANAGER="gradle"
elif file_exists "pubspec.lock"; then PACKAGE_MANAGER="pub"
elif file_exists "pubspec.yaml"; then PACKAGE_MANAGER="pub"
elif file_exists "package.json"; then PACKAGE_MANAGER="npm"
fi

# ---------------------------------------------------------------------------
# 5. DATABASE DETECTION
# ---------------------------------------------------------------------------
DATABASE=""
if dir_exists "prisma" || file_exists "prisma/schema.prisma"; then
  DATABASE="prisma"
  if file_exists "prisma/schema.prisma"; then
    if file_contains "$PROJECT_DIR/prisma/schema.prisma" "postgresql"; then DATABASE="postgresql+prisma"
    elif file_contains "$PROJECT_DIR/prisma/schema.prisma" "mysql"; then DATABASE="mysql+prisma"
    elif file_contains "$PROJECT_DIR/prisma/schema.prisma" "sqlite"; then DATABASE="sqlite+prisma"
    fi
  fi
elif dir_exists "drizzle" || file_exists "drizzle.config.ts"; then DATABASE="drizzle"
elif pkg_has "mongoose" || pip_has "pymongo"; then DATABASE="mongodb"
elif pkg_has "pg" || pip_has "psycopg" || composer_has "doctrine/dbal"; then DATABASE="postgresql"
elif pip_has "sqlalchemy"; then DATABASE="sqlalchemy"
elif file_exists "wp-config.php"; then DATABASE="mysql"
elif pkg_has "mysql2" || composer_has "mysql"; then DATABASE="mysql"
elif pub_has "cloud_firestore" || pub_has "firebase_firestore"; then DATABASE="firestore"
elif pub_has "drift"; then DATABASE="drift"
elif pub_has "isar"; then DATABASE="isar"
elif pub_has "hive" || pub_has "hive_flutter"; then DATABASE="hive"
elif pkg_has "better-sqlite3" || pip_has "sqlite" || pub_has "sqflite"; then DATABASE="sqlite"
elif pkg_has "redis" || pip_has "redis"; then DATABASE="${DATABASE:+$DATABASE,}redis"
fi

# ---------------------------------------------------------------------------
# 6. CHARACTERISTICS DETECTION
# ---------------------------------------------------------------------------
HAS_UI="false"
HAS_WEB="false"
HAS_MOBILE_UI="false"
HAS_API="false"
HAS_DB="false"
HANDLES_AUTH="false"
HAS_USER_INPUT="false"
SERVES_TRAFFIC="false"
IS_LIBRARY="false"
HAS_CI="false"
HAS_DOCKER="false"
HAS_I18N="false"
HAS_ECOMMERCE="false"
HAS_CMS="false"
CLI_ONLY="false"
DATA_PIPELINE="false"
HEADLESS="false"
SERVES_PUBLIC="false"

# UI detection
case "$PROJECT_TYPE" in
  web-frontend|web-fullstack|cms-web) HAS_UI="true"; HAS_WEB="true"; SERVES_PUBLIC="true" ;;
  mobile) HAS_UI="true"; HAS_MOBILE_UI="true" ;;
  desktop) HAS_UI="true" ;;
  cli-tool) CLI_ONLY="true"; HAS_USER_INPUT="true" ;;
  data-ml) DATA_PIPELINE="true" ;;
  backend-api) HEADLESS="true"; HAS_API="true"; SERVES_TRAFFIC="true" ;;
  library) IS_LIBRARY="true" ;;
esac

# API detection (deeper)
if [ "$HAS_API" = "false" ]; then
  if dir_exists "app/api" || dir_exists "pages/api" || dir_exists "src/api" || dir_exists "api"; then
    HAS_API="true"; SERVES_TRAFFIC="true"
  fi
  if file_exists "openapi.yaml" || file_exists "openapi.json" || file_exists "swagger.json"; then
    HAS_API="true"; SERVES_TRAFFIC="true"
  fi
fi

# Web detection (deeper)
if [ "$HAS_WEB" = "false" ]; then
  if dir_exists "public" && (find "$PROJECT_DIR/public" -name "*.html" 2>/dev/null | head -1 | grep -q .); then
    HAS_WEB="true"; HAS_UI="true"
  fi
  if dir_exists "templates" || dir_exists "views" || dir_exists "app/views"; then
    HAS_WEB="true"; HAS_UI="true"
  fi
fi

# Database
[ -n "$DATABASE" ] && HAS_DB="true"

# Auth detection
if pkg_has "next-auth" || pkg_has "passport" || pkg_has "@auth" || \
   pip_has "django.contrib.auth" || pip_has "authlib" || \
   composer_has "laravel/sanctum" || composer_has "tymon/jwt-auth" || \
   pub_has "firebase_auth" || pub_has "google_sign_in" || pub_has "flutter_appauth" || \
   pub_has "local_auth" || pub_has "sign_in_with_apple" || \
   file_exists "wp-login.php" || dir_exists "app/auth" || dir_exists "src/auth"; then
  HANDLES_AUTH="true"
fi

# User input (web forms, CLI args, file uploads)
if [ "$HAS_WEB" = "true" ] || [ "$HAS_MOBILE_UI" = "true" ] || [ "$HAS_API" = "true" ]; then
  HAS_USER_INPUT="true"
fi

# Serves traffic
if [ "$HAS_WEB" = "true" ] || [ "$HAS_API" = "true" ]; then
  SERVES_TRAFFIC="true"
fi

# CI/CD
if dir_exists ".github/workflows" || file_exists ".gitlab-ci.yml" || file_exists "Jenkinsfile" || \
   file_exists ".circleci/config.yml" || file_exists "bitbucket-pipelines.yml"; then
  HAS_CI="true"
fi

# Docker
if file_exists "Dockerfile" || file_exists "docker-compose.yml" || file_exists "docker-compose.yaml"; then
  HAS_DOCKER="true"
fi

# i18n
if pkg_has "next-intl" || pkg_has "i18next" || pkg_has "react-intl" || \
   dir_exists "locales" || dir_exists "i18n" || dir_exists "lang" || dir_exists "translations" || \
   pip_has "gettext" || composer_has "laravel-lang" || \
   pub_has "intl" || pub_has "flutter_localizations" || pub_has "easy_localization" || \
   (file_exists "next.config.js" && file_contains "$PROJECT_DIR/next.config.js" "i18n"); then
  HAS_I18N="true"
fi

# E-commerce
if [ "$SUB_FRAMEWORK" = "woocommerce" ] || pkg_has "stripe" || pkg_has "@stripe" || \
   pip_has "stripe" || composer_has "stripe" || pkg_has "shopify" || \
   pkg_has "@lemonsqueezy"; then
  HAS_ECOMMERCE="true"
fi

# CMS
if [ "$FRAMEWORK" = "wordpress" ] || [ "$FRAMEWORK" = "drupal" ] || \
   pkg_has "contentful" || pkg_has "sanity" || pkg_has "strapi"; then
  HAS_CMS="true"
fi

# ---------------------------------------------------------------------------
# 7. INFRASTRUCTURE DETECTION
# ---------------------------------------------------------------------------
CDN=""
HOSTING=""
CI_TOOL=""

# CDN
if file_exists "vercel.json" || file_exists ".vercelignore"; then CDN="vercel"
elif file_exists "netlify.toml" || file_exists "_redirects"; then CDN="netlify"
elif file_exists "wrangler.toml" || file_exists "wrangler.jsonc"; then CDN="cloudflare"
fi

# CI tool name
if dir_exists ".github/workflows"; then CI_TOOL="github-actions"
elif file_exists ".gitlab-ci.yml"; then CI_TOOL="gitlab-ci"
elif file_exists "Jenkinsfile"; then CI_TOOL="jenkins"
fi

# ---------------------------------------------------------------------------
# 8. CRITICAL FILES (profile-driven protection)
# ---------------------------------------------------------------------------
CRITICAL_FILES='[".env", ".env.local", ".env.production"]'

# Add language-specific critical files
case "$LANGUAGE" in
  php)
    CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + ["composer.json", "composer.lock"]') ;;
  javascript|typescript)
    CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + ["package.json"]') ;;
  python)
    CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + ["pyproject.toml", "requirements.txt"]') ;;
  go)
    CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + ["go.mod", "go.sum"]') ;;
  rust)
    CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + ["Cargo.toml", "Cargo.lock"]') ;;
  ruby)
    CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + ["Gemfile", "Gemfile.lock"]') ;;
  dart)
    CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + ["pubspec.yaml", "pubspec.lock"]') ;;
esac

# Add framework-specific critical files
case "$FRAMEWORK" in
  nextjs)
    CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + ["next.config.ts", "next.config.js", "next.config.mjs", "middleware.ts", "app/layout.tsx", "app/layout.jsx"]') ;;
  wordpress)
    CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + ["wp-config.php", ".htaccess", "functions.php"]') ;;
  laravel)
    CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + ["artisan", "config/app.php", "config/database.php", "routes/web.php", "routes/api.php"]') ;;
  django)
    CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + ["manage.py", "settings.py", "urls.py"]') ;;
  react-native)
    CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + ["react-native.config.js", "metro.config.js", "babel.config.js", "android/app/build.gradle", "ios/Podfile"]') ;;
  flutter)
    CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + ["android/app/build.gradle", "android/app/src/main/AndroidManifest.xml", "ios/Podfile", "ios/Runner/Info.plist", "lib/main.dart"]') ;;
  rails)
    CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + ["config/routes.rb", "config/database.yml", "db/schema.rb"]') ;;
esac

# Add infra critical files
[ "$HAS_DOCKER" = "true" ] && CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + ["Dockerfile", "docker-compose.yml", "docker-compose.yaml"]')
[ "$HAS_CI" = "true" ] && [ -n "$CI_TOOL" ] && case "$CI_TOOL" in
  github-actions) CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + [".github/workflows"]') ;;
  gitlab-ci) CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq '. + [".gitlab-ci.yml"]') ;;
esac

# Deduplicate
CRITICAL_FILES=$(echo "$CRITICAL_FILES" | jq 'unique')

# ---------------------------------------------------------------------------
# 8.5 DEEP LIBRARY INTROSPECTION
# ---------------------------------------------------------------------------
# Purpose: beyond coarse (language, framework) signals, detect which specific
# libraries the project uses — TanStack Query, Zustand, FastAPI, Drizzle, etc.
# Emitted as a flat array of canonical IDs under `libraries` so scoring can
# target them via `match_libraries: ["tanstack-query"]`.
#
# Design notes:
#   - Canonical IDs are lowercase kebab-case and stable across versions
#   - Multiple packages can map to the same canonical (e.g. @tanstack/query-core
#     and @tanstack/react-query both → tanstack-query)
#   - Detection is substring-based on manifest files — fast, no tool deps
#   - Order within each language branch is alphabetical by canonical ID
# ---------------------------------------------------------------------------
LIBS=()
add_lib() { LIBS+=("$1"); }

case "$LANGUAGE" in
  javascript|typescript)
    pkg_has '"@anthropic-ai/sdk"' && add_lib "anthropic-sdk"
    pkg_has '"@clerk/' && add_lib "clerk"
    pkg_has '"cypress"' && add_lib "cypress"
    pkg_has '"drizzle-orm"' && add_lib "drizzle"
    pkg_has '"framer-motion"' && add_lib "framer-motion"
    pkg_has '"jest"' && add_lib "jest"
    pkg_has '"jotai"' && add_lib "jotai"
    pkg_has '"kysely"' && add_lib "kysely"
    pkg_has '"langchain"' && add_lib "langchain"
    pkg_has '"mongoose"' && add_lib "mongoose"
    pkg_has '"next-auth"' && add_lib "next-auth"
    pkg_has '"openai"' && add_lib "openai-sdk"
    (pkg_has '"playwright"' || pkg_has '"@playwright/test"') && add_lib "playwright"
    pkg_has '"@prisma/client"' && add_lib "prisma"
    pkg_has '"react-hook-form"' && add_lib "react-hook-form"
    pkg_has '"recoil"' && add_lib "recoil"
    pkg_has '"@reduxjs/toolkit"' && add_lib "redux-toolkit"
    pkg_has '"socket.io"' && add_lib "socketio"
    (pkg_has '"stripe"' || pkg_has '"@stripe/stripe-js"') && add_lib "stripe"
    pkg_has '"@supabase/supabase-js"' && add_lib "supabase"
    pkg_has '"swr"' && add_lib "swr"
    pkg_has '"tailwindcss"' && add_lib "tailwindcss"
    (pkg_has '"@tanstack/react-query"' || pkg_has '"@tanstack/query-core"') && add_lib "tanstack-query"
    pkg_has '"@trpc/' && add_lib "trpc"
    pkg_has '"typeorm"' && add_lib "typeorm"
    pkg_has '"vitest"' && add_lib "vitest"
    pkg_has '"yup"' && add_lib "yup"
    pkg_has '"zod"' && add_lib "zod"
    pkg_has '"zustand"' && add_lib "zustand"
    ;;

  python)
    pip_has "alembic" && add_lib "alembic"
    pip_has "anthropic" && add_lib "anthropic-sdk"
    pip_has "boto3" && add_lib "boto3"
    pip_has "celery" && add_lib "celery"
    pip_has "fastapi" && add_lib "fastapi"
    pip_has "gunicorn" && add_lib "gunicorn"
    pip_has "httpx" && add_lib "httpx"
    pip_has "langchain" && add_lib "langchain"
    pip_has "mypy" && add_lib "mypy"
    pip_has "numpy" && add_lib "numpy"
    pip_has "openai" && add_lib "openai-sdk"
    pip_has "pandas" && add_lib "pandas"
    pip_has "polars" && add_lib "polars"
    pip_has "pydantic" && add_lib "pydantic"
    pip_has "pytest" && add_lib "pytest"
    pip_has "redis" && add_lib "redis-py"
    pip_has "ruff" && add_lib "ruff"
    pip_has "scikit-learn" && add_lib "scikit-learn"
    pip_has "sqlalchemy" && add_lib "sqlalchemy"
    pip_has "stripe" && add_lib "stripe"
    pip_has "tensorflow" && add_lib "tensorflow"
    pip_has "torch" && add_lib "pytorch"
    pip_has "transformers" && add_lib "transformers"
    pip_has "uvicorn" && add_lib "uvicorn"
    ;;

  php)
    composer_has "doctrine/orm" && add_lib "doctrine-orm"
    composer_has "filament/filament" && add_lib "filament"
    composer_has "inertiajs/inertia-laravel" && add_lib "inertia"
    composer_has "laravel/passport" && add_lib "laravel-passport"
    composer_has "laravel/sanctum" && add_lib "laravel-sanctum"
    composer_has "livewire/livewire" && add_lib "livewire"
    composer_has "nesbot/carbon" && add_lib "carbon"
    composer_has "pestphp/pest" && add_lib "pest"
    composer_has "phpunit/phpunit" && add_lib "phpunit"
    composer_has "spatie/laravel-permission" && add_lib "spatie-permission"
    composer_has "stripe/stripe-php" && add_lib "stripe"
    composer_has "symfony/messenger" && add_lib "symfony-messenger"
    ;;

  ruby)
    gem_has "cancancan" && add_lib "cancancan"
    gem_has "capybara" && add_lib "capybara"
    gem_has "devise" && add_lib "devise"
    gem_has "factory_bot" && add_lib "factory-bot"
    gem_has "hotwire-rails" && add_lib "hotwire"
    gem_has "pundit" && add_lib "pundit"
    gem_has "rspec" && add_lib "rspec"
    gem_has "rspec-rails" && add_lib "rspec"
    gem_has "rubocop" && add_lib "rubocop"
    gem_has "sidekiq" && add_lib "sidekiq"
    gem_has "stimulus-rails" && add_lib "stimulus"
    gem_has "stripe" && add_lib "stripe"
    gem_has "turbo-rails" && add_lib "turbo"
    ;;

  go)
    go_mod_has "github.com/gin-gonic/gin" && add_lib "gin"
    go_mod_has "github.com/gofiber/fiber" && add_lib "fiber"
    go_mod_has "github.com/jackc/pgx" && add_lib "pgx"
    go_mod_has "github.com/jmoiron/sqlx" && add_lib "sqlx"
    go_mod_has "github.com/labstack/echo" && add_lib "echo"
    go_mod_has "github.com/spf13/cobra" && add_lib "cobra"
    go_mod_has "github.com/spf13/viper" && add_lib "viper"
    go_mod_has "github.com/stretchr/testify" && add_lib "testify"
    go_mod_has "go.uber.org/zap" && add_lib "zap"
    go_mod_has "google.golang.org/grpc" && add_lib "grpc-go"
    go_mod_has "gorm.io/gorm" && add_lib "gorm"
    ;;

  rust)
    cargo_has "actix-web" && add_lib "actix-web"
    cargo_has "anyhow" && add_lib "anyhow"
    cargo_has "axum" && add_lib "axum"
    cargo_has "clap" && add_lib "clap"
    cargo_has "diesel" && add_lib "diesel"
    cargo_has "reqwest" && add_lib "reqwest"
    cargo_has "rocket" && add_lib "rocket"
    cargo_has "sea-orm" && add_lib "sea-orm"
    cargo_has "serde" && add_lib "serde"
    cargo_has "sqlx" && add_lib "sqlx"
    cargo_has "thiserror" && add_lib "thiserror"
    cargo_has "tokio" && add_lib "tokio"
    cargo_has "tracing" && add_lib "tracing"
    ;;

  dart)
    pub_has "bloc" && add_lib "bloc"
    pub_has "cloud_firestore" && add_lib "firestore"
    pub_has "dio" && add_lib "dio"
    pub_has "drift" && add_lib "drift"
    pub_has "firebase_auth" && add_lib "firebase-auth"
    pub_has "flutter_bloc" && add_lib "flutter-bloc"
    pub_has "flutter_riverpod" && add_lib "riverpod"
    pub_has "freezed" && add_lib "freezed"
    pub_has "get_it" && add_lib "get-it"
    pub_has "go_router" && add_lib "go-router"
    pub_has "hive" && add_lib "hive"
    pub_has "json_serializable" && add_lib "json-serializable"
    pub_has "provider" && add_lib "provider"
    pub_has "retrofit" && add_lib "retrofit"
    pub_has "riverpod" && add_lib "riverpod"
    pub_has "sqflite" && add_lib "sqflite"
    ;;

  java|kotlin)
    gradle_has "androidx.room" && add_lib "room"
    gradle_has "com.fasterxml.jackson" && add_lib "jackson"
    gradle_has "com.squareup.okhttp3" && add_lib "okhttp"
    gradle_has "com.squareup.retrofit2" && add_lib "retrofit"
    gradle_has "dagger.hilt" && add_lib "hilt"
    gradle_has "hibernate-core" && add_lib "hibernate"
    gradle_has "kotlinx-coroutines" && add_lib "coroutines"
    gradle_has "lombok" && add_lib "lombok"
    gradle_has "mockito" && add_lib "mockito"
    gradle_has "org.junit.jupiter" && add_lib "junit5"
    gradle_has "spring-boot-starter-data-jpa" && add_lib "spring-data-jpa"
    gradle_has "spring-boot-starter" && add_lib "spring-boot"
    ;;

  csharp)
    nuget_has "AutoMapper" && add_lib "automapper"
    nuget_has "FluentValidation" && add_lib "fluent-validation"
    nuget_has "IdentityServer" && add_lib "identity-server"
    nuget_has "MediatR" && add_lib "mediatr"
    nuget_has "Microsoft.AspNetCore.SignalR" && add_lib "signalr"
    nuget_has "Microsoft.EntityFrameworkCore" && add_lib "entity-framework"
    nuget_has "Serilog" && add_lib "serilog"
    nuget_has "xunit" && add_lib "xunit"
    ;;
esac

# Build JSON array from LIBS (deduped, sorted). jq -R reads each line as a
# string, -s aggregates into a list, unique sorts and dedupes.
if [ ${#LIBS[@]} -eq 0 ]; then
  LIBRARIES_JSON='[]'
else
  LIBRARIES_JSON=$(printf '%s\n' "${LIBS[@]}" | jq -R . | jq -s 'unique')
fi

# ---------------------------------------------------------------------------
# 9. AUDIT COMMANDS
# ---------------------------------------------------------------------------
AUDIT_DEPS=""
AUDIT_LINT=""
AUDIT_TEST=""
AUDIT_FORMAT=""

case "$PACKAGE_MANAGER" in
  npm)      AUDIT_DEPS="npm audit --json" ;;
  yarn)     AUDIT_DEPS="yarn audit --json" ;;
  pnpm)     AUDIT_DEPS="pnpm audit --json" ;;
  composer) AUDIT_DEPS="composer audit --format=json" ;;
  pip|pipenv|poetry|uv) AUDIT_DEPS="pip-audit --format=json" ;;
  bundler)  AUDIT_DEPS="bundle audit check --format=json" ;;
  cargo)    AUDIT_DEPS="cargo audit --json" ;;
  go-mod)   AUDIT_DEPS="govulncheck ./..." ;;
  maven)    AUDIT_DEPS="mvn dependency-check:check" ;;
  pub)      AUDIT_DEPS="dart pub outdated --json" ;;
esac

case "$LANGUAGE" in
  php)       AUDIT_LINT="phpcs"; AUDIT_FORMAT="phpcbf" ;;
  python)    AUDIT_LINT="ruff check ."; AUDIT_FORMAT="black ." ;;
  go)        AUDIT_LINT="golangci-lint run"; AUDIT_FORMAT="gofmt -w ." ;;
  rust)      AUDIT_LINT="clippy"; AUDIT_FORMAT="rustfmt" ;;
  ruby)      AUDIT_LINT="rubocop"; AUDIT_FORMAT="rubocop -a" ;;
  javascript|typescript) AUDIT_LINT="eslint ."; AUDIT_FORMAT="prettier --write ." ;;
  dart)      AUDIT_LINT="dart analyze"; AUDIT_FORMAT="dart format ." ;;
esac

case "$FRAMEWORK" in
  wordpress) AUDIT_LINT="phpcs --standard=WordPress"; AUDIT_TEST="phpunit" ;;
  laravel)   AUDIT_TEST="php artisan test" ;;
  django)    AUDIT_TEST="python manage.py test" ;;
  rails)     AUDIT_TEST="bundle exec rspec" ;;
  nextjs)    AUDIT_TEST="npm test" ;;
  react-native) AUDIT_TEST="npx jest" ;;
  flutter)   AUDIT_TEST="flutter test" ;;
  *)         [ -z "$AUDIT_TEST" ] && AUDIT_TEST="" ;;
esac

# ---------------------------------------------------------------------------
# 10. GIT CONTEXT
# ---------------------------------------------------------------------------
GIT_BRANCH=""
GIT_UNCOMMITTED="0"
GIT_LAST_COMMIT=""
if [ -d "$PROJECT_DIR/.git" ]; then
  GIT_BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo "")
  GIT_UNCOMMITTED=$(git -C "$PROJECT_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  GIT_LAST_COMMIT=$(git -C "$PROJECT_DIR" log -1 --oneline 2>/dev/null || echo "")
fi

# ---------------------------------------------------------------------------
# 11. BUILD JSON PROFILE (via jq for safe escaping)
# ---------------------------------------------------------------------------
mkdir -p "$PROFILE_DIR"

# jq --arg makes every string safe (quotes, backslashes, unicode).
# --argjson injects pre-built JSON (our critical_files array).
jq -n \
  --arg generated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg language "$LANGUAGE" \
  --arg language_version "$LANGUAGE_VERSION" \
  --argjson has_typescript "$HAS_TYPESCRIPT" \
  --arg framework "$FRAMEWORK" \
  --arg sub_framework "$SUB_FRAMEWORK" \
  --arg project_type "$PROJECT_TYPE" \
  --arg package_manager "$PACKAGE_MANAGER" \
  --arg database "$DATABASE" \
  --argjson has_ui "$HAS_UI" \
  --argjson has_web "$HAS_WEB" \
  --argjson has_mobile_ui "$HAS_MOBILE_UI" \
  --argjson has_api "$HAS_API" \
  --argjson has_db "$HAS_DB" \
  --argjson handles_auth "$HANDLES_AUTH" \
  --argjson has_user_input "$HAS_USER_INPUT" \
  --argjson serves_traffic "$SERVES_TRAFFIC" \
  --argjson is_library "$IS_LIBRARY" \
  --argjson has_ci "$HAS_CI" \
  --argjson has_docker "$HAS_DOCKER" \
  --argjson has_i18n "$HAS_I18N" \
  --argjson has_ecommerce "$HAS_ECOMMERCE" \
  --argjson has_cms "$HAS_CMS" \
  --argjson cli_only "$CLI_ONLY" \
  --argjson data_pipeline "$DATA_PIPELINE" \
  --argjson headless "$HEADLESS" \
  --argjson serves_public "$SERVES_PUBLIC" \
  --arg cdn "$CDN" \
  --arg ci_tool "$CI_TOOL" \
  --arg git_branch "$GIT_BRANCH" \
  --argjson git_uncommitted "${GIT_UNCOMMITTED:-0}" \
  --arg git_last_commit "$GIT_LAST_COMMIT" \
  --argjson critical_files "$CRITICAL_FILES" \
  --argjson libraries "$LIBRARIES_JSON" \
  --arg audit_deps "$AUDIT_DEPS" \
  --arg audit_lint "$AUDIT_LINT" \
  --arg audit_test "$AUDIT_TEST" \
  --arg audit_format "$AUDIT_FORMAT" \
  '{
    version: 3,
    generated: $generated,
    detector: "skillforge-v3",
    language: $language,
    language_version: $language_version,
    has_typescript: $has_typescript,
    framework: (if $framework == "" then null else $framework end),
    sub_framework: (if $sub_framework == "" then null else $sub_framework end),
    project_type: $project_type,
    package_manager: $package_manager,
    database: (if $database == "" then null else $database end),
    characteristics: {
      has_ui: $has_ui,
      has_web: $has_web,
      has_mobile_ui: $has_mobile_ui,
      has_api: $has_api,
      has_db: $has_db,
      handles_auth: $handles_auth,
      has_user_input: $has_user_input,
      serves_traffic: $serves_traffic,
      is_library: $is_library,
      has_ci: $has_ci,
      has_docker: $has_docker,
      has_i18n: $has_i18n,
      has_ecommerce: $has_ecommerce,
      has_cms: $has_cms,
      cli_only: $cli_only,
      data_pipeline: $data_pipeline,
      headless: $headless,
      serves_public: $serves_public
    },
    infrastructure: {
      cdn: (if $cdn == "" then null else $cdn end),
      ci_tool: (if $ci_tool == "" then null else $ci_tool end),
      docker: $has_docker
    },
    git: {
      branch: (if $git_branch == "" then null else $git_branch end),
      uncommitted: $git_uncommitted,
      last_commit: (if $git_last_commit == "" then null else $git_last_commit end)
    },
    critical_files: $critical_files,
    libraries: $libraries,
    audit_commands: {
      deps: (if $audit_deps == "" then null else $audit_deps end),
      lint: (if $audit_lint == "" then null else $audit_lint end),
      test: (if $audit_test == "" then null else $audit_test end),
      format: (if $audit_format == "" then null else $audit_format end)
    }
  }' > "$PROFILE_FILE"

# ---------------------------------------------------------------------------
# 12. OUTPUT FOR CLAUDE CONTEXT
# ---------------------------------------------------------------------------
SELECTIONS_FILE="$PROFILE_DIR/skill-selections.json"

if [ ! -f "$SELECTIONS_FILE" ]; then
  # First run — prompt user to configure
  SUMMARY="NEW PROJECT: $LANGUAGE"
  [ -n "$FRAMEWORK" ] && SUMMARY="$SUMMARY / $FRAMEWORK"
  [ -n "$SUB_FRAMEWORK" ] && SUMMARY="$SUMMARY ($SUB_FRAMEWORK)"
  SUMMARY="$SUMMARY | Type: $PROJECT_TYPE"

  echo "{\"additionalContext\": \"SkillForge: $SUMMARY. Run /skillforge to select skills for this project.\"}"
else
  # Subsequent runs — load active skills
  ACTIVE=$(jq '[.selections | to_entries[] | select(.value.enabled==true) | .key] | length' "$SELECTIONS_FILE" 2>/dev/null || echo "0")
  echo "{\"additionalContext\": \"SkillForge: $ACTIVE skills active ($LANGUAGE${FRAMEWORK:+ / $FRAMEWORK}). Run /skillforge to manage.\"}"
fi
