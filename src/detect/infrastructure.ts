// ─── Infrastructure Detection ───────────────────────────────────────
// Ported from detect.sh section 7: Infrastructure Detection
// CI tools, Docker, CDN/hosting platforms.
// ─────────────────────────────────────────────────────────────────────

import { join } from 'node:path';
import { fileExists, dirExists } from './manifest-readers.js';

/**
 * Detect CI tool, Docker usage, and CDN/hosting platform.
 */
export function detectInfrastructure(dir: string): {
  cdn: string | null;
  ci_tool: string | null;
  docker: boolean;
} {
  // ── CDN / Hosting ──────────────────────────────────────────────────
  let cdn: string | null = null;
  if (fileExists(join(dir, 'vercel.json')) || fileExists(join(dir, '.vercelignore'))) {
    cdn = 'vercel';
  } else if (fileExists(join(dir, 'netlify.toml')) || fileExists(join(dir, '_redirects'))) {
    cdn = 'netlify';
  } else if (fileExists(join(dir, 'wrangler.toml')) || fileExists(join(dir, 'wrangler.jsonc'))) {
    cdn = 'cloudflare';
  }

  // ── CI Tool ────────────────────────────────────────────────────────
  let ci_tool: string | null = null;
  if (dirExists(dir, '.github/workflows')) {
    ci_tool = 'github-actions';
  } else if (fileExists(join(dir, '.gitlab-ci.yml'))) {
    ci_tool = 'gitlab-ci';
  } else if (fileExists(join(dir, 'Jenkinsfile'))) {
    ci_tool = 'jenkins';
  }

  // ── Docker ─────────────────────────────────────────────────────────
  const docker =
    fileExists(join(dir, 'Dockerfile')) ||
    fileExists(join(dir, 'docker-compose.yml')) ||
    fileExists(join(dir, 'docker-compose.yaml'));

  return { cdn, ci_tool, docker };
}
