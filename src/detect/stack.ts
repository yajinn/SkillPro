/**
 * Smart stack detection — reads package.json (and other manifests) and
 * resolves the project's ACTUAL stack using a priority hierarchy.
 *
 * Key insight: A React Native project has "react" and often "ruby" (CocoaPods)
 * in its dependency tree, but the PROJECT is React Native, not React or Ruby.
 * The priority system ensures the most specific framework wins.
 *
 * Priority hierarchy examples:
 *   expo (95) > react-native (90) > react (50)
 *   nextjs (85) > react (50)
 *   nuxt (85) > vue (50)
 *   sveltekit (85) > svelte (50)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────

export interface StackDetectRule {
  packages: string[];
  files: string[];
}

export interface StackDefinition {
  id: string;
  name: string;
  detect: StackDetectRule;
  priority: number;
  parent: string | null;
  category: string;
}

export interface DetectedStack {
  /** Primary framework (highest priority match) */
  primary: StackDefinition;
  /** All detected stacks, sorted by priority desc */
  all: StackDefinition[];
  /** Raw dependencies from package.json */
  dependencies: string[];
  /** Project language */
  language: string;
  /** Package manager */
  packageManager: string;
}

// ─── Manifest readers ─────────────────────────────────────────────────

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

function readPackageJson(dir: string): PackageJson | null {
  const path = join(dir, 'package.json');
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PackageJson;
  } catch {
    return null;
  }
}

