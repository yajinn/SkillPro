# SkillForge

[![CI](https://github.com/yajinn/SkillForge/actions/workflows/test.yml/badge.svg)](https://github.com/yajinn/SkillForge/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Stars](https://img.shields.io/github/stars/yajinn/SkillForge?style=social)](https://github.com/yajinn/SkillForge/stargazers)

Zero-config federated skill discovery for AI coding agents. Detects your
project's language, framework, and characteristics, then fetches a federated
index of skills from external sources, scores it against the profile, passes
every candidate through an always-on audit gate, and installs only what you
explicitly pick.

> **Install once, open any project — the right skills get discovered, scored,
> audited, and suggested automatically.**
> No company lock-in, no language bias, no skills shipped inside the tool
> itself.

See [PRD.md](./PRD.md) for the full design, and the architecture specs under
[docs/superpowers/specs/](./docs/superpowers/specs/).

## Install

### Primary: Claude Code plugin marketplace

```
/plugin marketplace add yajinn/skillforge
/plugin install skillforge
```

That's it. The `/skillforge` slash command is now available, the runtime
hooks are registered automatically, and the federated index is fetched on
first invocation.

### Alternative: clone and wire manually

```bash
git clone https://github.com/yajinn/skillforge ~/.claude/plugins/skillforge
```

Then either symlink `~/.claude/plugins/skillforge` into your Claude Code
plugins directory, or copy `hooks/hooks.json` keys into your global
`~/.claude/settings.json` (replacing `${CLAUDE_PLUGIN_ROOT}` with the
absolute path to the clone).

## Status

All eight PRD phases complete. See [CHANGELOG.md](./CHANGELOG.md) for the
1.0.0 release notes.

| Phase | Deliverable | Status |
|-------|-------------|--------|
| 1 | Universal project detector (`hooks/detect.sh`) | ✅ Complete |
| 2 | Relevance engine (`scripts/score.py`) + federated index schema | ✅ Complete |
| 3 | `/skillforge` slash command | ✅ Complete |
| 4 | Selection persistence (`~/.claude/skillforge/selections.json`) | ✅ Complete |
| 5 | Federated discovery (`refresh_index.py` + source adapters) | ✅ Complete |
| 6 | Runtime hooks v2 (profile-driven guards + auto-format) | ✅ Complete |
| 7 | Audit gate (heuristic scanner + optional external tools) | ✅ Complete |
| 8 | Plugin manifest, marketplace.json, CI workflow | ✅ Complete |
| 9 | Multi-agent export (Cursor + Codex CLI; Gemini deferred) | ✅ Partial |

Post-1.0 refinements landed on top of the initial commit: detector
Flutter/Dart gap fixes (`pub_has` helper + state-management sub-framework
detection), npm/package.json fallback for the package manager field,
`.claude-plugin/marketplace.json` convention fix (real Claude Code schema
with `plugins[].skills` as path lists or empty → Tree API fallback),
heuristic tag inference from SKILL.md descriptions, community enrichment
layer (`config/enrichment.json`) for hand-curated metadata overlays,
parallel sub-probes in the awesome-list walker, and optional
`GITHUB_TOKEN` auth to raise the API rate limit from 60/hr to 5000/hr.

## How it works

```
project files → detect.sh → project-profile.json
                                     │
config/sources.json → refresh_index.py → index.json
                                     │
                                     ▼
                        score.py (profile × index)
                                     │
                                     ▼
                        /skillforge UI (recommended / optional / skip)
                                     │
                                user picks
                                     │
                                     ▼
                        install_skill.py ──▶ audit_skill.py
                                     │              │
                                     │              audit passed
                                     ▼
                        ~/.claude/skills/<id>/
                                     │
                        ~/.claude/skillforge/selections.json
```

1. **Detect** — on session start, `hooks/detect.sh` writes
   `.claude/project-profile.json` with language, framework, package manager,
   database, and 18 characteristic flags.
2. **Federate** — on first run or after TTL expiry, `scripts/refresh_index.py`
   reads `config/sources.json`, fetches every whitelisted source in parallel,
   dedupes by skill id, and writes `~/.claude/skillforge/index.json`.
3. **Score** — `scripts/score.py` multiplies the profile against the
   federated index using tag matching, boost/penalize rules, and default-for
   project-type matching.
4. **Audit + Install** — on `/skillforge add <id>`, `scripts/install_skill.py`
   fetches the skill, runs it through `scripts/audit_skill.py` (heuristic
   scanner with optional external Tier 2), and writes it to
   `~/.claude/skills/<id>/`.

SkillForge ships with **zero skills of its own**. All content comes from
external sources. Swap in your own source list by creating
`~/.claude/skillforge/sources.json` — it fully replaces the built-in defaults.

## Commands

```
/skillforge              status: detected project, index summary, selections
/skillforge setup        refresh, seed pending.json with recommended pre-checked
/skillforge refresh      force-refresh the index (bypass TTL)
/skillforge sources      list active sources and their last fetch status
/skillforge add <id>     install a single skill (one-off, bypasses pending)
/skillforge skip <id>    uncheck a pending item before confirming
/skillforge check <id>   re-check a previously skipped item
/skillforge confirm      install every checked pending item in one batch
/skillforge clear        drop pending.json without installing
/skillforge remove <id>  uninstall and drop from selections
/skillforge export cursor  convert installed skills to .cursor/rules/*.mdc
/skillforge export codex   bundle installed skills into AGENTS.md (managed block)
/skillforge audit        run the audit gate on every installed skill
/skillforge profile      dump the full .claude/project-profile.json
```

## Security

The built-in audit gate checks every skill before install against heuristic
rules for prompt injection, environment variable exfiltration, hidden
subprocess calls, suspicious imports, symlink escapes, and more. See
[SECURITY.md](./SECURITY.md) for the full rule table, severity policy, and
strict-mode configuration.

Optional Tier 2 adapters wrap `snyk-agent-scan` and `skill-scanner` if they
are on your PATH — no configuration required.

## Multi-agent export

Once you've curated a set of skills with `/skillforge confirm`, you can
re-use them in other AI coding tools without re-picking. SkillForge reads
from a single source of truth (`~/.claude/skills/`) and emits each target
platform's native format.

### Cursor

```bash
cd ~/code/my-project
/skillforge export cursor
```

Writes one `.mdc` file per skill under `<project>/.cursor/rules/`:

```
.cursor/rules/
├── brainstorming.mdc
├── python-pro.mdc
└── writing-plans.mdc
```

Each rule carries a `description:` field from the skill's YAML
frontmatter and `alwaysApply: false` — Cursor activates the rule when
the description matches your request, not on every turn. Re-run the
command after `/skillforge confirm` to refresh the rule set.

### Codex CLI

```bash
cd ~/code/my-project
/skillforge export codex
```

Bundles every installed skill into a single `<project>/AGENTS.md`
inside a managed section bracketed by HTML-comment markers:

```markdown
# My project notes      ← your content
Use 2-space indent.

<!-- skillforge:start -->
# SkillForge skills

## python-pro
_Activate when: Advanced Python patterns for production codebases_
...
<!-- skillforge:end -->

More of your content below the markers is also preserved.
```

Any content you write **outside** the markers survives across
re-exports. Running `export codex` a second time replaces the managed
block in place — no duplication, no marker drift.

### Degrade behavior

Skills with `scripts/` or `references/` subdirectories can't travel to
either target (both platforms use a flat markdown model). SkillForge
emits a warning and transfers only the `SKILL.md` body. The source
stays in `~/.claude/skills/` where it works normally inside Claude Code.

### Why not Gemini?

Gemini CLI's skill format isn't stable enough yet to produce a reliable
converter. Adding Gemini support is tracked as future work.

## Try it without installing

```bash
# Fetch the federated index from the default sources
python3 scripts/refresh_index.py --force --verbose

# See what the scoring engine would recommend for any project
bash hooks/detect.sh /path/to/your/project
python3 scripts/score.py /path/to/your/project

# Audit a specific skill directory
python3 scripts/audit_skill.py /path/to/some/skill

# Install a specific skill by id (uses the fetched index)
python3 scripts/install_skill.py <skill-id>
```

The index lives at `~/.claude/skillforge/index.json`. Installed skills land
in `~/.claude/skills/<id>/`. Edit `~/.claude/skillforge/sources.json` to use
a different source set.

## Repository layout

```
skillforge/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest (required)
├── marketplace.json             # Claude Code marketplace listing
├── PRD.md
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
├── commands/
│   └── skillforge.md            # /skillforge slash command
├── hooks/
│   ├── hooks.json               # Hook event registration
│   ├── detect.sh
│   ├── protect-infra-files.py
│   ├── protect-dangerous-commands.py
│   └── auto-format.sh
├── scripts/
│   ├── refresh_index.py         # Federated index builder
│   ├── score.py                 # Relevance scoring
│   ├── install_skill.py         # Fetch + audit + install
│   ├── audit_skill.py           # Audit gate entry point
│   ├── source_adapters/
│   │   ├── base.py
│   │   ├── marketplace.py
│   │   └── awesome_list.py
│   └── audit_rules/
│       ├── base.py
│       ├── patterns.py
│       ├── heuristic.py
│       ├── external.py
│       └── rules_{markdown,shell,python,js,filesystem}.py
├── config/
│   ├── sources.json             # Built-in source whitelist
│   └── enrichment.json          # Hand-curated metadata overlays
├── tests/                       # 105 unit + integration + e2e tests
│   ├── fixtures/
│   └── test_*.py
├── docs/
│   └── superpowers/
│       ├── specs/
│       └── plans/
├── .github/
│   └── workflows/
│       └── test.yml             # CI: tests + plugin-structure checks
└── v1-reference/                # Legacy v1/v2 artifacts (reference only)
```

## Requirements

- `bash`, `jq` (for `detect.sh` and the JSON builder path)
- `python3` (>= 3.11, stdlib only — no pip dependencies)
- Network access for the first `/skillforge refresh`. Offline afterwards
  unless the index goes stale (default TTL: 7 days).

## Running the tests

```bash
python3 -m unittest discover tests
```

248 tests, stdlib-only. The end-to-end test spins up a local `http.server`
serving a fake marketplace and runs the full detect → refresh → score →
install pipeline without touching the network. Separate suites cover
audit rules (27), enrichment merge semantics (7), and the GitHub Trees
API fallback path (19) with mocked HTTP.

### Optional: raise the GitHub API rate limit

`refresh_index.py` uses the public GitHub Trees API to discover skills in
repositories that ship a `.claude-plugin/marketplace.json` without an
explicit `skills` array (e.g. `obra/superpowers`). Unauthenticated, the
API allows 60 requests per hour — enough for small awesome-lists but not
for full discovery across the ecosystem. Set `GITHUB_TOKEN` in your
environment to raise the limit to 5000/hour:

```bash
export GITHUB_TOKEN=ghp_your_token_here
python3 scripts/refresh_index.py --force --verbose
```

Any personal access token with no scopes is sufficient.

## License

MIT — see [LICENSE](./LICENSE).
