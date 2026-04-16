/**
 * SkillForge — Relevance Scoring Engine
 *
 * Port of scripts/score.py's score_skill() and classify() functions.
 * Computes a relevance score for each skill against a project profile.
 */

import type {
  SkillEntry,
  ProjectProfile,
  ScoringThresholds,
  Characteristic,
} from '../types.js';

/**
 * Compute relevance score for a skill given a project profile.
 *
 * Algorithm (mirrors score.py exactly):
 *   1. Library anchor   — match_libraries   -> 100 or -100
 *   2. Language anchor   — match_language    -> 100 or -100
 *   3. Framework anchor  — match_framework   -> 100 or -100 (pipe-separated)
 *   4. Sub-framework     — match_sub_framework -> 100 or -100
 *   5. Soft library boost — boost_libraries  -> +5
 *   6. Tag matching      — "any" -> +5, else +2 per matching characteristic
 *   7. Boost matching    — boost_when        -> +3 per match
 *   8. Penalize matching — penalize_when     -> -5 per match
 *   9. Default-for       — project_type      -> +10
 */
export function scoreSkill(skill: SkillEntry, profile: ProjectProfile): number {
  const chars = profile.characteristics;
  const projectType = profile.project_type;
  const language = profile.language || 'unknown';
  const framework = profile.framework || '';
  const subFramework = profile.sub_framework || '';
  const libraries = new Set(profile.libraries || []);

  let score = 0;

  // --- Library match (auto-recommend skills tied to a specific library) ---
  const matchLibs = skill.match_libraries;
  if (matchLibs.length > 0) {
    let overlap = false;
    for (const lib of matchLibs) {
      if (libraries.has(lib)) {
        overlap = true;
        break;
      }
    }
    return overlap ? 100 : -100;
  }

  // --- Language match (auto-recommend language skills) ---
  const matchLang = skill.match_language || '';
  if (matchLang) {
    return language === matchLang ? 100 : -100;
  }

  // --- Framework match (auto-recommend framework skills) ---
  const matchFw = skill.match_framework || '';
  if (matchFw) {
    const patterns = matchFw.split('|');
    return patterns.includes(framework) ? 100 : -100;
  }

  // --- Sub-framework match ---
  const matchSub = skill.match_sub_framework || '';
  if (matchSub) {
    if (subFramework && subFramework.includes(matchSub)) {
      return 100;
    }
    return -100;
  }

  // --- Soft library boost ---
  const boostLibs = skill.boost_libraries;
  if (boostLibs.length > 0) {
    for (const lib of boostLibs) {
      if (libraries.has(lib)) {
        score += 5;
        break;
      }
    }
  }

  // --- Tag matching ---
  const tags = skill.tags;
  if (tags.includes('any')) {
    score += 5;
  } else {
    for (const tag of tags) {
      if (chars[tag as Characteristic]) {
        score += 2;
      }
    }
  }

  // --- Boost matching ---
  for (const boost of skill.boost_when) {
    if (chars[boost as Characteristic]) {
      score += 3;
    }
  }

  // --- Penalize matching ---
  for (const pen of skill.penalize_when) {
    if (chars[pen as Characteristic]) {
      score -= 5;
    }
  }

  // --- Default-for matching ---
  if (skill.default_for.includes(projectType)) {
    score += 10;
  }

  return score;
}

/**
 * Classify a score into recommended / optional / not_relevant.
 *
 *   recommended >= thresholds.recommended (default 10)
 *   optional    >= thresholds.optional    (default 1)
 *   else          not_relevant
 */
export function classify(
  score: number,
  thresholds: ScoringThresholds,
): 'recommended' | 'optional' | 'not_relevant' {
  if (score >= thresholds.recommended) {
    return 'recommended';
  }
  if (score >= thresholds.optional) {
    return 'optional';
  }
  return 'not_relevant';
}
