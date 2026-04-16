// ─── Manifest Readers ───────────────────────────────────────────────
// Cached file readers ported from detect.sh helpers (pkg_has, pip_has, etc.)
// Each manifest file is read ONCE per detection run and cached.
// ─────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ─── Caches ──────────────────────────────────────────────────────────

const fileContentCache = new Map<string, string | null>();
const fileExistsCache = new Map<string, boolean>();
const jsonCache = new Map<string, unknown>();

export function resetCache(): void {
  fileContentCache.clear();
  fileExistsCache.clear();
  jsonCache.clear();
}

// ─── Low-Level Helpers ───────────────────────────────────────────────

function cachedRead(path: string): string | null {
  if (fileContentCache.has(path)) return fileContentCache.get(path)!;
  try {
    const content = readFileSync(path, 'utf-8');
    fileContentCache.set(path, content);
    return content;
  } catch {
    fileContentCache.set(path, null);
    return null;
  }
}

export function fileExists(path: string): boolean {
  if (fileExistsCache.has(path)) return fileExistsCache.get(path)!;
  const exists = existsSync(path);
  fileExistsCache.set(path, exists);
  return exists;
}

export function readJson(path: string): unknown | null {
  if (jsonCache.has(path)) return jsonCache.get(path)!;
  const content = cachedRead(path);
  if (content === null) {
    jsonCache.set(path, null);
    return null;
  }
  try {
    const parsed = JSON.parse(content);
    jsonCache.set(path, parsed);
    return parsed;
  } catch {
    jsonCache.set(path, null);
    return null;
  }
}

/**
 * grep equivalent: case-insensitive substring/regex search in file content.
 */
export function fileContains(path: string, pattern: string): boolean {
  const content = cachedRead(path);
  if (content === null) return false;
  try {
    const re = new RegExp(pattern, 'i');
    return re.test(content);
  } catch {
    // If regex is invalid, fall back to case-insensitive indexOf
    return content.toLowerCase().includes(pattern.toLowerCase());
  }
}

