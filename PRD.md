# SkillForge — Product Requirements Document

**Version:** 3.0
**Date:** 2026-04-14
**Author:** Yasin Coşkun
**Status:** Phase 1-2 complete, Phase 3+ in progress

---

## Executive summary

SkillForge is an open-source, profile-driven skill ecosystem for AI coding agents (Claude Code, Codex, Cursor, Gemini CLI). It automatically detects any project's language, framework, and characteristics, then recommends and loads the right set of skills — security, performance, testing, accessibility, observability, plus language and framework conventions — without any manual configuration.

**Core value proposition:** Install once, open any project — the right skills auto-load for your stack. No company lock-in, no language bias, no forced skills.

**One-line pitch:** "Zero-config skill ecosystem that adapts to your project, not the other way around."

---

## Problem statement

### Current state of AI coding agent skills

1. **Language bias:** Existing skill collections are overwhelmingly JavaScript/TypeScript focused. A WordPress (PHP), Django (Python), or Go CLI project gets generic or no coverage.

2. **All-or-nothing loading:** Skills are either always loaded (wasting context tokens) or manually toggled (requiring user expertise to know what they need).

3. **No project awareness:** Skills don't adapt to the project they're in. A backend API gets accessibility rules it doesn't need. A CLI tool gets web performance rules that don't apply.

4. **Security blind spot:** The skill ecosystem has documented supply chain attacks (Snyk ToxicSkills found 13.4% of ClawHub skills contain critical issues, 36% have security flaws). No standard audit pipeline exists.

5. **Company-specific lock-in:** Many "skill sets" are built around specific company stacks and aren't reusable by the broader community.

### What SkillForge solves

- **Universal language coverage:** PHP, Python, Go, Rust, Java, Ruby, C#, Dart, JS/TS — detected automatically
- **Profile-driven skill loading:** Project characteristics (has_ui, has_api, has_db, etc.) determine which skills are relevant — not hardcoded layers
- **Smart defaults with full user control:** Recommended skills come pre-checked, but nothing is forced
- **Built-in security:** Audit gate before installing third-party skills
- **Truly global:** Every skill works for any project in its category, no company-specific assumptions

---

## Architecture

### Design principles

1. **Profile-first:** Every decision flows from the project profile. No hardcoded "core" set.
2. **Progressive disclosure:** Skill metadata (~100 tokens) always visible; full content loads only on invocation.
3. **Language-agnostic patterns:** Security rules apply to all languages; language-specific details live in `references/` subdirectories.
4. **User sovereignty:** Nothing is forced. User can disable any skill, add any skill, override any recommendation.
5. **Cross-platform:** Same SKILL.md format works on Claude Code, Codex, Cursor, Gemini CLI, Windsurf, and others.

### System flow

```
Project directory opened
        │
        ▼
┌─────────────────────────────┐
│  Universal Detector          │  SessionStart hook
│  (detect.sh)                 │  Runs in < 3 seconds
│  Scans: files, configs,     │
│  package manifests, dirs     │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Project Profile (JSON)      │  .claude/project-profile.json
│  language, framework,        │
│  characteristics (18 flags), │
│  critical_files, audit_cmds  │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Relevance Engine            │  scripts/score.py
│  (score.py)                  │  Tag matching + boost/penalize
│  index.json × profile        │  scoring algorithm
│  → recommended/optional/     │
│    not-relevant per skill    │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  /skillforge UI              │  First run: setup wizard
│  Interactive selection       │  Subsequent: silent load
│  Grouped: rec/opt/skip       │  /skillforge to reopen
│  User toggles, installs      │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Installed Skill Set         │  .claude/skill-selections.json
│  Per-project, persisted      │  Survives sessions
│  Only installed skills       │
│  consume context tokens      │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Runtime Hooks               │  Deterministic guards
│  protect-infra-files.py      │  Profile-driven file list
│  protect-dangerous-cmds.py   │  Universal command blocklist
│  auto-format (per-language)  │  php-cs-fixer/black/gofmt/prettier
└─────────────────────────────┘
```

### Project profile structure

The detector outputs this JSON to `.claude/project-profile.json`:

