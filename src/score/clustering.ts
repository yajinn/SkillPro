/**
 * Presentation-layer clustering for SkillForge recommendations.
 *
 * Port of scripts/clustering.py.
 *
 * Groups scored skills by category, clusters by id prefix,
 * sorts by (score desc, popularity desc, id asc), and caps
 * each category to a configurable number of canonicals.
 */

import type { ScoredSkill } from '../types.js';

const DEFAULT_OTHER_CATEGORY = 'other';
const DEFAULT_TOP_PER_CATEGORY = 3;
const MIN_PREFIX_LEN = 3;

/** Tiebreaker key for sorting: score desc, popularity desc, id asc. */
function tiebreakerCompare(a: ScoredSkill, b: ScoredSkill): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.popularity !== b.popularity) return b.popularity - a.popularity;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Extract the clustering prefix from a skill id.
 *
 * Rule: the first dash-separated segment, if it's at least
 * MIN_PREFIX_LEN characters. Otherwise fall back to the full id
 * so short prefixes like "ci-" or "go-" don't wrongly merge
 * unrelated skills.
 */
function skillPrefix(skillId: string): string {
  if (!skillId.includes('-')) return skillId;
  const head = skillId.split('-', 1)[0];
  if (head.length < MIN_PREFIX_LEN) return skillId;
  return head;
}

export interface ClusterCanonical extends ScoredSkill {
  variant_count: number;
  variants_preview: string[];
}

export interface CategoryGroup {
  category: string;
  total_canonicals: number;
  total_variants: number;
  canonicals: ClusterCanonical[];
  hidden: ClusterCanonical[];
}

export interface GroupedResult {
  total_input: number;
  total_shown: number;
  total_hidden: number;
  categories: CategoryGroup[];
}

/**
 * Group skills sharing a prefix into clusters.
 * Each cluster is sorted by tiebreaker; the first member is the canonical.
 * Clusters are returned in tiebreaker order of their canonicals.
 */
function clusterByPrefix(skills: ScoredSkill[]): ScoredSkill[][] {
  const buckets = new Map<string, ScoredSkill[]>();
  for (const skill of skills) {
    const prefix = skillPrefix(skill.id);
    let bucket = buckets.get(prefix);
    if (!bucket) {
      bucket = [];
      buckets.set(prefix, bucket);
    }
    bucket.push(skill);
  }

  const clusters: ScoredSkill[][] = [];
  for (const members of buckets.values()) {
    members.sort(tiebreakerCompare);
    clusters.push(members);
  }

  clusters.sort((a, b) => tiebreakerCompare(a[0], b[0]));
  return clusters;
}

/**
 * Bucket skills by their category field.
 * Skills with no category go into DEFAULT_OTHER_CATEGORY.
 */
function groupByCategory(skills: ScoredSkill[]): Map<string, ScoredSkill[]> {
  const groups = new Map<string, ScoredSkill[]>();
  for (const skill of skills) {
    const category = skill.category || DEFAULT_OTHER_CATEGORY;
    let group = groups.get(category);
    if (!group) {
      group = [];
      groups.set(category, group);
    }
    group.push(skill);
  }
  return groups;
}

/**
 * Build a presentation-layer structure from a flat skill list.
 * Mirrors clustering.py's present_grouped().
 */
export function presentGrouped(
  skills: ScoredSkill[],
  topPerCategory: number = DEFAULT_TOP_PER_CATEGORY,
): GroupedResult {
  if (skills.length === 0) {
    return {
      total_input: 0,
      total_shown: 0,
      total_hidden: 0,
      categories: [],
    };
  }

  const groups = groupByCategory(skills);
  const outCategories: CategoryGroup[] = [];
  let totalShown = 0;
  let totalHidden = 0;

  for (const [category, members] of groups) {
    const clusters = clusterByPrefix(members);
    const canonicalEntries: ClusterCanonical[] = [];

    for (const cluster of clusters) {
      const canonical: ClusterCanonical = {
        ...cluster[0],
        variant_count: cluster.length - 1,
        variants_preview: cluster.slice(1, 6).map((v) => v.id),
      };
      canonicalEntries.push(canonical);
    }

    const totalVariants = canonicalEntries.reduce(
      (sum, e) => sum + e.variant_count,
      0,
    );

    const shown = canonicalEntries.slice(0, topPerCategory);
    const hidden = canonicalEntries.slice(topPerCategory);

    totalShown += shown.length;
    totalHidden += totalVariants + hidden.length;

    outCategories.push({
      category,
      total_canonicals: canonicalEntries.length,
      total_variants: totalVariants,
      canonicals: shown,
      hidden,
    });
  }

  // Sort categories: "other" always last, then by top canonical tiebreaker
  outCategories.sort((a, b) => {
    const aIsOther = a.category === DEFAULT_OTHER_CATEGORY ? 1 : 0;
    const bIsOther = b.category === DEFAULT_OTHER_CATEGORY ? 1 : 0;
    if (aIsOther !== bIsOther) return aIsOther - bIsOther;

    const aCanon = a.canonicals[0];
    const bCanon = b.canonicals[0];
    if (!aCanon && !bCanon) {
      return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
    }
    if (!aCanon) return 1;
    if (!bCanon) return -1;
    return tiebreakerCompare(aCanon, bCanon);
  });

  return {
    total_input: skills.length,
    total_shown: totalShown,
    total_hidden: totalHidden,
    categories: outCategories,
  };
}

/**
 * Simple cluster function that groups skills by category.
 * Returns a Map of category -> sorted skills.
 */
export function clusterSkills(
  skills: ScoredSkill[],
): Map<string, ScoredSkill[]> {
  const groups = groupByCategory(skills);

  // Sort each group by score desc, popularity desc, id asc
  for (const members of groups.values()) {
    members.sort(tiebreakerCompare);
  }

  return groups;
}