export function dirExists(dir: string, sub: string): boolean {
  const full = join(dir, sub);
  const cacheKey = `__dir__${full}`;
  if (fileExistsCache.has(cacheKey)) return fileExistsCache.get(cacheKey)!;
  const result = isDir(full);
  fileExistsCache.set(cacheKey, result);
  return result;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function anyFileExists(dir: string, ...files: string[]): boolean {
  for (const f of files) {
    if (fileExists(join(dir, f))) return true;
  }
  return false;
}

// ─── Manifest Has Helpers ────────────────────────────────────────────

/**
 * Check if package.json contains a dependency name (prod or dev).
 * Uses simple string search on the raw file content, matching Bash behavior.
 */
export function pkgHas(dir: string, dep: string): boolean {
  const p = join(dir, 'package.json');
  if (!fileExists(p)) return false;
  const content = cachedRead(p);
  if (content === null) return false;
  return content.includes(dep);
}

/**
 * Check if any Python manifest (requirements.txt, pyproject.toml, Pipfile)
 * contains a dependency name (case-insensitive).
 */
export function pipHas(dir: string, dep: string): boolean {
  const files = ['requirements.txt', 'pyproject.toml', 'Pipfile'];
  const pattern = new RegExp(dep, 'i');
  for (const f of files) {
    const p = join(dir, f);
    const content = cachedRead(p);
    if (content !== null && pattern.test(content)) return true;
  }
  return false;
}

/**
 * Check if composer.json contains a dependency name (case-sensitive, matching Bash grep -q).
 */
export function composerHas(dir: string, dep: string): boolean {
  const p = join(dir, 'composer.json');
  if (!fileExists(p)) return false;
  const content = cachedRead(p);
  if (content === null) return false;
  return content.includes(dep);
}

/**
 * Check if pubspec.yaml contains a Dart/Flutter dependency name.
 * Matches lines like `  dep_name:` (leading whitespace, colon at end).
 */
export function pubHas(dir: string, dep: string): boolean {
  const p = join(dir, 'pubspec.yaml');
  if (!fileExists(p)) return false;
  const content = cachedRead(p);
  if (content === null) return false;
  const pattern = new RegExp(`^\\s*${dep}:`, 'im');
  return pattern.test(content);
}

/**
 * Check if Gemfile contains a gem reference.
 * Matches lines like `  gem 'name'` or `  gem "name"`.
 */
export function gemHas(dir: string, dep: string): boolean {
  const p = join(dir, 'Gemfile');
  if (!fileExists(p)) return false;
  const content = cachedRead(p);
  if (content === null) return false;
  const pattern = new RegExp(`^\\s*gem\\s*['"]${dep}['"]`, 'im');
  return pattern.test(content);
}

/**
 * Check if go.mod contains a dependency path (case-sensitive).
 */
export function goModHas(dir: string, dep: string): boolean {
  const p = join(dir, 'go.mod');
  if (!fileExists(p)) return false;
  const content = cachedRead(p);
  if (content === null) return false;
  return content.includes(dep);
}

/**
 * Check if Cargo.toml contains a dependency (matches `dep_name =` pattern).
 */
export function cargoHas(dir: string, dep: string): boolean {
  const p = join(dir, 'Cargo.toml');
  if (!fileExists(p)) return false;
  const content = cachedRead(p);
  if (content === null) return false;
  const pattern = new RegExp(`^\\s*${dep}\\s*=`, 'm');
  return pattern.test(content);
}

/**
 * Check if any Gradle/Maven build file contains a dependency pattern.
 * Searches pom.xml, build.gradle, build.gradle.kts, and app/ variants.
 */
export function gradleHas(dir: string, dep: string): boolean {
  const files = [
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'app/build.gradle',
    'app/build.gradle.kts',
  ];
  for (const f of files) {
    const p = join(dir, f);
    const content = cachedRead(p);
    if (content !== null && content.includes(dep)) return true;
  }
  return false;
}

/**
 * Check if any .csproj file (up to depth 2) contains a PackageReference include.
 */
export function nugetHas(dir: string, dep: string): boolean {
  // Walk up to depth 2 looking for .csproj files
  const csprojFiles = findCsprojFiles(dir, 2);
  for (const f of csprojFiles) {
    const content = cachedRead(f);
    if (content !== null && content.includes(dep)) return true;
  }
  return false;
}

/**
 * Find .csproj files up to maxDepth levels deep. Returns absolute paths.
 */
function findCsprojFiles(dir: string, maxDepth: number): string[] {
  const results: string[] = [];
  const cacheKey = `__csproj__${dir}__${maxDepth}`;
  // Use a simple cache key stored in fileContentCache
  const cached = fileContentCache.get(cacheKey);
  if (cached !== undefined) {
    return cached === null ? [] : JSON.parse(cached);
  }

  function walk(current: string, depth: number): void {
    if (depth > maxDepth) return;
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(current, entry.name);
        if (entry.isFile() && entry.name.endsWith('.csproj')) {
          results.push(full);
        } else if (entry.isDirectory() && depth < maxDepth) {
          // Skip common non-project dirs
          if (['node_modules', '.git', 'vendor', 'bin', 'obj'].includes(entry.name)) continue;
          walk(full, depth + 1);
        }
      }
    } catch {
      // Permission errors, etc.
    }
  }

  walk(dir, 0);
  fileContentCache.set(cacheKey, results.length > 0 ? JSON.stringify(results) : null);
  return results;
}

/**
 * Find .csproj or .sln files at depth 0-1 in a directory. Used by language detection.
 */
export function hasCsprojOrSln(dir: string, maxDepth = 2): boolean {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.csproj') || entry.name.endsWith('.sln'))) {
        return true;
      }
      if (entry.isDirectory() && maxDepth > 0) {
        const sub = join(dir, entry.name);
        if (['node_modules', '.git', 'vendor'].includes(entry.name)) continue;
        try {
          const subEntries = readdirSync(sub, { withFileTypes: true });
          for (const se of subEntries) {
            if (se.isFile() && (se.name.endsWith('.csproj') || se.name.endsWith('.sln'))) {
              return true;
            }
          }
        } catch {
          // skip
        }
      }
    }
  } catch {
    // skip
  }
  return false;
}

/**
 * Check if a directory contains .kt files (for Java vs Kotlin detection).
 */
export function hasKotlinFiles(dir: string): boolean {
  const srcDir = join(dir, 'src');
  if (!existsSync(srcDir)) return false;
  return walkForExtension(srcDir, '.kt', 3);
}

function walkForExtension(dir: string, ext: string, maxDepth: number, depth = 0): boolean {
  if (depth > maxDepth) return false;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(ext)) return true;
      if (entry.isDirectory()) {
        if (walkForExtension(join(dir, entry.name), ext, maxDepth, depth + 1)) return true;
      }
    }
  } catch {
    // skip
  }
  return false;
}

/**
 * Check if a directory contains .ipynb files (up to depth 2).
 */
export function hasNotebookFiles(dir: string): boolean {
  return walkForExtension(dir, '.ipynb', 2);
}