```json
{
  "version": 3,
  "generated": "2026-04-14T10:00:00Z",
  "detector": "skillforge-v3",

  "language": "php",
  "language_version": "8.3",
  "has_typescript": false,
  "framework": "wordpress",
  "sub_framework": "woocommerce",
  "project_type": "cms-web",
  "package_manager": "composer",
  "database": "mysql",

  "characteristics": {
    "has_ui": true,
    "has_web": true,
    "has_mobile_ui": false,
    "has_api": false,
    "has_db": true,
    "handles_auth": false,
    "has_user_input": true,
    "serves_traffic": true,
    "is_library": false,
    "has_ci": true,
    "has_docker": true,
    "has_i18n": false,
    "has_ecommerce": true,
    "has_cms": true,
    "cli_only": false,
    "data_pipeline": false,
    "headless": false,
    "serves_public": true
  },

  "infrastructure": {
    "cdn": "cloudflare",
    "ci_tool": "github-actions",
    "docker": true
  },

  "git": {
    "branch": "main",
    "uncommitted": 3,
    "last_commit": "abc123 fix: payment gateway timeout"
  },

  "critical_files": [
    ".env", ".env.local", ".env.production",
    "composer.json", "composer.lock",
    "wp-config.php", ".htaccess", "functions.php",
    "Dockerfile", "docker-compose.yml",
    ".github/workflows"
  ],

  "audit_commands": {
    "deps": "composer audit --format=json",
    "lint": "phpcs --standard=WordPress",
    "test": "phpunit",
    "format": "phpcbf"
  }
}
```

### Characteristics — the 18 detection flags

| Flag | Meaning | Detected by |
|------|---------|-------------|
| `has_ui` | Project has a visual user interface | Framework type, template dirs |
| `has_web` | Serves web pages | HTML templates, public dir, web framework |
| `has_mobile_ui` | Mobile app with UI | React Native, Flutter, Android, MAUI |
| `has_api` | Exposes REST/GraphQL API | app/api dir, openapi.yaml, API framework |
| `has_db` | Uses a database | ORM presence, database driver packages |
| `handles_auth` | Authentication logic present | Auth packages, auth directories |
| `has_user_input` | Processes user input | Web forms, CLI args, API endpoints |
| `serves_traffic` | Handles production traffic | Web or API project type |
| `is_library` | Published as a reusable package | setup.py, package.json with main field |
| `has_ci` | CI/CD pipeline configured | .github/workflows, .gitlab-ci.yml, etc. |
| `has_docker` | Containerized deployment | Dockerfile, docker-compose.yml |
| `has_i18n` | Internationalization support | i18n packages, locales directory |
| `has_ecommerce` | Payment processing | Stripe, WooCommerce, Shopify packages |
| `has_cms` | Content management system | WordPress, Drupal, headless CMS packages |
| `cli_only` | Command-line tool only | CLI framework detected, no UI |
| `data_pipeline` | Data science / ML project | Jupyter, torch, tensorflow, ML frameworks |
| `headless` | No visual interface | Pure API, worker, job processor |
| `serves_public` | Public-facing application | Web frontend, CMS, public API |

### Relevance scoring algorithm

Each skill in the catalog has: `tags`, `boost_when`, `penalize_when`, `default_for`, and optionally `match_language`, `match_framework`, `match_sub_framework`.

```
score = base(0)

# Language/framework skills: binary match
if match_language defined:
    return 100 if language matches, else -100
if match_framework defined:
    return 100 if framework matches, else -100

# Universal skills: weighted scoring
+ (each tag that matches a true characteristic) × 2
+ ("any" tag present) × 5
+ (each boost_when that matches a true characteristic) × 3
- (each penalize_when that matches a true characteristic) × 5
+ (project_type in default_for list) × 10

# Classification
score >= 10 → "recommended" (default checked in UI)
score 1-9   → "optional" (visible, unchecked)
score <= 0  → "not_relevant" (hidden, expandable)
```

### Verified test results (Phase 1-2)

| Project | Detected | Recommended | Optional | Skipped |
|---------|----------|-------------|----------|---------|
| WordPress + WooCommerce | php, wordpress, woocommerce, cms-web | 12 skills | 1 (i18n) | 11 |
| Go CLI tool (Cobra) | go, cobra-cli, cli-tool | 5 skills | 0 | 19 |
| Next.js + i18n + Prisma | typescript, nextjs, app-router, web-frontend | 10 skills | 1 (i18n) | 13 |

---

## Federated skill index

