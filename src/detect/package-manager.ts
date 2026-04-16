// ─── Package Manager Detection ──────────────────────────────────────
// Ported from detect.sh section 4: Package Manager Detection
// ─────────────────────────────────────────────────────────────────────

import { join } from 'node:path';
import { fileExists, anyFileExists } from './manifest-readers.js';

/**
 * Detect the package manager in use.
 *
 * For JavaScript: pnpm > yarn > bun > npm (by lockfile)
 * For Python: poetry > pipenv > uv > pip (by lockfile)
 * Others: single canonical manager per language
 */
export function detectPackageManager(dir: string, language: string): string {
  // JS-specific lockfiles take priority over language-generic detection
  if (fileExists(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fileExists(join(dir, 'yarn.lock'))) return 'yarn';
  if (fileExists(join(dir, 'bun.lockb'))) return 'bun';
  if (fileExists(join(dir, 'package-lock.json'))) return 'npm';

  // PHP
  if (
    fileExists(join(dir, 'composer.lock')) ||
    fileExists(join(dir, 'composer.json'))
  ) {
    return 'composer';
  }

  // Python lockfiles
  if (fileExists(join(dir, 'Pipfile.lock'))) return 'pipenv';
  if (fileExists(join(dir, 'poetry.lock'))) return 'poetry';
  if (fileExists(join(dir, 'uv.lock'))) return 'uv';
  if (fileExists(join(dir, 'requirements.txt'))) return 'pip';

  // Ruby
  if (fileExists(join(dir, 'Gemfile.lock'))) return 'bundler';

  // Go
  if (fileExists(join(dir, 'go.sum'))) return 'go-mod';

  // Rust
  if (fileExists(join(dir, 'Cargo.lock'))) return 'cargo';

  // Java / Kotlin
  if (fileExists(join(dir, 'pom.xml'))) return 'maven';
  if (anyFileExists(dir, 'build.gradle', 'build.gradle.kts')) return 'gradle';

  // Dart
  if (
    fileExists(join(dir, 'pubspec.lock')) ||
    fileExists(join(dir, 'pubspec.yaml'))
  ) {
    return 'pub';
  }

  // Fallback: if package.json exists but no lockfile was found
  if (fileExists(join(dir, 'package.json'))) return 'npm';

  return 'unknown';
}
