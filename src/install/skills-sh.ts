/**
 * Install skills from skills.sh using `npx skills add`.
 */

import { execFile } from 'node:child_process';
import type { ScoredSkill, InstallResult, CliArgs } from '../types.js';

const INSTALL_TIMEOUT_MS = 60_000;

/**
 * Parse owner/repo from a skills.sh or raw GitHub install URL.
 *
 * Accepted formats:
 *   https://skills.sh/skills/<owner>/<repo>
 *   https://raw.githubusercontent.com/<owner>/<repo>/...
 *   https://github.com/<owner>/<repo>
 */
function parseOwnerRepo(url: string): string | null {
  const sh = url.match(/skills\.sh\/skills\/([^/]+\/[^/]+)/);
  if (sh) return sh[1]!;
  const raw = url.match(/raw\.githubusercontent\.com\/([^/]+\/[^/]+)/);
  if (raw) return raw[1]!;
  const gh = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git|\/|$)/);
  if (gh) return gh[1]!;
  return null;
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

  // -g installs to user level (~/.claude/skills/), -y skips prompts.
  // Without -a, skills add doesn't symlink into any agent directory,
  // so default to claude-code when the user didn't pick agents explicitly.
  const agents = args.agents.length > 0 ? args.agents : ['claude-code'];
  const npxArgs = ['skills', 'add', ownerRepo, '--skill', skill.id, '-y', '-g'];
  for (const agent of agents) {
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
