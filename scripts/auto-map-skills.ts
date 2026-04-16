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

const SKILL_MATCHERS: Array<[string, RegExp[]]> = [
  // ── Web Frameworks (specific to their framework only) ──
  ['nextjs', [
    /\bnext\.?js\b/i,
    /\bapp[\s-]?router\b/i,
    /\bpages[\s-]?router\b/i,
    /\brsc\b/i,
    /\bserver[\s-]?component/i,
    /\bnext[\s-]config/i,
    /\bnextjs/i,
    /\bnext\s+(?:cache|upgrade|deploy|best)/i,
  ]],
  ['nuxt', [/\bnuxt/i, /\bnitro\b/i]],
  ['sveltekit', [/\bsveltekit\b/i, /\bsvelte\s*kit\b/i]],
  ['remix', [/\bremix\s+(?:run|framework|route)/i]],
  ['gatsby', [/\bgatsby\b/i]],
  ['astro', [/\bastro\s+(?:component|island|framework|build)/i]],

  // ── Mobile Frameworks (Expo is NOT React Native — separate stacks) ──
  ['expo', [
    /\bexpo\s+(?:sdk|cli|router|modules?|config|tailwind|deploy|api|dev)/i,
    /\beas\s+(?:build|submit|update|workflow)/i,
    /\bexpo[\s-]?(?:router|module|cicd)/i,
    /\bbuilding\s+native\s+(?:ui|expo)/i,
    /\bnative\s+data\s+fetching.*expo/i,
    /\bupgrading\s+expo/i,
  ]],
  ['react-native', [
    /\breact[\s-]?native\s+(?:cli|best|perform|pattern|skill|module|animation)/i,
    /\brn[\s-]?(?:cli|best|pattern)/i,
    /\bflatlist\b/i,
    /\bmetro\s+(?:config|bundler)/i,
    /\bnative\s+(?:module|view|ui)(?!\s+expo)/i,
    // Only match "react-native" without expo context
  ]],

  // ── Client Frameworks (generic, cross-platform) ──
  ['react', [
    /\breact\s+(?:hooks?|context|fiber|three|query|server|compose|tanstack|forms?|router(?![\s-]dom))/i,
    /\buse[A-Z][a-z]\w+\(/,  // useHook(
    /\bjsx\b/i,
    /\bclass\s+component/i,
    // Deliberately narrow — "react" alone is too common
  ]],
  ['vue', [/\bvue\s+(?:component|composition|reactive|template|directive)/i, /\bvuex\b/i, /\bpinia\b/i, /\bcomposition[\s-]?api\b/i]],
  ['angular', [/\bangular\s+(?:component|module|signal|service|route|form)/i, /\brxjs\b/i, /\bng[\s-]?module/i, /\bsignals?\b.*angular/i]],
  ['svelte', [/\bsvelte\s+(?:store|component|action|transition|store|slot)/i]],

  // ── Desktop ──
  ['electron', [/\belectron\s+(?:app|ipc|main|render)/i]],
  ['tauri', [/\btauri\s+(?:app|command|plugin|config)/i]],

  // ── Mobile Native ──
  ['flutter', [
    /\bflutter\s+(?:widget|architecture|anim|pattern|state|test|best)/i,
    /\bwidget\s+(?:tree|build|stateless|stateful)/i,
    /\briverpod\b/i,
    /\bbloc\s+pattern\b/i,
    /\bpubspec\b/i,
  ]],

  // ── Backend ──
  ['express', [/\bexpress\.?js\s+(?:app|middleware|route|best)/i]],
  ['fastify', [/\bfastify\s+(?:plugin|hook|schema|best)/i]],
  ['nestjs', [/\bnestjs\b/i, /\bnest\.?js\s+(?:module|controller|service|guard|pipe)/i]],
  ['hono', [/\bhono\s+(?:app|middleware|route)/i]],
  ['django', [/\bdjango\s+(?:rest|model|view|template|orm|migration)/i, /\bdrf\b/i, /\bdjango[\s-]?rest\b/i]],
  ['fastapi', [/\bfastapi\s+(?:route|depend|schema|best)/i]],
  ['flask', [/\bflask\s+(?:app|route|blueprint|best)/i]],
  ['laravel', [/\blaravel\s+(?:eloquent|blade|livewire|model|controller|best)/i, /\beloquent\s+(?:orm|model|relation)/i, /\bblade\s+template/i, /\blivewire\b/i]],
  ['rails', [/\brails\s+(?:activerecord|model|controller|view|migration|best)/i, /\bruby[\s-]?on[\s-]?rails\b/i, /\bactiverecord\b/i]],
  ['spring-boot', [/\bspring[\s-]?boot\s+(?:starter|app|config|security|best)/i, /\bspring[\s-]?framework\s+(?:bean|context|aop)/i, /\bjava[\s-]?spring\b/i]],

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

const LANGUAGE_FALLBACK_MATCHERS: Array<[string, RegExp[]]> = [
  ['_typescript', [/\btypescript\s+(?:pattern|best|advanced|strict|expert|type[\s-]?safe)/i, /\btsconfig\b/i, /\btype[\s-]?safe\s+(?:api|orm|sdk)/i]],
  ['_golang', [/\bgolang\s+(?:pattern|best|concurrency|error)/i, /\bgo\s+(?:concurrent|channel|goroutine|module|error[\s-]?handl)/i]],
  ['_rust', [/\brust\s+(?:pattern|best|ownership|lifetime|crate)/i, /\bcargo\s+(?:workspace|manifest)/i]],
  ['_python', [/\bpython\s+(?:pattern|best|modern|async)/i, /\bpytest\s+(?:fixture|mock)/i, /\bpep[\s-]?8\b/i]],
  ['_java', [/\bjava\s+(?:pattern|best|concurrent|stream)/i, /\bkotlin\s+(?:pattern|best|coroutine)/i]],
  ['_csharp', [/\bc#\s+(?:pattern|best|async)/i, /\b\.net\s+(?:core|framework|pattern)/i]],
  ['_php', [/\bphp\s+(?:pattern|best|modern)/i, /\bphpstan\b/i, /\bpsr[\s-]?\d+/i]],
  ['_ruby', [/\bruby\s+(?:pattern|best|block|meta)/i, /\brubocop\b/i, /\brspec\s+(?:test|matcher)/i]],
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
