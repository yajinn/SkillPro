---
name: dependency-audit
description: >
  CORE DEPENDENCY LAYER - Auto-invoke when installing packages, updating dependencies,
  modifying package.json, reviewing lock files, or encountering import errors.
  Checks for vulnerable packages, abandoned libraries, license conflicts, duplicate
  dependencies, and unnecessary bloat. ALWAYS active.
---

# 📦 Dependency Audit — Core Layer

Mandatory dependency health checks for every project.

## Live Scan

!`echo "=== Dependency count ===" && (jq -r '(.dependencies // {} | length | tostring) + " prod, " + (.devDependencies // {} | length | tostring) + " dev"' package.json 2>/dev/null || echo "No package.json")`
!`echo "=== Outdated check ===" && (npm outdated --json 2>/dev/null | jq 'to_entries | length | tostring + " outdated packages"' 2>/dev/null || echo "Check not available")`
!`echo "=== Audit ===" && (npm audit --json 2>/dev/null | jq '.metadata.vulnerabilities | to_entries | map(select(.value > 0)) | map(.key + ": " + (.value | tostring)) | join(", ")' 2>/dev/null || echo "Audit not available")`

## Rules

### 1. Before Adding Any Dependency
Evaluate:
- **Need**: Can this be done with built-in APIs or existing dependencies?
- **Size**: Check bundlephobia.com — reject if > 50KB gzipped without justification
- **Health**: Last published > 1 year ago? < 100 weekly downloads? → Red flag
- **Maintenance**: Open issues count, PR response time, bus factor
- **License**: Must be compatible (MIT, Apache-2.0, ISC = safe; GPL = review needed)
- **Security**: Check Snyk advisories for known vulnerabilities

### 2. Dependency Categories
```
dependencies:     Runtime essentials ONLY
devDependencies:  Build tools, testing, linting, types
peerDependencies: Framework plugins that share a host version
```
- **NEVER** put dev tools in `dependencies` (ESLint, Jest, TypeScript, etc.)
- **NEVER** put runtime needs in `devDependencies`

### 3. Version Pinning Strategy
- **Lock files** (`package-lock.json`, `pnpm-lock.yaml`) MUST be committed
- Use exact versions for critical packages: `"react": "18.3.1"` not `"^18.3.1"`
- Use ranges for dev tools: `"eslint": "^9.0.0"` is acceptable
- **NEVER** use `*` or `latest` as version

### 4. Duplicate Detection
- Watch for duplicates: `lodash` + `lodash-es`, `moment` + `dayjs`, `axios` + `node-fetch`
- Prefer native: `fetch()` over `axios`, `structuredClone` over `lodash.cloneDeep`
- Consolidate utility libraries — one choice per category

### 5. Known Risky Patterns
Flag these immediately:
- `moment.js` → Replace with `date-fns` or `dayjs` (moment is 67KB+ gzipped)
- `lodash` full import → Use `lodash-es` with tree-shaking or individual imports
- `request` → Deprecated, use native `fetch` or `undici`
- `node-sass` → Deprecated, use `sass` (dart-sass)
- `tslint` → Deprecated, use `eslint` + `@typescript-eslint`

### 6. Security Response
When vulnerabilities found:
1. Check if it affects production code (not just dev tooling)
2. Check if a patched version exists → update immediately
3. If no patch: evaluate if the vulnerable code path is reachable
4. Document the decision if accepting risk temporarily

### 7. Update Strategy
- **Patch updates** (1.0.x): Apply freely, low risk
- **Minor updates** (1.x.0): Apply with testing, check changelog
- **Major updates** (x.0.0): Plan migration, read breaking changes, test thoroughly
- Run full test suite after any dependency update
- Never update all dependencies at once — batch by category
