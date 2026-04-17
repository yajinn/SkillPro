// Detect which skills are already installed in the current project.
// Source of truth is ./skills-lock.json (written by `npx skills add`).
// Falls back to scanning ./.claude/skills/<id>/SKILL.md so we still work
// if the lock file is missing (e.g. user installed skills manually).

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface SkillsLock {
  version?: number;
  skills?: Record<string, unknown>;
}

/**
 * Return the set of skill IDs already installed in `cwd`.
 */
export function getInstalledSkillIds(cwd: string): Set<string> {
  const installed = new Set<string>();

  const lockPath = join(cwd, 'skills-lock.json');
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as SkillsLock;
      if (lock.skills && typeof lock.skills === 'object') {
        for (const id of Object.keys(lock.skills)) installed.add(id);
      }
    } catch {
      // malformed lock — fall through to directory scan
    }
  }

  const skillsDir = join(cwd, '.claude', 'skills');
  if (existsSync(skillsDir)) {
    try {
      for (const entry of readdirSync(skillsDir)) {
        const skillMd = join(skillsDir, entry, 'SKILL.md');
        if (existsSync(skillMd) && statSync(skillMd).isFile()) {
          installed.add(entry);
        }
      }
    } catch {
      // ignore — directory might be unreadable
    }
  }

  return installed;
}
