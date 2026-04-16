// ─── Project Type Classification ────────────────────────────────────
// Ported from detect.sh section 3: Project Type Classification
// ─────────────────────────────────────────────────────────────────────

import { join } from 'node:path';
import { fileExists, fileContains, dirExists } from './manifest-readers.js';

/**
 * Classify the project type based on language, framework, and characteristics.
 *
 * Returns one of: web-frontend, web-fullstack, backend-api, mobile, desktop,
 * cli-tool, library, data-ml, cms-web, unknown
 */
export function detectProjectType(
  dir: string,
  language: string,
  framework: string | null,
): string {
  // ── Framework-driven classification ────────────────────────────────
  if (framework) {
    switch (framework) {
      case 'nextjs':
      case 'nuxtjs':
      case 'astro':
      case 'remix':
      case 'sveltekit':
      case 'angular':
      case 'vue':
      case 'vite':
        return 'web-frontend';

      case 'react-native':
      case 'flutter':
      case 'android-native':
      case 'maui':
        return 'mobile';

      case 'express':
      case 'fastify':
      case 'nestjs':
      case 'fastapi':
      case 'flask':
      case 'gin':
      case 'echo':
      case 'fiber':
      case 'actix':
      case 'axum':
      case 'rails':
      case 'sinatra':
      case 'spring-boot':
      case 'aspnet':
      case 'django':
        // Could be API or fullstack
        if (framework === 'django' && dirExists(dir, 'templates')) {
          return 'web-fullstack';
        }
        if (framework === 'rails' && dirExists(dir, 'app/views')) {
          return 'web-fullstack';
        }
        return 'backend-api';

      case 'wordpress':
      case 'drupal':
        return 'cms-web';

      case 'electron':
      case 'tauri':
        return 'desktop';

      case 'cobra-cli':
      case 'clap-cli':
        return 'cli-tool';

      case 'jupyter':
      case 'ml-pipeline':
      case 'streamlit':
        return 'data-ml';
    }
  }

  // ── Fallback classification by file patterns ───────────────────────
  if (fileExists(join(dir, 'main.go')) && !framework) {
    return 'cli-tool';
  }
  if (dirExists(dir, 'src') && fileExists(join(dir, 'Cargo.toml')) && !framework) {
    return 'cli-tool';
  }
  if (fileExists(join(dir, 'setup.py')) || fileExists(join(dir, 'setup.cfg'))) {
    return 'library';
  }
  if (
    fileExists(join(dir, 'package.json')) &&
    fileContains(join(dir, 'package.json'), '"main"')
  ) {
    return 'library';
  }

  return 'unknown';
}
