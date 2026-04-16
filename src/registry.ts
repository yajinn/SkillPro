/**
 * Registry-based skill matching with priority scoring, deduplication,
 * and alternative grouping.
 *
 * Priority formula:
 *   1. Anthropic official → +10,000 base
 *   2. skills.sh source  → +1,000 base + weekly_installs
 *   3. Other sources      → +100 base + github_stars
 *
 * Dedup: Skills doing the same job are grouped. The highest-priority
 * one is the "primary" (checked by default), others are "alternatives"
 * (shown unchecked when user asks for more).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StackDefinition } from './detect/stack.js';

// ─── Types ────────────────────────────────────────────────────────────

export type Platform = 'web' | 'mobile' | 'desktop' | 'both';

export interface RegistrySkill {
  name: string;
  description: string;
  install_url: string;
  owner: string;
  repo: string;
  source: string;
  weekly_installs?: number;
  github_stars?: number;
  stacks?: string[];
  platform?: Platform;
}

export interface MatchedSkill extends RegistrySkill {
  id: string;
  matchedStack: string;
  priority: number;
  isAlternative: boolean;
  alternativeOf?: string;
}

interface Registry {
  _meta: { total_skills: number };
  stacks: StackDefinition[];
  repo_to_stack: Record<string, string[]>;
  keyword_to_stack: Record<string, string[]>;
  skills: Record<string, RegistrySkill>;
  /** Hand-curated skill IDs per stack. Highest-priority matches. */
  curated_skills?: Record<string, string[]>;
  /** Cross-tech combo skills. e.g. Django + Celery → background jobs. */
  skill_combos?: Array<{ techs: string[]; skills: string[] }>;
  /** Universal skills for all frontend/web projects. */
  universal_frontend_skills?: string[];
}

// ─── Load registry ────────────────────────────────────────────────────

let _registry: Registry | null = null;

export function loadRegistry(): Registry {
  if (_registry) return _registry;
  const registryPath = join(import.meta.dirname, 'config', 'skills-registry.json');
  _registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as Registry;
  return _registry;
}

export function getStacks(): StackDefinition[] {
  return loadRegistry().stacks;
}

// ─── Priority scoring ─────────────────────────────────────────────────

const ANTHROPIC_OWNERS = new Set(['anthropics']);

function computePriority(skill: RegistrySkill): number {
  const installs = skill.weekly_installs ?? 0;
  const stars = skill.github_stars ?? 0;

  // Anthropic official: highest tier
  if (ANTHROPIC_OWNERS.has(skill.owner) || skill.source === 'Anthropic Skills') {
    return 10_000 + installs;
  }

  // skills.sh with popularity data
  if (skill.source === 'skills.sh' && installs > 0) {
    return 1_000 + installs;
  }

  // skills.sh without install data — use stars
  if (skill.source === 'skills.sh') {
    return 500 + stars;
  }

  // Other sources
  return 100 + stars;
}

// ─── Deduplication ────────────────────────────────────────────────────

/**
 * Normalize a skill name for dedup grouping.
 * "vercel-react-best-practices" → "react-best-practices"
 * "nextjs-best-practices" → "nextjs-best-practices"
 * "typescript-expert" → "typescript-expert"
 */
function dedupKey(id: string, description: string): string {
  // Remove common owner prefixes
  let key = id
    .replace(/^vercel-/, '')
    .replace(/^anthropic-/, '')
    .replace(/^expo-/, 'expo-')
    .replace(/^sf-/, 'salesforce-');

  // For very generic names, include first meaningful description word
  if (['expert', 'best-practices', 'patterns', 'guide', 'specialist'].some(w => key === w)) {
    const firstWord = description.split(/\s+/).find(w => w.length > 3)?.toLowerCase() ?? '';
    key = `${firstWord}-${key}`;
  }

  return key;
}

/**
 * Group skills that likely do the same thing.
 * Returns: Map<groupKey, skills sorted by priority desc>
 */
