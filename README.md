# SkillPro

[![npm version](https://img.shields.io/npm/v/skillpro.svg)](https://www.npmjs.com/package/skillpro)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/node/v/skillpro)](https://www.npmjs.com/package/skillpro)

> **Zero-config skill discovery for AI coding agents.**
> One command detects your tech stack and suggests the best-matched skills from a 3,900+ skill registry.

```bash
npx skillpro
```

## How It Works

```
┌─ Detect ──────────────┐   ┌─ Match ───────────────┐   ┌─ Install ─────────────┐
│ package.json reader   │ → │ Registry lookup       │ → │ npx skills add <repo> │
│ priority hierarchy    │   │ priority scoring      │   │ + CLAUDE.md updater   │
│ build-noise filtering │   │ dedup + alternatives  │   │ + Cursor/Codex export │
└───────────────────────┘   └───────────────────────┘   └───────────────────────┘
```

No network calls at runtime. The skill registry ships with the package (3,906 skills from skills.sh + Anthropic's official catalog), updated via `npm run build:registry`.

## Quick Start

```bash
# Preview recommendations without installing
npx skillpro --dry-run

# Install all recommended skills (no prompt)
npx skillpro -y

# Show all matches including alternatives
npx skillpro --dry-run --all

# Export to Cursor .mdc rules after install
npx skillpro --export cursor

# Export to Codex AGENTS.md
npx skillpro --export codex
```

## Detection

Reads `package.json` and config files, then resolves your stack via a priority hierarchy:

```
expo (95)      →  overrides react-native, react
react-native   →  overrides react
nextjs (85)    →  overrides react
nuxt (85)      →  overrides vue
sveltekit (85) →  overrides svelte
```

**Build-noise filtering:** A React Native project has `react` and a `Gemfile` (CocoaPods), but its actual stack is React Native. SkillPro knows that and ignores the Ruby dependency.

Supported stacks: 40+ including Next.js, React Native, Expo, Vue, Svelte, Angular, Astro, Remix, Flutter, Django, FastAPI, Laravel, Rails, Spring Boot, NestJS, Supabase, Prisma, Firebase, Vercel, Cloudflare Workers, Stripe, Playwright, Vitest, Tailwind, shadcn/ui, Docker, Terraform.

## Ranking

Skills are sorted by priority:

1. **Curated map** (hand-picked per stack, AutoSkills-inspired) → +1000 boost
2. **Anthropic official** (`anthropics/skills` repo) → +10,000
3. **skills.sh with popularity data** → +1,000 + weekly installs
4. **Other sources** → +100 + GitHub stars

Deduplication groups skills doing the same job (e.g. `react-best-practices` and `vercel-react-best-practices`). The highest-priority one is recommended; the rest become alternatives shown with `--all`.

Every project gets **at most 20 recommendations** — the best ones, not all matches.

## Monorepo Support

SkillPro detects npm/yarn/pnpm workspaces, lerna, and turborepo. Run it at your monorepo root:

```bash
$ npx skillpro
  ✔ javascript / Expo
  Expo, React Native, Next.js, NestJS, Prisma, Stripe, React, Tailwind CSS
  npm · 5 workspaces
    ↳ api     NestJS, Prisma, Stripe
    ↳ mobile  Expo, React Native, React
    ↳ web     Next.js, React, Tailwind CSS
    ↳ @repo/db Prisma
    ↳ @repo/ui React, Tailwind CSS
```

Skills are aggregated from ALL workspaces (union of stacks). Per-workspace breakdown shows which workspace contributes which tech.

Supported monorepo formats:

| System | Detection |
|--------|-----------|
| npm/yarn workspaces | `package.json` → `workspaces` field |
| pnpm | `pnpm-workspace.yaml` |
| Lerna | `lerna.json` → `packages` field |
| Turborepo | `turbo.json` + workspaces field |
| Nx | `package.json` workspaces field |

## Auto-Update System

SkillPro keeps itself fresh via three auto-update layers, all opt-in via config:

```
┌─ Layer 1 ─────────┐  ┌─ Layer 2 ─────────┐  ┌─ Layer 3 ─────────┐
│ CLI self-update   │  │ Registry refresh  │  │ Skill updates     │
│ 24h cache         │  │ 6h cache, ETag    │  │ Every run         │
│ Yellow banner     │  │ Silent            │  │ Notification      │
└───────────────────┘  └───────────────────┘  └───────────────────┘
```

**Layer 1 — CLI self-update:** Checks `registry.npmjs.org/skillpro/latest` daily. Shows banner if newer version exists. Non-blocking.

**Layer 2 — Registry refresh:** Fetches `skills-registry.json` overlay from GitHub raw with ETag. If `304 Not Modified` → use local cache. Network failure → fall back to bundled. New skills added to skills.sh appear without requiring `npm install`.

**Layer 3 — Skill updates:** Compares installed skill SHAs against registry. Flags outdated skills and breaking changes. User runs `npx skillpro --update` to apply.

**Config at `~/.config/skillpro/config.json`:**

```json
{
  "update": {
    "check_cli": true,
    "check_registry": true,
    "check_skills": true,
    "auto_apply_skills": false,
    "skip_breaking_changes": true
  },
  "notify": {
    "breaking_changes": "always"
  },
  "telemetry": false
}
```

**Cache files at `~/.config/skillpro/`:**

| File | Purpose | TTL |
|------|---------|-----|
| `config.json` | User preferences | Manual |
| `version-check.json` | CLI version check | 24h |
| `registry-overlay.json` | Fresh registry data | 6h |
| `registry-cache-meta.json` | ETag + timestamp | — |
| `selections.json` | Installed skills | Manual |

Privacy-first: no telemetry by default. Network calls are minimized via ETag (304 Not Modified in ~5ms). Works fully offline with bundled fallback.

## Example Output

```
  SkillPro v2.6.0
  Zero-config skill discovery for AI agents

  ✔ typescript / Next.js
  Next.js, React, Supabase, shadcn/ui, Tailwind CSS
  pnpm

  ✔ 20 skills (from 2805 matches)
  187 alternatives hidden — use --all to see

  react (11)
    [x] vercel-react-best-practices  321.1K
      React and Next.js performance optimization guide with 64 prioritized rules
    [x] web-design-guidelines  256.7K
      Audit UI code against Vercel's Web Interface Guidelines
    [x] next-best-practices  64.7K
      Comprehensive Next.js development guidelines covering file structure, RSC
    ...

  supabase (1)
    [x] supabase-postgres-best-practices  99.7K
      Postgres performance optimization rules across 8 priority categories
```

## CLI Reference

```
Usage: npx skillpro [options]

Options:
  -y, --yes          Skip confirmation, install all recommended
  --dry-run          Show skills without installing
  --all              Include alternative skills (unchecked)
  --update           Update installed skills to latest versions
  -v, --verbose      Show error details
  -a, --agent <ids>  Target specific agents: cursor, claude-code, codex
  --export <target>  Export after install: cursor, codex
  -h, --help         Show help
  --version          Show version
```

### Example: fresh run with auto-update

```
  SkillPro v2.6.0
  Zero-config skill discovery for AI agents

  ✔ typescript / Next.js
  Next.js, Prisma, React, Playwright, Tailwind CSS
  npm

  ✓ Registry refreshed: 3906 skills

  ↑ Installed skill updates:
    → next-best-practices    14.2.0 → 15.1.0
    ⚠ BREAKING prisma-client-api    5.0.0 → 7.0.0
    Run: npx skillpro --update

  Matching skills...
  ✔ 20 skills (from 2852 matches)
```

## Architecture

| Module | Responsibility |
|--------|----------------|
| `src/detect/stack.ts` | Package manifest reader (JS/Python/Ruby/Go/Rust/Java), monorepo walker, priority hierarchy |
| `src/registry.ts` | Skill matching, priority scoring, dedup, platform filter |
| `src/install/skills-sh.ts` | Delegates to `npx skills add` |
| `src/install/direct-fetch.ts` | Direct SKILL.md fetch for non-skills.sh |
| `src/export/claude.ts` | CLAUDE.md managed section |
| `src/export/cursor.ts` | `.cursor/rules/*.mdc` generator |
| `src/export/codex.ts` | AGENTS.md managed section |
| `src/update/config.ts` | `~/.config/skillpro/config.json` preferences |
| `src/update/cli-check.ts` | npm registry version check (24h cache) |
| `src/update/registry-refresh.ts` | GitHub overlay fetch with ETag (6h cache) |
| `src/update/skill-check.ts` | Installed skill diff against registry |
| `src/config/skills-registry.json` | Pre-built skill catalog (3,906 skills + curated maps + combos) |

Zero runtime dependencies. Node ≥20 only — uses built-in `fetch`, `parseArgs`, and `fs`.

## Rebuilding the Registry

The skill registry is regenerated periodically by fetching all skills from [skills.sh](https://skills.sh) and Anthropic's official marketplace:

```bash
git clone https://github.com/yajinn/skillpro
cd skillpro
npm install
npm run build:registry               # Fetches ~4000 skill pages (takes 3-5 min)
npx tsx scripts/auto-map-repos.ts    # Maps repos to tech stacks
npx tsx scripts/auto-map-skills.ts   # Per-skill stack assignment
npm run build
npm publish
```

## License

MIT © Yasin Coşkun
