/**
 * CLI self-update check — queries npm for the latest skillpro version
 * and shows a banner if a newer version exists.
 *
 * Cached for 24h at ~/.config/skillpro/version-check.json.
 * Never blocks the user — warning only.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getConfigDir } from './config.js';

const NPM_REGISTRY = 'https://registry.npmjs.org/skillpro/latest';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 3000; // 3s — don't slow down startup

interface VersionCache {
  latest_version: string;
  checked_at: number; // epoch ms
}

// ─── Version comparison ───────────────────────────────────────────────

/** Returns 1 if a > b, -1 if a < b, 0 if equal. Handles semver major.minor.patch. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// ─── Cache I/O ────────────────────────────────────────────────────────

function getCachePath(): string {
  return join(getConfigDir(), 'version-check.json');
}

function readCache(): VersionCache | null {
  const path = getCachePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as VersionCache;
  } catch {
    return null;
  }
}

function writeCache(cache: VersionCache): void {
  const path = getCachePath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache) + '\n');
  } catch {
    // Can't write cache — non-fatal
  }
}

// ─── Remote fetch ─────────────────────────────────────────────────────

async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(NPM_REGISTRY, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'SkillPro/auto-update',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const doc = (await res.json()) as { version?: string };
    return doc.version ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ───────────────────────────────────────────────────────

export interface CliUpdateResult {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
}

/**
 * Check if a newer version of skillpro is available on npm.
 * Uses 24h cache to avoid hitting npm on every run.
 * Returns null-latest if check skipped or failed (never throws).
 */
export async function checkCliUpdate(
  currentVersion: string,
): Promise<CliUpdateResult> {
  const cached = readCache();
  const now = Date.now();

  // Use cached result if still fresh
  if (cached && now - cached.checked_at < CACHE_TTL_MS) {
    return {
      current: currentVersion,
      latest: cached.latest_version,
      updateAvailable: compareVersions(cached.latest_version, currentVersion) > 0,
    };
  }

  // Fetch fresh
  const latest = await fetchLatestVersion();
  if (!latest) {
    // Network failure — if we have stale cache, use it
    if (cached) {
      return {
        current: currentVersion,
        latest: cached.latest_version,
        updateAvailable: compareVersions(cached.latest_version, currentVersion) > 0,
      };
    }
    return { current: currentVersion, latest: null, updateAvailable: false };
  }

  // Cache and return
  writeCache({ latest_version: latest, checked_at: now });
  return {
    current: currentVersion,
    latest,
    updateAvailable: compareVersions(latest, currentVersion) > 0,
  };
}
