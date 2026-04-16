// ─── Language Detection ─────────────────────────────────────────────
// Ported from detect.sh section 1: Language Detection
// Priority cascade mirrors Bash exactly.
// ─────────────────────────────────────────────────────────────────────

import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  pkgHas,
  fileExists,
  anyFileExists,
  hasCsprojOrSln,
  hasKotlinFiles,
} from './manifest-readers.js';

/**
 * Detect the primary language and its runtime version.
 *
 * 1. Pre-pass: JS/TS framework deps lock to javascript/typescript immediately
 * 2. Cascade: PHP > Python > Go > Rust > Java/Kotlin > Ruby > C# > JS/TS > Dart
 * 3. TypeScript override: if language is javascript and tsconfig.json exists
 */
export function detectLanguage(dir: string): { language: string; version: string } {
  let language = 'unknown';
  let version = '';

  // ── Pre-pass: strong JS/TS framework deps ──────────────────────────
  const hasPkgJson = fileExists(join(dir, 'package.json'));

  const jsFrameworkDeps = hasPkgJson && (
    pkgHas(dir, '"react-native"') ||
    pkgHas(dir, '"expo"') ||
    pkgHas(dir, '"next"') ||
    pkgHas(dir, '"nuxt"') ||
    pkgHas(dir, '"vue"') ||
    pkgHas(dir, '"@angular/core"') ||
    pkgHas(dir, '"astro"') ||
    pkgHas(dir, '"@remix-run"') ||
    pkgHas(dir, '"@sveltejs/kit"') ||
    pkgHas(dir, '"svelte"') ||
    pkgHas(dir, '"@nestjs/core"') ||
    pkgHas(dir, '"electron"') ||
    pkgHas(dir, '"tauri"') ||
    pkgHas(dir, '"vite"')
  );

  const jsConfigFiles = anyFileExists(
    dir,
    'react-native.config.js',
    'next.config.js', 'next.config.ts', 'next.config.mjs',
    'nuxt.config.js', 'nuxt.config.ts',
    'astro.config.mjs', 'astro.config.ts',
    'remix.config.js', 'remix.config.ts',
    'svelte.config.js', 'svelte.config.ts',
    'angular.json', 'vue.config.js',
  );

  if (jsFrameworkDeps || jsConfigFiles) {
    language = fileExists(join(dir, 'tsconfig.json')) ? 'typescript' : 'javascript';
    version = safeVersion('node', ['-v'], /v?([\d.]+)/);
  }

  // ── Manifest cascade (only if pre-pass didn't lock) ────────────────
  if (language === 'unknown') {
    if (
      anyFileExists(dir, 'composer.json', 'index.php', 'wp-config.php', 'artisan')
    ) {
      language = 'php';
      version = safeVersion('php', ['-v'], /([\d]+\.[\d]+)/);
    } else if (
      anyFileExists(dir, 'pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile', 'manage.py')
    ) {
      language = 'python';
      version = safeVersion('python3', ['--version'], /([\d]+\.[\d]+)/);
    } else if (fileExists(join(dir, 'go.mod'))) {
      language = 'go';
      version = safeVersion('go', ['version'], /([\d]+\.[\d]+)/);
    } else if (fileExists(join(dir, 'Cargo.toml'))) {
      language = 'rust';
      version = safeVersion('rustc', ['--version'], /([\d]+\.[\d]+)/);
    } else if (
      anyFileExists(dir, 'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle')
    ) {
      language = hasKotlinFiles(dir) ? 'kotlin' : 'java';
      version = safeVersion('java', ['--version'], /([\d]+)/);
    } else if (anyFileExists(dir, 'Gemfile', 'Rakefile', 'config.ru')) {
      language = 'ruby';
      version = safeVersion('ruby', ['-v'], /([\d]+\.[\d]+)/);
    } else if (
      fileExists(join(dir, 'global.json')) || hasCsprojOrSln(dir)
    ) {
      language = 'csharp';
      version = safeVersion('dotnet', ['--version'], /([\d]+\.[\d]+\.?[\d]*)/);
    } else if (fileExists(join(dir, 'package.json'))) {
      language = fileExists(join(dir, 'tsconfig.json')) ? 'typescript' : 'javascript';
      version = safeVersion('node', ['-v'], /v?([\d.]+)/);
    } else if (fileExists(join(dir, 'pubspec.yaml'))) {
      language = 'dart';
      version = safeVersion('dart', ['--version'], /([\d]+\.[\d]+)/);
    }
  }

  // ── TypeScript override ────────────────────────────────────────────
  if (language === 'javascript' && fileExists(join(dir, 'tsconfig.json'))) {
    language = 'typescript';
  }

  return { language, version };
}

/**
 * Run a command via execFileSync (no shell injection risk), extract a version
 * via regex, return empty string on failure.
 */
function safeVersion(cmd: string, args: string[], pattern: RegExp): string {
  try {
    const output = execFileSync(cmd, args, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const match = output.match(pattern);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}
