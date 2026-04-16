// ─── Monorepo / Multi-Project Resolution ────────────────────────────
// Ported from detect.sh section 0.5: Monorepo Hoist Logic
// Finds the best project root when cwd is a parent directory.
// ─────────────────────────────────────────────────────────────────────

import { join } from 'node:path';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { fileExists } from './manifest-readers.js';

const MANIFESTS = [
  'composer.json', 'pyproject.toml', 'requirements.txt', 'setup.py',
  'Pipfile', 'manage.py', 'go.mod', 'Cargo.toml', 'pom.xml',
  'build.gradle', 'build.gradle.kts', 'settings.gradle', 'Gemfile',
  'Rakefile', 'config.ru', 'global.json', 'package.json', 'pubspec.yaml',
];

const SCORE_MANIFESTS = [
  'package.json', 'tsconfig.json', 'composer.json', 'pyproject.toml',
  'requirements.txt', 'Pipfile', 'go.mod', 'Cargo.toml', 'Gemfile',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'pubspec.yaml',
  'Makefile', 'README.md', 'README.rst', '.gitignore',
];

const SCORE_DIRS = [
  'src', 'lib', 'app', 'ios', 'android', 'tests', 'test', 'spec',
  'cmd', 'internal', 'pkg',
];

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'vendor', '.venv', 'venv', '__pycache__',
  'dist', 'build', '.next', '.nuxt',
]);

/**
 * Check if a directory has a root-level manifest file (fast path).
 */
function hasRootManifest(base: string): boolean {
  for (const m of MANIFESTS) {
    if (fileExists(join(base, m))) return true;
  }
  // Check for .csproj / .sln at root
  try {
    const entries = readdirSync(base, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && (e.name.endsWith('.csproj') || e.name.endsWith('.sln'))) {
        return true;
      }
    }
  } catch {
    // skip
  }
  return false;
}

/**
 * Score a candidate directory based on manifest files and project markers.
 */
function scoreCandidate(dir: string): number {
  let score = 0;
  for (const m of SCORE_MANIFESTS) {
    if (fileExists(join(dir, m))) score++;
  }
  for (const d of SCORE_DIRS) {
    const full = join(dir, d);
    try {
      if (existsSync(full) && statSync(full).isDirectory()) score++;
    } catch {
      // skip
    }
  }
  return score;
}

/**
 * Recursively find directories containing manifest files, up to maxDepth.
 */
function findManifestDirs(base: string, maxDepth: number): Array<{ dir: string; depth: number }> {
  const results: Array<{ dir: string; depth: number }> = [];

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      let hasManifest = false;

      for (const e of entries) {
        if (e.isFile()) {
          // Check if this is a recognized manifest
          if (
            MANIFESTS.includes(e.name) ||
            e.name.endsWith('.csproj') ||
            e.name.endsWith('.sln')
          ) {
            hasManifest = true;
          }
        }
      }

      if (hasManifest && dir !== base) {
        // Compute depth relative to base
        const rel = dir.slice(base.length + 1);
        const relDepth = rel ? rel.split('/').length : 0;
        results.push({ dir, depth: relDepth });
      }

      // Recurse into subdirectories
      for (const e of entries) {
        if (e.isDirectory() && !SKIP_DIRS.has(e.name)) {
          walk(join(dir, e.name), depth + 1);
        }
      }
    } catch {
      // Permission errors, etc.
    }
  }

  walk(base, 0);
  return results;
}

/**
 * Resolve the effective project root directory.
 *
 * If the given directory has a root-level manifest, returns it as-is (fast path).
 * Otherwise, walks up to 3 levels deep looking for the best candidate subdirectory
 * with the most project markers. Shallower directories win ties.
 *
 * Returns the resolved directory path.
 */
export function resolveProjectRoot(dir: string): string {
  // Fast path: if the parent itself has a manifest, detection works correctly
  if (hasRootManifest(dir)) {
    return dir;
  }

  // Slow path: walk subdirs up to depth 3 and score each candidate
  const candidates = findManifestDirs(dir, 3);

  if (candidates.length === 0) {
    return dir;
  }

  let bestDir = '';
  let bestScore = -1;

  for (const { dir: candidateDir, depth } of candidates) {
    const score = scoreCandidate(candidateDir);
    // adjusted = score * 10 - depth (shallower wins ties)
    const adjusted = score * 10 - depth;
    if (adjusted > bestScore) {
      bestScore = adjusted;
      bestDir = candidateDir;
    }
  }

  return bestDir || dir;
}
