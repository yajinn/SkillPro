// ─── Characteristics Detection ──────────────────────────────────────
// Ported from detect.sh section 6: Characteristics Detection
// 18 boolean flags describing project traits.
// ─────────────────────────────────────────────────────────────────────

import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import type { Characteristic } from '../types.js';
import {
  pkgHas,
  pipHas,
  composerHas,
  pubHas,
  fileExists,
  fileContains,
  dirExists,
} from './manifest-readers.js';

/**
 * Detect the 18 boolean characteristic flags for a project.
 */
export function detectCharacteristics(
  dir: string,
  language: string,
  framework: string | null,
  projectType: string,
  database: string | null,
): Record<Characteristic, boolean> {
  let has_ui = false;
  let has_web = false;
  let has_mobile_ui = false;
  let has_api = false;
  let has_db = false;
  let handles_auth = false;
  let has_user_input = false;
  let serves_traffic = false;
  let is_library = false;
  let has_ci = false;
  let has_docker = false;
  let has_i18n = false;
  let has_ecommerce = false;
  let has_cms = false;
  let cli_only = false;
  let data_pipeline = false;
  let headless = false;
  let serves_public = false;

  // ── Project-type based initial classification ──────────────────────
  switch (projectType) {
    case 'web-frontend':
    case 'web-fullstack':
    case 'cms-web':
      has_ui = true;
      has_web = true;
      serves_public = true;
      break;
    case 'mobile':
      has_ui = true;
      has_mobile_ui = true;
      break;
    case 'desktop':
      has_ui = true;
      break;
    case 'cli-tool':
      cli_only = true;
      has_user_input = true;
      break;
    case 'data-ml':
      data_pipeline = true;
      break;
    case 'backend-api':
      headless = true;
      has_api = true;
      serves_traffic = true;
      break;
    case 'library':
      is_library = true;
      break;
  }

  // ── API detection (deeper) ─────────────────────────────────────────
  if (!has_api) {
    if (
      dirExists(dir, 'app/api') ||
      dirExists(dir, 'pages/api') ||
      dirExists(dir, 'src/api') ||
      dirExists(dir, 'api')
    ) {
      has_api = true;
      serves_traffic = true;
    }
    if (
      fileExists(join(dir, 'openapi.yaml')) ||
      fileExists(join(dir, 'openapi.json')) ||
      fileExists(join(dir, 'swagger.json'))
    ) {
      has_api = true;
      serves_traffic = true;
    }
  }

  // ── Web detection (deeper) ─────────────────────────────────────────
  if (!has_web) {
    if (dirExists(dir, 'public') && hasHtmlFiles(join(dir, 'public'))) {
      has_web = true;
      has_ui = true;
    }
    if (
      dirExists(dir, 'templates') ||
      dirExists(dir, 'views') ||
      dirExists(dir, 'app/views')
    ) {
      has_web = true;
      has_ui = true;
    }
  }

  // ── Database ───────────────────────────────────────────────────────
  if (database) {
    has_db = true;
  }

  // ── Auth detection ─────────────────────────────────────────────────
  if (
    pkgHas(dir, '"next-auth"') ||
    pkgHas(dir, '"passport"') ||
    pkgHas(dir, '"@auth"') ||
    pipHas(dir, 'django.contrib.auth') ||
    pipHas(dir, 'authlib') ||
    composerHas(dir, 'laravel/sanctum') ||
    composerHas(dir, 'tymon/jwt-auth') ||
    pubHas(dir, 'firebase_auth') ||
    pubHas(dir, 'google_sign_in') ||
    pubHas(dir, 'flutter_appauth') ||
    pubHas(dir, 'local_auth') ||
    pubHas(dir, 'sign_in_with_apple') ||
    fileExists(join(dir, 'wp-login.php')) ||
    dirExists(dir, 'app/auth') ||
    dirExists(dir, 'src/auth')
  ) {
    handles_auth = true;
  }

  // ── User input ─────────────────────────────────────────────────────
  if (has_web || has_mobile_ui || has_api) {
    has_user_input = true;
  }

  // ── Serves traffic ─────────────────────────────────────────────────
  if (has_web || has_api) {
    serves_traffic = true;
  }

  // ── CI/CD ──────────────────────────────────────────────────────────
  if (
    dirExists(dir, '.github/workflows') ||
    fileExists(join(dir, '.gitlab-ci.yml')) ||
    fileExists(join(dir, 'Jenkinsfile')) ||
    fileExists(join(dir, '.circleci/config.yml')) ||
    fileExists(join(dir, 'bitbucket-pipelines.yml'))
  ) {
    has_ci = true;
  }

  // ── Docker ─────────────────────────────────────────────────────────
  if (
    fileExists(join(dir, 'Dockerfile')) ||
    fileExists(join(dir, 'docker-compose.yml')) ||
    fileExists(join(dir, 'docker-compose.yaml'))
  ) {
    has_docker = true;
  }

  // ── i18n ───────────────────────────────────────────────────────────
  if (
    pkgHas(dir, '"next-intl"') ||
    pkgHas(dir, '"i18next"') ||
    pkgHas(dir, '"react-intl"') ||
    dirExists(dir, 'locales') ||
    dirExists(dir, 'i18n') ||
    dirExists(dir, 'lang') ||
    dirExists(dir, 'translations') ||
    pipHas(dir, 'gettext') ||
    composerHas(dir, 'laravel-lang') ||
    pubHas(dir, 'intl') ||
    pubHas(dir, 'flutter_localizations') ||
    pubHas(dir, 'easy_localization') ||
    (fileExists(join(dir, 'next.config.js')) &&
      fileContains(join(dir, 'next.config.js'), 'i18n'))
  ) {
    has_i18n = true;
  }

  // ── E-commerce ─────────────────────────────────────────────────────
  if (
    (framework === 'wordpress' &&
      (dirExists(dir, 'wp-content/plugins/woocommerce') ||
        composerHas(dir, 'woocommerce'))) ||
    pkgHas(dir, '"stripe"') ||
    pkgHas(dir, '"@stripe"') ||
    pipHas(dir, 'stripe') ||
    composerHas(dir, 'stripe') ||
    pkgHas(dir, '"shopify"') ||
    pkgHas(dir, '"@lemonsqueezy"')
  ) {
    has_ecommerce = true;
  }

  // ── CMS ────────────────────────────────────────────────────────────
  if (
    framework === 'wordpress' ||
    framework === 'drupal' ||
    pkgHas(dir, '"contentful"') ||
    pkgHas(dir, '"sanity"') ||
    pkgHas(dir, '"strapi"')
  ) {
    has_cms = true;
  }

  return {
    has_ui,
    has_web,
    has_mobile_ui,
    has_api,
    has_db,
    handles_auth,
    has_user_input,
    serves_traffic,
    is_library,
    has_ci,
    has_docker,
    has_i18n,
    has_ecommerce,
    has_cms,
    cli_only,
    data_pipeline,
    headless,
    serves_public,
  };
}

/**
 * Check if a directory contains .html files (non-recursive).
 */
function hasHtmlFiles(dir: string): boolean {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    return entries.some(e => e.isFile() && e.name.endsWith('.html'));
  } catch {
    return false;
  }
}