SkillForge ships with **zero self-authored skills**. The tool is infrastructure
— detector, scorer, installer, runtime guards. Skill content lives in external
sources: `marketplace.json` files in GitHub repositories and curated
awesome-list READMEs. SkillForge fetches them, scores the result against the
project profile, and installs only what the user accepts.

### Sources

`config/sources.json` ships a built-in whitelist. Users can override it by
creating `~/.claude/skillforge/sources.json`, which **fully replaces** the
defaults (no merging — the ambiguity of list-merging semantics is avoided by
design). Each source entry:

```json
{
  "type": "marketplace" | "awesome-list",
  "name": "...",
  "url": "https://...",
  "require_audit": false
}
```

Two adapter types ship today:

- **marketplace** — parses Claude Code-style `marketplace.json` files with the
  `plugins[].skills[]` shape. One HTTP GET per source.
- **awesome-list** — extracts GitHub repo links from a curated README, caps
  probes at 20 per invocation, and looks for `marketplace.json` at the
  conventional location in each repo's `main` branch. Repos without one are
  skipped silently.

Adding a new source type = one new file under `scripts/source_adapters/` and
one line in the adapter registry in `scripts/refresh_index.py`. No other
changes.

### Federated index (`~/.claude/skillforge/index.json`)

```json
{
  "version": 1,
  "fetched_at": "2026-04-15T14:00:00Z",
  "ttl_seconds": 604800,
  "partial": false,
  "sources": [ ... ],
  "conflicts": [ ... ],
  "skills": [
    {
      "id": "security-guardian",
      "name": "Security Guardian",
      "description": "...",
      "tags": [...], "boost_when": [...], "penalize_when": [...],
      "default_for": [...],
      "match_language": null, "match_framework": null, "match_sub_framework": null,
      "source": {
        "name": "...",
        "install_url": "https://...",
        "commit_sha": "...",
        "version": "1.0.0"
      },
      "audit": { "status": "unaudited", "tool": null, "scanned_at": null }
    }
  ]
}
```

When the same skill id appears in multiple sources, the **first source in the
sources list wins**. The conflict is recorded in the top-level `conflicts[]`
array so users can diagnose unexpected version skew without losing information.

### Refresh cadence

- TTL default: 7 days.
- `/skillforge` uses stale-while-revalidate: a cached index serves reads while
  a background refresh runs if the cache is stale.
- `/skillforge refresh` forces a sync refresh regardless of TTL.
- Unreachable sources mark the index `partial: true`; the command surfaces a
  warning banner to the user.
- Offline mode: if every source is unreachable and a cache exists, the cache
  is served. If no cache exists, the command tells the user to connect and
  retry.

### Audit gate (stub → Phase 7)

Every install passes through `scripts/audit_skill.py`, which currently returns
`{"status": "unavailable"}`. When a source has `require_audit: true`, an
unavailable or failed audit aborts the install. Phase 7 drops in real
integrations (Snyk Agent Scan, Repello SkillCheck) here without touching the
install pipeline.

### Migration note

Earlier revisions of this document listed 27 self-authored skills (7 universal
+ 7 language + 10 framework + 3 infrastructure) with per-language reference
files under `has_lang_refs: true`. That static catalog was a temporary
scaffold and has been removed in favor of the federated model above. If
maintainers want to publish a first-party skill set, they do it the same way
anyone else would: a separate `skillforge-skills` repository with its own
`marketplace.json`, listed as one entry in `sources.json`. Nothing in
SkillForge's own code depends on it, and users who do not want maintainer-
published content simply drop it from their `sources.json`.

---

## User experience

### First run flow

```
User opens Claude Code in a project directory
        │
        ▼
SessionStart hook runs detect.sh (< 3 seconds)
        │
        ▼
No .claude/skill-selections.json found → first run
        │
        ▼
Claude displays: "SkillForge: NEW PROJECT: typescript / nextjs (app-router)
                  | Type: web-frontend. Run /skillforge to select skills."
        │
        ▼
User types: /skillforge
        │
        ▼
Interactive UI opens (browser-based HTML or terminal output)
Shows 3 groups:
  ✅ RECOMMENDED (10) — all checked by default
  ⚡ OPTIONAL (1) — unchecked
  💤 NOT RELEVANT (13) — hidden, expandable

User unchecks skills they don't want
        │
        ▼
User clicks "Install X skills" or "Skip for now"
        │
        ▼
.claude/skill-selections.json saved
Selected skills installed to .claude/skills/
```

