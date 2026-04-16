/**
 * Federated source orchestrator -- reads source configs, dispatches
 * adapters in parallel, deduplicates results, returns FederatedIndex.
 *
 * Reads bundled src/config/sources.json, merges with user override
 * from ~/.config/skillforge/sources.json (if exists, fully replaces),
 * and merges with CLI --sources argument (appended as marketplace type).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  CliArgs,
  FederatedIndex,
  SkillEntry,
  SourceConfig,
  SourceStatus,
  SourcesConfig,
} from '../types.js';
import { fetchSkillsSh } from './adapter-skillssh.js';
import { fetchMarketplace } from './adapter-marketplace.js';
import { fetchAwesomeList } from './adapter-awesome-list.js';

const SOURCE_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function loadSourcesConfig(): SourceConfig[] {
  // User override fully replaces bundled config
  const userPath = join(
    homedir(),
    '.config',
    'skillforge',
    'sources.json',
  );

  try {
    const raw = readFileSync(userPath, 'utf-8');
    const doc = JSON.parse(raw) as SourcesConfig;
    if (Array.isArray(doc.defaults)) {
      return doc.defaults;
    }
  } catch {
    // No user override -- fall through to bundled config
  }

  // Bundled config
  try {
    const bundledPath = join(
      import.meta.dirname,
      '..',
      'config',
      'sources.json',
    );
    const raw = readFileSync(bundledPath, 'utf-8');
    const doc = JSON.parse(raw) as SourcesConfig;
    if (Array.isArray(doc.defaults)) {
      return doc.defaults;
    }
  } catch {
    // Bundled config missing -- should not happen in production
  }

  return [];
}

// ---------------------------------------------------------------------------
// Adapter dispatch
// ---------------------------------------------------------------------------

function getAdapterFetch(
  type: string,
): ((url: string, config: SourceConfig) => Promise<SkillEntry[]>) | null {
  switch (type) {
    case 'skills-sh-html':
      return fetchSkillsSh;
    case 'marketplace':
      return fetchMarketplace;
    case 'awesome-list':
      return fetchAwesomeList;
    default:
      return null;
  }
}

async function fetchWithTimeout(
  adapterFetch: (url: string, config: SourceConfig) => Promise<SkillEntry[]>,
  config: SourceConfig,
  timeoutMs: number,
): Promise<{ skills: SkillEntry[]; status: 'success' | 'error' | 'timeout'; error?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ skills: [], status: 'timeout', error: `Timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    adapterFetch(config.url, config)
      .then((skills) => {
        clearTimeout(timer);
        resolve({ skills, status: 'success' });
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        resolve({
          skills: [],
          status: 'error',
          error: String(err),
        });
      });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchSources(args: CliArgs): Promise<FederatedIndex> {
  const sources = loadSourcesConfig();

  // Merge CLI --sources as additional marketplace entries
  for (const sourceUrl of args.sources) {
    sources.push({
      type: 'marketplace',
      name: `CLI: ${sourceUrl}`,
      url: sourceUrl,
      require_audit: false,
    });
  }

  const fetchedAt = new Date().toISOString();
  const sourceStatuses: SourceStatus[] = [];
  const allSkills: SkillEntry[] = [];
  const seenIds = new Set<string>();

  // Dispatch all adapters in parallel
  const results = await Promise.allSettled(
    sources.map(async (config) => {
      const adapterFetch = getAdapterFetch(config.type);
      if (!adapterFetch) {
        return {
          config,
          skills: [] as SkillEntry[],
          status: 'error' as const,
          error: `Unknown source type: ${config.type}`,
        };
      }

      const result = await fetchWithTimeout(
        adapterFetch,
        config,
        SOURCE_TIMEOUT_MS,
      );

      return {
        config,
        ...result,
      };
    }),
  );

  // Process results
  let partial = false;

  for (const result of results) {
    if (result.status === 'rejected') {
      // Promise.allSettled should not produce rejected results given our
      // catch-all in fetchWithTimeout, but handle gracefully.
      partial = true;
      continue;
    }

    const { config, skills, status, error } = result.value;

    sourceStatuses.push({
      type: config.type,
      name: config.name,
      url: config.url,
      skill_count: skills.length,
      fetched_at: fetchedAt,
      status,
      ...(error ? { error } : {}),
    });

    if (status !== 'success') {
      partial = true;
    }

    // Deduplicate by skill ID (first source wins)
    for (const skill of skills) {
      if (!seenIds.has(skill.id)) {
        seenIds.add(skill.id);
        allSkills.push(skill);
      }
    }
  }

  return {
    version: 1,
    fetched_at: fetchedAt,
    ttl_seconds: 24 * 60 * 60, // 24 hours
    partial,
    sources: sourceStatuses,
    scoring_rules: {
      thresholds: {
        recommended: 15,
        optional: 5,
        not_relevant: 0,
      },
    },
    skills: allSkills,
  };
}
