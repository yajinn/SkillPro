---
description: Detect the current project and manage SkillForge's federated skill index
argument-hint: "[setup|refresh|sources|add <id>|remove <id>|audit|profile]"
allowed-tools: Bash, Read, Write, Edit
---

# /skillforge

You are running the SkillForge command. SkillForge ships with no skills of
its own — it fetches a federated index from external sources listed in
`config/sources.json` (or `~/.claude/skillforge/sources.json`), scores the
index against the detected project profile, and installs skills on demand.

## Argument routing

- (no argument) or `status` → show detected project + installed skills + recommendation summary
- `setup` → refresh the index if TTL expired, then show interactive recommendations
- `refresh` → force-refresh the index, ignoring TTL
- `sources` → print the active source list + last fetch status per source
- `add <id>` → install a single skill by id
- `remove <id>` → uninstall and drop from selections
- `audit` → run the audit gate on every installed skill (Phase 7 stub, reports "unavailable")
- `profile` → dump the full `.claude/project-profile.json`

## Live state

Project profile (regenerated each invocation):
!`bash "${CLAUDE_PLUGIN_ROOT:-$PWD}/hooks/detect.sh" "$PWD" >/dev/null 2>&1 && cat .claude/project-profile.json 2>/dev/null || echo '{"error":"detect.sh failed"}'`

Index freshness (stale-while-revalidate: this command both reports staleness and triggers a background refresh if needed):
!`python3 -c "
import json, os, sys
from datetime import datetime, timezone
p = os.path.expanduser('~/.claude/skillforge/index.json')
if not os.path.exists(p):
    print(json.dumps({'state': 'missing'}))
    sys.exit(0)
try:
    with open(p) as f: idx = json.load(f)
    t = datetime.strptime(idx['fetched_at'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    age = (datetime.now(timezone.utc) - t).total_seconds()
    ttl = idx.get('ttl_seconds', 604800)
    print(json.dumps({'state': 'stale' if age > ttl else 'fresh', 'age_s': int(age), 'ttl_s': ttl, 'skills': len(idx.get('skills', [])), 'partial': idx.get('partial', False)}))
except Exception as e:
    print(json.dumps({'state': 'corrupt', 'error': str(e)}))
"`

Skill recommendations (blank if index is missing — tell the user to run /skillforge refresh):
!`python3 "${CLAUDE_PLUGIN_ROOT:-$PWD}/scripts/score.py" "$PWD" 2>/dev/null || echo '{}'`

Selections (persistent across sessions):
!`cat ~/.claude/skillforge/selections.json 2>/dev/null || echo '{}'`

## Behavior

1. **Parse the argument** from `$ARGUMENTS`.

2. **If the index is `missing`:**
   - If argument is `refresh` or `setup`, run `python3 "${CLAUDE_PLUGIN_ROOT:-$PWD}/scripts/refresh_index.py" --force --verbose` and wait for it to finish, then re-read state.
   - For any other argument, tell the user the index is missing and suggest `/skillforge refresh`, then stop.

3. **If the index is `stale`:** silently run `python3 "${CLAUDE_PLUGIN_ROOT:-$PWD}/scripts/refresh_index.py" &` to kick off a background refresh. Serve the cached index in the meantime.

4. **Routing:**
   - `profile` → dump the profile JSON verbatim as a fenced block. Stop.
   - `sources` → list active sources, their types, their last fetch status. Stop.
   - `refresh` → run `refresh_index.py --force --verbose`, report the outcome. Stop.
   - `add <id>` → run `python3 "${CLAUDE_PLUGIN_ROOT:-$PWD}/scripts/install_skill.py" <id>`, report the outcome, then show the updated selections count.
   - `remove <id>` → run `rm -rf ~/.claude/skills/<id>` and update `~/.claude/skillforge/selections.json` to drop the id. No confirmation prompt; this is explicit user intent.
   - `audit` → for each installed skill, invoke `scripts/audit_skill.py`. Report a table. In this iteration every row reports `unavailable`.
   - `status` / (empty) → proceed to step 5.
   - `setup` → proceed to step 5 with the explicit invitation "Which skills do you want? Reply `/skillforge add <id>` for each."

5. **Render recommendations.** Group as:

```
### ✅ Recommended (N)
| Skill | Score | Source | Description |
|-------|-------|--------|-------------|

### ⚡ Optional (N)
...

<details>
<summary>💤 Not relevant (N) — click to expand</summary>
...
</details>
```

Sort within each group by score descending. Prefix installed skill ids with ✓. If a skill carries `audit.status == "failed"`, prefix it with ⚠️ and say so in the description.

6. **Footer lines:**
   - "Index: N skills from M sources, fetched <relative time> ago."
   - If `partial: true`: "⚠️ Partial index — some sources failed to fetch. Run `/skillforge sources` to see which."
   - "Run `/skillforge add <id>` to install. Selections persist in `~/.claude/skillforge/selections.json`."

7. **Never install anything automatically.** Recommendations are suggestions, not actions.