### Subsequent sessions

```
SessionStart hook detects existing skill-selections.json
        │
        ▼
Claude displays: "SkillForge: 10 skills active (typescript / nextjs).
                  Run /skillforge to manage."
        │
        ▼
Skills loaded silently. No interruption.
```

### /skillforge command

Available at any time during a session:

| Command | Action |
|---------|--------|
| `/skillforge` | Show current status: installed skills, project profile summary |
| `/skillforge setup` | Reopen the setup wizard with fresh detection |
| `/skillforge add <name>` | Install a single skill |
| `/skillforge remove <name>` | Remove a single skill |
| `/skillforge profile` | Show full project profile JSON |
| `/skillforge audit` | Run security scan on all installed skills |
| `/skillforge update` | Pull latest skill versions |

### UI design requirements

The selection UI (browser-based HTML file):

1. **Project profile card** at top — detected language, framework, package manager, database
2. **Three grouped sections:**
   - Recommended: each row has colored left border matching category, checkbox checked, skill name + description
   - Optional: same format, checkbox unchecked
   - Not relevant: collapsed by default, expandable, all unchecked
3. **Each row has alternating background tint** based on its category color (but text must remain readable)
4. **No skill is locked** — user can uncheck recommended skills or check not-relevant ones
5. **Footer:** selected count / total, "Install N skills" button, "Skip for now" button
6. **Persistent note:** "Run /skillforge anytime to change. Selections persist across sessions."
7. **Manager view:** When reopened after setup, shows installed skills with uninstall buttons + available skills

Interactive prototype created: see `skillforge-manager.jsx` artifact from this conversation.

---

## Runtime hooks

### Hook 1: detect.sh (SessionStart)

- **Trigger:** Every session start
- **Duration:** < 3 seconds
- **Output:** Writes `.claude/project-profile.json` + injects summary into Claude context
- **Idempotent:** Safe to run multiple times, always overwrites profile

### Hook 2: protect-infra-files.py (PreToolUse: Edit|Write)

- **Trigger:** Before every file edit/write operation
- **Source:** Reads `critical_files` from project profile
- **Action:** Exit code 2 (block) with explanation if file is protected
- **Fallback:** If no profile exists, uses a default list of common critical files
- **User can override:** Claude explains what it wants to change and asks for permission

### Hook 3: protect-dangerous-commands.py (PreToolUse: Bash)

- **Trigger:** Before every bash command execution
- **Patterns blocked:**
  - `rm -rf /`, `rm -rf ~`, `rm -rf *`
  - `git push --force` (without `--force-with-lease`)
  - `git reset --hard origin`
  - `DROP DATABASE`, `DELETE FROM ... (no WHERE)`
  - `chmod -R 777`
  - Secret exposure via curl/echo piping
- **Universal:** Same patterns regardless of language/framework

### Hook 4: auto-format (PostToolUse: Edit|Write)

- **Trigger:** After every file edit/write
- **Language-aware:** Reads profile language, runs appropriate formatter
- **Formatters:**
  - PHP → `php-cs-fixer fix`
  - Python → `black`
  - Go → `gofmt -w`
  - Rust → `rustfmt`
  - Ruby → `rubocop -a`
  - JS/TS → `prettier --write`
- **Graceful fallback:** If formatter not installed, silently skip

---

## Security

### Threat model

Based on Snyk ToxicSkills research (Feb 2026):
- 13.4% of ClawHub skills contain critical security issues
- 36% have at least one security flaw
- 91% of confirmed malicious skills use prompt injection
- Primary attack vectors: environment variable exfiltration, hidden subprocess calls, adversarial SKILL.md instructions

### SkillForge security posture

1. **Self-authored skills:** All skills in the SkillForge catalog are written by the maintainers, not imported from third-party sources
2. **Pre-install audit gate:** Optional integration with Snyk Agent Scan and Repello SkillCheck
3. **Runtime protection:** Hooks block dangerous commands and protect critical files regardless of skill instructions
4. **No external network calls from skills:** Skills never fetch remote resources at runtime (no curl in SKILL.md)
5. **Audit command:** `/skillforge audit` runs security scan on all installed skills

### Audit tools integration

