import type { ScoredSkill } from '../types.js';
import { multiSelect } from './multi-select.js';

/**
 * Present skills to the user and let them select which to install.
 * In non-interactive mode (no TTY), returns all recommended skills.
 */
export async function selectSkills(
  skills: ScoredSkill[],
): Promise<ScoredSkill[]> {
  if (skills.length === 0) return [];
  return multiSelect(skills);
}
