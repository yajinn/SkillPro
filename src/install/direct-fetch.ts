/**
 * Install skills from non-skills.sh sources by fetching SKILL.md directly.
 *
 * Downloads the SKILL.md from install_url and writes it to
 * ~/.claude/skills/<skill-id>/SKILL.md.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { get as httpsGet } from 'node:https';
import { get as httpGet } from 'node:http';
import type { ScoredSkill, InstallResult } from '../types.js';

const FETCH_TIMEOUT_MS = 30_000;

/**
 * Fetch content from a URL. Uses built-in http/https modules (zero deps).
 */
function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith('https') ? httpsGet : httpGet;
    const req = getter(url, { timeout: FETCH_TIMEOUT_MS }, (res) => {
      // Follow redirects (3xx)
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        fetchUrl(res.headers.location).then(resolve, reject);
        return;
      }

      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

/**
 * Install a single skill by fetching its SKILL.md from install_url
 * and writing it to ~/.claude/skills/<skill-id>/SKILL.md.
 */
export async function installDirectFetch(
  skill: ScoredSkill,
): Promise<InstallResult> {
  const url = skill.install_url;
  if (!url) {
    return {
      skill_id: skill.id,
      success: false,
      error: 'No install_url provided',
    };
  }

  try {
    const content = await fetchUrl(url);

    const skillDir = join(homedir(), '.claude', 'skills', skill.id);
    mkdirSync(skillDir, { recursive: true });

    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(skillPath, content, 'utf-8');

    return {
      skill_id: skill.id,
      success: true,
      path: skillPath,
    };
  } catch (err) {
    return {
      skill_id: skill.id,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
