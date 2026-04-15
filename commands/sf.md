---
description: SkillForge — detect project, score federated skill index, install picks
argument-hint: "[setup|refresh|sources|add <id>|remove <id>|skip <id>|check <id>|confirm|clear|export <cursor|codex>|audit|profile]"
allowed-tools: Bash, Read, Write, Edit
---

# /sf

**Output style:** Be terse. No numbered "next steps" lists. No Insight blocks.
No multi-paragraph preambles. Render the scan as a compact table and a single
footer line. If the user wants detail, they'll ask.

SkillForge ships with zero skills of its own. It fetches a federated index,
scores it against the detected project, and installs only what the user picks.

## Plugin root resolver (used by every bash block below)

```bash
SF_ROOT="${CLAUDE_PLUGIN_ROOT:-$(ls -d ~/.claude/plugins/cache/*/skillforge/*/ 2>/dev/null | tail -1 | sed 's:/$::')}"
```

Never reference `${CLAUDE_PLUGIN_ROOT}` bare — Claude Code doesn't always
export it into slash-command subshells, and `$PWD` fallback would point
at the user's project, not this plugin.

## Live state (3 injected blocks)

Project profile:
!`SF_ROOT="${CLAUDE_PLUGIN_ROOT:-$(ls -d ~/.claude/plugins/cache/*/skillforge/*/ 2>/dev/null | tail -1 | sed 's:/$::')}"; bash "$SF_ROOT/hooks/detect.sh" "$PWD" >/dev/null 2>&1 && cat .claude/project-profile.json 2>/dev/null || echo "{\"error\":\"detect.sh failed (SF_ROOT=$SF_ROOT)\"}"`

Index freshness:
!`python3 -c "
import json, os, sys
from datetime import datetime, timezone
p = os.path.expanduser('~/.claude/skillforge/index.json')
if not os.path.exists(p):
    print(json.dumps({'state': 'missing'})); sys.exit(0)
try:
    with open(p) as f: idx = json.load(f)
    t = datetime.strptime(idx['fetched_at'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    age = (datetime.now(timezone.utc) - t).total_seconds()
    ttl = idx.get('ttl_seconds', 604800)
    print(json.dumps({'state': 'stale' if age > ttl else 'fresh', 'age_s': int(age), 'skills': len(idx.get('skills', [])), 'partial': idx.get('partial', False)}))
except Exception as e:
    print(json.dumps({'state': 'corrupt', 'error': str(e)}))
"`

Recommendations:
!`SF_ROOT="${CLAUDE_PLUGIN_ROOT:-$(ls -d ~/.claude/plugins/cache/*/skillforge/*/ 2>/dev/null | tail -1 | sed 's:/$::')}"; python3 "$SF_ROOT/scripts/score.py" "$PWD" 2>/dev/null || echo '{}'`

Selections and pending state are read lazily inside `confirm`/`skip`/`check`
routes — they're not needed for the status path.

## Routing

Resolve `SF_ROOT` at the top of every Bash call using the line above. Then:

1. Parse `$ARGUMENTS`.
2. If index is `missing`:
   - `refresh` / `setup` → run `python3 "$SF_ROOT/scripts/refresh_index.py" --force --verbose`, then re-read state.
   - Anything else → tell the user "index missing, run `/sf refresh`". Stop.
3. If index is `stale` → kick off `python3 "$SF_ROOT/scripts/refresh_index.py" &` in background, continue with cached index.
4. Dispatch:

| Arg | Action |
|-----|--------|
| `profile` | Dump `.claude/project-profile.json` verbatim. Stop. |
| `sources` | List sources from the index + their fetch status. Stop. |
| `refresh` | `refresh_index.py --force --verbose`, report outcome. Stop. |
| `add <id>` | `install_skill.py <id>`, report outcome. Stop. |
| `remove <id>` | `rm -rf ~/.claude/skills/<id>` + drop from `selections.json`. Stop. |
| `setup` | `scan.py "$PWD"` — runs the narrated pipeline (detect → index → score → seed) and streams status lines. THEN run `pending.py render` and print its full output as a second block so the user sees the checkbox list. Do NOT reformat scan.py output — it's already user-facing. Stop. |
| `skip <id>` | `pending.py skip <id>` then `pending.py render`. Stop. |
| `check <id>` | `pending.py check <id>` then `pending.py render`. Stop. |
| `confirm` | `pending.py confirm`, report. Pending file preserved on failure. Stop. |
| `clear` | `pending.py clear`. Stop. |
| `export cursor` | `convert.py --agent cursor --out "$PWD" --json`. Report file count. Stop. |
| `export codex` | `convert.py --agent codex --out "$PWD" --json`. Report path. Stop. |
| `audit` | `audit_skill.py` on each installed skill. Compact table. Stop. |
| `status` / empty | Continue to step 5. |

## Render template (status path only)

Output exactly this shape. No prose outside it:

```
Project: <language> / <framework>  <N libs>
Index:   <count> skills · <state> · fetched <age>
<partial-warn if any>

Recommended (<R>)        Optional (<O>)
─────────────────────    ─────────────────
<id>  (<score>)          <id>  (<score>)
...                      ...

Next: <one concrete action>
```

Rendering rules (minimal):
- Max 5 rows per column. If more, append `+N more` on the last row.
- Libraries list: truncate to 3 + `…` if longer.
- `<partial-warn>` = `⚠ partial index` on its own line, only if `partial: true`.
- `<one concrete action>` picks ONE of:
  - `/sf setup` if pending.json missing or empty
  - `/sf confirm` if pending.json has checked items
  - `/sf refresh` if state is stale
- Never auto-install. `confirm` is the only verb that touches `~/.claude/skills/`.

If `grouped` is present in score output, use grouped IDs instead of flat
`skills.recommended` — one category per row block, top 2 per category,
collapse the rest silently. No category headers in terse mode.
