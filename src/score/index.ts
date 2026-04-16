/**
 * Score orchestrator — scores all skills against a project profile
 * and classifies them into recommended / optional / not_relevant.
 */

import type {
  SkillEntry,
  ProjectProfile,
  ScoredSkill,
  ScoringRules,
} from '../types.js';
import { scoreSkill, classify } from './engine.js';

/**
 * Score each skill against the project profile, classify by thresholds,
 * and return all scored skills sorted by score descending.
 */
export function scoreAndClassify(
  skills: SkillEntry[],
  profile: ProjectProfile,
  rules: ScoringRules,
): ScoredSkill[] {
  const thresholds = rules.thresholds;

  const scored: ScoredSkill[] = skills.map((skill) => {
    const score = scoreSkill(skill, profile);
    const relevance = classify(score, thresholds);
    return { ...skill, score, relevance };
  });

  // Sort by score descending, then by id ascending as tiebreaker
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  return scored;
}

export { scoreSkill, classify } from './engine.js';
export { clusterSkills, presentGrouped } from './clustering.js';
