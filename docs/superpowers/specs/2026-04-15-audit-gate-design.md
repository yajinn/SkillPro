# Audit Gate — Design

**Status:** approved (self-approved per user delegation, 2026-04-15)
**Phase:** 7 (per PRD roadmap §Phase 7)
**Depends on:** federated skill discovery (spec 2026-04-15-dynamic-skill-discovery-design.md). The install pipeline is already wired to call `audit_file(path)`; this phase replaces the stub behind that call.

## Context

The current `scripts/audit_skill.py` is a stub that always returns
`{"status": "unavailable"}`. The install pipeline already routes through
it. What is missing is the actual security logic.

Per PRD §Security (citing Snyk ToxicSkills research, Feb 2026):

- 13.4% of ClawHub skills contain critical security issues
- 36% have at least one security flaw
- 91% of confirmed malicious skills use prompt injection
- Primary attack vectors: environment variable exfiltration, hidden
  subprocess calls, adversarial SKILL.md instructions

The audit gate must catch these vectors before a skill lands in
`~/.claude/skills/`.

## Goals

1. Ship an audit gate that works on every install machine with no
   external dependencies required. Users who install SkillForge must get
   real protection out of the box.
2. Defense in depth when external tools exist. If `snyk-agent-scan` or
   `skill-scanner` is on PATH, use it as an additional tier.
3. Explicit, reviewable rules. Every check is a named rule with a known
   severity and a test case. No ML, no black box.
4. Cover the three PRD-cited attack vectors directly: prompt injection,
   env var exfiltration, hidden subprocess calls.
5. Fail loud under `require_audit: true`, warn under default. Users who
   explicitly opt into strict mode get blocked on any high-or-critical
   finding; default users see findings reported but the install proceeds.
6. Preserve the existing `audit_file(path)` signature. Backward compat
   with `install_skill.py` is non-negotiable. The function returns a
   richer dict, but the `status` / `tool` / `details` keys keep their
   shape.

## Non-goals

- Sandboxing, virtualization, seccomp
- Code signing, PKI, TUF, Sigstore
- Binary decompilation or malware hash databases
- ML or LLM-based anomaly detection
- User-editable rules — rules live in Python source
- A central vuln database service
- Reversing obfuscated payloads

## Architecture

Two tiers merge into a single result:

- Tier 1 is a heuristic scanner in Python stdlib, always run.
- Tier 2 is a probe for external CLI tools, skipped when they are not
  on PATH.

Both tiers produce a list of `Finding` objects. The orchestrator merges
the lists, picks the highest severity, and decides `status`.

```
install_skill.install(...)          /skillforge audit (batch)
         |                                  |
         +----------+-----------------------+
                    v
        +----------------------+
        |  audit_skill.audit() |  scripts/audit_skill.py
        +----------+-----------+
                   |
          +--------+----------+
          v                   v
   +------------+       +--------------+
   |  Tier 1    |       |   Tier 2     |
   | heuristic  |       |  external    |
   |  scanner   |       |  tool probe  |
   | (stdlib)   |       |  (optional)  |
   +-----+------+       +------+-------+
         |                     |
         +----------+----------+
                    v
          +-------------------+
          | merge findings    |
          | max severity wins |
          +---------+---------+
                    v
          +-------------------+
          |   AuditResult     |
          +-------------------+
```

## Data types

Defined in `scripts/audit_rules/base.py`:

- `SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"]`
- `Finding(severity, rule, file, line, details)` — one per detection
- `AuditResult(status, tool, findings, details)` — one per audit call

`AuditResult.to_dict()` returns a dict with the same `status`, `tool`,
and `details` keys the stub produced, plus a new `findings` list.

The `status` field can be `"passed"`, `"failed"`, or `"unavailable"`.
The `tool` field can be `"heuristic"`, `"snyk-agent-scan"`,
`"combined"`, or `"none"`.

## Severity policy

- Any critical or high finding yields `status = "failed"`.
- Only medium, low, or info findings yields `status = "passed"` with
  warnings surfaced in the install output.
- No findings yields `status = "passed"` with empty findings.

The `failed` bar is deliberately low because skills run inside the
user's agent session with privileged access. One critical finding is
one too many.

## Heuristic scanner rules

The scanner walks every file in the skill directory and applies rules
based on file type. Each rule is a pure function that takes a file path
and file content bytes and returns a list of findings, so every rule
can be unit-tested in isolation.

Rule IDs are kebab-case and live in the Python source next to their
implementations. The full canonical list with exact patterns is in
`scripts/audit_rules/heuristic.py` once implemented; this spec
describes the rule families and their intent, not the regex strings.

### Markdown rules

