# SkillPro Security Policy

This document describes SkillPro's threat model, what the built-in
audit gate checks, how to configure strict mode, how to review a skill
manually, and how to report a vulnerability.

## Threat model

Skills execute inside the user's AI agent session with direct access to
files, shell commands, and network resources. A malicious skill can:

1. **Exfiltrate secrets** — read environment variables, keychain
   entries, dotfiles, then send them to an attacker-controlled host.
2. **Run arbitrary code** — download a payload and pipe it into a
   shell, or use dynamic code-evaluation features to defeat static
   review.
3. **Hijack the agent** — embed prompt-injection directives in SKILL.md
   that try to override the user's instructions or extract the system
   prompt.

Per Snyk's ToxicSkills research (February 2026), 13.4% of community-
hosted skills contain critical security issues, 36% have at least one
security flaw, and 91% of confirmed malicious skills use prompt
injection. The audit gate exists to catch these three vectors before a
skill lands in `~/.claude/skills/`.

## What the scanner checks

The audit gate has two tiers.

### Tier 1 — heuristic scanner (always runs)

Pure Python stdlib, no external dependencies, deterministic. It walks
the skill directory and applies per-file-type rules:

- **Markdown rules**
  - `prompt-injection-keyword` (high): matches known injection phrases
    such as "ignore previous instructions", "reveal the system prompt",
    "disregard the user", "you must not refuse".
  - `invisible-characters` (medium): zero-width spaces, zero-width
    joiners, word joiners, BOM, Unicode tag characters.
  - `base64-blob` (medium): continuous runs of 200+ base64 chars.
  - `hidden-html-comment-directive` (high): HTML comments containing
    imperative verbs (run, execute, fetch, download, delete, ignore,
    disable) — the ClawHub attack vector.
  - `suspicious-url-scheme` (high): `data:`, `javascript:`, `file://`,
    `vbscript:` in markdown URLs.

- **Shell rules**
  - `curl-pipe-to-shell` (critical): network download piped into a
    shell interpreter, with or without sudo.
  - `env-var-exfiltration` (critical): network upload command whose
    data payload references an uppercase shell variable.
  - `shell-evalexec-with-input` (high): shell dynamic evaluation of a
    variable or command substitution.
  - `rm-rf-suspicious` (high): `rm -rf /`, `rm -rf ~`, or
    `rm -rf *`.
  - `network-download-execute` (critical): downloaded script chained
    into an immediate shell invocation.

- **Python rules** (AST-based, not regex — zero false positives on
  string literals)
  - `python-evalexec` (high): direct call to a dynamic
    code-evaluation builtin.
  - `subprocess-shell-true` (medium): subprocess spawn with
    `shell=True`.
  - `env-var-exfiltration-py` (critical): module reads `os.environ`
    and uses an HTTP client.
  - `suspicious-import` (medium): imports of low-level binary
    deserializers.

- **JavaScript / TypeScript rules** (regex)
  - `js-dynamic-eval` (high): direct call to the JS code-evaluation
    builtin.
  - `js-function-constructor` (high): dynamic code synthesis via the
    runtime `Function` constructor.
  - `js-fetch-unknown-origin` (medium): `fetch()` to a host that is
    not on the allowlist.

- **Filesystem rules**
  - `symlink-escape` (critical): a symlink whose target is outside
    the skill root.
  - `setuid-file` (high): file with the SUID bit set.
  - `executable-outside-scripts` (low): +x bit on a file not under
    `scripts/`.
  - `binary-content` (medium): non-text content (null bytes or high
    non-ASCII ratio).

### Tier 2 — external CLI tools (optional)

If the binary is on PATH, it runs in addition to Tier 1. Neither is
required for SkillPro to function.

- `snyk-agent-scan` — Snyk's official CLI scanner for agent skills.
- `skill-scanner` — Cisco's open-source scanner.

Tier 2 output is parsed into the same `Finding` shape and merged with
Tier 1. If neither tool is installed, the merged result uses Tier 1
only and the `tool` field reports `"heuristic"`.

## Severity policy

- **Any** critical or high finding → `status = "failed"`. The install
  is blocked.
- **Only** medium, low, or info findings → `status = "passed"`, but
  findings are surfaced in the install output so the user sees them.
- No findings → `status = "passed"` silently.

The `failed` bar is deliberately low because skills run with
privileged access. One critical finding is one too many.

## Strict mode: `require_audit: true`

Each source in `config/sources.json` (or your override at
`~/.claude/skillpro/sources.json`) can set `require_audit: true`.
When the flag is enabled, the install pipeline also aborts on an
`unavailable` audit result — i.e. if the scanner could not produce a
verdict. Use strict mode for:

- Sources you do not fully trust.
- Corporate environments that mandate auditable installs.
- CI pipelines that must fail-closed on audit errors.

The default is `false` because the heuristic scanner always runs in
practice, so `unavailable` is essentially dead code unless the scanner
is explicitly disabled.

## Manual review checklist

Before adding an entry to `sources.json` pointing at a new marketplace
or awesome-list, review the target:

1. Read every file in the skill directory — `SKILL.md`, everything
   under `scripts/`, any `references/` subdirectory.
2. No external URL fetches or network calls in scripts that you
   cannot explain.
3. No environment variable reads that could leak secrets without a
   clear, legitimate purpose.
4. No instructions that tell the agent to ignore safety rules or
   hide behavior from the user.
5. No hidden commands in Dynamic Context Injection (`!command`)
   blocks that you would not run yourself at the shell.
6. Script behavior matches the stated purpose in `SKILL.md`.
7. Test in a sandbox environment (separate user, no real secrets)
   before enabling in production.

This is the checklist from the PRD §Security. The scanner automates a
subset of it but is not a replacement for a careful read.

## Reporting a vulnerability

If you discover a vulnerability in SkillPro itself (the detector,
the scorer, the audit gate, the runtime hooks):

1. **Do not open a public issue.**
2. Email the maintainer with a description and reproduction steps.
3. Alternatively, file a private GitHub security advisory on the
   SkillPro repository.

We aim to acknowledge reports within 72 hours and provide a status
update within 7 days.

## Reporting a malicious skill

If a skill in a public marketplace or awesome-list is malicious:

1. Report it to the source maintainer first (repo issue, upstream
   moderation channel).
2. If the source is unresponsive and the skill poses active risk,
   email the SkillPro maintainer so we can consider removing the
   source from the built-in default whitelist in `config/sources.json`.

## Limitations

The audit gate is a **heuristic**, not a proof of safety. Specifically:

- It cannot detect sophisticated obfuscation (nested base64, string
  reassembly across multiple files, steganography in images).
- It cannot reason about intent — a script that legitimately needs to
  use a dynamic code-evaluation builtin will also trip the rule.
- It cannot simulate runtime behavior — side effects during
  installation (a `RUN` step in a Dockerfile, a postinstall npm hook)
  are not evaluated.
- It relies on file extensions to pick a rule family. A `.txt` file
  that contains a shell script is not scanned as a shell script.

For high-stakes environments, combine the scanner with:

1. `require_audit: true` on every source.
2. Manual review using the checklist above.
3. Running SkillPro in a separate user account with restricted
   filesystem access.
4. Regularly running `/sf audit` on already-installed skills
   to catch rules introduced after the install.

The scanner raises the floor. It does not raise the ceiling.
