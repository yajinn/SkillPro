# Changelog

All notable changes to SkillPro are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [1.0.0] — 2026-04-15

Initial release. All eight PRD phases complete.

### Added

- **Universal project detector** (`hooks/detect.sh`) — identifies
  language, framework, package manager, database, 18 characteristic
  flags, critical files, and audit commands in under 3 seconds. Writes
  `.claude/project-profile.json`.
- **Relevance scoring engine** (`scripts/score.py`) — tag matching,
  boost/penalize rules, default-for project-type matching, and
  recommended/optional/not-relevant classification.
- **Federated skill discovery** — built-in source whitelist in
  `config/sources.json`, parallel fetch orchestrator
  (`scripts/refresh_index.py`), `marketplace.json` and awesome-list
  adapters, deduplication with first-source-wins precedence, atomic
  index writes, TTL-based stale-while-revalidate refresh (default 7
  days).
- **Install pipeline** (`scripts/install_skill.py`) — SHA256 tamper
  check, audit gate integration, staging directory with atomic
  replace, persistent selections at
  `~/.claude/skillpro/selections.json`.
- **Audit gate** (`scripts/audit_skill.py` + `scripts/audit_rules/`) —
  always-on heuristic scanner with Python stdlib rule families for
  markdown, shell, Python (AST-based), JavaScript, and filesystem
  structure. Optional Tier 2 adapters for `snyk-agent-scan` and
  `skill-scanner`. Severity policy: any high/critical → install
  blocked. `require_audit: true` source flag enables strict mode.
- **Runtime hooks v2** — profile-driven file protection
  (`protect-infra-files.py`), universal dangerous command blocklist
  (`protect-dangerous-commands.py`), language-aware auto-format
  (`auto-format.sh`). Wired via `hooks/hooks.json`.
- **`/skillpro` slash command** with subcommands: `status`, `setup`,
  `refresh`, `sources`, `add <id>`, `remove <id>`, `audit`, `profile`.
  Stale-while-revalidate cache behavior built into the command body.
- **SECURITY.md** — threat model, rule tables, severity policy,
  strict-mode guidance, manual review checklist, vulnerability
  reporting.
- **Tests** — 79 unit, integration, and end-to-end tests (stdlib
  `unittest`, zero pip dependencies). End-to-end test runs the full
  detect → refresh → score → install pipeline against a local
  `http.server` fake marketplace.

### Known limitations

- Scanner is a heuristic, not a proof of safety. See SECURITY.md
  §Limitations.
- `skill-scanner` (Cisco) adapter assumes a Snyk-compatible JSON
  shape; upstream schema confirmation pending.
- Awesome-list adapter probes up to 20 sub-URLs per source to avoid
  rate-limiting; large lists get truncated.
- `/skillpro audit --verbose` output format is markdown table only;
  JSON output via the direct CLI (`python3 scripts/audit_skill.py`).
