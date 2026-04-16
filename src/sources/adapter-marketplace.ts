/**
 * Marketplace adapter -- port of marketplace.py.
 *
 * Handles 3 shapes:
 *   Shape A: marketplace.json has `skills` array with full metadata dicts
 *   Shape B: marketplace.json has `skills` array with string paths to SKILL.md
 *   Shape C: No `skills` array -- discover via GitHub Trees API
 *
 * After building entries, applies enrichment overlay.
 */

import { httpGet } from './http.js';
import { parseFrontmatter } from './frontmatter.js';
import { inferFullMetadata, inferCategory } from './tag-inference.js';
import {
  loadEnrichment,
  applyEnrichmentToEntry,
} from './enrichment.js';
import * as cache from './cache.js';
import type { SkillEntry, SourceConfig } from '../types.js';

const MAX_SKILLS_PER_PLUGIN_FROM_TREE = 50;
const SUBPROBE_WORKERS = 8;

// Process-wide circuit breaker for GitHub Trees API rate limiting.
let treeApiRateLimited = false;

export function resetTreeApiRateLimit(): void {
  treeApiRateLimited = false;
}

// ---------------------------------------------------------------------------
// Concurrency limiter
// ---------------------------------------------------------------------------

async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => runNext(),
  );
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

const RAW_GITHUB_RE =
  /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\//;

function parseGithubRawUrl(
  url: string,
): { owner: string; repo: string; ref: string } | null {
  const m = url.match(RAW_GITHUB_RE);
  if (!m) return null;
  return { owner: m[1], repo: m[2], ref: m[3] };
}

function marketplaceRoot(marketplaceUrl: string): string {
  if (marketplaceUrl.endsWith('/.claude-plugin/marketplace.json')) {
    return marketplaceUrl.slice(
      0,
      -'/.claude-plugin/marketplace.json'.length,
    );
  }
  if (marketplaceUrl.endsWith('/marketplace.json')) {
    return marketplaceUrl.slice(0, -'/marketplace.json'.length);
  }
  return marketplaceUrl;
}

// ---------------------------------------------------------------------------
// Shape A: full metadata dict
// ---------------------------------------------------------------------------

function fromDict(
  skill: Record<string, unknown>,
  sourceName: string,
  sourceUrl: string,
): SkillEntry {
  return {
    id: skill.id as string,
    name: skill.name as string,
    description: (skill.description as string) ?? '',
    tags: Array.isArray(skill.tags) ? [...(skill.tags as string[])] : [],
    boost_when: Array.isArray(skill.boost_when)
      ? [...(skill.boost_when as string[])]
      : [],
    penalize_when: Array.isArray(skill.penalize_when)
      ? [...(skill.penalize_when as string[])]
      : [],
    default_for: Array.isArray(skill.default_for)
      ? [...(skill.default_for as string[])]
      : [],
    match_language: (skill.match_language as string | null) ?? null,
    match_framework: (skill.match_framework as string | null) ?? null,
    match_sub_framework: (skill.match_sub_framework as string | null) ?? null,
    install_url: skill.install_url as string,
    version: (skill.version as string | null) ?? null,
    commit_sha: (skill.commit_sha as string | null) ?? null,
    category: (skill.category as string | null) ?? null,
    popularity: (skill.popularity as number) ?? 0,
    match_libraries: Array.isArray(skill.match_libraries)
      ? [...(skill.match_libraries as string[])]
      : [],
    boost_libraries: Array.isArray(skill.boost_libraries)
      ? [...(skill.boost_libraries as string[])]
      : [],
    source: {
      name: sourceName,
      install_url: skill.install_url as string,
      commit_sha: (skill.commit_sha as string | null) ?? null,
      type: 'marketplace',
    },
  };
}

// ---------------------------------------------------------------------------
// Shape B: path-based SKILL.md fetch
// ---------------------------------------------------------------------------

