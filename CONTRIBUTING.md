# Contributing to SkillPro

Thanks for your interest. SkillPro is a small tool with a clear
scope, so contributions should stay focused on one of four areas:

1. **New source adapter** — support a new kind of external skill
   registry (e.g. GitLab, Hugging Face Spaces).
2. **New audit rule** — extend the heuristic scanner with a new
   attack-pattern detector.
3. **Detector improvements** — add languages, frameworks, or
   characteristic flags to `hooks/detect.sh`.
4. **Bug fixes** — the usual.

Anything outside these categories — adding new commands, redesigning
the scoring algorithm, shipping first-party skills in this repo —
should be discussed in an issue first. See `README.md` for the
architecture overview and the design boundary.

## Development setup

```bash
git clone https://github.com/yajinn/skillpro
cd skillpro
python3 -m unittest discover tests
```

No pip dependencies. Only `bash`, `jq`, and Python 3 stdlib are
required.

## Running the tool locally

```bash
bash hooks/detect.sh .
python3 scripts/refresh_index.py --force --verbose
python3 scripts/score.py .
python3 scripts/audit_skill.py scripts/audit_rules
```

Generated outputs land in `.claude/project-profile.json` (per project)
and `~/.claude/skillpro/index.json` (global).

## Adding a source adapter

Say you want to support a GitLab Skills registry:

1. Create `scripts/source_adapters/gitlab.py`:
   ```python
   from .base import HttpGet, SkillEntry

   class GitlabAdapter:
       type = "gitlab"

       def fetch(self, url: str, http_get: HttpGet) -> list[SkillEntry]:
           ...  # parse GitLab API response into SkillEntry list
   ```

2. Register it in `scripts/refresh_index.py`:
   ```python
   from source_adapters.gitlab import GitlabAdapter

   ADAPTERS = {
       "marketplace": MarketplaceAdapter(),
       "awesome-list": AwesomeListAdapter(),
       "gitlab": GitlabAdapter(),
   }
   ```

3. Add unit tests in `tests/test_gitlab_adapter.py` with fixture data
   in `tests/fixtures/gitlab_sample.json`. Follow the existing
   `test_marketplace_adapter.py` shape.

4. Document the new `type` value in `SECURITY.md` and `README.md`.

Every adapter must:

- Return `List[SkillEntry]` (never raise to the orchestrator — catch
  parse errors internally and log to stderr).
- Use the injected `http_get` callable, not direct `urllib` or
  `requests` calls. This keeps tests offline.
- Cap any sub-URL probes at 20 per invocation to prevent rate-limiting.

## Adding an audit rule

Rules live in `scripts/audit_rules/rules_<family>.py`. Each rule is a
pure function that takes a file path and byte content, and returns a
`List[Finding]`.

1. Pick the right file: markdown / shell / python / js / filesystem.
2. Add the rule function. Patterns that involve literal dangerous
   identifiers (e.g. dynamic code-evaluation builtins) must be
   assembled from fragments in `scripts/audit_rules/patterns.py` so
   the repo's own Write-tool hooks don't flag the rule source.
3. Add a unit test in `tests/test_audit_rules.py` with:
   - A malicious fixture that triggers the new rule.
   - An explicit false-positive test on the `clean` fixture.
4. Add an entry to the rule table in `SECURITY.md`.

**Severity guidance:**

- `critical` — arbitrary code execution, secret exfiltration, root
  takeover.
- `high` — static indicators of the above (dynamic eval, prompt
  injection, setuid files).
- `medium` — suspicious patterns that need human review but are not
  definitive (binary content, unusual imports).
- `low` — minor hygiene issues (stray executables).
- `info` — purely informational.

Rules at `high` and above trip the `failed` status and block installs.

## Adding languages or frameworks to the detector

`hooks/detect.sh` is pure bash. Detection happens in named blocks for
each language and framework.

1. Add the detection block to the appropriate section of `detect.sh`.
2. Add the new language/framework to the audit commands section if
   there's a linter/formatter/test runner to invoke.
3. Update the framework coverage in `README.md`.
4. If possible, add an integration test with a synthetic fixture
   project. See the end-to-end test in `tests/test_end_to_end.py` for
   the pattern.

## Commit and PR conventions

- **Commits**: Conventional Commits format (`feat(scope): ...`,
  `fix(scope): ...`, `docs(scope): ...`, `chore(scope): ...`, `test(scope): ...`).
  The `scope` should match a plan task or a file family (`detector`,
  `audit`, `install`, `refresh`, `score`, `docs`).
- **Branches**: `feat/<short-description>`, `fix/<short-description>`,
  `chore/<short-description>`.
- **PR description**: state the motivation, the affected files, and
  the test plan. Link to any related issue.
- **Tests**: every PR must pass `python3 -m unittest discover tests`.
  CI enforces this.
- **No new pip dependencies.** The stdlib-only constraint is a
  deliberate design choice — it keeps SkillPro installable on any
  machine that already has Python 3. If you believe a dependency is
  unavoidable, open an issue first and explain why.

## Code style

- Python: follow PEP 8 loosely, use `from __future__ import
  annotations`, type hints are encouraged but not required.
- Bash: use `set -uo pipefail`, quote all variable expansions, use
  `[ -f ... ]` not `test -f ...`.
- Markdown: 80-col wrap, no trailing whitespace.

## Reporting bugs

Include:

- Your OS and Python version.
- The SkillPro version (`python3 scripts/refresh_index.py --version`
  once implemented, or the git SHA).
- The output of the failing command (stdout + stderr).
- The project profile (if the bug is detector-related): paste
  `.claude/project-profile.json`.

## Reporting security issues

See `SECURITY.md` §Reporting a vulnerability. Do not open public
issues for security reports.
