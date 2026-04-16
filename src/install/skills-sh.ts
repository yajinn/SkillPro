/**
 * Install skills from skills.sh using `npx skills add`.
 */

import { execFile } from 'node:child_process';
import type { ScoredSkill, InstallResult, CliArgs } from '../types.js';

const INSTALL_TIMEOUT_MS = 60_000;

/**
 * Parse owner/repo from a skills.sh install URL.
 *
 * Expected formats:
 *   https://skills.sh/skills/<owner>/<repo>
 *   https://skills.sh/skills/<owner>/<repo>/...
 *   skills.sh/skills/<owner>/<repo>
 */
function parseOwnerRepo(url: string): string | null {
  const match = url.match(/skills\.sh\/skills\/([^/]+\/[^/]+)/);
  return match ? match[1] : null;
}

/**
 * Install a single skill from skills.sh via npx.
 *
 * Runs: npx skills add <owner/repo> --skill <skill-id> -y
 * Optionally adds -a <agent> flags for specific agents.
 */
export async function installFromSkillsSh(
  skill: ScoredSkill,
  args: CliArgs,
): Promise<InstallResult> {
  const ownerRepo = parseOwnerRepo(skill.install_url);
  if (!ownerRepo) {
    return {
      skill_id: skill.id,
      success: false,
      error: `Could not parse owner/repo from URL: ${skill.install_url}`,
    };
  }

  const npxArgs = ['skills', 'add', ownerRepo, '--skill', skill.id, '-y'];

  // Add agent flags if specified
  for (const agent of args.agents) {
    npxArgs.push('-a', agent);
  }

  return new Promise<InstallResult>((resolve) => {
    execFile(
      'npx',
      npxArgs,
      { timeout: INSTALL_TIMEOUT_MS },
      (error, _stdout, stderr) => {
        if (error) {
          resolve({
            skill_id: skill.id,
            success: false,
            error: error.message || stderr || 'npx skills add failed',
          });
          return;
        }
        resolve({
          skill_id: skill.id,
          success: true,
        });
      },
    );
  });
}