| Tool | Type | Usage |
|------|------|-------|
| Snyk Agent Scan | CLI | `uvx snyk-agent-scan@latest --skills ~/.claude/skills` |
| Repello SkillCheck | Browser | Upload skill zip at skills.repello.ai |
| Cisco skill-scanner | CLI (Python) | For CI/CD pipeline integration |
| Manual checklist | Process | Read SKILL.md + scripts before installing |

### Review checklist for new skills

Before adding any skill to the catalog:
- [ ] Read all files in skill directory (SKILL.md, scripts/, references/)
- [ ] No external URL fetches or network calls in scripts
- [ ] No environment variable reads that could leak secrets
- [ ] No instructions that tell Claude to ignore safety rules
- [ ] No hidden commands in DCI (`!`command``) blocks
- [ ] Script behavior matches stated purpose
- [ ] Test in sandbox environment before production

---

## Distribution

### Primary: Claude Code Plugin Marketplace

Repository structure:

```
skillforge/                          # The TOOL repository (this repo)
├── .claude-plugin/
│   └── plugin.json                  # Claude Code plugin manifest (Phase 8)
├── marketplace.json                 # Points at this repo as a plugin source
├── commands/
│   └── skillforge.md                # /skillforge slash command
├── hooks/
│   ├── detect.sh                    # Project detector (SessionStart)
│   ├── protect-infra-files.py       # PreToolUse file guard
│   ├── protect-dangerous-commands.py # PreToolUse Bash guard
│   └── auto-format.sh               # PostToolUse formatter
├── scripts/
│   ├── refresh_index.py             # Federated index builder
│   ├── score.py                     # Relevance scoring
│   ├── install_skill.py             # Fetch + audit + install
│   ├── audit_skill.py               # Audit gate (stub in this iteration)
│   └── source_adapters/
│       ├── base.py
│       ├── marketplace.py
│       └── awesome_list.py
├── config/
│   ├── sources.json                 # Built-in source whitelist
│   └── settings.json                # Claude Code hook template
├── tests/
│   ├── fixtures/
│   └── test_*.py                    # unittest-based, stdlib only
├── docs/
│   └── superpowers/
│       ├── specs/                   # Design documents
│       └── plans/                   # Implementation plans
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── CHANGELOG.md
└── LICENSE                          # MIT
```

**Skills do NOT live in this tree.** They are fetched at runtime from external
marketplace.json / awesome-list sources and installed under `~/.claude/skills/`.
If maintainers want to publish a curated set, they do it in a separate
`skillforge-skills` repository listed as one entry in `sources.json`.

Installation:

```bash
# One-time marketplace add
/plugin marketplace add yajinn/skillforge

# Install what you need
/plugin install core-layers@skillforge
/plugin install lang-php@skillforge
/plugin install fw-wordpress@skillforge
```