Five rule families on `SKILL.md` and any `*.md` files:

- **Prompt-injection keyword detector** (severity high) matches
  known-bad directive phrases that try to override or extract the
  agent's instructions. The phrase list is a module constant and can
  grow.
- **Invisible-character detector** (medium) flags any zero-width space,
  zero-width non-joiner, zero-width joiner, word joiner, BOM, or
  Unicode tag character range. Skill content has no legitimate reason
  to contain these.
- **Base64 blob detector** (medium) flags any continuous run of at
  least 200 characters from the base64 alphabet. Legitimate
  documentation rarely embeds large encoded blobs in markdown.
- **Hidden HTML comment directive detector** (high) flags HTML
  comments that contain imperative verbs like run, execute, fetch,
  download, delete, ignore, or disable — the ClawHub attack vector of
  smuggling instructions inside comments that a human reader skims
  over.
- **Suspicious URL scheme detector** (high) flags any markdown link or
  raw URL with a `data:`, `javascript:`, `file://`, or `vbscript:`
  scheme.

### Shell script rules

Five rule families on `.sh`, `.bash`, and `.zsh` files:

- **Pipe-to-shell detector** (critical) flags any invocation of a
  network download tool whose output is piped into a shell
  interpreter. This is the most common "own this machine" one-liner
  in the wild.
- **Env var exfiltration detector** (critical) flags any network
  upload command whose data payload references an uppercase shell
  variable. Heuristic for "smuggling a secret out over HTTP".
- **Evaluated-input detector** (high) flags any shell construct that
  evaluates a variable or command substitution through the shell's
  dynamic code mechanism. Rule ID uses the `evalexec` stem to avoid
  embedding literal trigger strings in this spec document.
- **Destructive rm detector** (high) flags literal recursive deletes
  of the filesystem root, the home directory, or the current
  directory wildcard. The runtime `protect-dangerous-commands.py`
  already blocks these when they execute, but catching them
  statically at install time is cheaper.
- **Download-execute detector** (critical) flags a network download
  of a script file that is chained into a shell invocation via `&&`,
  `||`, or `;`.

### Python rules

Python rules use `ast.parse` on each `.py` file so matches are
precise rather than regex-based. The AST walker looks for specific
`Call` nodes.

- **Dynamic code-evaluation detector** (high) flags any direct call to
  any of the three dynamic code-evaluation builtins. AST-based, so
  string literals containing those names do not trip the rule.
- **Unsafe subprocess detector** (medium) flags any subprocess spawn
  with the `shell=True` keyword argument.
- **Secret-to-network detector** (critical) flags any module that
  both reads the process environment and imports or calls any HTTP
  client. Heuristic for "reads secrets and connects out".
- **Suspicious deserializer detector** (medium) flags imports of
  low-level binary deserialization modules (the pickling module, the
  marshal module, or ctypes) when combined with network use. These
  are rare in honest companion scripts.
- **Encoded-payload execution detector** (critical) flags a call to
  a base64 decoder whose result is, anywhere in the same function,
  passed to a dynamic code-evaluation builtin.

Parse errors produce a `medium`-severity `python-syntax-error`
finding, and AST rules are skipped for that file. Text rules still
run.

### JavaScript and TypeScript rules

Regex-based rather than a full parser. Malicious JS patterns are
shallow enough that YAGNI applies.

- **Dynamic JS eval detector** (high) flags any direct call to the JS
  code-evaluation builtin. Rule ID uses `jsdynamic` to avoid embedding
  literal trigger strings.
- **Function-constructor detector** (high) flags dynamic code
  synthesis via the runtime `Function` constructor.
- **Unknown-origin fetch detector** (medium) flags any fetch call with
  an http(s) URL whose host is not on the allowlist.

Allowlist: `{"raw.githubusercontent.com", "github.com", "api.github.com"}`
as a conservative starting set.

### Filesystem rules

- **Symlink-escape detector** (critical) flags any symlink inside the
  skill dir whose resolved target is outside the skill root.
- **Stray-executable detector** (low) flags any file with the +x bit
  that is not under a `scripts/` subdirectory.
- **Setuid detector** (high) flags any file whose mode has the SUID
  bit set.
- **Binary-content detector** (medium) flags any file whose first 512
  bytes contain a null byte or more than 30% non-ASCII characters.
  Skills should not ship binaries.

## External tool adapters

The `audit_rules/external.py` module probes each supported tool with
`shutil.which()`, runs it via `subprocess.run` with a 30-second
timeout, parses the JSON output into `Finding` objects, and wraps them
in an `AuditResult`. Tools return `None` on any failure (not
installed, timed out, tool error, unparseable output) so Tier 1 alone
remains sufficient.

