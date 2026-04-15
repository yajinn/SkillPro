# Dynamic Skill Discovery — Design

**Status:** approved (self-approved per user delegation, 2026-04-15)
**Supersedes:** static `config/catalog.json` model (v3.0 PRD §236)
**Related:** PRD.md §462, §488-560, §788 (all anticipated this pivot)

## Context

The SkillForge v3 PRD describes a "zero-config skill ecosystem" that adapts
to any project. The v1 implementation followed PRD §462 literally — it shipped
27 self-authored skills in `config/catalog.json` — but the decision log at
§788 already marked that as a temporary scaffold ("Self-authored skills only
in v1 … third-party skills require audit gate in Phase 7"). The project's
real value proposition is discovery and installation of skills from the
wider ecosystem, not a closed set of maintainer-written content.

This document replaces the static catalog model with a federated discovery
pipeline.

## Goals

1. SkillForge ships with **zero self-authored skills**. The tool itself is
   infrastructure (detector, scorer, installer, guards), not content.
2. On first `/skillforge` invocation, the tool fetches a federated index
   from multiple external sources, scores it against the project profile,
   and presents recommendations.
3. Index refresh is lazy with a TTL (default 7 days) and supports
   stale-while-revalidate: cached index serves reads while a refresh runs
   in the background.
4. Supply chain defense is explicit: every install passes through an audit
   gate (pluggable, stubbed in this iteration).
5. The existing profile-driven scoring, runtime hooks, and `/skillforge`
   command shape are preserved — only the catalog source changes.

## Non-goals

- HTML scraping of aggregator sites (skillsmp.com, ClawHub). Rejected in
  favor of structured sources only.
- Plugin signing, TUF, Sigstore. Leave for a later iteration.
- Skill version pinning beyond "the commit_sha referenced in the source".
- Delta updates. Full fetch per refresh; skill counts below ~1000 make
  this trivial.
- Background cron / launchd refresh. Manual + TTL-on-demand is enough.
- Rating, popularity, or social features. Source ordering in
  `sources.json` is the only precedence signal.

## Architecture

```
┌─────────────────────┐
│  sources.json       │  config/sources.json (defaults)
│  (built-in + user)  │  ~/.claude/skillforge/sources.json (override)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  refresh_index.py   │  TTL check + parallel fetch
│                     │
│  source_adapters/   │   marketplace.py   (marketplace.json)
│   ├ marketplace.py  │   awesome_list.py  (curated README.md)
│   └ awesome_list.py │   base.py          (SourceAdapter protocol)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  index.json         │  ~/.claude/skillforge/index.json
│  (federated catalog)│  fetched_at, ttl, sources[], skills[]
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  score.py v2        │  unchanged algorithm,
│  (input path only)  │  now reads index.json
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  /skillforge        │  groups: recommended / optional / skip
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  install_skill.py   │  fetch → audit → write → record
└─────────────────────┘
```

## Components

### 1. `config/sources.json` — built-in whitelist

```json
{
  "version": 1,
  "defaults": [
    {
      "type": "marketplace",
      "name": "Anthropic Skills",
      "url": "https://raw.githubusercontent.com/anthropics/skills/main/marketplace.json",
      "require_audit": false
    },
    {
      "type": "awesome-list",
      "name": "awesome-claude-skills",
      "url": "https://raw.githubusercontent.com/travisvn/awesome-claude-skills/main/README.md",
      "require_audit": false
    },
    {
      "type": "awesome-list",
      "name": "awesome-claude-plugins",
      "url": "https://raw.githubusercontent.com/quemsah/awesome-claude-plugins/main/README.md",
      "require_audit": false
    }
  ]
}
```

Each source entry carries an optional `require_audit: bool` (default `false`).
When `true`, installations from that source abort if the audit gate returns
`unavailable` or `failed`. Setting it to `true` on a source is how a security-
conscious user enforces strict supply-chain hygiene for a specific origin.

If a file exists at `~/.claude/skillforge/sources.json`, it replaces the
built-in defaults entirely (not merged). That file is the single extension
point for users who want private marketplaces, internal corporate sources,
or a completely custom curation. Keeping the override as a full replace
avoids the ambiguity of list-merging semantics.

### 2. Source adapter protocol

```python
# scripts/source_adapters/base.py
from dataclasses import dataclass
from typing import Protocol, Callable

@dataclass
class SkillEntry:
    id: str
    name: str
    description: str
    tags: list[str]
    boost_when: list[str]
    penalize_when: list[str]
    default_for: list[str]
    match_language: str | None
    match_framework: str | None
    match_sub_framework: str | None
    install_url: str        # raw URL of the skill's SKILL.md
    version: str | None
    commit_sha: str | None

class SourceAdapter(Protocol):
    type: str
    def fetch(self, url: str, http_get: Callable[[str], bytes]) -> list[SkillEntry]: ...
```

- `http_get` is injected so tests can supply a fake. Production uses
  `urllib.request.urlopen` wrapped with a 10-second timeout.
- Adapters return an empty list on any parse error and log the error at
  `refresh_index.py` level, not internally. Adapters never raise to the
  orchestrator.
- Adding a new source type = one new file under `source_adapters/` plus
  one line in `refresh_index.py`'s adapter registry. No other file changes.

### 3. `index.json` schema

```json
{
  "version": 1,
  "fetched_at": "2026-04-15T14:00:00Z",
  "ttl_seconds": 604800,
  "partial": false,
  "sources": [
    {
      "name": "Anthropic Skills",
      "type": "marketplace",
      "url": "https://...",
      "fetched_at": "2026-04-15T14:00:00Z",
      "status": "ok",
      "skill_count": 12
    }
  ],
  "skills": [
    {
      "id": "security-guardian",
      "name": "Security Guardian",
      "description": "...",
      "tags": ["has_user_input", "has_api"],
      "boost_when": [],
      "penalize_when": [],
      "default_for": [],
      "match_language": null,
      "match_framework": null,
      "match_sub_framework": null,
      "source": {
        "name": "Anthropic Skills",
        "install_url": "https://raw.githubusercontent.com/.../SKILL.md",
        "commit_sha": "abc123",
        "version": "1.0.0"
      },
      "audit": {
        "status": "unaudited",
        "tool": null,
        "scanned_at": null
      }
    }
  ]
}
```

The `skills[]` entries are a superset of the old catalog.json entry shape:
every field used by score.py (tags, boost_when, penalize_when, default_for,
match_*) is present with identical semantics. This is why `score.py` needs
only a single-line path change.

When the same `id` appears in multiple sources, the **first source wins**
(sources.json ordering = precedence). The conflict is recorded in a
top-level `conflicts[]` array so users can debug unexpected version
mismatches without losing information.

### 4. `scripts/refresh_index.py`

Orchestrator with the following contract:

- CLI: `python3 refresh_index.py [--force] [--verbose]`
- Reads `~/.claude/skillforge/sources.json` if present, else
  `config/sources.json`.
- Iterates sources in order. For each, instantiates the registered adapter
  and calls `adapter.fetch(url, http_get)` inside a
  `concurrent.futures.ThreadPoolExecutor(max_workers=4)`.
- Each source fetch has a hard 10-second timeout (adapter + HTTP combined).
- Adapters that probe sub-URLs (e.g. `awesome_list.py` fetching every GitHub
  link it finds) must cap their internal probes at **20 sub-URLs per
  adapter invocation** and serialize them inside the one worker slot
  assigned to the source. This prevents a single awesome-list with 500
  links from hammering GitHub and blowing the 10-second budget.
- On any per-source failure: log a warning with the source name and reason,
  mark `sources[i].status = "failed"`, continue with others, set
  top-level `partial: true`.
- Dedupes skills by `id` (first-source-wins), records conflicts.
- Writes to `~/.claude/skillforge/index.json.tmp`, then
  atomic `rename` to `index.json`. Interrupted runs never leave the index
  half-written.
- Exit codes: `0` = full or partial success (at least one skill retrieved),
  `1` = every source failed and no usable cache exists.
- `--force` bypasses the TTL check, always refreshes.
- `--verbose` prints per-source progress; otherwise stays silent on success
  and prints only warnings on errors.

### 5. `scripts/score.py` — minimal change

```python
# Before
catalog_path = os.path.join(os.path.dirname(__file__), "..", "config", "catalog.json")

# After
index_path = os.path.expanduser("~/.claude/skillforge/index.json")
if not os.path.exists(index_path):
    print(json.dumps({"error": "No index found. Run /skillforge refresh."}))
    sys.exit(1)
```

The scoring algorithm, the input fields it reads, and the output format
are identical. This preserves all Phase 1-2 verification work.

### 6. `scripts/install_skill.py`

```
install_skill.py <skill-id> [--dry-run]
```

Steps:
1. Load `index.json`. Fail with a clear error if missing.
2. Look up the skill by id. Fail if not found, suggest `/skillforge refresh`.
3. Fetch `source.install_url` via `urllib.request.urlopen` with timeout.
4. Compute SHA256 of the body. If `source.commit_sha` is present and
   mismatches, abort with a tamper warning.
5. Call `audit_skill.py` on the downloaded content (see §7). If audit
   fails and `sources.json` has `require_audit: true`, abort. Otherwise
   warn and continue.
6. Write the content to `~/.claude/skills/<skill-id>/SKILL.md`. If a
   directory for this skill already exists, it is **removed and rewritten
   atomically** — no merge, no prompt. Re-install = clean replace, which
   matches how package managers treat reinstall. If the source is a
   marketplace entry that advertises additional files (`references/`,
   `scripts/`), fetch them as well, each with the same SHA discipline.
7. Update `~/.claude/skillforge/selections.json` with
   `{"enabled": true, "installed_at": <iso>, "source": <source_name>,
    "sha": <sha256>}`.
8. `--dry-run` performs 1-5 but skips 6-7, letting users preview what
   would be installed.

### 7. `scripts/audit_skill.py` — Phase 7 stub

Contract: takes a file path or URL, returns
`{"status": "passed" | "failed" | "unavailable", "tool": str | None,
  "details": str}`. In this iteration it is a stub that always returns
`{"status": "unavailable", "tool": null, "details": "audit gate not implemented"}`.
The install pipeline treats `unavailable` the same as `passed` unless the
source is marked `require_audit: true`.

Stub keeps the interface stable so Phase 7 can drop in a real Snyk Agent
Scan / Repello SkillCheck integration without touching `install_skill.py`.

### 8. `commands/skillforge.md` — rewritten argument set

```
/skillforge              → status: index summary + installed skills
/skillforge setup        → refresh if stale, then interactive select
/skillforge refresh      → force refresh (bypass TTL)
/skillforge sources      → print active source list + last fetch status
/skillforge add <id>     → install_skill.py <id>
/skillforge remove <id>  → remove from selections.json + rm -rf installed dir
                          (no confirmation prompt — explicit user intent)
/skillforge audit        → run audit_skill.py across installed skills
/skillforge profile      → dump project-profile.json
```

Stale-while-revalidate lives in the command body: if `index.json` exists
but `fetched_at + ttl_seconds < now`, the command displays the cached
index immediately and kicks off `refresh_index.py &` in the background
so the next invocation sees fresh data. If no cache exists at all, the
command blocks on a synchronous refresh before displaying results.

### 9. `hooks/` — unchanged

`detect.sh`, `protect-infra-files.py`, `protect-dangerous-commands.py`,
`auto-format.sh`, and `config/settings.json` are untouched. Project
profile generation and runtime guards are independent of the catalog
source.

## Data flow

### First run

```
User: /skillforge
  └─▶ command checks ~/.claude/skillforge/index.json
       └─▶ not found, synchronous refresh
            └─▶ refresh_index.py reads sources.json
                 └─▶ parallel fetch (4 workers, 10s each)
                      └─▶ adapters parse → SkillEntry[]
                 └─▶ dedupe, write index.json atomically
  └─▶ score.py reads index.json + project-profile.json
       └─▶ writes skill-recommendations.json
  └─▶ command renders grouped markdown tables
  └─▶ user runs: /skillforge add security-guardian
       └─▶ install_skill.py fetches, audits, writes ~/.claude/skills/
       └─▶ updates selections.json
```

### Subsequent run (cache warm)

```
User: /skillforge
  └─▶ index.json present, fetched_at within TTL → serve cache
  └─▶ score.py against cached index
  └─▶ render tables
```

### Subsequent run (cache stale)

```
User: /skillforge
  └─▶ index.json present, TTL expired
  └─▶ serve cache immediately, fork refresh_index.py into background
  └─▶ next invocation sees fresh index
```

## Error handling

| Condition | Behavior |
|---|---|
| Source timeout or DNS failure | Warning logged, source status `failed`, continue |
| Source returns 4xx/5xx | Warning logged, skip, continue |
| Malformed marketplace.json | Adapter returns `[]`, warning logged, continue |
| Awesome-list parse fails entirely | Adapter returns `[]`, warning logged, continue |
| All sources fail, cache exists | Serve cache, stderr banner "offline — using cached index from <date>" |
| All sources fail, no cache | stderr "No index available. Run /skillforge refresh when online." exit 1 |
| install_url 404 | Install aborts, selections unchanged, user sees clean error |
| SHA256 mismatch | Install aborts with tamper warning, selections unchanged |
| Audit gate unavailable | Proceed with warning, unless `require_audit: true` in the source |
| Duplicate skill id across sources | First source wins, conflict recorded in `conflicts[]` |
| Concurrent refresh (two /skillforge runs) | File lock `~/.claude/skillforge/index.lock` held for the duration of refresh; second invocation waits up to 15s then falls back to cache |

No error path is silent. Every failure produces either a warning on stderr
or a structured entry in `index.json.sources[].status` so users can diagnose.

## Testing

**Unit tests** (`tests/test_adapters.py`):
- `marketplace.py` on a well-formed fixture
- `marketplace.py` on malformed JSON
- `marketplace.py` on an empty plugins array
- `awesome_list.py` on a fixture with a mix of GitHub links and noise
- `awesome_list.py` on a README with no links
- Injection safety: SkillEntry fields containing quotes, unicode, `"../../"`
  path attempts, HTML in descriptions

**Integration tests** (`tests/test_refresh_integration.py`):
- Spin up `python3 -m http.server` on a free port
- Serve `tests/fixtures/fake-marketplace/marketplace.json` +
  referenced `SKILL.md` files
- Run `refresh_index.py` with a sources.json pointing at the local server
- Assert `index.json` has the expected skills
- Run `score.py` against a synthetic profile, assert recommendations
- Run `install_skill.py --dry-run` on one skill, assert it would write
  the right file

**Edge cases to cover in integration**:
- One source 404, another 200 → `partial: true`
- Duplicate skill id across two sources → `conflicts[]` populated
- SHA mismatch → install aborts
- TTL expiry → stale-while-revalidate behavior
- File lock contention → second caller waits

**Smoke test** (`tests/smoke.sh`): end-to-end against a real Go CLI fixture
like the one in the Phase 1-2 verification, but pointed at a local
fake marketplace. Verifies that the full detect → refresh → score →
install pipeline produces the expected 5 recommended skills for a Go CLI.

## Migration

| File | Action |
|---|---|
| `config/catalog.json` | Delete |
| `config/sources.json` | Create with default whitelist |
| `skills/git-safety/SKILL.md` | Delete (moves to a separate published repo later, out of scope) |
| `skills/` directory | Delete |
| `scripts/refresh_index.py` | Create |
| `scripts/source_adapters/base.py` | Create |
| `scripts/source_adapters/marketplace.py` | Create |
| `scripts/source_adapters/awesome_list.py` | Create |
| `scripts/install_skill.py` | Create |
| `scripts/audit_skill.py` | Create (stub) |
| `scripts/score.py` | One-line edit: catalog path → index path |
| `commands/skillforge.md` | Rewrite with new argument set and TTL logic |
| `hooks/detect.sh` | No change |
| `hooks/protect-infra-files.py` | No change |
| `hooks/protect-dangerous-commands.py` | No change |
| `hooks/auto-format.sh` | No change |
| `config/settings.json` | No change |
| `PRD.md` | Major edit: replace §Skill catalog with §Federated index; remove 27-skill tables; reframe Phase 5 as "publish skillforge-skills repo (separate)" |
| `README.md` | Update to reflect discovery-first model |
| `tests/` | New directory with fixtures and test files |

No data is lost. The scoring metadata currently in `catalog.json` becomes
seed content for a future `skillforge-skills` repository (outside this
scope). That repo would publish a `marketplace.json` which SkillForge
would consume like any other source.

## Open questions

None at spec time. If a question surfaces during implementation, it
becomes an entry in the implementation plan, not a spec revision, unless
it forces an architectural change.
