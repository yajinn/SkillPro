/**
 * Disk-backed cache with TTL -- port of tree_cache.py.
 *
 * Used to cache GitHub Trees API results so that subsequent refreshes
 * within the TTL window skip the network call entirely.
 *
 * Cache location: ~/.config/skillpro/tree-cache.json
 * TTL: 24 hours
 * Format: { version: 1, entries: { [key]: { data, timestamp } } }
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const CACHE_VERSION = 1;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

interface CacheDoc {
  version: number;
  entries: Record<string, CacheEntry>;
}

function cachePath(): string {
  return join(homedir(), '.config', 'skillpro', 'tree-cache.json');
}

function loadCache(): CacheDoc {
  try {
    const raw = readFileSync(cachePath(), 'utf-8');
    const doc = JSON.parse(raw) as Record<string, unknown>;
    if (doc.version !== CACHE_VERSION) {
      return { version: CACHE_VERSION, entries: {} };
    }
    if (typeof doc.entries !== 'object' || doc.entries === null) {
      return { version: CACHE_VERSION, entries: {} };
    }
    return doc as unknown as CacheDoc;
  } catch {
    // File not found, parse error, etc.
    return { version: CACHE_VERSION, entries: {} };
  }
}

function saveCache(doc: CacheDoc): void {
  const path = cachePath();
  const dir = dirname(path);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // Directory already exists
  }
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
  renameSync(tmp, path);
}

/**
 * Get cached data for a key. Returns null if the cache entry is missing,
 * expired, or corrupt. Returns the cached data (including empty arrays)
 * if fresh.
 */
export function get(key: string): unknown | null {
  const doc = loadCache();
  const entry = doc.entries[key];
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const { timestamp, data } = entry;
  if (typeof timestamp !== 'number') {
    return null;
  }
  if (Date.now() - timestamp > CACHE_TTL_MS) {
    return null;
  }
  return data ?? null;
}

/**
 * Store data for a key with the current timestamp.
 */
export function set(key: string, data: unknown): void {
  const doc = loadCache();
  doc.entries[key] = {
    data,
    timestamp: Date.now(),
  };
  try {
    saveCache(doc);
  } catch {
    // Cache write errors should not break the caller.
  }
}

/**
 * Delete the entire cache file. No-op if it doesn't exist.
 */
export function clear(): void {
  try {
    unlinkSync(cachePath());
  } catch {
    // File not found -- that's fine.
  }
}
