/**
 * Export orchestrator — dispatches to the appropriate exporter
 * based on the target format.
 */

import type { ScoredSkill } from '../types.js';
import { exportToCursor } from './cursor.js';
import { exportToCodex } from './codex.js';
import { generateClaudeMd } from './claude.js';

/**
 * Export skills to the specified target format.
 *
 * @param skills  - Scored skills to export
 * @param target  - Target format: 'cursor' | 'codex' | 'claude'
 * @param projectDir - Project root directory
 */
export function exportSkills(
  skills: ScoredSkill[],
  target: string,
  projectDir: string,
): void {
  switch (target) {
    case 'cursor':
      exportToCursor(skills, projectDir);
      break;
    case 'codex':
      exportToCodex(skills, projectDir);
      break;
    case 'claude':
      generateClaudeMd(skills, projectDir);
      break;
    default:
      throw new Error(
        `Unknown export target: "${target}". Supported: cursor, codex, claude`,
      );
  }
}

export { exportToCursor } from './cursor.js';
export { exportToCodex } from './codex.js';
export { generateClaudeMd } from './claude.js';
