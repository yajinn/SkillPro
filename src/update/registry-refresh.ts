/**
 * Registry auto-refresh — fetches latest skills-registry.json from GitHub
 * raw, cached locally with ETag for bandwidth efficiency.
 *
 * Strategy:
 * - Check remote via ETag (fast: 304 Not Modified = ~5ms)
 * - If 200 OK → update local overlay cache
 * - If 304 / error → use bundled registry
 * - 24h cache window
 *
 * Path: ~/.config/skillpro/registry-overlay.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getConfigDir } from './config.js';

const REGISTRY_RAW_URL =
  'https://raw.githubusercontent.com/yajinn/SkillPro/main/src/config/skills-registry.json';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — check more often than CLI
const FETCH_TIMEOUT_MS = 5000;

interface OverlayCache {
  /** ETag from the GitHub response */
  etag: string | null;
  /** Content SHA or Last-Modified */
  last_modified: string | null;
  /** When we last checked */
  fetched_at: number;
  /** Skill count in cached overlay (for reporting) */
  skill_count: number;
  /** Full overlay content (registry JSON) */
  data: unknown;
}

// ─── Paths ────────────────────────────────────────────────────────────

function getOverlayPath(): string {
  return join(getConfigDir(), 'registry-overlay.json');
}

function getCacheMetaPath(): string {
  return join(getConfigDir(), 'registry-cache-meta.json');
}

// ─── I/O helpers ──────────────────────────────────────────────────────

function readMeta(): { etag: string | null; fetched_at: number } | null {
  const path = getCacheMetaPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function writeMeta(etag: string | null, fetched_at: number): void {
  try {
    mkdirSync(dirname(getCacheMetaPath()), { recursive: true });
    writeFileSync(getCacheMetaPath(), JSON.stringify({ etag, fetched_at }));
  } catch { /* non-fatal */ }
}

function writeOverlay(data: unknown): void {
  try {
    mkdirSync(dirname(getOverlayPath()), { recursive: true });
    writeFileSync(getOverlayPath(), JSON.stringify(data));
  } catch { /* non-fatal */ }
}

function readOverlay(): unknown | null {
  const path = getOverlayPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

// ─── Remote fetch ─────────────────────────────────────────────────────

interface FetchResult {
  status: 'fresh' | 'cached' | 'skipped' | 'error';
  data: unknown | null;
  fetchedAt: number;
  skillCount?: number;
}

async function fetchRegistry(): Promise<FetchResult> {
  const meta = readMeta();
  const now = Date.now();

  // Skip if we checked recently
  if (meta && now - meta.fetched_at < CACHE_TTL_MS) {
    const cached = readOverlay();
    if (cached) {
      const cnt = (cached as { _meta?: { total_skills?: number } })._meta?.total_skills;
      return { status: 'cached', data: cached, fetchedAt: meta.fetched_at, skillCount: cnt };
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const headers: Record<string, string> = {
    'User-Agent': 'SkillPro/registry-refresh',
  };
  if (meta?.etag) headers['If-None-Match'] = meta.etag;

  try {
    const res = await fetch(REGISTRY_RAW_URL, { signal: controller.signal, headers });

    // 304: our cached copy is still valid
    if (res.status === 304) {
      writeMeta(meta?.etag ?? null, now);
      const cached = readOverlay();
      const cnt = (cached as { _meta?: { total_skills?: number } } | null)?._meta?.total_skills;
      return { status: 'cached', data: cached, fetchedAt: now, skillCount: cnt };
    }

    if (!res.ok) {
      return { status: 'error', data: null, fetchedAt: now };
    }

    const data = await res.json();
    const etag = res.headers.get('ETag');
    writeOverlay(data);
    writeMeta(etag, now);

    const skillCount = (data as { _meta?: { total_skills?: number } })._meta?.total_skills;
    return { status: 'fresh', data, fetchedAt: now, skillCount };
  } catch {
    // Network error — use stale cache if available
    const cached = readOverlay();
    if (cached) {
      const cnt = (cached as { _meta?: { total_skills?: number } })._meta?.total_skills;
      return { status: 'cached', data: cached, fetchedAt: meta?.fetched_at ?? 0, skillCount: cnt };
    }
    return { status: 'skipped', data: null, fetchedAt: now };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ───────────────────────────────────────────────────────

export interface RegistryRefreshResult {
  /** Was remote fetched? */
  status: 'fresh' | 'cached' | 'skipped' | 'error';
  /** Overlay data to use, or null if none */
  overlay: unknown | null;
  /** When overlay was fetched */
  fetchedAt: number;
  /** Skill count in overlay */
  skillCount?: number;
  /** Seconds ago for UI display */
  ageSeconds: number;
}

/**
 * Refresh registry from remote with ETag caching.
 * Returns metadata about cache state; overlay data is nullable.
 */
export async function refreshRegistry(): Promise<RegistryRefreshResult> {
  const result = await fetchRegistry();
  const ageSeconds = result.fetchedAt > 0
    ? Math.floor((Date.now() - result.fetchedAt) / 1000)
    : -1;
  return {
    status: result.status,
    overlay: result.data,
    fetchedAt: result.fetchedAt,
    skillCount: result.skillCount,
    ageSeconds,
  };
}

/**
 * Load the cached overlay (if any) WITHOUT triggering a network fetch.
 * Use this during early boot to layer over bundled registry synchronously.
 */
export function loadCachedOverlay(): unknown | null {
  return readOverlay();
}