function readPythonDeps(dir: string): string[] {
  const deps: string[] = [];

  // requirements.txt
  try {
    const content = readFileSync(join(dir, 'requirements.txt'), 'utf-8');
    for (const line of content.split('\n')) {
      const pkg = line.trim().split(/[=<>!~\[#]/)[0]?.trim().toLowerCase();
      if (pkg) deps.push(pkg);
    }
  } catch { /* */ }

  // pyproject.toml (simple extraction)
  try {
    const content = readFileSync(join(dir, 'pyproject.toml'), 'utf-8');
    const depMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (depMatch) {
      for (const m of depMatch[1].matchAll(/"([^"]+)"/g)) {
        const pkg = m[1].split(/[=<>!~\[]/)[0]?.trim().toLowerCase();
        if (pkg) deps.push(pkg);
      }
    }
  } catch { /* */ }

  return deps;
}

function readComposerDeps(dir: string): string[] {
  try {
    const content = JSON.parse(readFileSync(join(dir, 'composer.json'), 'utf-8'));
    return [
      ...Object.keys(content.require ?? {}),
      ...Object.keys(content['require-dev'] ?? {}),
    ].map(d => d.toLowerCase());
  } catch {
    return [];
  }
}

function readGemfileDeps(dir: string): string[] {
  try {
    const content = readFileSync(join(dir, 'Gemfile'), 'utf-8');
    const gems: string[] = [];
    for (const m of content.matchAll(/gem\s+['"]([^'"]+)['"]/g)) {
      gems.push(m[1].toLowerCase());
    }
    return gems;
  } catch {
    return [];
  }
}

function readGoModDeps(dir: string): string[] {
  try {
    const content = readFileSync(join(dir, 'go.mod'), 'utf-8');
    const deps: string[] = [];
    // Match "  github.com/owner/repo vX.Y.Z" inside require blocks
    for (const m of content.matchAll(/\s+(github\.com\/[\w.-]+\/[\w.-]+|[\w.-]+\/[\w.-]+)(?:\s+v?\d|\s*\n)/g)) {
      deps.push(m[1].toLowerCase());
      // Also add without prefix for short matching (gin-gonic/gin -> gin)
      const parts = m[1].split('/');
      if (parts.length >= 2) deps.push(parts[parts.length - 1].toLowerCase());
    }
    return deps;
  } catch {
    return [];
  }
}

function readCargoDeps(dir: string): string[] {
  try {
    const content = readFileSync(join(dir, 'Cargo.toml'), 'utf-8');
    const deps: string[] = [];
    // Match [dependencies] and [dev-dependencies] sections
    const depsMatch = content.match(/\[(?:dev-)?dependencies\]([\s\S]*?)(?=\n\[|\n*$)/g);
    if (depsMatch) {
      for (const section of depsMatch) {
        for (const m of section.matchAll(/^([a-zA-Z0-9_-]+)\s*=/gm)) {
          deps.push(m[1].toLowerCase());
        }
      }
    }
    return deps;
  } catch {
    return [];
  }
}

function readPomDeps(dir: string): string[] {
  try {
    const content = readFileSync(join(dir, 'pom.xml'), 'utf-8');
    const deps: string[] = [];
    for (const m of content.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) {
      deps.push(m[1].toLowerCase());
    }
    return deps;
  } catch {
    return [];
  }
}

function readGradleDeps(dir: string): string[] {
  try {
    const content =
      (readFileSync(join(dir, 'build.gradle'), 'utf-8').toLowerCase() + '\n' ||
       readFileSync(join(dir, 'build.gradle.kts'), 'utf-8').toLowerCase() + '\n' || '');
    const deps: string[] = [];
    for (const m of content.matchAll(/['"]([a-z0-9.-]+:[a-z0-9.-]+)(?::[^'"]+)?['"]/g)) {
      deps.push(m[1]);
    }
    return deps;
  } catch {
    return [];
  }
}

/** Get all dependency names from package.json (deps + devDeps). */
function getAllJsDeps(pkg: PackageJson): string[] {
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];
}

// ─── Language detection ───────────────────────────────────────────────

function detectLanguage(dir: string, pkg: PackageJson | null): string {
  // JS/TS FIRST: if package.json has a real framework dependency, the project
  // is JS/TS regardless of Gemfile (CocoaPods), Python (scripts), etc.
  // This prevents React Native projects from being detected as Ruby.
  const JS_FRAMEWORK_MARKERS = [
    'react', 'react-native', 'expo', 'vue', 'next', 'nuxt', 'svelte',
    '@sveltejs/kit', 'angular', '@angular/core', 'astro', 'gatsby',
    'remix', '@remix-run/react', 'electron', '@tauri-apps/api',
    'express', 'fastify', 'hono', '@nestjs/core',
  ];

  if (pkg) {
    const deps = getAllJsDeps(pkg);
    if (deps.some((d) => JS_FRAMEWORK_MARKERS.includes(d))) {
      return existsSync(join(dir, 'tsconfig.json')) ? 'typescript' : 'javascript';
    }
  }

  // Non-JS languages — checked only when no JS framework is found
  if (existsSync(join(dir, 'pubspec.yaml'))) return 'dart';
  if (existsSync(join(dir, 'Cargo.toml'))) return 'rust';
  if (existsSync(join(dir, 'go.mod'))) return 'go';
  if (existsSync(join(dir, 'composer.json'))) return 'php';
  if (
    existsSync(join(dir, 'pyproject.toml')) ||
    existsSync(join(dir, 'setup.py')) ||
    existsSync(join(dir, 'requirements.txt')) ||
    existsSync(join(dir, 'Pipfile'))
  ) {
    return 'python';
  }
  if (existsSync(join(dir, 'Gemfile'))) return 'ruby';
  if (existsSync(join(dir, 'pom.xml')) || existsSync(join(dir, 'build.gradle'))) return 'java';

  // Fallback JS/TS (has package.json but no framework)
  if (pkg) {
    return existsSync(join(dir, 'tsconfig.json')) ? 'typescript' : 'javascript';
  }

  return 'unknown';
}

// ─── Package manager detection ────────────────────────────────────────

function detectPackageManager(dir: string, language: string): string {
  if (language === 'python') {
    if (existsSync(join(dir, 'poetry.lock'))) return 'poetry';
    if (existsSync(join(dir, 'Pipfile.lock'))) return 'pipenv';
    if (existsSync(join(dir, 'uv.lock'))) return 'uv';
    return 'pip';
  }
  if (language === 'php') return 'composer';
  if (language === 'ruby') return 'bundler';
  if (language === 'rust') return 'cargo';
  if (language === 'go') return 'go';
  if (language === 'dart') return 'pub';
  if (language === 'java') {
    return existsSync(join(dir, 'pom.xml')) ? 'maven' : 'gradle';
  }

  // JS/TS package managers
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun';
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

// ─── Stack matching ───────────────────────────────────────────────────

function matchStack(
  stack: StackDefinition,
  deps: Set<string>,
  dir: string,
): boolean {
  const hasPackages = stack.detect.packages.length > 0;
  const hasFiles = stack.detect.files.length > 0;

  const packageMatch = hasPackages && stack.detect.packages.some((p) => deps.has(p));
  const fileMatch = hasFiles && stack.detect.files.some((f) => existsSync(join(dir, f)));

  // If the stack defines packages, at least one MUST be present.
  // Files alone are not enough — prevents app.json from matching Expo
  // in React Native CLI projects, etc.
  if (hasPackages) return packageMatch;

  // File-only stacks (e.g. Flutter with pubspec.yaml, Terraform with main.tf)
  if (hasFiles) return fileMatch;

  return false;
}

/**
 * Filter out stacks that are just "build noise":
 * e.g., Ruby (from Gemfile for CocoaPods) in a React Native project
 */
function filterBuildNoise(
  matched: StackDefinition[],
  language: string,
): StackDefinition[] {
  // If we have a JS/TS framework AND Ruby detected, Ruby is CocoaPods noise
  const hasJsFramework = matched.some(
    (s) => s.category === 'mobile' || s.category === 'web-frontend' || s.category === 'web-fullstack',
  );

  if (hasJsFramework) {
    return matched.filter((s) => s.id !== 'rails' || language === 'ruby');
  }

  return matched;
}

// ─── Public API ───────────────────────────────────────────────────────

export function detectStack(
  dir: string,
  stacks: StackDefinition[],
): DetectedStack {
  const pkg = readPackageJson(dir);
  const language = detectLanguage(dir, pkg);
  const packageManager = detectPackageManager(dir, language);

  // Collect ALL dependencies across all manifest types
  const allDeps: string[] = [];

  if (pkg) allDeps.push(...getAllJsDeps(pkg));
  if (language === 'python') allDeps.push(...readPythonDeps(dir));
  if (language === 'php') allDeps.push(...readComposerDeps(dir));
  if (language === 'ruby') allDeps.push(...readGemfileDeps(dir));
  if (language === 'go') allDeps.push(...readGoModDeps(dir));
  if (language === 'rust') allDeps.push(...readCargoDeps(dir));
  if (language === 'java') {
    allDeps.push(...readPomDeps(dir));
    allDeps.push(...readGradleDeps(dir));
  }

  const depsSet = new Set(allDeps.map((d) => d.toLowerCase()));

  // Match against all stack definitions
  let matched = stacks.filter((s) => matchStack(s, depsSet, dir));

  // Filter build noise
  matched = filterBuildNoise(matched, language);

  // Sort by priority descending
  matched.sort((a, b) => b.priority - a.priority);

  // The primary stack is the highest-priority match
  const primary = matched[0] ?? {
    id: language,
    name: language,
    detect: { packages: [], files: [] },
    priority: 0,
    parent: null,
    category: 'unknown',
  };

  return {
    primary,
    all: matched,
    dependencies: allDeps,
    language,
    packageManager,
  };
}
