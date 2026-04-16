// ─── Detection Engine Orchestrator ──────────────────────────────────
// Calls all sub-detectors and returns a complete ProjectProfile.
// ─────────────────────────────────────────────────────────────────────

import type { ProjectProfile, Characteristic } from '../types.js';
import { resetCache } from './manifest-readers.js';
import { resolveProjectRoot } from './monorepo.js';
import { detectLanguage } from './language.js';
import { detectFramework } from './framework.js';
import { detectProjectType } from './project-type.js';
import { detectPackageManager } from './package-manager.js';
import { detectDatabase } from './database.js';
import { detectCharacteristics } from './characteristics.js';
import { detectLibraries } from './libraries.js';
import { detectInfrastructure } from './infrastructure.js';

/**
 * Run full project detection on the given directory.
 * Returns a complete ProjectProfile with all detected attributes.
 */
export function detect(dir: string): ProjectProfile {
  // Reset caches from any previous run
  resetCache();

  // ── 0. Monorepo resolution ─────────────────────────────────────────
  const resolvedDir = resolveProjectRoot(dir);
  const monorepoHoist = resolvedDir !== dir;

  // ── 1. Language ────────────────────────────────────────────────────
  const { language, version } = detectLanguage(resolvedDir);

  // ── 2. Framework ───────────────────────────────────────────────────
  const { framework, sub_framework } = detectFramework(resolvedDir, language);

  // ── 3. Project type ────────────────────────────────────────────────
  const projectType = detectProjectType(resolvedDir, language, framework);

  // ── 4. Package manager ─────────────────────────────────────────────
  const packageManager = detectPackageManager(resolvedDir, language);

  // ── 5. Database ────────────────────────────────────────────────────
  const database = detectDatabase(resolvedDir, language);

  // ── 6. Characteristics ─────────────────────────────────────────────
  const characteristics = detectCharacteristics(
    resolvedDir,
    language,
    framework,
    projectType,
    database,
  );

  // ── 7. Libraries ───────────────────────────────────────────────────
  const libraries = detectLibraries(resolvedDir, language);

  // ── 8. Infrastructure ──────────────────────────────────────────────
  const infrastructure = detectInfrastructure(resolvedDir);

  // ── 9. Critical files ──────────────────────────────────────────────
  const criticalFiles = buildCriticalFiles(
    language,
    framework,
    characteristics,
    infrastructure,
  );

  return {
    language,
    language_version: version,
    framework,
    sub_framework,
    project_type: projectType,
    package_manager: packageManager,
    database,
    characteristics,
    libraries,
    critical_files: criticalFiles,
    infrastructure,
    monorepo_hoist: monorepoHoist,
    detection_dir: resolvedDir,
  };
}

/**
 * Build the critical files list based on language, framework, and infrastructure.
 * Ported from detect.sh section 8.
 */
function buildCriticalFiles(
  language: string,
  framework: string | null,
  characteristics: Record<Characteristic, boolean>,
  infrastructure: { cdn: string | null; ci_tool: string | null; docker: boolean },
): string[] {
  const files = new Set<string>(['.env', '.env.local', '.env.production']);

  // Language-specific
  switch (language) {
    case 'php':
      files.add('composer.json');
      files.add('composer.lock');
      break;
    case 'javascript':
    case 'typescript':
      files.add('package.json');
      break;
    case 'python':
      files.add('pyproject.toml');
      files.add('requirements.txt');
      break;
    case 'go':
      files.add('go.mod');
      files.add('go.sum');
      break;
    case 'rust':
      files.add('Cargo.toml');
      files.add('Cargo.lock');
      break;
    case 'ruby':
      files.add('Gemfile');
      files.add('Gemfile.lock');
      break;
    case 'dart':
      files.add('pubspec.yaml');
      files.add('pubspec.lock');
      break;
  }

  // Framework-specific
  switch (framework) {
    case 'nextjs':
      files.add('next.config.ts');
      files.add('next.config.js');
      files.add('next.config.mjs');
      files.add('middleware.ts');
      files.add('app/layout.tsx');
      files.add('app/layout.jsx');
      break;
    case 'wordpress':
      files.add('wp-config.php');
      files.add('.htaccess');
      files.add('functions.php');
      break;
    case 'laravel':
      files.add('artisan');
      files.add('config/app.php');
      files.add('config/database.php');
      files.add('routes/web.php');
      files.add('routes/api.php');
      break;
    case 'django':
      files.add('manage.py');
      files.add('settings.py');
      files.add('urls.py');
      break;
    case 'react-native':
      files.add('react-native.config.js');
      files.add('metro.config.js');
      files.add('babel.config.js');
      files.add('android/app/build.gradle');
      files.add('ios/Podfile');
      break;
    case 'flutter':
      files.add('android/app/build.gradle');
      files.add('android/app/src/main/AndroidManifest.xml');
      files.add('ios/Podfile');
      files.add('ios/Runner/Info.plist');
      files.add('lib/main.dart');
      break;
    case 'rails':
      files.add('config/routes.rb');
      files.add('config/database.yml');
      files.add('db/schema.rb');
      break;
  }

  // Infrastructure
  if (characteristics.has_docker) {
    files.add('Dockerfile');
    files.add('docker-compose.yml');
    files.add('docker-compose.yaml');
  }
  if (characteristics.has_ci && infrastructure.ci_tool) {
    switch (infrastructure.ci_tool) {
      case 'github-actions':
        files.add('.github/workflows');
        break;
      case 'gitlab-ci':
        files.add('.gitlab-ci.yml');
        break;
    }
  }

  // Sort and return as array (deduplicated via Set)
  return Array.from(files).sort();
}
