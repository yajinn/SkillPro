# SkillPro Differentiation Spec

**Status:** Requirements discovery (brainstorm output)
**Date:** 2026-04-16
**Output type:** Requirements only — no implementation, no architecture

---

## Context

SkillPro currently mirrors AutoSkills' feature set with some edges (monorepo support, registry size, platform filtering). To win real developer adoption measured in npm downloads, we need features that:

1. Create shareable "whoa" moments (Twitter-worthy)
2. Are completable in 5-10hr/week slots
3. Target AI-first developers (Cursor/Claude/Windsurf users)
4. Differentiate clearly from AutoSkills

The core thesis: **SkillPro becomes the "smart" skill tool. AutoSkills is curated static mappings. We add intelligence.**

---

## Non-Goals

Per user constraints, explicitly NOT pursuing in this cycle:

- Enterprise features (SSO, audit, private registry)
- Skill authoring/publishing platform
- Community/ratings system with backend
- Paid tier / monetization
- Full rewrite or architecture overhaul
- Marketing-heavy content strategy
- Team/org collaboration features beyond solo dev

---

## Functional Requirements (Priority Order)

### P0 — AI-Powered Intelligence (The core differentiator)

**FR-01: Natural language project query**
As an AI-first dev, I want to run `npx skillpro "I'm building a SaaS with Stripe subscriptions"` and get a curated skill bundle tailored to that intent. Because AutoSkills only detects deps; SkillPro should understand intent.

**Acceptance:**
- Accepts free-form description as argument
- Returns relevant skills even if deps don't fully reflect intent
- Falls back to package.json detection if no query given
- Works offline with heuristics; better with API key (OpenAI/Anthropic)

**FR-02: Per-skill explanation**
Every recommendation must show a 1-line "Why?" reason based on the actual project context, not generic description. Because "vercel-react-best-practices" should say "Because you use React 18 + Next.js 14" not just its description.

**Acceptance:**
- Human-readable reason next to each skill
- References concrete project state (deps, files, patterns)
- Generated locally for speed; LLM-enhanced if available

**FR-03: `--explain <skill>` command**
Deep-dive into any skill: what it does, when it applies, how it's typically used, alternatives. Because AutoSkills is opaque — SkillPro teaches.

**Acceptance:**
- Shows full skill description with formatting
- Lists related skills and alternatives
- Shows popularity and trend data if available
- Works without LLM (uses registry metadata)

### P1 — Code-Aware Suggestions

**FR-04: File pattern scanning**
Beyond package.json, scan src/ tree for code patterns (hook usage, API route structure, test file locations) to refine recommendations. Because two Next.js projects can be very different — API-heavy vs content-heavy.

**Acceptance:**
- Scans top 50 files or configurable depth
- Detects: file extensions, common patterns (hooks, routes, tests, stories)
- Uses patterns to filter/boost skill recommendations
- Runs in under 2 seconds

**FR-05: Skill conflict detection**
Warn when detected deps conflict with recommended skills. Because "tanstack-query skill" shouldn't appear if project uses `react-query` v3 (different API).

**Acceptance:**
- Flags incompatible version combinations
- Suggests migration skills when relevant
- Non-blocking warning (user can override)

### P2 — Multi-Agent Supremacy

**FR-06: Expand agent support beyond AutoSkills**
Export skills to: Cursor, Codex CLI, Claude Code (existing) + Windsurf, GitHub Copilot Instructions, Continue.dev, Zed AI, Gemini CLI. Because AutoSkills supports 3; we should support 7+.

**Acceptance:**
- `--export windsurf` generates `.windsurf/rules/*.md`
- `--export copilot` writes `.github/copilot-instructions.md`
- `--export all` writes to every detected agent
- Each format is verified to match that agent's spec

**FR-07: Auto-detect installed agents**
Detect which AI agents the user has installed (via config files, extensions) and default to exporting for those. Because explicit `--export` is friction.

**Acceptance:**
- Detects: `.cursor/`, `.claude/`, `AGENTS.md`, `.windsurf/`, `.github/copilot-instructions.md`
- Shows detected agents in CLI header
- Auto-writes to all detected without `--export` flag

### P3 — Maintenance Features

**FR-08: Update mode**
`npx skillpro --update` checks installed skills for newer versions and suggests upgrades. Because skills evolve; users forget to update.

**Acceptance:**
- Checks registry for newer versions of installed skills
- Shows diff: what changed in each skill
- Interactive confirmation to upgrade
- Supports `--update <skill-id>` for single-skill upgrade