Supported tools:

- **snyk-agent-scan** — invoked with `--format json <skill-dir>`.
  Exit codes 0 and 1 are parsed (0 = clean, 1 = findings). Anything
  else is treated as a tool error.
- **skill-scanner** (Cisco) — same pattern, different CLI flags.
  Added as a stub function that can be filled in when the CLI schema
  is confirmed.

Tier 2 orchestration is a simple loop over tool functions, collecting
non-None results.

## Merger

`merge_results(tier1, tier2_results)` concatenates every tier's
findings, sets `tool = "heuristic"` if only Tier 1 produced results
and `tool = "combined"` otherwise, and calls `_decide_status()` which
scans the merged findings list for any `critical` or `high` entry.

## Public entry point

`scripts/audit_skill.py` exports two functions:

- `audit(skill_dir)` — returns an `AuditResult` object. Accepts
  either a directory or a file. When given a file, scans the parent
  directory. This handles the `install_skill.py` call shape where
  the hook is invoked with a staging `SKILL.md` path.
- `audit_file(path) -> dict` — backward-compat wrapper that calls
  `audit()` and returns `.to_dict()`.

`install_skill.py` keeps calling `audit_file(staging_path)` and
reading the `status` field exactly as before. The new `findings` key
is additive.

## `install_skill.install()` behavior

No signature change. Two behavioral refinements:

1. When `audit_file` returns `passed` with a non-empty findings list,
   the install proceeds and the final install result dict includes an
   `audit_findings` count for reporting.
2. When `audit_file` returns `failed`, the install aborts with
   `AuditBlocked` regardless of `require_audit`. The `unavailable`
   branch stays as defensive code for the future case where the whole
   scanner is disabled by flag.

## `/skillforge audit` command

Invocation: `/skillforge audit [--verbose]`

- Iterate every directory directly under `~/.claude/skills/`.
- Call `audit(dir)` on each one.
- Render a markdown table with columns: Skill, Tool, Status,
  Critical, High, Medium, Top finding.
- Exit 0 if every skill passes, exit 1 if any skill fails.
- With `--verbose`, dump every finding per skill below the table.

## Testing strategy

### Unit tests — one per rule, malicious + clean fixtures

```
tests/fixtures/audit/
  clean/
    SKILL.md                    # well-formed, no findings
    scripts/helper.sh           # innocuous bash
    scripts/helper.py           # innocuous python
  malicious/
    prompt-injection/SKILL.md   # contains an injection phrase
    invisible-chars/SKILL.md    # contains U+200B
    curl-pipe-shell/scripts/pwn.sh
    env-exfil-py/scripts/leak.py
    python-evalexec/scripts/dynamic.py
    setuid/scripts/suid.bin     # mode with S_ISUID set via chmod in test setup
    symlink-escape/evil         # symlink target outside dir
```

Each malicious fixture is exactly one attack. Unit tests assert that
rule X fires on fixture X, and the clean fixture produces zero
findings across all rules (false-positive regression guard).

### Integration tests

- `test_audit_integration.py` — full `audit(dir)` against each
  fixture, assert the correct `status` and finding count.
- `test_install_skill.py` updated — install a skill whose body
  matches the pipe-to-shell rule and assert `AuditBlocked` is raised.

### External tool tests

- `test_audit_external.py` — mock `shutil.which` to return a fake
  path and `subprocess.run` to return canned JSON. Assert that a
  high-severity external finding gets wrapped as a `Finding` with
  `tool="snyk-agent-scan"`.

### Regression

- `test_audit_stub.py` updated to assert real heuristic behavior on
  a clean fixture — status `"passed"`, tool `"heuristic"`.

Target: the full suite has at least 50 tests after Phase 7 (27
existing + about 25 new for audit).

## SECURITY.md

A new top-level policy document covering:

1. Threat model — reproduced from the PRD §Security summary, expanded
   with the three primary attack vectors.
2. What the scanner checks — a narrative pointer to the rule
   families described above.
3. Severity policy — how statuses are decided.
4. `require_audit: true` — when and why to enable it per source.
5. Manual review checklist — the 7-item list from PRD §Security lines
   476-485.
6. Reporting a vulnerability — email and GitHub security advisory.
7. Limitations — explicit statement that the scanner is a heuristic
   and not a substitute for review of third-party skills from
   untrusted sources.

Length target: 150-250 lines. Policy doc, not a research paper.

## Open questions

None. The severity policy is deliberate, the rule set is exhaustive
for the PRD threat model, and the integration points are already in
place. New attack classes that surface later become new rule
functions under `audit_rules/` without touching the orchestrator.