Or one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/yajinn/skillforge/main/scripts/install.sh | bash
```

### Secondary: Multi-platform support

The Agent Skills open standard (SKILL.md format) works across:
- Claude Code (`~/.claude/skills/`)
- OpenAI Codex CLI (`~/.codex/skills/`)
- Cursor (agent skills)
- Gemini CLI
- Windsurf
- OpenClaw / Hermes

`scripts/convert.sh` handles format differences between platforms.

### Tertiary: Community directories

Submit to:
- skillsmp.com — Agent Skills marketplace
- claudemarketplaces.com — Claude Code marketplace directory
- awesome-claude-skills (travisvn/awesome-claude-skills) — curated GitHub list
- awesome-claude-plugins (quemsah/awesome-claude-plugins) — plugin metrics

---

## Roadmap

### Phase 1: Universal detector ✅ COMPLETE

**Deliverable:** `hooks/detect.sh`
- Detects 10+ languages: PHP, Python, Go, Rust, Java, Kotlin, Ruby, C#, Dart, JS, TS
- Detects 25+ frameworks: WordPress, WooCommerce, Laravel, Symfony, Drupal, Django, FastAPI, Flask, Rails, Sinatra, Next.js, Nuxt.js, Astro, Remix, SvelteKit, Angular, Vue, React Native, Express, Fastify, NestJS, Electron, Tauri, Spring Boot, Flutter, Gin, Echo, Fiber, Actix, Axum, Cobra, Clap
- Outputs 18 characteristic flags
- Detects package manager, database, CI/CD, CDN, Docker
- Generates critical_files and audit_commands per stack
- Tested: WordPress+WooCommerce, Go CLI, Next.js fullstack

### Phase 2: Skill catalog + relevance engine ✅ COMPLETE

**Deliverables:** federated index (`config/sources.json` + `scripts/refresh_index.py` + `scripts/source_adapters/*`) + `scripts/score.py`
- Relevance engine seeded with 27 skills in an earlier revision; those static
  entries have since been removed in favor of the federated index model
  (see §Federated skill index). The scoring algorithm is unchanged — only
  its input source migrated from a checked-in catalog file to a runtime-
  built index.
- Relevance scoring: tag match, boost, penalize, default-for
- Classification: recommended / optional / not_relevant
- Tested: correct skill sets for 3 different project types

### Phase 3: /skillforge command + selection UI

**Deliverables:**
- `/skillforge` slash command (SKILL.md with user-invocable: true)
- Browser-based HTML setup wizard (generated by bundled script)
- Terminal fallback for non-browser environments
- Grouped display: recommended (checked) / optional (unchecked) / not-relevant (hidden)
- Install/skip/manage actions

**Acceptance criteria:**
- [x] First run shows setup wizard — `/skillforge setup` seeds `pending.json`
      with every recommended skill pre-checked and renders a markdown
      checklist grouped by category
- [x] User can toggle any skill on/off — `/skillforge skip <id>` and
      `/skillforge check <id>` flip individual entries
- [x] "Skip for now" works — `/skillforge clear` drops the pending file
      without installing anything; subsequent `/skillforge` calls just
      show status
- [x] Subsequent sessions don't re-prompt — `selections.json` persists
      installed skills across sessions; detect.sh's SessionStart hook only
      prompts when selections.json is missing entirely
- [x] `/skillforge` reopens manager view — the status verb (default) shows
      detected project + installed skills + recommendation summary
- [x] `/skillforge add <name>` and `/skillforge remove <name>` work — both
      are explicit verbs in the command router
- [ ] Browser-based HTML wizard — deferred indefinitely. The terminal-native
      checkbox flow (pending.json + markdown render) turned out to be
      sufficient for the interactive review use case and doesn't require
      a separate HTTP server process.

### Phase 4: State persistence

**Deliverable:** `.claude/skill-selections.json`
- Per-project selections saved
- Survives across sessions
- Tracks: enabled/disabled, install date, version
- Profile hash to detect when project has changed significantly

**Schema:**
```json
{
  "version": 1,
  "created": "2026-04-14T10:00:00Z",
  "updated": "2026-04-14T10:05:00Z",
  "profile_hash": "a1b2c3d4",
  "selections": {
    "security-guardian": { "enabled": true, "installed_at": "..." },
    "php-conventions": { "enabled": true, "installed_at": "..." },
    "wordpress-conventions": { "enabled": true, "installed_at": "..." },
    "analytics-tracking": { "enabled": false }
  }
}
```

### Phase 5: Write all skills

**Deliverable:** a separate Git repository (`skillforge-skills`), outside the
SkillForge tool, that publishes the maintainer-curated skill set as a standard
`marketplace.json`. SkillForge consumes it like any other source — nothing in
the tool depends on it, and users who do not want maintainer-published content
simply drop it from their `sources.json`.

Historical note: earlier revisions of this phase listed 27 SKILL.md files

Priority order:
1. Universal skills (7) — refactor from v1, add multi-language references/
2. Language skills — PHP, Python, Go (most requested first)
3. Framework skills — WordPress, Next.js, React Native, Laravel, Django
4. Infrastructure skills — CDN, i18n, analytics

**Per skill requirements (when publishing to a `skillforge-skills` repo):**
- SKILL.md with YAML frontmatter (name, description matching the
  `marketplace.json` entry that points at it)
- Dynamic Context Injection (`!`command``) for live project scanning
- Code examples in the skill's target language
- Checklist at the end for quick verification
- Multi-language skills: a `references/` directory with per-language files,
  loaded lazily based on the detected project profile

### Phase 6: Runtime hooks v2

**Deliverables:**
- `protect-infra-files.py` — reads critical_files from profile (not hardcoded)
- `protect-dangerous-commands.py` — universal command blocklist
- Auto-format hook — language-aware (reads profile.language, runs correct formatter)
- `settings.json` template — all hooks configured

### Phase 7: Audit gate

**Deliverables:**
- `scripts/audit.sh` — wraps Snyk Agent Scan + SkillCheck
- Pre-install scan integrated into install.sh
- `/skillforge audit` command
- SECURITY.md with audit policy documentation

### Phase 8: GitHub repo + marketplace

**Deliverables:**
- Public GitHub repository
- `marketplace.json` — Claude Code plugin marketplace format
- `plugin.json` per plugin
- `README.md` — hero banner, one-command install, GIF demo, architecture diagram
- `CONTRIBUTING.md` — how to add skills, languages, frameworks
- `SECURITY.md` — audit policy, vulnerability reporting
- `CHANGELOG.md` — semantic versioning
- `LICENSE` — MIT
- GitHub Actions — PR validation, skill schema linting
- `/plugin validate .` passes Anthropic validator

### Phase 9: Multi-platform support ✅ PARTIAL

**Deliverables:**
- ✅ `scripts/convert.py` + `scripts/converters/{cursor,codex}.py` — converts
  installed skills to Cursor `.mdc` rules and Codex CLI `AGENTS.md` bundles.
  Replaces the originally-planned `convert.sh` (Python gave cleaner per-platform
  isolation) and also supersedes the separate `install.sh --agent <platform>`
  deliverable — `convert.py` is itself the installer, writing directly to the
  target project's expected directories.
- ✅ Platform-specific README sections (§Multi-agent export).
- ✅ Live end-to-end testing on Cursor + Codex CLI (author's own skill
  library — 14 skills, 100% export success, managed-section round-trip
  verified with zero marker drift).
- 🚫 **Gemini CLI deferred.** Gemini's skill format isn't stable enough yet
  to produce a reliable converter without significant reverse-engineering.
  Tracked as future work.

**Semantic split between targets:**
- Cursor is **granular** — one `.mdc` file per skill under `.cursor/rules/`,
  each with a description-triggered activation model.
- Codex CLI is **monolithic** — a single `AGENTS.md` bundled into a managed
  section bracketed by `<!-- skillforge:start -->` / `<!-- skillforge:end -->`
  markers. User content outside the markers is preserved across re-runs.

**Degrade strategy:**
Skills with `scripts/` or `references/` directories can't travel to either
target (both use flat markdown models). The converters emit a warning and
transfer only the SKILL.md body.

### Phase 10: Launch + community

**Activities:**
- Product Hunt launch
- Dev.to article (EN)
- Medium article (TR)
- X/Twitter thread with demo GIF
- r/ClaudeAI, r/ChatGPTCoding posts
- Hacker News Show HN
- "good first issue" labels for community contributions
- Discord/Telegram community group

---

## Knowledge sources

Skills derive their knowledge from 4 layers:

### 1. Static (embedded in SKILL.md)
Curated best practices, code patterns, checklists. Written by maintainers. Updated per release.

### 2. Dynamic Context Injection (DCI)
`!`command`` syntax in SKILL.md runs shell commands at invocation time:
- `npm audit`, `composer audit` for live dependency status
- `git status`, `git branch` for current context
- File existence checks for conditional advice

### 3. Scripts (bundled)
Reusable bash/python helpers in `scripts/` directory:
- `scan-secrets.sh` — language-agnostic secret detection
- `check-deps.sh` — multi-package-manager audit wrapper
- `lighthouse-check.sh` — web performance audit (optional)

### 4. External (MCP servers)
Optional integration with:
- Context7 MCP — latest library documentation
- Snyk MCP — vulnerability database
- Custom MCP servers per organization

---

## Revenue model

The project is MIT-licensed and free. Potential indirect revenue:

| Model | Description |
|-------|-------------|
| Consulting | Custom skill development for enterprises |
| Premium content | Video courses, workshops on building agent skills |
| Sponsorship | README badges, marketplace listing sponsors |
| SaaS (future) | Hosted skill audit service, team management dashboard |

---

## Metrics for success

### Launch (Month 1)
- [ ] GitHub stars > 100
- [ ] Plugin installs > 500
- [ ] 3+ languages with full skill coverage (JS/TS, PHP, Python)
- [ ] 5+ framework skills shipped

### Growth (Month 3)
- [ ] GitHub stars > 500
- [ ] Active contributors > 10
- [ ] Supported languages > 7
- [ ] Community-submitted skills accepted > 5
- [ ] Featured on skillsmp.com or claudemarketplaces.com

### Maturity (Month 6)
- [ ] GitHub stars > 2000
- [ ] All 27 planned skills shipped
- [ ] Multi-platform testing (Claude Code + Codex + Cursor)
- [ ] Enterprise adoption (at least 1 organization using managed deployment)

---

## Technical decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-14 | Removed "core" concept, everything profile-driven | A Go CLI tool doesn't need accessibility. No skill should be forced. |
| 2026-04-14 | Tag-based scoring instead of layer hierarchy | Flat catalog with scoring is more flexible and easier to extend |
| 2026-04-14 | 18 characteristic flags in profile | Covers the decision space for all current skills without over-engineering |
| 2026-04-14 | Browser-based UI for setup wizard | Better UX than terminal, can show grouped/colored checkboxes |
| 2026-04-14 | Per-language references/ in skills | Progressive disclosure: only relevant language file loaded |
| 2026-04-14 | MIT license, no monetization of plugins | Aligns with ecosystem norms, builds trust faster |
| 2026-04-14 | Self-authored skills only in v1 | Avoids supply chain risk. Third-party skills require audit gate (Phase 7) |

---

## Appendix A: Supported detection matrix

### Languages

| Language | Detected by | Version detection |
|----------|-------------|-------------------|
| PHP | composer.json, index.php, wp-config.php, artisan | `php -v` |
| Python | pyproject.toml, requirements.txt, setup.py, Pipfile, manage.py | `python3 --version` |
| Go | go.mod | `go version` |
| Rust | Cargo.toml | `rustc --version` |
| Java | pom.xml, build.gradle, build.gradle.kts | `java --version` |
| Kotlin | .kt files in src/ (with Java markers) | - |
| Ruby | Gemfile, Rakefile, config.ru | `ruby -v` |
| C# | *.csproj, *.sln, global.json | `dotnet --version` |
| Dart | pubspec.yaml | - |
| JavaScript | package.json (no tsconfig) | `node -v` |
| TypeScript | tsconfig.json | `node -v` |

### Frameworks (25+)

PHP: WordPress, Laravel, Symfony, Drupal
Python: Django, FastAPI, Flask, Streamlit, Jupyter, ML Pipeline
JS/TS: Next.js, Nuxt.js, Astro, Remix, SvelteKit, Angular, Vue, Vite, React Native, Electron, Tauri, NestJS, Fastify, Express
Go: Gin, Echo, Fiber, Cobra CLI
Rust: Actix, Axum, Tauri, Clap CLI
Ruby: Rails, Sinatra
Java/Kotlin: Spring Boot, Android Native
Dart: Flutter
C#: ASP.NET, MAUI

### Package managers (15)

npm, yarn, pnpm, bun, Composer, pip, pipenv, poetry, uv, Bundler, Go Modules, Cargo, Maven, Gradle, Pub

---

## Appendix B: File inventory (current)

```
skillforge/
├── hooks/
│   └── detect.sh              # 350 lines, Phase 1 ✅
├── scripts/
│   └── score.py               # 170 lines, Phase 2 ✅
├── config/
│   └── sources.json           # Federated source whitelist, Phase 2 ✅
└── (skills/, plugins/, marketplace.json — Phase 3+)
```

Files from earlier v1-v2 iterations (to be refactored):
- security-guardian/SKILL.md — needs multi-lang references/
- performance-sentinel/SKILL.md — needs multi-lang references/
- git-safety/SKILL.md — mostly universal, minor updates
- dependency-audit/SKILL.md — needs multi-pkg-manager scripts/
- testing-qa/SKILL.md — needs multi-lang references/
- accessibility-a11y/SKILL.md — mostly universal
- observability/SKILL.md — needs multi-lang references/
- nextjs-conventions/SKILL.md — ready, minor updates
- react-native-conventions/SKILL.md — ready, minor updates
- node-api-conventions/SKILL.md — ready, minor updates
- protect-infra-files.py — needs profile-driven refactor
- protect-dangerous-commands.py — ready
- install.sh — needs marketplace format update
- settings.json — needs hook path updates
- skillforge-manager.jsx — UI prototype, needs integration with score.py output
