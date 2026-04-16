/**
 * Concurrent installation orchestrator.
 *
 * Dispatches each skill to the appropriate installer (skills-sh or
 * direct-fetch) and runs them with a concurrency limit.
 */

import type { ScoredSkill, InstallResult, CliArgs } from '../types.js';
import { installFromSkillsSh } from './skills-sh.js';
import { installDirectFetch } from './direct-fetch.js';

/**
 * Run async tasks with a concurrency limit. No external dependencies.
 */
async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      results[idx] = await tasks[idx]();
    }
  }

  // Spawn `limit` workers that each pull from the shared task queue
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, tasks.length); i++) {
    workers.push(runNext());
  }

  await Promise.all(workers);
  return results;
}

/**
 * Install all selected skills concurrently.
 *
 * - Skills from skills-sh sources use `npx skills add`
 * - Other skills use direct SKILL.md fetch
 * - Concurrency is capped at 6
 * - Prints progress (checkmark or cross) per skill
 */
export async function installAll(
  skills: ScoredSkill[],
  args: CliArgs,
): Promise<InstallResult[]> {
  if (skills.length === 0) return [];

  const CONCURRENCY_LIMIT = 6;

  const tasks = skills.map((skill) => {
    return async (): Promise<InstallResult> => {
      const isSkillsSh = skill.source.type.includes('skills-sh');
      let result: InstallResult;

      if (isSkillsSh) {
        result = await installFromSkillsSh(skill, args);
      } else {
        result = await installDirectFetch(skill);
      }

      // Print progress indicator
      const icon = result.success ? '\u2713' : '\u2718';
      const suffix = result.error ? ` (${result.error})` : '';
      process.stderr.write(`  ${icon} ${skill.id}${suffix}\n`);

      return result;
    };
  });

  return withConcurrency(tasks, CONCURRENCY_LIMIT);
}

export { installFromSkillsSh } from './skills-sh.js';
export { installDirectFetch } from './direct-fetch.js';
export { loadSelections, saveSelection, removeSelection } from './selections.js';