async function fromPath(
  skillPath: string,
  plugin: Record<string, unknown>,
  marketplaceUrl: string,
  sourceName: string,
): Promise<SkillEntry | null> {
  const base = marketplaceRoot(marketplaceUrl);
  const path = skillPath.replace(/^\.\//, '').replace(/^\//, '');
  const skillMdUrl = `${base}/${path}/SKILL.md`;

  let body: string;
  try {
    body = await httpGet(skillMdUrl);
  } catch {
    return null;
  }

  const fm = parseFrontmatter(body);
  if (!fm || !fm.name) {
    return null;
  }

  const description =
    typeof fm.description === 'string' ? fm.description : '';
  const name = typeof fm.name === 'string' ? fm.name : '';
  const inferred = inferFullMetadata(description, name);
  const inferredCategory = inferCategory(
    description,
    name,
    inferred.tags,
    inferred.default_for,
  );

  const skillId = name || path.split('/').pop() || path;

  const entry: SkillEntry = {
    id: skillId,
    name: skillId,
    description,
    tags: inferred.tags,
    boost_when: inferred.boost_when,
    penalize_when: inferred.penalize_when,
    default_for: inferred.default_for,
    match_language: inferred.match_language,
    match_framework: null,
    match_sub_framework: null,
    install_url: skillMdUrl,
    version: (plugin.version as string | null) ?? null,
    commit_sha: null,
    category: inferredCategory,
    popularity: 0,
    match_libraries: [],
    boost_libraries: [],
    source: {
      name: sourceName,
      install_url: skillMdUrl,
      commit_sha: null,
      type: 'marketplace',
    },
  };

  const enrichment = loadEnrichment();
  return applyEnrichmentToEntry(entry, enrichment);
}

// ---------------------------------------------------------------------------
// Shape C: GitHub Trees API discovery
// ---------------------------------------------------------------------------

async function discoverSkillsViaTreeApi(
  owner: string,
  repo: string,
  ref: string,
): Promise<string[]> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`;

  // Cache lookup
  const cached = cache.get(apiUrl);
  if (cached !== null) {
    return cached as string[];
  }

  if (treeApiRateLimited) {
    return [];
  }

  let body: string;
  try {
    body = await httpGet(apiUrl);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('403') || msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
      treeApiRateLimited = true;
      console.error(
        '[marketplace] tree API rate limited -- suppressing further ' +
          'calls (set GITHUB_TOKEN to raise limit from 60/hr to 5000/hr)',
      );
    } else {
      console.error(
        `[marketplace] tree API failed for ${owner}/${repo}: ${err}`,
      );
    }
    return [];
  }

  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return [];
  }

  const tree = doc.tree;
  if (!Array.isArray(tree)) {
    return [];
  }

  const dirs: string[] = [];
  const seen = new Set<string>();

  for (const node of tree) {
    if (typeof node !== 'object' || node === null) continue;
    const nodePath = (node as Record<string, unknown>).path;
    if (typeof nodePath !== 'string') continue;

    if (nodePath.endsWith('/SKILL.md')) {
      const d = nodePath.slice(0, -'/SKILL.md'.length);
      if (!seen.has(d)) {
        seen.add(d);
        dirs.push(d);
      }
    } else if (nodePath === 'SKILL.md') {
      if (!seen.has('')) {
        seen.add('');
        dirs.push('');
      }
    }
  }

  // Persist to cache
  try {
    cache.set(apiUrl, dirs);
  } catch {
    // Cache write errors should not break discovery
  }

  return dirs;
}

// ---------------------------------------------------------------------------
// Plugin processing (handles all three shapes)
// ---------------------------------------------------------------------------

async function skillsFromPlugin(
  plugin: Record<string, unknown>,
  marketplaceUrl: string,
  sourceName: string,
): Promise<SkillEntry[]> {
  const skills = plugin.skills;
  if (skills !== undefined && skills !== null && !Array.isArray(skills)) {
    return [];
  }

  const skillsList = (skills as unknown[]) ?? [];

  // Shape A/B: explicit skills list present
  if (skillsList.length > 0) {
    const entries: SkillEntry[] = [];
    const tasks: Array<() => Promise<SkillEntry | null>> = [];

    for (const skill of skillsList) {
      if (typeof skill === 'object' && skill !== null && !Array.isArray(skill)) {
        // Shape A -- full metadata dict
        try {
          entries.push(
            fromDict(skill as Record<string, unknown>, sourceName, marketplaceUrl),
          );
        } catch (err) {
          console.error(
            `[marketplace] skipping malformed skill in ${marketplaceUrl}: ${err}`,
          );
        }
      } else if (typeof skill === 'string') {
        // Shape B -- path-based
        const skillPath = skill;
        tasks.push(() => fromPath(skillPath, plugin, marketplaceUrl, sourceName));
      }
    }

    if (tasks.length > 0) {
      const pathResults = await withConcurrency(
        tasks,
        Math.min(SUBPROBE_WORKERS, tasks.length),
      );
      for (const result of pathResults) {
        if (result !== null) {
          entries.push(result);
        }
      }
    }

    return entries;
  }

  // Shape C -- no skills array. Fall back to GitHub Trees API.
  const parsed = parseGithubRawUrl(marketplaceUrl);
  if (!parsed) {
    return [];
  }

  const { owner, repo, ref } = parsed;
  const skillDirs = await discoverSkillsViaTreeApi(owner, repo, ref);
  if (skillDirs.length === 0) {
    return [];
  }

  const capped = skillDirs.slice(0, MAX_SKILLS_PER_PLUGIN_FROM_TREE);
  const tasks = capped.map(
    (sd) => () => fromPath(sd, plugin, marketplaceUrl, sourceName),
  );

  const results = await withConcurrency(
    tasks,
    Math.min(SUBPROBE_WORKERS, tasks.length),
  );
  return results.filter((e): e is SkillEntry => e !== null);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchMarketplace(
  url: string,
  config: SourceConfig,
): Promise<SkillEntry[]> {
  let body: string;
  try {
    body = await httpGet(url);
  } catch {
    // 404s are expected when probing convention paths — stay silent
    return [];
  }

  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return [];
  }

  const plugins = doc.plugins;
  if (!Array.isArray(plugins)) {
    return [];
  }

  const entries: SkillEntry[] = [];
  for (const plugin of plugins) {
    if (typeof plugin !== 'object' || plugin === null || Array.isArray(plugin)) {
      continue;
    }
    const pluginEntries = await skillsFromPlugin(
      plugin as Record<string, unknown>,
      url,
      config.name,
    );
    entries.push(...pluginEntries);
  }

  return entries;
}

/**
 * Walk a repo's skill/ tree directly, without requiring marketplace.json.
 * Used by awesome-list adapter when no marketplace.json is found.
 */
export async function fetchRepoViaTreeApi(
  owner: string,
  repo: string,
  ref: string,
  sourceName: string,
): Promise<SkillEntry[]> {
  const syntheticPlugin: Record<string, unknown> = {
    name: repo,
    source: './',
  };
  const syntheticUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/.claude-plugin/marketplace.json`;
  return skillsFromPlugin(syntheticPlugin, syntheticUrl, sourceName);
}

export const marketplaceAdapter = {
  type: 'marketplace' as const,
  fetch: fetchMarketplace,
};
