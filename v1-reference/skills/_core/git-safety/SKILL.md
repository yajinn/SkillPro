---
name: git-safety
description: >
  CORE GIT LAYER - Auto-invoke on ANY git operation, branch change, merge, rebase,
  commit, push, or file deletion. Prevents force-push to protected branches, detects
  .env files in staging, enforces conventional commits, warns about large file commits,
  and protects against accidental data loss. ALWAYS active.
---

# 🔒 Git Safety — Core Layer

Mandatory git protection rules for every project.

## Live Context

!`echo "Branch: $(git branch --show-current 2>/dev/null || echo 'N/A')"`
!`echo "Uncommitted: $(git status --porcelain 2>/dev/null | wc -l | tr -d ' ') files"`
!`echo "Staged .env: $(git diff --cached --name-only 2>/dev/null | grep -c '\.env' || echo 0)"`

## Rules

### 1. Branch Protection
- **NEVER** force-push to `main`, `master`, `production`, `staging`, `develop`
- **NEVER** commit directly to `main` or `master` — always use feature branches
- Branch naming: `feature/`, `fix/`, `hotfix/`, `chore/`, `refactor/`
- Before merge: ensure CI passes, code reviewed

### 2. Commit Hygiene
- Use conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `perf:`, `test:`
- One logical change per commit — don't mix refactors with features
- Never commit generated files: `node_modules/`, `.next/`, `dist/`, `build/`
- Max commit size guideline: if diff > 500 lines, consider splitting

### 3. Sensitive File Guard
**BLOCK** these from ever being committed:
- `.env`, `.env.local`, `.env.production`, `.env.*.local`
- `*.pem`, `*.key`, `*.cert` (private keys)
- `*credentials*`, `*secret*` files
- `serviceAccountKey.json`, `firebase-adminsdk*.json`
- `.npmrc` with auth tokens

**Verify `.gitignore` includes:**
```
.env
.env.*
*.pem
*.key
node_modules/
.next/
dist/
build/
```

### 4. Large File Prevention
- Warn if any single file > 1MB is being committed
- Binary files (images, videos, PDFs) → use Git LFS or external storage
- Database dumps → never commit, use migrations instead

### 5. Destructive Operation Guard
Before executing any of these, **STOP and confirm with user**:
- `git reset --hard`
- `git clean -fd`
- `git push --force` / `git push -f`
- `git rebase` on shared branches
- `git branch -D` (force delete)
- Any operation that rewrites history on remote

### 6. Merge Conflict Resolution
- **NEVER** auto-resolve conflicts by accepting all "theirs" or all "ours"
- Show the conflict to the user and explain both sides
- Test after resolution — conflicts can introduce subtle bugs

### 7. Pre-Push Verification
Suggest running before push:
- Type checking: `tsc --noEmit` or equivalent
- Lint: `eslint .` / `biome check .`
- Tests: at minimum smoke tests for changed areas
- Build: `npm run build` to catch compilation errors
