#!/usr/bin/env tsx
/**
 * Per-skill stack mapping — analyzes each skill's name + description
 * and writes a `stacks` array directly into each skill entry.
 *
 * This catches skills inside "mega collection" repos that contain
 * mixed technologies (e.g. github/awesome-copilot has 271 skills
 * spanning React, Go, Docker, Python, etc.)
 *
 * Run AFTER auto-map-repos.ts:
 *   npx tsx scripts/auto-map-repos.ts
 *   npx tsx scripts/auto-map-skills.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, '..', 'src', 'config', 'skills-registry.json');

// ─── Per-skill keyword matchers ───────────────────────────────────────
// Each entry: [stackId, patterns matched against "skillId name description"]

const SKILL_MATCHERS: Array<[string, RegExp[]]> = [
  // Frameworks
  ['nextjs', [/\bnext\.?js\b/i, /\bapp[\s-]?router\b/i, /\bpages[\s-]?router\b/i, /\brsc\b/i, /\bserver[\s-]?component/i, /\bnext[\s-]config/i, /\bnextjs/i]],
  ['react-native', [/\breact[\s-]?native\b/i, /\bexpo\b/i, /\bmobile.*(?:ios|android)\b/i, /\bflatlist\b/i, /\bmetro\b/i]],
  ['react', [/\breact(?![\s-]?native)\b/i, /\bjsx\b/i, /\bhooks?\b/i, /\buse[A-Z]\w+/]],
  ['vue', [/\bvue\.?(?:js)?\b/i, /\bvuex\b/i, /\bpinia\b/i, /\bcomposition[\s-]?api\b/i]],
  ['nuxt', [/\bnuxt/i, /\bnitro\b/i]],
  ['angular', [/\bangular\b/i, /\brxjs\b/i, /\bng[\s-]?module/i]],
  ['svelte', [/\bsvelte/i, /\bsveltekit\b/i]],
  ['astro', [/\bastro\b/i]],
  ['remix', [/\bremix\b/i]],
  ['gatsby', [/\bgatsby\b/i]],
  ['electron', [/\belectron\b/i]],
  ['tauri', [/\btauri\b/i]],

  // Backend
  ['express', [/\bexpress\.?js?\b/i]],
  ['fastify', [/\bfastify\b/i]],
  ['nestjs', [/\bnestjs\b/i, /\bnest\.?js\b/i]],
  ['hono', [/\bhono\b/i]],
  ['django', [/\bdjango\b/i, /\bdrf\b/i, /\bdjango[\s-]?rest\b/i]],
  ['fastapi', [/\bfastapi\b/i]],
  ['flask', [/\bflask\b/i]],
  ['laravel', [/\blaravel\b/i, /\beloquent\b/i, /\bblade\b/i, /\blivewire\b/i]],
  ['rails', [/\brails\b/i, /\bruby[\s-]?on[\s-]?rails\b/i, /\bactiverecord\b/i]],
  ['spring-boot', [/\bspring[\s-]?boot\b/i, /\bspring[\s-]?framework\b/i, /\bjava[\s-]?spring\b/i]],

  // Languages (prefixed with _ to distinguish from framework stacks)
  ['_typescript', [/\btypescript\b/i, /\btsconfig\b/i, /\btype[\s-]?safe\b/i, /\bts[\s-]?patterns?\b/i]],
  ['_golang', [/\bgolang\b/i, /\bgo[\s-](?:pattern|error|test|concurren|modul|perform)/i, /\bgoroutine/i]],
  ['_rust', [/\brust\b/i, /\bcargo\b/i, /\bownership\b/i, /\blifetime/i]],
  ['_python', [/\bpython\b/i, /\bpytest\b/i, /\bpep[\s-]?8\b/i, /\bpython[\s-]?(?:pattern|best|perform|test)/i]],
  ['_swift', [/\bswift(?:ui)?\b/i, /\bxcode\b/i, /\buikit\b/i, /\bios[\s-]?(?:develop|access|secur|test|deploy|app)/i]],
  ['_java', [/\bjava[\s-]?(?:spring|pattern|best|ee|script(?![\s]))\b/i, /\bkotlin\b/i, /\bandroid[\s-]?(?:develop|test|jetpack)/i, /\bspringboot\b/i]],
  ['_csharp', [/\bc#\b/i, /\b\.net\b/i, /\blazor\b/i, /\bunity\b/i, /\bmaui\b/i, /\bef[\s-]?core\b/i]],
  ['_php', [/\bphp\b/i, /\bwordpress\b/i, /\bwp[\s-]/i, /\bsymfony\b/i, /\blaravel\b/i]],
  ['_ruby', [/\bruby\b/i, /\brubocop\b/i, /\brspec\b/i, /\bgem(?:file)?\b/i]],

  // Mobile
  ['flutter', [/\bflutter\b/i, /\bwidget\b/i, /\bdart\b/i, /\briverpod\b/i, /\bbloc\b/i]],

  // Databases
  ['supabase', [/\bsupabase\b/i]],
  ['prisma', [/\bprisma\b/i]],
  ['drizzle', [/\bdrizzle\b/i]],
  ['firebase', [/\bfirebase\b/i, /\bfirestore\b/i]],
  ['_postgresql', [/\bpostgres(?:ql)?\b/i, /\bpsql\b/i]],
  ['_mongodb', [/\bmongo(?:db)?\b/i, /\bmongoose\b/i]],
  ['_redis', [/\bredis\b/i]],

  // Styling
  ['tailwindcss', [/\btailwind/i]],
  ['shadcn', [/\bshadcn\b/i]],

  // Testing
  ['playwright', [/\bplaywright\b/i]],
  ['vitest', [/\bvitest\b/i]],
  ['_jest', [/\bjest\b/i]],
  ['_cypress', [/\bcypress\b/i]],

  // Platforms
  ['_azure', [/\bazure\b/i, /\bapp[\s-]?service\b/i]],
  ['_aws', [/\baws\b/i, /\blambda\b/i, /\bdynamodb\b/i, /\bcloudformation\b/i]],
  ['_gcp', [/\bgoogle[\s-]?cloud\b/i, /\bgcp\b/i, /\bbigquery\b/i]],
  ['vercel', [/\bvercel\b/i]],
  ['cloudflare-workers', [/\bcloudflare\b/i, /\bwrangler\b/i]],
  ['stripe', [/\bstripe\b/i, /\bpayment[\s-]?process/i]],
  ['_shopify', [/\bshopify\b/i, /\bliquid\b/i, /\bpolaris\b/i]],
  ['_salesforce', [/\bsalesforce\b/i, /\bapex\b/i, /\blwc\b/i, /\bsoql\b/i]],

  // Infra
  ['docker', [/\bdocker\b/i, /\bcontainer(?:iz)/i, /\bkubernetes\b/i, /\bk8s\b/i, /\bhelm\b/i]],
  ['terraform', [/\bterraform\b/i, /\binfrastructure[\s-]?as[\s-]?code\b/i]],

  // Media
  ['remotion', [/\bremotion\b/i]],

  // Domains
  ['_security', [/\bsecurity[\s-]?(?:audit|review|best|check|harden)/i, /\bvulnerabilit/i, /\bsemgrep\b/i, /\bsast\b/i, /\bsca\b/i, /\bowasp\b/i, /\bpentesting\b/i]],
  ['_web3', [/\bsolana\b/i, /\bethereum\b/i, /\bweb3\b/i, /\bblockchain\b/i, /\bsmart[\s-]?contract\b/i, /\bsolidity\b/i]],
  ['_ai', [/\bllm[\s-]?(?:app|agent|chain)\b/i, /\bprompt[\s-]?engineer/i, /\brag\b/i, /\blangchain\b/i, /\bmodel[\s-]?train/i, /\btransformer/i, /\bembedding/i]],
  ['_seo', [/\bseo\b/i, /\bsearch[\s-]?engine[\s-]?optim/i]],
  ['_marketing', [/\bmarketing\b/i, /\bcopywriting\b/i, /\bcontent[\s-]?strategy\b/i]],
  ['_devops', [/\bci[\s\/]?cd\b/i, /\bgithub[\s-]?actions\b/i, /\bpipeline\b/i, /\bdeployment[\s-]?automat/i]],
  ['_api', [/\brest[\s-]?api\b/i, /\bgraphql\b/i, /\bopenapi\b/i, /\bgrpc\b/i, /\bapi[\s-]?design\b/i]],
  ['_database', [/\bdatabase[\s-]?(?:design|schema|migration|optim)/i, /\bsql\b/i, /\borm\b/i]],
];

// ─── Main ─────────────────────────────────────────────────────────────

function main(): void {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
  const repoMapping = registry.repo_to_stack as Record<string, string[]>;

  let totalMatched = 0;
  let totalUnmatched = 0;
  let totalSkills = 0;
  const stackCounts = new Map<string, number>();

  for (const [skillId, skill] of Object.entries(registry.skills) as [string, Record<string, unknown>][]) {
    totalSkills++;
    const repo = `${skill.owner}/${skill.repo}`;
    const text = `${skillId} ${skill.name} ${skill.description}`.toLowerCase();
    const matchedStacks = new Set<string>();

    // 1. Inherit from repo mapping
    const repoStacks = repoMapping[repo];
    if (repoStacks) {
      for (const s of repoStacks) matchedStacks.add(s);
    }

    // 2. Per-skill keyword matching
    for (const [stackId, patterns] of SKILL_MATCHERS) {
      if (patterns.some((p) => p.test(text))) {
        matchedStacks.add(stackId);
      }
    }

    // Remove _universal if we have specific matches
    if (matchedStacks.size > 1 && matchedStacks.has('_universal')) {
      matchedStacks.delete('_universal');
    }

    // Write stacks to skill
    if (matchedStacks.size > 0) {
      skill.stacks = [...matchedStacks];
      totalMatched++;
      for (const s of matchedStacks) {
        stackCounts.set(s, (stackCounts.get(s) || 0) + 1);
      }
    } else {
      // No match → universal
      skill.stacks = ['_universal'];
      totalUnmatched++;
      stackCounts.set('_universal', (stackCounts.get('_universal') || 0) + 1);
    }
  }

  // Write back
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');

  // Report
  console.log('=== Per-Skill Mapping Results ===\n');
  console.log(`Total skills: ${totalSkills}`);
  console.log(`Matched to specific stack(s): ${totalMatched} (${Math.round(totalMatched / totalSkills * 100)}%)`);
  console.log(`Universal (no specific stack): ${totalUnmatched} (${Math.round(totalUnmatched / totalSkills * 100)}%)`);

  console.log('\n=== Skills per Stack ===\n');
  const sorted = [...stackCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [stack, count] of sorted) {
    console.log(`  ${count.toString().padStart(5)}  ${stack}`);
  }
}

main();