**FR-09: Doctor mode**
`npx skillpro doctor` health check: stale skills, missing recommended skills, conflicts. Because developers want one command to see "is my setup good?"

**Acceptance:**
- Scans installed skills, compares to current recommendations
- Reports: out-of-date, missing, conflicting, redundant
- Provides action suggestions (`run: npx skillpro --update`)

### P4 — Delight Features (nice to have)

**FR-10: Trending skills**
Show trending skills in CLI: "vercel-react-best-practices +40% this week". Because social proof drives adoption.

**FR-11: Share configuration**
`npx skillpro share` uploads selections to a gist and returns a URL. Team member runs `npx skillpro --from <url>` to sync. Because teams want consistency without a backend.

**FR-12: Try before install**
`npx skillpro try <skill>` previews the skill content without installing. Because curiosity → trial → install is the funnel.

---

## Non-Functional Requirements

**NFR-01: Speed**
- Cold start under 1s, full scan + match under 3s
- No network calls required for base functionality
- LLM features are opt-in (API key configured)

**NFR-02: Trust**
- Each recommendation explains "why"
- Source, install count, star count visible
- No dark patterns (don't push one skill over another based on business reasons)

**NFR-03: Shareability**
- Beautiful CLI output (already have)
- "Whoa" moment in first 10 seconds
- Output should be screenshot-worthy for Twitter

**NFR-04: Low barrier**
- Node >= 20 (we're good; AutoSkills requires 22.6)
- Zero mandatory dependencies
- Works without API key (LLM features optional)

---

## User Stories

**US-01: AI-first dev, first time user**
> "As a Cursor power user, I run `npx skillpro` in my Next.js project and get 15 relevant skills with 1-line explanations for why each was picked. I see a 'whoa' moment when it detects I use tRPC + Prisma and suggests a specific integration skill. I copy the output to Twitter."

**US-02: Team syncing workflow**
> "As a founder, I curate a skill set for my team's standards. I run `npx skillpro share` and share the gist URL in Slack. My 4 teammates run `npx skillpro --from <url>` and all have the same skill setup without manual coordination."

**US-03: Continuous maintenance**
> "As a solo dev, I run `npx skillpro doctor` monthly. It tells me 3 skills have updates, 1 is deprecated, and 2 conflict with my new dependencies. I fix everything in one command."

**US-04: Intent-driven discovery**
> "I'm starting a new project but haven't written code yet. I run `npx skillpro 'building a video transcoding service in Node.js'` and get a tailored skill bundle for that use case, even though my package.json is nearly empty."

---

## Open Questions for User

1. **LLM dependency:** OK to make LLM features require API key (Anthropic/OpenAI)? Or should they be pure-heuristic fallback only?

2. **Telemetry:** Want anonymous usage telemetry to prove "real usage" metric? (e.g., opt-in, reports npm download velocity, popular stacks, error rates)

3. **Scope trim:** Above is ~12 features. At 5-10hr/week, this is 4-6 months. Should we cut to P0+P1 only (first 2 months shippable)?

4. **Branding:** Should we emphasize "AI-powered" in marketing or let the experience speak for itself?

5. **Distribution:** Stay npm-only, or also publish as a Claude Code plugin / Cursor extension for discoverability in those ecosystems?

---

## Prioritized 3-Month Roadmap (P0 + P1 focused)

**Month 1 (~40hr):** P0 features
- FR-01: Natural language query
- FR-02: Per-skill explanation
- FR-03: `--explain <skill>` command

**Month 2 (~40hr):** P1 features
- FR-04: File pattern scanning
- FR-05: Skill conflict detection

**Month 3 (~40hr):** P2 features (high-leverage for AI-first devs)
- FR-06: Expand agent support (Windsurf, Copilot Instructions)
- FR-07: Auto-detect installed agents

**After month 3:** Evaluate npm download growth. If < 1K/week, pivot to P4 delight features. If > 1K/week, build P3 maintenance features.

---

## Success Criteria

After 3 months of P0+P1+P2 shipped:
- **Primary:** Weekly npm downloads > 1,000
- **Secondary:** 50+ GitHub stars, organic traffic to npm page
- **Leading:** Users complete full flow (detect → review → install) > 60% of starts
- **Anti-goal:** Avoid feature creep. Ship less, better.

---

## Next Step

**If this spec is approved:** Use `/sc:design` to architect FR-01 (natural language query) or `/sc:workflow` to create an implementation plan for Month 1.

**If not approved:** Iterate on open questions or reduce scope further.
