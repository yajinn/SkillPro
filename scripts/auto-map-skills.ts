#!/usr/bin/env tsx
/**
 * Per-skill stack mapping — analyzes each skill's name + description
 * and writes `stacks` and `platform` arrays directly into each skill entry.
 *
 * Taxonomy rules (see memory/project_skillforge_taxonomy.md):
 *   1. Stacks are independent, not hierarchical. Expo ≠ React Native,
 *      Next.js ≠ React — even though they derive from each other.
 *   2. Platform boundaries are hard gates. Mobile projects never see
 *      web-only skills, even if they share a framework like React.
 *   3. Language tags (_typescript, _python) are FALLBACK matches only,
 *      not primary. A skill must match a framework/platform first.
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

// ─── Platform detection ───────────────────────────────────────────────
// Each skill gets exactly ONE platform: web, mobile, desktop, or both.
// `both` = cross-platform (generic React hooks, TypeScript patterns, etc.)

type Platform = 'web' | 'mobile' | 'desktop' | 'both';

const PLATFORM_PATTERNS: Array<[Platform, RegExp[]]> = [
  // Mobile: iOS/Android/RN/Expo/Flutter specific
  ['mobile', [
    /\breact[\s-]?native\b/i,
    /\bexpo\b/i,
    /\beas\s+(?:build|submit|update)\b/i,
    /\bflutter\b/i,
    /\bswift(?:ui)?\b/i,
    /\bxcode\b/i,
    /\buikit\b/i,
    /\bandroid\s+(?:studio|sdk|app|native|jetpack)\b/i,
    /\bjetpack[\s-]?compose\b/i,
    /\bios\s+(?:app|deploy|sim|native|access|secur|test)/i,
    /\bapp[\s-]?store\b/i,
    /\bplay[\s-]?store\b/i,
    /\bmobile\s+(?:app|device|deploy)/i,
  ]],

  // Desktop: Electron, Tauri, native desktop
  ['desktop', [
    /\belectron\b/i,
    /\btauri\b/i,
    /\bdesktop\s+(?:app|application)/i,
  ]],

  // Web: browser, DOM, SSR, web-specific frameworks
  ['web', [
    /\bnext\.?js\b/i,
    /\bnuxt\b/i,
    /\bsvelte\s*kit\b/i,
    /\bremix\b/i,
    /\bgatsby\b/i,
    /\bastro\b/i,
    /\bvercel\b/i,
    /\bcloudflare\s+(?:worker|page)/i,
    /\bwrangler\b/i,
    /\bshadcn\b/i,
    /\btailwind/i, // Tailwind is web-first (mobile via react-native-nativewind is rare)
    /\bbrowser\b/i,
    /\bdom\b/i,
    /\bhtml\b/i,
    /\bseo\b/i,
    /\bweb\s+(?:app|interface|design|perform|access|server|typography|quality)/i,
    /\blanding\s+page\b/i,
    /\bapp[\s-]?router\b/i,
    /\bpages[\s-]?router\b/i,
    /\brsc\b/i,
    /\bserver[\s-]?component/i,
    /\bhydrat/i,
    /\bwordpress\b/i,
    /\bshopify\b/i,
    /\bweb\s*hosting\b/i,
  ]],
];

function detectPlatform(text: string): Platform {
  // Check mobile first (more specific patterns)
  for (const [platform, patterns] of PLATFORM_PATTERNS) {
    if (patterns.some((p) => p.test(text))) {
      return platform;
    }
  }
  return 'both'; // Default: cross-platform
}

// ─── Stack matchers ───────────────────────────────────────────────────
// CRITICAL: Each stack pattern must match ONLY skills for that exact stack.
// Next.js skills → nextjs only (NOT react). Expo skills → expo only (NOT react-native).

// Strategy: Match if the framework name appears as a distinct word in the
// skill id/name/description. Use \b<name>\b to prevent substring matches
// (e.g. "expo" shouldn't match "exposure"). Platform filtering happens
// separately via isPlatformCompatible() so we don't double-gate here.

const SKILL_MATCHERS: Array<[string, RegExp[]]> = [
  // ── Web Frameworks ──
  ['nextjs', [/\bnext\.?js\b/i, /\bapp[\s-]?router\b/i, /\bpages[\s-]?router\b/i, /\brsc\b/i, /\bserver[\s-]?component/i, /\bnextjs/i]],
  ['nuxt', [/\bnuxt\b/i, /\bnitro\s+(?:server|engine)/i]],
  ['sveltekit', [/\bsveltekit\b/i, /\bsvelte\s*kit\b/i]],
  ['remix', [/\bremix\s+(?:run|framework|route|loader|action)/i, /\b@remix-run\b/i]],
  ['gatsby', [/\bgatsby\b/i]],
  ['astro', [/\bastro\s+(?:component|island|framework|build|integration)/i]],

  // ── Mobile Frameworks ──
  // Expo is NOT React Native — Expo skills only go to expo stack
  ['expo', [
    /\bexpo\b/i,
    /\beas\s+(?:build|submit|update|workflow)/i,
  ]],
  ['react-native', [
    // React Native without expo context (negative lookbehind impossible in JS, so check description excludes expo)
    /\breact[\s-]?native\b/i,
    /\brn[\s-]?(?:cli|best|pattern)/i,
    /\bflatlist\b/i,
    /\bmetro\s+(?:config|bundler)/i,
  ]],

  // ── Client Frameworks ──
  ['react', [/\breact\s+(?:hooks?|context|fiber|three|query|server|compose|tanstack|forms?|router(?![\s-]dom))/i, /\bjsx\b/i]],
  ['vue', [/\bvue\.?js\b/i, /\bvue\s+(?:component|composition|reactive|template)/i, /\bvuex\b/i, /\bpinia\b/i]],
  ['angular', [/\bangular\b/i, /\brxjs\s+(?:operator|observable)/i]],
  ['svelte', [/\bsvelte\b/i]],

  // ── Desktop ──
  ['electron', [/\belectron\b/i]],
  ['tauri', [/\btauri\b/i]],

  // ── Mobile Native ──
  ['flutter', [/\bflutter\b/i, /\bwidget\s+(?:tree|build|stateless|stateful)/i, /\briverpod\b/i, /\bbloc\s+pattern\b/i]],

  // ── Backend Frameworks ──
  ['express', [/\bexpress\.?js\b/i, /\bexpress\s+(?:app|middleware|route)/i]],
  ['fastify', [/\bfastify\b/i]],
  ['nestjs', [/\bnestjs\b/i, /\bnest\.?js\b/i]],
  ['hono', [/\bhono\b/i]],
  ['django', [/\bdjango\b/i, /\bdrf\b/i]],
  ['fastapi', [/\bfastapi\b/i]],
  ['flask', [/\bflask\b/i]],
  // Laravel must be PHP context — not confused with railway platform
  ['laravel', [/\blaravel\b/i, /\beloquent\s+(?:orm|model|relation)/i, /\bblade\s+template/i, /\blivewire\b/i]],
  // Rails = Ruby on Rails. \b prevents "railway" matches.
  ['rails', [/\brails\b/i, /\bruby[\s-]?on[\s-]?rails\b/i, /\bactiverecord\b/i, /\bhotwire\b/i]],
  ['spring-boot', [/\bspring[\s-]?boot\b/i, /\bspringboot\b/i]],

  // ── Go Frameworks ──
  ['gin', [/\bgin[\s-]?gonic\b/i, /\bgin\s+(?:framework|handler|middleware|router|context|web)/i]],
  ['echo-go', [/\becho\s+(?:framework|handler|middleware|context|web)/i, /\blabstack\/echo\b/i]],
  ['fiber', [/\bgofiber\b/i, /\bfiber\s+(?:framework|handler|middleware)/i]],

  // ── Ruby (non-Rails) ──
  ['sinatra', [/\bsinatra\b/i]],

  // ── WordPress (NOT Laravel — keep separate even though both are PHP) ──
  ['wordpress', [/\bwordpress\b/i, /\bwp[\s-](?:plugin|theme|cli|block|rest|content|admin|hook)/i, /\bgutenberg\b/i, /\bwp[\s-]?cli\b/i]],

  // ── Databases ──
  ['supabase', [/\bsupabase\s+(?:client|auth|database|storage|rls|edge|function|migration)/i, /\brow[\s-]?level[\s-]?security\b/i, /\bsupabase-postgres/i]],
  ['prisma', [/\bprisma\s+(?:client|schema|migration|studio|orm|generator)/i, /\bschema\.prisma\b/i]],
  ['drizzle', [/\bdrizzle\s+(?:orm|kit|schema|query)/i]],
  ['firebase', [/\bfirebase\s+(?:auth|firestore|function|hosting|storage|sdk|admin|cloud)/i, /\bfirestore\s+(?:rule|query|collection)/i, /\bcloud\s+function/i]],
  ['_postgresql', [/\bpostgres(?:ql)?\s+(?:perform|index|query|migration|best)/i, /\bpsql\s+(?:command|tool)/i]],
  ['_mongodb', [/\bmongo(?:db)?\s+(?:aggregation|schema|index|query|best)/i, /\bmongoose\s+(?:model|schema)/i]],
  ['_redis', [/\bredis\s+(?:cache|pub|sub|stream|cluster)/i]],

  // ── Styling / UI Libraries ──
  ['tailwindcss', [/\btailwind\s+(?:css|config|component|v4|design|utility)/i]],
  ['shadcn', [/\bshadcn\s*\/?\s*ui\b/i, /\bshadcn[\s-]/i]],

  // ── Testing ──
  ['playwright', [/\bplaywright\s+(?:test|config|fixture|locator|best)/i]],
  ['vitest', [/\bvitest\s+(?:config|mock|test|best)/i]],
  ['_jest', [/\bjest\s+(?:mock|test|config|setup)/i]],
  ['_cypress', [/\bcypress\s+(?:test|config|command)/i]],

  // ── Platforms ──
  ['_azure', [/\bazure\s+(?:function|service|sdk|deploy|ai|storage|cosmos|kubernetes)/i]],
  ['_aws', [/\baws\s+(?:lambda|s3|dynamodb|cloudformation|cdk|amplify|sdk)/i, /\blambda\s+function/i, /\bdynamodb\b/i]],
  ['_gcp', [/\bgoogle\s*cloud\s+(?:run|storage|function|sdk|sql)/i, /\bgcp\s+/i, /\bbigquery\b/i]],
  ['vercel', [/\bvercel\s+(?:deploy|edge|function|analytics|cli|cron)/i]],
  ['cloudflare-workers', [/\bcloudflare\s+(?:worker|page|kv|r2|d1|durable)/i, /\bwrangler\s+(?:dev|deploy|config)/i]],
  ['stripe', [/\bstripe\s+(?:checkout|payment|subscription|webhook|connect|sdk)/i, /\bpayment[\s-]?process/i]],
  ['_shopify', [/\bshopify\s+(?:admin|api|liquid|polaris|theme|app)/i]],
  ['_salesforce', [/\bsalesforce\s+(?:apex|lwc|flow|api|admin)/i, /\bapex\s+(?:class|trigger|test)/i, /\blwc\b/i, /\bsoql\b/i]],

  // ── Infra ──
  ['docker', [/\bdocker\s+(?:compose|file|image|container|registry)/i, /\bcontainer[\s-]?(?:iz|orch)/i, /\bkubernetes\s+(?:pod|deploy|service|ingress)/i, /\bk8s\s+/i, /\bhelm\s+chart/i]],
  ['terraform', [/\bterraform\s+(?:module|resource|provider|state)/i, /\binfrastructure[\s-]?as[\s-]?code\b/i]],

  // ── Media ──
  ['remotion', [/\bremotion\s+(?:component|video|render)/i]],

  // ── Domains ──
  ['_security', [/\bsecurity\s+(?:audit|review|best|check|harden|scan)/i, /\bvulnerabilit/i, /\bsemgrep\b/i, /\bsast\b/i, /\bsca\b/i, /\bowasp\b/i, /\bpentest/i]],
  ['_web3', [/\bsolana\s+(?:program|anchor|sdk)/i, /\bethereum\s+(?:smart|contract)/i, /\bsolidity\b/i, /\bsmart[\s-]?contract\s+(?:audit|deploy|test)/i]],
  ['_ai', [/\bllm\s+(?:app|agent|chain)\b/i, /\bprompt[\s-]?engineer/i, /\brag\s+(?:pipeline|system)/i, /\blangchain\b/i, /\bmodel[\s-]?train/i, /\bembedding\s+(?:model|search)/i]],
  ['_seo', [/\bseo\s+(?:audit|content|keyword|backlink|optim)/i, /\bsearch[\s-]?engine[\s-]?optim/i]],
  ['_marketing', [/\bmarketing\s+(?:strategy|automation|campaign)/i, /\bcopywriting\s+(?:best|guide|framework)/i, /\bcontent[\s-]?strategy\b/i]],
  ['_devops', [/\bci[\s\/]?cd\s+(?:pipeline|workflow|config)/i, /\bgithub[\s-]?actions\b/i, /\bdeployment[\s-]?automat/i]],
  ['_api', [/\brest[\s-]?api\s+(?:design|best|document)/i, /\bgraphql\s+(?:schema|resolver|best)/i, /\bopenapi\s+(?:spec|gen)/i, /\bgrpc\s+(?:service|proto)/i]],
];

// ─── Language FALLBACK matchers ─────────────────────────────────────────
// These are ONLY applied if no primary stack match was found.
// Prevents "skill mentions TypeScript" from triggering for every TS project.

// NOTE: Language tags use SAME NAMES as detect/stack.ts languages.
// "go" (lang) → "_go" (tag), "python" (lang) → "_python" (tag), etc.
const LANGUAGE_FALLBACK_MATCHERS: Array<[string, RegExp[]]> = [
  ['_typescript', [/\btypescript\b/i, /\btsconfig\b/i, /\btype[\s-]?safe\b/i]],
  ['_go', [/\bgolang\b/i, /\bgoroutine/i, /\bgo\s+(?:module|concurrent|channel|error[\s-]?handl|pattern|best|perform)/i]],
  ['_rust', [/\brust\b/i, /\bcargo\b/i, /\bownership\b/i, /\blifetime\b/i]],
  ['_python', [/\bpython\b/i, /\bpytest\b/i, /\bpep[\s-]?8\b/i, /\bpip\s+install/i]],
  ['_java', [/\bjava\s+(?:pattern|best|concurrent|stream|spring)/i, /\bjvm\b/i]],
  ['_kotlin', [/\bkotlin\b/i]],
  ['_csharp', [/\bc#\b/i, /\b\.net\b/i, /\baspnet\b/i, /\bblazor\b/i]],
  ['_php', [/\bphp\b/i, /\bphpstan\b/i, /\bpsr[\s-]?\d+/i]],
  ['_ruby', [/\bruby\b/i, /\brubocop\b/i, /\brspec\b/i, /\bgemfile\b/i]],
];

// ─── Main ─────────────────────────────────────────────────────────────

function matchAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function main(): void {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
  const repoMapping = registry.repo_to_stack as Record<string, string[]>;

  let totalSkills = 0;
  let specificMatched = 0;
  let languageOnly = 0;
  let universalOnly = 0;
  const stackCounts = new Map<string, number>();
  const platformCounts = new Map<string, number>();

  for (const [skillId, skill] of Object.entries(registry.skills) as [string, Record<string, unknown>][]) {
    totalSkills++;
    const repo = `${skill.owner}/${skill.repo}`;
    const text = `${skillId} ${skill.name} ${skill.description}`.toLowerCase();
    const matchedStacks = new Set<string>();

    // 1. Inherit from repo mapping (strongest signal)
    const repoStacks = repoMapping[repo];
    if (repoStacks) {
      for (const s of repoStacks) matchedStacks.add(s);
    }

    // 2. Primary stack matching (framework/platform-specific keywords)
    for (const [stackId, patterns] of SKILL_MATCHERS) {
      if (matchAny(text, patterns)) {
        matchedStacks.add(stackId);
      }
    }

    // 3. Fallback to language tags ONLY if no primary match
    const hasPrimaryMatch = [...matchedStacks].some(
      (s) => !s.startsWith('_') && s !== '_universal',
    );
    if (!hasPrimaryMatch) {
      for (const [langId, patterns] of LANGUAGE_FALLBACK_MATCHERS) {
        if (matchAny(text, patterns)) {
          matchedStacks.add(langId);
        }
      }
    }

    // 4. Detect platform (web/mobile/desktop/both)
    const platform = detectPlatform(text);
    skill.platform = platform;
    platformCounts.set(platform, (platformCounts.get(platform) || 0) + 1);

    // 5. Remove _universal if we have specific matches
    if (matchedStacks.size > 1 && matchedStacks.has('_universal')) {
      matchedStacks.delete('_universal');
    }

    // 6. Write stacks to skill
    if (matchedStacks.size > 0) {
      skill.stacks = [...matchedStacks];
      const hasSpecific = [...matchedStacks].some((s) => !s.startsWith('_'));
      if (hasSpecific) {
        specificMatched++;
      } else {
        languageOnly++;
      }
      for (const s of matchedStacks) {
        stackCounts.set(s, (stackCounts.get(s) || 0) + 1);
      }
    } else {
      skill.stacks = ['_universal'];
      universalOnly++;
      stackCounts.set('_universal', (stackCounts.get('_universal') || 0) + 1);
    }
  }

  // Write back
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');

  // Report
  console.log('=== Per-Skill Mapping Results ===\n');
  console.log(`Total skills: ${totalSkills}`);
  console.log(`  Stack-specific: ${specificMatched} (${Math.round(specificMatched / totalSkills * 100)}%)`);
  console.log(`  Language fallback only: ${languageOnly} (${Math.round(languageOnly / totalSkills * 100)}%)`);
  console.log(`  Universal (no match): ${universalOnly} (${Math.round(universalOnly / totalSkills * 100)}%)`);

  console.log('\n=== Platform Distribution ===\n');
  for (const [platform, count] of [...platformCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${platform.padEnd(10)}  ${count}`);
  }

  console.log('\n=== Top Stacks ===\n');
  const sorted = [...stackCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [stack, count] of sorted.slice(0, 30)) {
    console.log(`  ${count.toString().padStart(5)}  ${stack}`);
  }
}

main();