function groupSimilar(skills: MatchedSkill[]): Map<string, MatchedSkill[]> {
  const groups = new Map<string, MatchedSkill[]>();

  for (const skill of skills) {
    const key = dedupKey(skill.id, skill.description);

    // Also check for exact-suffix matches (e.g. "react-best-practices" and "vercel-react-best-practices")
    let assigned = false;
    for (const [existingKey, group] of groups) {
      if (
        key.endsWith(existingKey) ||
        existingKey.endsWith(key) ||
        key === existingKey
      ) {
        group.push(skill);
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      groups.set(key, [skill]);
    }
  }

  // Sort each group by priority descending
  for (const group of groups.values()) {
    group.sort((a, b) => b.priority - a.priority);
  }

  return groups;
}

// ─── Matching ─────────────────────────────────────────────────────────

function buildMatchSet(detectedStackIds: string[], language: string): Set<string> {
  const set = new Set<string>();
  for (const id of detectedStackIds) set.add(id);
  if (language) set.add(`_${language}`);
  set.add('_universal');
  return set;
}

/**
 * Determine the project's platform from detected stacks.
 * Used as a HARD GATE — mobile projects never see web-only skills.
 */
const MOBILE_STACKS = new Set(['react-native', 'expo', 'flutter']);
const DESKTOP_STACKS = new Set(['electron', 'tauri']);
const WEB_STACKS = new Set([
  'nextjs', 'nuxt', 'sveltekit', 'remix', 'gatsby', 'astro',
  'react', 'vue', 'angular', 'svelte',
  'vercel', 'cloudflare-workers',
  'shadcn', 'tailwindcss',
]);

function detectProjectPlatform(stackIds: string[]): Platform {
  for (const id of stackIds) {
    if (MOBILE_STACKS.has(id)) return 'mobile';
    if (DESKTOP_STACKS.has(id)) return 'desktop';
  }
  for (const id of stackIds) {
    if (WEB_STACKS.has(id)) return 'web';
  }
  return 'both'; // Unknown / backend / CLI — show everything
}

/**
 * Is this skill compatible with the project's platform?
 * - Mobile projects: only mobile or cross-platform skills
 * - Desktop projects: only desktop or cross-platform skills
 * - Web projects: only web or cross-platform skills
 * - Unknown/backend: everything is fair game
 */
function isPlatformCompatible(
  skillPlatform: Platform | undefined,
  projectPlatform: Platform,
): boolean {
  const sp = skillPlatform ?? 'both';

  // Cross-platform skills match everywhere
  if (sp === 'both') return true;

  // Unknown project = show everything
  if (projectPlatform === 'both') return true;

  // Exact match
  return sp === projectPlatform;
}

export interface MatchResult {
  /** Top skills (max 20), deduped, sorted by priority */
  recommended: MatchedSkill[];
  /** Alternative skills (grouped by what they're alternative to) */
  alternatives: MatchedSkill[];
  /** Total matched before cap */
  totalMatched: number;
}

export function matchSkills(
  detectedStackIds: string[],
  language: string = 'unknown',
  dependencies: string[] = [],
): MatchResult {
  const registry = loadRegistry();
  const matchSet = buildMatchSet(detectedStackIds, language);
  const projectPlatform = detectProjectPlatform(detectedStackIds);

  // Ecosystem gates: only include these tags if the project actually uses them
  const deps = new Set(dependencies.map((d) => d.toLowerCase()));
  const AI_DEP_PATTERNS = [
    /^@anthropic-ai\//, /^anthropic$/, /^openai$/, /^@openai\//,
    /^langchain/, /^@langchain\//, /^llamaindex/, /^@llamaindex\//,
    /^@google-ai\//, /^genkit/, /^@modelcontextprotocol\//,
    /^ai$/,
  ];
  const hasAiDep = [...deps].some((d) => AI_DEP_PATTERNS.some((p) => p.test(d)));
  if (hasAiDep) matchSet.add('_ai');

  const addedIds = new Set<string>();
  const curated: MatchedSkill[] = [];

  // Helper: add a skill by ID with a given matched stack label
  const addSkill = (skillId: string, matchedStack: string): void => {
    if (addedIds.has(skillId)) return;
    const skill = registry.skills[skillId];
    if (!skill) return;
    if (!isPlatformCompatible(skill.platform, projectPlatform)) return;
    addedIds.add(skillId);
    curated.push({
      ...skill,
      id: skillId,
      matchedStack,
      priority: computePriority(skill) + 1000, // boost curated over regex-matched
      isAlternative: false,
    });
  };

  // ─── PHASE 1: CURATED (hand-picked per detected stack) ───
  // Highest priority — these are known-good skills for each tech.
  const curatedMap = registry.curated_skills ?? {};
  for (const stackId of detectedStackIds) {
    const ids = curatedMap[stackId];
    if (ids) for (const id of ids) addSkill(id, stackId);
  }
  // Language fallback curated (_typescript, _python, etc.)
  if (language) {
    const langIds = curatedMap[`_${language}`];
    if (langIds) for (const id of langIds) addSkill(id, `_${language}`);
  }

  // ─── PHASE 2: COMBOS (cross-tech specializations) ───
  const combos = registry.skill_combos ?? [];
  const detectedSet = new Set(detectedStackIds);
  for (const combo of combos) {
    const allMatch = combo.techs.every((t) => detectedSet.has(t));
    if (allMatch) {
      for (const id of combo.skills) addSkill(id, `${combo.techs.join('+')}`);
    }
  }

  // ─── PHASE 3: UNIVERSAL FRONTEND (for web projects only) ───
  if (projectPlatform === 'web') {
    const frontendSkills = registry.universal_frontend_skills ?? [];
    for (const id of frontendSkills) addSkill(id, 'frontend');
  }

  // ─── PHASE 4: REGEX-MATCHED (fill remaining slots with stack-matched skills) ───
  const raw: MatchedSkill[] = [];
  for (const [skillId, skill] of Object.entries(registry.skills)) {
    if (addedIds.has(skillId)) continue;
    if (!isPlatformCompatible(skill.platform, projectPlatform)) continue;

    const skillStacks = skill.stacks ?? ['_universal'];
    let bestMatch: string | null = null;
    for (const ss of skillStacks) {
      if (ss !== '_universal' && matchSet.has(ss)) {
        bestMatch = ss;
        break;
      }
    }
    if (!bestMatch && skillStacks.includes('_universal')) bestMatch = '_universal';
    if (!bestMatch) continue;

    raw.push({
      ...skill,
      id: skillId,
      matchedStack: bestMatch === '_universal' ? 'universal' : bestMatch,
      priority: computePriority(skill),
      isAlternative: false,
    });
  }
  raw.sort((a, b) => b.priority - a.priority);

  // Cap language fallbacks at 2 per language (AutoSkills-tight)
  const MAX_PER_LANG_FALLBACK = 2;
  const langCounts = new Map<string, number>();
  const afterLangCap: MatchedSkill[] = [];
  for (const skill of raw) {
    if (skill.matchedStack.startsWith('_') && skill.matchedStack !== 'universal') {
      const count = langCounts.get(skill.matchedStack) ?? 0;
      if (count >= MAX_PER_LANG_FALLBACK) continue;
      langCounts.set(skill.matchedStack, count + 1);
    }
    afterLangCap.push(skill);
  }

  // Merge: curated first, then regex-matched
  const allMatched = [...curated, ...afterLangCap];
  const specific = allMatched.filter((s) => s.matchedStack !== 'universal');
  const universal = allMatched.filter((s) => s.matchedStack === 'universal');

  // Phase 4: Dedup specific skills
  const specificGroups = groupSimilar(specific);
  const recommended: MatchedSkill[] = [];
  const alternatives: MatchedSkill[] = [];

  for (const group of specificGroups.values()) {
    const [primary, ...alts] = group;
    if (!primary) continue;
    recommended.push(primary);
    for (const alt of alts) {
      alt.isAlternative = true;
      alt.alternativeOf = primary.id;
      alternatives.push(alt);
    }
  }

  // Phase 5: Add top universal (deduped)
  const universalGroups = groupSimilar(universal);
  const universalPrimaries: MatchedSkill[] = [];
  for (const group of universalGroups.values()) {
    const [primary, ...alts] = group;
    if (!primary) continue;
    universalPrimaries.push(primary);
    for (const alt of alts) {
      alt.isAlternative = true;
      alt.alternativeOf = primary.id;
      alternatives.push(alt);
    }
  }

  // Phase 6: Cap at 20 total (specific first, then fill with universal)
  const MAX_RECOMMENDATIONS = 20;
  const cappedSpecific = recommended.slice(0, MAX_RECOMMENDATIONS);
  const remaining = MAX_RECOMMENDATIONS - cappedSpecific.length;
  const cappedUniversal = remaining > 0 ? universalPrimaries.slice(0, remaining) : [];

  return {
    recommended: [...cappedSpecific, ...cappedUniversal],
    alternatives,
    totalMatched: raw.length,
  };
}
