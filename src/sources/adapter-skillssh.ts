/**
 * skills.sh HTML adapter -- port of skillssh_html.py.
 *
 * Fetches skills.sh sitemap.xml, parses skill page URLs, then
 * concurrently fetches each skill page HTML to extract metadata.
 * No GitHub API calls needed -- skills.sh has everything.
 */

import { httpGet } from './http.js';
import type { SkillEntry, SourceConfig } from '../types.js';

const DEFAULT_MAX_SKILLS = 50;
const SUBPROBE_WORKERS = 8;

// Regex for depth-3 sitemap paths: /owner/repo/skill-name
const URL_PATH_RE = /^\/([^/]+)\/([^/]+)\/([^/]+)$/;

// Regex heuristics for parsing skill page HTML
const INSTALL_RE =
  /npx skills add\s*(?:<[^>]+>)?\s*(https:\/\/github\.com\/[^<\s]+)\s*(?:<[^>]+>)?\s*--skill\s*(?:<[^>]+>)?\s*([a-zA-Z0-9._-]+)/;
const H1_RE = /<h1[^>]*>([^<]+)<\/h1>/;
const OG_DESC_RE = /property="og:description"\s+content="([^"]*)"/;
const SUMMARY_RE = /Summary<\/div>[\s\S]*?<p>(?:<strong>)?([^<]+)/;

// Non-skill slugs to filter out
const SKIP_SLUGS = new Set(['picks', 'official', 'audits', 'docs', 'about']);

interface SkillPageUrl {
  url: string;
  owner: string;
  repo: string;
  skillId: string;
}

// ---------------------------------------------------------------------------
// Concurrency limiter (no p-limit dependency)
// ---------------------------------------------------------------------------

async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => runNext(),
  );
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Sitemap parsing
// ---------------------------------------------------------------------------

function parseSitemap(xml: string): SkillPageUrl[] {
  // Simple regex-based XML parsing (no DOM parser needed)
  const locRe = /<loc>([^<]+)<\/loc>/g;
  const urls: SkillPageUrl[] = [];
  let found: RegExpMatchArray | null;

  while ((found = locRe.exec(xml)) !== null) {
    const text = found[1].trim();
    if (!text || !text.includes('skills.sh/')) {
      continue;
    }

    const path = '/' + text.split('skills.sh/')[1];
    const m = URL_PATH_RE.exec(path);
    if (!m) {
      continue;
    }

    const [, owner, repo, skillId] = m;
    if (SKIP_SLUGS.has(skillId)) {
      continue;
    }

    urls.push({ url: text, owner, repo, skillId });
  }

  return urls;
}

// ---------------------------------------------------------------------------
// Install URL construction
// ---------------------------------------------------------------------------

function inferInstallUrl(githubUrl: string, skillId: string): string {
  let cleaned = githubUrl.replace(/\/+$/, '');
  if (cleaned.endsWith('.git')) {
    cleaned = cleaned.slice(0, -4);
  }
  const m = cleaned.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (!m) {
    return cleaned;
  }
  const [, owner, repo] = m;
  return `https://raw.githubusercontent.com/${owner}/${repo}/main/skills/${skillId}/SKILL.md`;
}

// ---------------------------------------------------------------------------
// HTML page parsing
// ---------------------------------------------------------------------------

function parseSkillPage(
  html: string,
  page: SkillPageUrl,
): SkillEntry | null {
  const installMatch = INSTALL_RE.exec(html);
  if (!installMatch) {
    return null;
  }

  const githubUrl = installMatch[1].trim();
  const pageSkillId = installMatch[2].trim();
  // Prefer the install command's skill id over the URL slug
  const skillId = pageSkillId || page.skillId;

  // H1 usually matches skill id but sometimes has a friendlier name
  const h1Match = H1_RE.exec(html);
  const name = h1Match ? h1Match[1].trim() : skillId;

  // Description priority: summary section > og:description > fallback
  let description = '';
  const summaryMatch = SUMMARY_RE.exec(html);
  if (summaryMatch) {
    description = summaryMatch[1].trim();
  }
  if (!description) {
    const ogMatch = OG_DESC_RE.exec(html);
    if (ogMatch) {
      const desc = ogMatch[1].trim();
      if (desc && desc !== 'Discover and install skills for AI agents.') {
        description = desc;
      }
    }
  }
  if (!description) {
    description = `${skillId} (via skills.sh)`;
  }

  const installUrl = inferInstallUrl(githubUrl, skillId);

  return {
    id: skillId,
    name,
    description: description.slice(0, 500),
    tags: [],
    boost_when: [],
    penalize_when: [],
    default_for: [],
    match_language: null,
    match_framework: null,
    match_sub_framework: null,
    install_url: installUrl,
    version: null,
    commit_sha: null,
    category: null,
    popularity: 0,
    match_libraries: [],
    boost_libraries: [],
    source: {
      name: 'skills.sh',
      install_url: installUrl,
      commit_sha: null,
      type: 'skills-sh-html',
    },
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export async function fetchSkillsSh(
  url: string,
  config: SourceConfig,
): Promise<SkillEntry[]> {
  const maxSkills = config.max_skills ?? DEFAULT_MAX_SKILLS;

  let sitemapXml: string;
  try {
    sitemapXml = await httpGet(url);
  } catch (err) {
    console.error(`[skills-sh-html] sitemap fetch failed: ${err}`);
    return [];
  }

  const pages = parseSitemap(sitemapXml);
  if (pages.length === 0) {
    console.error(`[skills-sh-html] no skill pages in sitemap at ${url}`);
    return [];
  }

  // Deduplicate by skillId before fetching
  const seenIds = new Set<string>();
  const deduped: SkillPageUrl[] = [];
  for (const page of pages) {
    if (seenIds.has(page.skillId)) {
      continue;
    }
    seenIds.add(page.skillId);
    deduped.push(page);
    if (deduped.length >= maxSkills) {
      break;
    }
  }

  // Build task list for concurrent fetching
  const tasks = deduped.map(
    (page) => async (): Promise<SkillEntry | null> => {
      try {
        const html = await httpGet(page.url);
        return parseSkillPage(html, page);
      } catch (err) {
        console.error(`[skills-sh-html] probe failed for ${page.url}: ${err}`);
        return null;
      }
    },
  );

  const results = await withConcurrency(tasks, SUBPROBE_WORKERS);
  return results.filter((entry): entry is SkillEntry => entry !== null);
}

/** Exported for use by adapter registry */
export const skillsShAdapter = {
  type: 'skills-sh-html' as const,
  fetch: fetchSkillsSh,
};
