#!/usr/bin/env tsx
/**
 * Auto-map repos to stacks by analyzing repo names, skill names, and descriptions.
 *
 * Strategy:
 * 1. Repo name/owner matching (strongest signal)
 * 2. Skill names + descriptions keyword matching (aggregated per repo)
 * 3. Majority vote: if >40% of a repo's skills mention a stack, map it
 *
 * Output: Updates repo_to_stack in skills-registry.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, '..', 'src', 'config', 'skills-registry.json');

// ─── Stack keyword definitions ────────────────────────────────────────
// Each stack has keywords that signal a repo belongs to it.
// Organized by strength: repo-name patterns vs description patterns.

interface StackMatcher {
  id: string;
  /** Patterns matched against repo owner/name (strongest signal) */
  repoPatterns: RegExp[];
  /** Patterns matched against aggregated skill text (weaker signal) */
  textPatterns: RegExp[];
  /** Minimum ratio of skills matching text patterns to map the whole repo */
  minRatio: number;
}

const MATCHERS: StackMatcher[] = [
  // ── Frameworks ──────────────────────────────────────────────────
  {
    id: 'react-native',
    repoPatterns: [/react.?native/i, /\brn\b/i],
    textPatterns: [/\breact[\s-]?native\b/i, /\bexpo\b/i, /\bmobile.*react\b/i, /\bios.*android\b/i],
    minRatio: 0.3,
  },
  {
    id: 'expo',
    repoPatterns: [/\bexpo\b/i],
    textPatterns: [/\bexpo\b/i, /\beas\b/i, /\bexpo[\s-]?router\b/i],
    minRatio: 0.4,
  },
  {
    id: 'nextjs',
    repoPatterns: [/\bnext/i],
    textPatterns: [/\bnext\.?js\b/i, /\bapp\s*router\b/i, /\bpages?\s*router\b/i, /\brsc\b/i, /\bserver\s*component/i, /\bnext\s/i],
    minRatio: 0.3,
  },
  {
    id: 'nuxt',
    repoPatterns: [/\bnuxt/i],
    textPatterns: [/\bnuxt/i, /\bnitro\b/i],
    minRatio: 0.3,
  },
  {
    id: 'svelte',
    repoPatterns: [/\bsvelte/i],
    textPatterns: [/\bsvelte/i, /\bsveltekit\b/i],
    minRatio: 0.3,
  },
  {
    id: 'angular',
    repoPatterns: [/\bangular/i],
    textPatterns: [/\bangular\b/i, /\brxjs\b/i, /\bng[\s-]/i],
    minRatio: 0.3,
  },
  {
    id: 'vue',
    repoPatterns: [/\bvue/i],
    textPatterns: [/\bvue\.?js?\b/i, /\bvuex\b/i, /\bpinia\b/i, /\bvue\s/i],
    minRatio: 0.3,
  },
  {
    id: 'react',
    repoPatterns: [/\breact(?![\s-]?native)/i],
    textPatterns: [/\breact\b/i, /\bjsx\b/i, /\bhooks?\b/i, /\bcomponent/i],
    minRatio: 0.4, // higher threshold — "react" is very common in descriptions
  },
  {
    id: 'astro',
    repoPatterns: [/\bastro/i],
    textPatterns: [/\bastro\b/i, /\bisland/i],
    minRatio: 0.3,
  },
  {
    id: 'remix',
    repoPatterns: [/\bremix/i],
    textPatterns: [/\bremix\b/i],
    minRatio: 0.3,
  },
  {
    id: 'gatsby',
    repoPatterns: [/\bgatsby/i],
    textPatterns: [/\bgatsby\b/i],
    minRatio: 0.3,
  },

  // ── Backend frameworks ──────────────────────────────────────────
  {
    id: 'express',
    repoPatterns: [/\bexpress/i],
    textPatterns: [/\bexpress\.?js?\b/i, /\bexpress\s/i],
    minRatio: 0.3,
  },
  {
    id: 'fastify',
    repoPatterns: [/\bfastify/i],
    textPatterns: [/\bfastify\b/i],
    minRatio: 0.3,
  },
  {
    id: 'nestjs',
    repoPatterns: [/\bnest/i],
    textPatterns: [/\bnestjs\b/i, /\bnest\.?js\b/i],
    minRatio: 0.3,
  },
  {
    id: 'django',
    repoPatterns: [/\bdjango/i],
    textPatterns: [/\bdjango\b/i, /\bdrf\b/i, /\bdjango\s*rest/i],
    minRatio: 0.3,
  },
  {
    id: 'fastapi',
    repoPatterns: [/\bfastapi/i],
    textPatterns: [/\bfastapi\b/i, /\bpydantic\b/i],
    minRatio: 0.3,
  },
  {
    id: 'flask',
    repoPatterns: [/\bflask/i],
    textPatterns: [/\bflask\b/i],
    minRatio: 0.3,
  },
  {
    id: 'laravel',
    repoPatterns: [/\blaravel/i],
    textPatterns: [/\blaravel\b/i, /\beloquent\b/i, /\bblade\b/i, /\blivewire\b/i],
    minRatio: 0.3,
  },
  {
    id: 'rails',
    repoPatterns: [/\brails/i, /\bruby[\s-]?on/i],
    textPatterns: [/\brails\b/i, /\bruby on rails\b/i, /\bactiverecord\b/i, /\bactioncable\b/i],
    minRatio: 0.3,
  },
  {
    id: 'spring-boot',
    repoPatterns: [/\bspring/i],
    textPatterns: [/\bspring\s*boot\b/i, /\bspring\s*framework\b/i],
    minRatio: 0.3,
  },
  {
    id: 'hono',
    repoPatterns: [/\bhono/i],
    textPatterns: [/\bhono\b/i],
    minRatio: 0.3,
  },

  // ── Languages (matched from repo name / heavy keyword presence) ─
  {
    id: 'flutter',
    repoPatterns: [/\bflutter/i, /\bdart/i],
    textPatterns: [/\bflutter\b/i, /\bwidget/i, /\bdart\b/i, /\bpubspec\b/i],
    minRatio: 0.3,
  },
  {
    id: '_typescript',
    repoPatterns: [/\btypescript/i, /\bts[\s-]/i],
    textPatterns: [/\btypescript\b/i, /\btsconfig\b/i, /\btype[\s-]?safe/i],
    minRatio: 0.5,
  },
  {
    id: '_golang',
    repoPatterns: [/\bgolang/i, /\bgo[\s-]skill/i, /\bgo[\s-]best/i],
    textPatterns: [/\bgolang\b/i, /\bgoroutine/i, /\bgo\s+module/i, /\bgo\s+(?:code|error|test|concurren)/i],
    minRatio: 0.4,
  },
  {
    id: '_rust',
    repoPatterns: [/\brust/i, /\bcargo/i],
    textPatterns: [/\brust\b/i, /\bcargo\b/i, /\bownership\b/i, /\blifetime/i, /\bcrate\b/i],
    minRatio: 0.4,
  },
  {
    id: '_python',
    repoPatterns: [/\bpython/i, /\bpy[\s-]/i],
    textPatterns: [/\bpython\b/i, /\bpytest\b/i, /\bpep[\s-]?8\b/i, /\bpip\b/i],
    minRatio: 0.5, // high threshold — "python" very common
  },
  {
    id: '_swift',
    repoPatterns: [/\bswift/i, /\bios[\s-]skill/i, /\bios[\s-]dev/i],
    textPatterns: [/\bswift(?:ui)?\b/i, /\bios\b/i, /\bxcode\b/i, /\buikit\b/i, /\bapp\s*store\b/i],
    minRatio: 0.3,
  },
  {
    id: '_java',
    repoPatterns: [/\bjava(?!script)/i, /\bkotlin/i, /\bandroid[\s-]skill/i],
    textPatterns: [/\bjava\b/i, /\bkotlin\b/i, /\bandroid\b/i, /\bspring\b/i, /\bgradle\b/i, /\bmaven\b/i],
    minRatio: 0.4,
  },
  {
    id: '_csharp',
    repoPatterns: [/\bcsharp/i, /\bdotnet/i, /\.net/i, /\bunity/i],
    textPatterns: [/\bc#\b/i, /\.net\b/i, /\blazor\b/i, /\bunity\b/i, /\bmaui\b/i],
    minRatio: 0.3,
  },
  {
    id: '_php',
    repoPatterns: [/\bphp/i, /\bwordpress/i],
    textPatterns: [/\bphp\b/i, /\bwordpress\b/i, /\bwp[\s-]/i, /\bsymfony\b/i, /\bcomposer\b/i],
    minRatio: 0.3,
  },
  {
    id: '_ruby',
    repoPatterns: [/\bruby(?![\s-]?on)/i],
    textPatterns: [/\bruby\b/i, /\bgem\b/i, /\brubocop\b/i, /\brspec\b/i],
    minRatio: 0.4,
  },

  // ── Databases / ORMs ────────────────────────────────────────────
  {
    id: 'supabase',
    repoPatterns: [/\bsupabase/i],
    textPatterns: [/\bsupabase\b/i, /\brow\s*level\s*security\b/i, /\brls\b/i],
    minRatio: 0.3,
  },
  {
    id: 'prisma',
    repoPatterns: [/\bprisma/i],
    textPatterns: [/\bprisma\b/i, /\bschema\.prisma\b/i],
    minRatio: 0.3,
  },
  {
    id: 'drizzle',
    repoPatterns: [/\bdrizzle/i],
    textPatterns: [/\bdrizzle\b/i],
    minRatio: 0.3,
  },
  {
    id: 'firebase',
    repoPatterns: [/\bfirebase/i],
    textPatterns: [/\bfirebase\b/i, /\bfirestore\b/i, /\bcloud\s*function/i],
    minRatio: 0.3,
  },

  // ── Styling / UI ────────────────────────────────────────────────
  {
    id: 'tailwindcss',
    repoPatterns: [/\btailwind/i],
    textPatterns: [/\btailwind/i, /\butility[\s-]first/i],
    minRatio: 0.3,
  },
  {
    id: 'shadcn',
    repoPatterns: [/\bshadcn/i],
    textPatterns: [/\bshadcn\b/i],
    minRatio: 0.3,
  },

  // ── Platforms / Services ────────────────────────────────────────
  {
    id: '_azure',
    repoPatterns: [/\bazure/i, /\bmicrosoft/i],
    textPatterns: [/\bazure\b/i, /\bapp\s*service\b/i, /\bazure\s*function/i, /\bcosmos\s*db\b/i],
    minRatio: 0.3,
  },
  {
    id: '_aws',
    repoPatterns: [/\baws/i, /\bamazon/i],
    textPatterns: [/\baws\b/i, /\blambda\b/i, /\bs3\b/i, /\bdynamodb\b/i, /\bcloudformation\b/i],
    minRatio: 0.3,
  },
  {
    id: '_gcp',
    repoPatterns: [/\bgoogle[\s-]?cloud/i, /\bgcp/i],
    textPatterns: [/\bgcp\b/i, /\bgoogle\s*cloud\b/i, /\bbigquery\b/i, /\bcloud\s*run\b/i],
    minRatio: 0.3,
  },
  {
    id: 'vercel',
    repoPatterns: [/\bvercel/i],
    textPatterns: [/\bvercel\b/i, /\bedge\s*function/i],
    minRatio: 0.3,
  },
  {
    id: 'cloudflare-workers',
    repoPatterns: [/\bcloudflare/i, /\bworker/i],
    textPatterns: [/\bcloudflare\b/i, /\bworker/i, /\bwrangler\b/i],
    minRatio: 0.3,
  },
  {
    id: 'stripe',
    repoPatterns: [/\bstripe/i],
    textPatterns: [/\bstripe\b/i, /\bpayment/i, /\bcheckout\b/i],
    minRatio: 0.3,
  },
  {
    id: '_shopify',
    repoPatterns: [/\bshopify/i],
    textPatterns: [/\bshopify\b/i, /\bliquid\b/i, /\bpolaris\b/i],
    minRatio: 0.3,
  },
  {
    id: '_salesforce',
    repoPatterns: [/\bsalesforce/i, /\bsf[\s-]skill/i, /\bapex/i],
    textPatterns: [/\bsalesforce\b/i, /\bapex\b/i, /\blwc\b/i, /\bsoql\b/i, /\bsf[\s-]/i],
    minRatio: 0.3,
  },

  // ── Infra / DevOps ──────────────────────────────────────────────
  {
    id: 'docker',
    repoPatterns: [/\bdocker/i, /\bkubernetes/i, /\bk8s/i],
    textPatterns: [/\bdocker\b/i, /\bcontainer/i, /\bkubernetes\b/i, /\bk8s\b/i, /\bhelm\b/i],
    minRatio: 0.3,
  },
  {
    id: 'terraform',
    repoPatterns: [/\bterraform/i, /\biac/i],
    textPatterns: [/\bterraform\b/i, /\binfrastructure\s*as\s*code\b/i, /\biac\b/i],
    minRatio: 0.3,
  },

  // ── Testing ─────────────────────────────────────────────────────
  {
    id: 'playwright',
    repoPatterns: [/\bplaywright/i],
    textPatterns: [/\bplaywright\b/i, /\be2e\s*test/i],
    minRatio: 0.3,
  },
  {
    id: 'vitest',
    repoPatterns: [/\bvitest/i],
    textPatterns: [/\bvitest\b/i],
    minRatio: 0.3,
  },

  // ── Media ───────────────────────────────────────────────────────
  {
    id: 'remotion',
    repoPatterns: [/\bremotion/i],
    textPatterns: [/\bremotion\b/i],
    minRatio: 0.3,
  },

  // ── Security ────────────────────────────────────────────────────
  {
    id: '_security',
    repoPatterns: [/\bsecur/i, /\baudit/i, /\btrailofbits/i, /\bvuln/i],
    textPatterns: [/\bsecurity\b/i, /\bvulnerabilit/i, /\baudit\b/i, /\bsemgrep\b/i, /\bcve\b/i, /\bsast\b/i, /\bsca\b/i],
    minRatio: 0.3,
  },

  // ── Crypto / Web3 ───────────────────────────────────────────────
  {
    id: '_web3',
    repoPatterns: [/\bbinance/i, /\bsolana/i, /\bethereum/i, /\bweb3/i, /\bcrypto/i, /\bblockchain/i],
    textPatterns: [/\bsolana\b/i, /\bethereum\b/i, /\bweb3\b/i, /\bblockchain\b/i, /\bsmart\s*contract/i, /\bcrypto/i, /\btok?en\b/i],
    minRatio: 0.3,
  },

  // ── AI/ML ───────────────────────────────────────────────────────
  {
    id: '_ai',
    repoPatterns: [/\bopenai/i, /\bllm/i, /\bai[\s-]skill/i, /\bml[\s-]skill/i],
    textPatterns: [/\bllm\b/i, /\bopenai\b/i, /\bgpt/i, /\bprompt\s*engineer/i, /\bmodel\s*train/i, /\btransformer/i],
    minRatio: 0.4,
  },
];

// ─── Execution ────────────────────────────────────────────────────────

function main(): void {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
  const skills = Object.entries(registry.skills) as [string, { name: string; description: string; owner: string; repo: string }][];

  // Group skills by repo
  const repos = new Map<string, { skillIds: string[]; texts: string[] }>();
  for (const [id, s] of skills) {
    const key = `${s.owner}/${s.repo}`;
    if (!repos.has(key)) repos.set(key, { skillIds: [], texts: [] });
    const entry = repos.get(key)!;
    entry.skillIds.push(id);
    entry.texts.push(`${s.name} ${s.description} ${id}`.toLowerCase());
  }

  const existingMapping = registry.repo_to_stack as Record<string, string[]>;
  const newMapping: Record<string, string[]> = { ...existingMapping };
  let newlyMapped = 0;
  let totalMappedSkills = 0;

  for (const [repo, data] of repos) {
    // Skip already-mapped repos
    if (existingMapping[repo]) {
      totalMappedSkills += data.skillIds.length;
      continue;
    }

    const repoLower = repo.toLowerCase();
    const matchedStacks = new Set<string>();

    for (const matcher of MATCHERS) {
      // 1. Check repo name (strongest signal — auto-maps the whole repo)
      if (matcher.repoPatterns.some((p) => p.test(repoLower))) {
        matchedStacks.add(matcher.id);
        continue;
      }

      // 2. Check skill texts (weaker — needs minRatio of skills to match)
      let matchCount = 0;
      for (const text of data.texts) {
        if (matcher.textPatterns.some((p) => p.test(text))) {
          matchCount++;
        }
      }

      const ratio = matchCount / data.texts.length;
      if (ratio >= matcher.minRatio && matchCount >= 2) {
        matchedStacks.add(matcher.id);
      }
    }

    if (matchedStacks.size > 0) {
      newMapping[repo] = [...matchedStacks];
      newlyMapped++;
      totalMappedSkills += data.skillIds.length;
    }
  }

  // Write back
  registry.repo_to_stack = newMapping;
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');

  // Report
  const totalRepos = repos.size;
  const mappedRepos = Object.keys(newMapping).length;
  const unmappedRepos = totalRepos - mappedRepos;
  const totalSkills = skills.length;
  const unmappedSkills = totalSkills - totalMappedSkills;

  console.log('=== Auto-Mapping Results ===\n');
  console.log(`Repos:  ${mappedRepos}/${totalRepos} mapped (+${newlyMapped} new)`);
  console.log(`Skills: ${totalMappedSkills}/${totalSkills} reachable (${unmappedSkills} unmapped)\n`);

  // Show new mappings
  const newEntries = Object.entries(newMapping)
    .filter(([k]) => !existingMapping[k])
    .sort((a, b) => {
      const countA = repos.get(a[0])?.skillIds.length || 0;
      const countB = repos.get(b[0])?.skillIds.length || 0;
      return countB - countA;
    });

  console.log(`=== New Mappings (top 50) ===\n`);
  for (const [repo, stacks] of newEntries.slice(0, 50)) {
    const count = repos.get(repo)?.skillIds.length || 0;
    console.log(`  ${count.toString().padStart(4)}  ${repo}  ->  [${stacks.join(', ')}]`);
  }

  if (unmappedRepos > 0) {
    console.log(`\n=== Still Unmapped (top 20) ===\n`);
    const stillUnmapped = [...repos.entries()]
      .filter(([k]) => !newMapping[k])
      .sort((a, b) => b[1].skillIds.length - a[1].skillIds.length)
      .slice(0, 20);
    for (const [repo, data] of stillUnmapped) {
      console.log(`  ${data.skillIds.length.toString().padStart(4)}  ${repo}`);
    }
  }
}

main();
