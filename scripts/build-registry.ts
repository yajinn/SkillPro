#!/usr/bin/env tsx
/**
 * Registry builder — fetches ALL skills from all sources and builds
 * the bundled skills-registry.json.
 *
 * Usage: npm run build:registry
 *
 * This runs at build/publish time, NOT at user runtime.
 * The output ships with the npm package so users get instant skill lookup.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, '..', 'src', 'config', 'skills-registry.json');

// ─── Sitemap fetching ─────────────────────────────────────────────────

const SITEMAP_URL = 'https://skills.sh/sitemap.xml';
const CONCURRENCY = 12;
const SKIP_SLUGS = new Set(['picks', 'official', 'audits', 'docs', 'about']);

interface RawSkill {
  id: string;
  name: string;
  description: string;
  install_url: string;
  owner: string;
  repo: string;
  source: string;
  weekly_installs: number;
  github_stars: number;
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const headers: Record<string, string> = {
      'User-Agent': 'SkillForge/2.0 registry-builder',
    };
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]!();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => runNext()),
  );
  return results;
}

// ─── skills.sh fetching ───────────────────────────────────────────────

const INSTALL_RE =
  /npx skills add\s*(?:<[^>]+>)?\s*(https:\/\/github\.com\/[^<\s]+)\s*(?:<[^>]+>)?\s*--skill\s*(?:<[^>]+>)?\s*([a-zA-Z0-9._-]+)/;
const H1_RE = /<h1[^>]*>([^<]+)<\/h1>/;
const OG_DESC_RE = /property="og:description"\s+content="([^"]*)"/;
const SUMMARY_RE = /Summary<\/div>[\s\S]*?<p>(?:<strong>)?([^<]+)/;

// Weekly installs: <div class="...font-semibold font-mono...">321.1K</div>
const WEEKLY_INSTALLS_RE =
  /font-semibold font-mono tracking-tight text-foreground">([0-9,.]+[kKmM]?)</;
// GitHub stars: <span>25.2K</span> (first occurrence after "GitHub Stars")
const GITHUB_STARS_RE =
  /GitHub Stars[\s\S]*?<span>([0-9,.]+[kKmM]?)<\/span>/;

function parseKNumber(s: string): number {
  if (!s) return 0;
  const clean = s.replace(/,/g, '').trim();
  const m = clean.match(/^([0-9.]+)([kKmM]?)$/);
  if (!m) return 0;
  const num = parseFloat(m[1]!);
  const suffix = m[2]!.toLowerCase();
  if (suffix === 'k') return Math.round(num * 1000);
  if (suffix === 'm') return Math.round(num * 1_000_000);
  return Math.round(num);
}

async function fetchAllSkillsSh(): Promise<RawSkill[]> {
  console.log(`Fetching sitemap from ${SITEMAP_URL}...`);
  const xml = await fetchText(SITEMAP_URL);

  const locRe = /<loc>([^<]+)<\/loc>/g;
  interface PageInfo { url: string; owner: string; repo: string; skillId: string }
  const pages: PageInfo[] = [];
  const seenIds = new Set<string>();
  let found: RegExpMatchArray | null;

  while ((found = locRe.exec(xml)) !== null) {
    const text = found[1]!.trim();
    if (!text.includes('skills.sh/')) continue;
    const path = '/' + text.split('skills.sh/')[1]!;
    const segments = path.split('/').filter(Boolean);
    if (segments.length !== 3) continue;
    const [owner, repo, skillId] = segments as [string, string, string];
    if (SKIP_SLUGS.has(skillId)) continue;
    if (seenIds.has(skillId)) continue;
    seenIds.add(skillId);
    pages.push({ url: text, owner, repo, skillId });
  }

  console.log(`Found ${pages.length} skill pages in sitemap.`);
  console.log(`Fetching skill pages with concurrency=${CONCURRENCY}...`);

  let completed = 0;
  const total = pages.length;

  const tasks = pages.map(
    (page) => async (): Promise<RawSkill | null> => {
      try {
        const html = await fetchText(page.url);

        const installMatch = INSTALL_RE.exec(html);
        if (!installMatch) return null;

        const githubUrl = installMatch[1]!.trim();
        const skillId = installMatch[2]!.trim() || page.skillId;

        const h1Match = H1_RE.exec(html);
        const name = h1Match ? h1Match[1]!.trim() : skillId;

        let description = '';
        const summaryMatch = SUMMARY_RE.exec(html);
        if (summaryMatch) description = summaryMatch[1]!.trim();
        if (!description) {
          const ogMatch = OG_DESC_RE.exec(html);
          if (ogMatch && ogMatch[1]!.trim() !== 'Discover and install skills for AI agents.') {
            description = ogMatch[1]!.trim();
          }
        }
        if (!description) description = `${skillId} skill`;

        // Parse owner/repo from github URL
        const ghMatch = githubUrl.match(/github\.com\/([^/]+)\/([^/\s]+)/);
        const owner = ghMatch ? ghMatch[1]! : page.owner;
        const repo = ghMatch ? ghMatch[2]!.replace(/\.git$/, '') : page.repo;

        const installUrl =
          `https://raw.githubusercontent.com/${owner}/${repo}/main/skills/${skillId}/SKILL.md`;

        // Extract popularity metrics
        const weeklyMatch = WEEKLY_INSTALLS_RE.exec(html);
        const starsMatch = GITHUB_STARS_RE.exec(html);
        const weekly_installs = weeklyMatch ? parseKNumber(weeklyMatch[1]!) : 0;
        const github_stars = starsMatch ? parseKNumber(starsMatch[1]!) : 0;

        completed++;
        if (completed % 100 === 0 || completed === total) {
          process.stderr.write(`  ${completed}/${total} pages fetched\r`);
        }

        return {
          id: skillId,
          name,
          description: description.slice(0, 300),
          install_url: installUrl,
          owner,
          repo,
          source: 'skills.sh',
          weekly_installs,
          github_stars,
        };
      } catch {
        completed++;
        return null;
      }
    },
  );

  const results = await withConcurrency(tasks, CONCURRENCY);
  const skills = results.filter((s): s is RawSkill => s !== null);
  console.log(`\nFetched ${skills.length} valid skills from skills.sh.`);
  return skills;
}

// ─── Anthropic + obra sources (marketplace.json) ──────────────────────

async function fetchMarketplaceSkills(
  url: string,
  sourceName: string,
): Promise<RawSkill[]> {
  console.log(`Fetching marketplace: ${sourceName}...`);
  try {
    const body = await fetchText(url);
    const doc = JSON.parse(body);
    if (!doc.plugins || !Array.isArray(doc.plugins)) return [];

    const skills: RawSkill[] = [];
    for (const plugin of doc.plugins) {
      if (!plugin.skills || !Array.isArray(plugin.skills)) continue;
      for (const s of plugin.skills) {
        if (typeof s === 'string') {
          const root = url.replace(/\/[^/]+$/, '');
          const skillPath = s.replace(/^\.\//, '').replace(/^\//, '');
          const installUrl = `${root}/../${skillPath}/SKILL.md`.replace(
            /\/[^/]+\/\.\.\//g,
            '/',
          );
          const id = skillPath.split('/').pop() || skillPath;
          skills.push({
            id,
            name: id,
            description: '',
            install_url: installUrl,
            owner: '',
            repo: '',
            source: sourceName,
            weekly_installs: 0,
            github_stars: 0,
          });
        } else if (typeof s === 'object' && s.id) {
          const ghMatch = (s.install_url || '').match(
            /github(?:usercontent)?\.com\/([^/]+)\/([^/]+)/,
          );
          skills.push({
            id: s.id,
            name: s.name || s.id,
            description: (s.description || '').slice(0, 300),
            install_url: s.install_url || '',
            owner: ghMatch ? ghMatch[1]! : '',
            repo: ghMatch ? ghMatch[2]! : '',
            source: sourceName,
            weekly_installs: 0,
            github_stars: 0,
          });
        }
      }
    }
    console.log(`  Found ${skills.length} skills from ${sourceName}.`);
    return skills;
  } catch (err) {
    console.error(`  Error fetching ${sourceName}: ${err}`);
    return [];
  }
}

// ─── Build registry ───────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== SkillForge Registry Builder ===\n');

  // Fetch from all sources in parallel
  const [skillsSh, anthropic, obra] = await Promise.all([
    fetchAllSkillsSh(),
    fetchMarketplaceSkills(
      'https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json',
      'Anthropic Skills',
    ),
    fetchMarketplaceSkills(
      'https://raw.githubusercontent.com/obra/superpowers/main/.claude-plugin/marketplace.json',
      'Superpowers (obra)',
    ),
  ]);

  // Merge and deduplicate (first source wins)
  const allSkills = [...skillsSh, ...anthropic, ...obra];
  const seenIds = new Set<string>();
  const deduped: RawSkill[] = [];
  for (const skill of allSkills) {
    if (!seenIds.has(skill.id)) {
      seenIds.add(skill.id);
      deduped.push(skill);
    }
  }

  console.log(`\nTotal unique skills: ${deduped.length}`);

  // Read existing registry for stacks config
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));

  // Build skills map with popularity metrics
  const skillsMap: Record<string, {
    name: string;
    description: string;
    install_url: string;
    owner: string;
    repo: string;
    source: string;
    weekly_installs: number;
    github_stars: number;
  }> = {};

  for (const s of deduped) {
    skillsMap[s.id] = {
      name: s.name,
      description: s.description,
      install_url: s.install_url,
      owner: s.owner,
      repo: s.repo,
      source: s.source,
      weekly_installs: s.weekly_installs,
      github_stars: s.github_stars,
    };
  }

  // Log top skills by installs
  const byInstalls = deduped.filter(s => s.weekly_installs > 0).sort((a, b) => b.weekly_installs - a.weekly_installs);
  console.log(`\nTop 10 by weekly installs:`);
  for (const s of byInstalls.slice(0, 10)) {
    console.log(`  ${s.weekly_installs.toString().padStart(8)}  ${s.id}`);
  }

  // Update registry
  registry._meta.generated_at = new Date().toISOString().split('T')[0];
  registry._meta.total_skills = deduped.length;
  registry.skills = skillsMap;

  // Write
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
  console.log(`\nRegistry written to ${REGISTRY_PATH}`);
  console.log(`  ${registry.stacks.length} stack definitions`);
  console.log(`  ${deduped.length} skills`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
