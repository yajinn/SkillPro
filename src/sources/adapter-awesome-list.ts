/**
 * Awesome-list adapter -- port of awesome_list.py.
 *
 * Fetches a README markdown file, extracts GitHub repo URLs, then
 * probes each repo for marketplace.json at convention paths. If found,
 * delegates to the marketplace adapter. Deduplicates results by skill ID.
 */

import { httpGet } from './http.js';
import { fetchMarketplace } from './adapter-marketplace.js';
import type { SkillEntry, SourceConfig } from '../types.js';

const MAX_PROBES = 20;
const SUBPROBE_WORKERS = 8;

// Match https://github.com/<owner>/<repo>[/...] where owner and repo are
// non-empty segments that don't contain slashes or whitespace.
const GH_RE =
  /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?=[/)\s]|$)/g;

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
// GitHub repo extraction
// ---------------------------------------------------------------------------

export function extractGithubRepos(
  markdown: string,
): Array<[string, string]> {
  const seen: Array<[string, string]> = [];
  const seenSet = new Set<string>();

  for (const m of markdown.matchAll(GH_RE)) {
    const owner = m[1];
    let repo = m[2];
    if (repo.endsWith('.git')) {
      repo = repo.slice(0, -4);
    }
    const key = `${owner}/${repo}`;
    if (!seenSet.has(key)) {
      seenSet.add(key);
      seen.push([owner, repo]);
    }
  }

  return seen;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export async function fetchAwesomeList(
  url: string,
  config: SourceConfig,
): Promise<SkillEntry[]> {
  let body: string;
  try {
    body = await httpGet(url);
  } catch (err) {
    console.error(`[awesome-list] fetch failed for ${url}: ${err}`);
    return [];
  }

  const repos = extractGithubRepos(body).slice(0, MAX_PROBES);
  if (repos.length === 0) {
    return [];
  }

  // Claude Code convention: .claude-plugin/marketplace.json
  // Legacy / alternative: root marketplace.json
  const candidatePaths = [
    '.claude-plugin/marketplace.json',
    'marketplace.json',
  ];

  const tasks = repos.map(
    ([owner, repo]) =>
      async (): Promise<SkillEntry[]> => {
        // Try convention marketplace.json locations first
        for (const candidate of candidatePaths) {
          const mpUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${candidate}`;
          const syntheticConfig: SourceConfig = {
            ...config,
            name: config.name,
            url: mpUrl,
          };
          const found = await fetchMarketplace(mpUrl, syntheticConfig);
          if (found.length > 0) {
            return found;
          }
        }
        return [];
      },
  );

  const results = await withConcurrency(tasks, SUBPROBE_WORKERS);

  // Flatten and deduplicate by skill ID
  const entries: SkillEntry[] = [];
  const seenIds = new Set<string>();
  for (const batch of results) {
    for (const entry of batch) {
      if (!seenIds.has(entry.id)) {
        seenIds.add(entry.id);
        entries.push(entry);
      }
    }
  }

  return entries;
}

export const awesomeListAdapter = {
  type: 'awesome-list' as const,
  fetch: fetchAwesomeList,
};
