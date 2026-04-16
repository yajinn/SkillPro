/**
 * Enrichment overlay -- community-curated metadata for known skills.
 *
 * After heuristic inference produces a SkillEntry, the adapter looks up
 * the skill's id in an enrichment dict and merges hand-curated fields
 * on top. This lets the community override noisy inference with accurate
 * metadata for known skills.
 *
 * Merge semantics per field:
 *   - tags, boost_when, penalize_when, default_for: enrichment REPLACES
 *     the inferred list when the enrichment provides a non-null value.
 *   - match_language, match_framework, match_sub_framework: enrichment
 *     replaces inference if present.
 *   - category: enrichment replaces if present and non-null.
 *   - match_libraries, boost_libraries: enrichment replaces if present.
 *
 * Lookup order (first hit wins):
 *   1. ~/.config/skillforge/enrichment.json (user override, full replace)
 *   2. Bundled src/config/enrichment.json
 *   3. No enrichment
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SkillEntry } from '../types.js';

let enrichmentCache: Record<string, Record<string, unknown>> | null = null;

/**
 * Load enrichment data. User override fully replaces bundled.
 */
export function loadEnrichment(): Record<string, Partial<SkillEntry>> {
  if (enrichmentCache !== null) {
    return enrichmentCache as Record<string, Partial<SkillEntry>>;
  }

  const candidates = [
    join(homedir(), '.config', 'skillforge', 'enrichment.json'),
    join(import.meta.dirname, '..', 'config', 'enrichment.json'),
  ];

  for (const path of candidates) {
    try {
      const raw = readFileSync(path, 'utf-8');
      const doc = JSON.parse(raw) as Record<string, unknown>;
      enrichmentCache = (doc.enrichment as Record<string, Record<string, unknown>>) ?? {};
      return enrichmentCache as Record<string, Partial<SkillEntry>>;
    } catch {
      // File not found, parse error, etc. -- try next candidate.
      continue;
    }
  }

  enrichmentCache = {};
  return enrichmentCache as Record<string, Partial<SkillEntry>>;
}

/**
 * Reset the enrichment cache. Used by tests.
 */
export function resetEnrichmentCache(): void {
  enrichmentCache = null;
}

/**
 * Apply enrichment overlay to a list of skill entries.
 * For each skill, if enrichment has a matching id, overlay the metadata fields.
 */
export function applyEnrichment(
  skills: SkillEntry[],
  enrichment: Record<string, Partial<SkillEntry>>,
): SkillEntry[] {
  return skills.map((entry) => applyEnrichmentToEntry(entry, enrichment));
}

/**
 * Apply enrichment to a single SkillEntry.
 */
export function applyEnrichmentToEntry(
  entry: SkillEntry,
  enrichment: Record<string, Partial<SkillEntry>>,
): SkillEntry {
  const overlay = enrichment[entry.id] as Record<string, unknown> | undefined;
  if (!overlay) {
    return entry;
  }

  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    install_url: entry.install_url,
    version: entry.version,
    commit_sha: entry.commit_sha,
    tags:
      'tags' in overlay && overlay.tags != null
        ? [...(overlay.tags as string[])]
        : entry.tags,
    boost_when:
      'boost_when' in overlay && overlay.boost_when != null
        ? [...(overlay.boost_when as string[])]
        : entry.boost_when,
    penalize_when:
      'penalize_when' in overlay && overlay.penalize_when != null
        ? [...(overlay.penalize_when as string[])]
        : entry.penalize_when,
    default_for:
      'default_for' in overlay && overlay.default_for != null
        ? [...(overlay.default_for as string[])]
        : entry.default_for,
    match_language:
      'match_language' in overlay
        ? (overlay.match_language as string | null)
        : entry.match_language,
    match_framework:
      'match_framework' in overlay
        ? (overlay.match_framework as string | null)
        : entry.match_framework,
    match_sub_framework:
      'match_sub_framework' in overlay
        ? (overlay.match_sub_framework as string | null)
        : entry.match_sub_framework,
    category:
      'category' in overlay && overlay.category != null
        ? (overlay.category as string)
        : entry.category,
    popularity: entry.popularity,
    match_libraries:
      'match_libraries' in overlay && overlay.match_libraries != null
        ? [...(overlay.match_libraries as string[])]
        : [...entry.match_libraries],
    boost_libraries:
      'boost_libraries' in overlay && overlay.boost_libraries != null
        ? [...(overlay.boost_libraries as string[])]
        : [...entry.boost_libraries],
    source: entry.source,
  };
}
