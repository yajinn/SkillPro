---
name: security-guardian
description: >
  CORE SECURITY LAYER - Auto-invoke on ANY code change, file creation, API endpoint,
  authentication flow, environment variable, secret handling, form input, database query,
  HTTP request, or dependency installation. Detects secrets in code, SQL injection,
  XSS, CSRF, insecure dependencies, missing input validation, and auth vulnerabilities.
  ALWAYS active. DO NOT skip for any project type.
---

# 🛡️ Security Guardian — Core Layer

This is a **mandatory** security layer. Apply these rules to EVERY code change regardless
of project type, framework, or language.

## Live Project Scan

!`echo "=== .env in git ===" && git ls-files --cached 2>/dev/null | grep -E '\.env' || echo "Clean"`
!`echo "=== Hardcoded secrets scan ===" && grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" -E "(password|secret|api_key|apikey|token)\s*[:=]\s*['\"][^'\"]{8,}" src/ app/ lib/ 2>/dev/null | head -5 || echo "No hardcoded secrets found"`
!`echo "=== npm audit summary ===" && npm audit --json 2>/dev/null | jq '{total: .metadata.totalDependencies, vulnerabilities: .metadata.vulnerabilities}' 2>/dev/null || echo "npm audit not available"`

## Mandatory Security Rules

### 1. Secret Management
- **NEVER** hardcode secrets, API keys, tokens, passwords in source code
- All secrets → environment variables via `.env.local` (development) or secret manager (production)
- `.env*` files MUST be in `.gitignore` — verify before every commit
- Use `process.env.VAR_NAME` with runtime validation (throw if missing)

### 2. Input Validation & Sanitization
- **ALL user input** must be validated at the boundary (API route, form handler, webhook)
- Use schema validation: `zod`, `yup`, `joi`, or equivalent
- Sanitize HTML output to prevent XSS: escape user-generated content
- File uploads: validate MIME type, size limit, filename sanitization
- URL parameters: validate and sanitize before database queries

```typescript
// ✅ CORRECT: Schema validation at API boundary
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100).trim(),
  amount: z.number().positive().max(999999),
});

export async function POST(req: Request) {
  const body = schema.parse(await req.json()); // throws on invalid
  // ... safe to use body
}
```

### 3. SQL Injection Prevention
- **NEVER** concatenate user input into SQL strings
- Always use parameterized queries or ORM methods
- Prisma/Drizzle: use their type-safe query builders
- Raw SQL: use `$1, $2` placeholders, never template literals with user data

### 4. Authentication & Authorization
- Verify auth on EVERY protected API route — not just middleware
- Use `httpOnly`, `secure`, `sameSite=strict` for cookies
- Implement rate limiting on auth endpoints (login, register, password reset)
- Session tokens: use cryptographically random values, set expiry
- RBAC: check permissions at the data access layer, not just UI

### 5. CSRF Protection
- Use anti-CSRF tokens for state-changing operations
- Verify `Origin` / `Referer` headers on mutations
- `SameSite=Strict` or `SameSite=Lax` for session cookies

### 6. Dependency Security
- Run `npm audit` / `yarn audit` regularly
- Pin exact versions for critical security packages
- Review new dependencies: check maintainer, download count, last update
- **NEVER** install packages from untrusted sources during automated flows

### 7. Error Handling
- **NEVER** expose stack traces, internal paths, or database errors to users
- Log detailed errors server-side; return generic messages to clients
- Use structured error responses with safe error codes

```typescript
// ✅ CORRECT: Safe error response
catch (error) {
  logger.error('Payment failed', { error, userId, orderId });
  return NextResponse.json(
    { error: 'Payment processing failed', code: 'PAYMENT_ERROR' },
    { status: 500 }
  );
}

// ❌ WRONG: Leaking internals
catch (error) {
  return NextResponse.json({ error: error.message, stack: error.stack });
}
```

### 8. HTTP Security Headers
Ensure these headers are set (via middleware, CDN, or next.config):
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` (or CSP frame-ancestors)
- `Content-Security-Policy: default-src 'self'; ...`
- `Referrer-Policy: strict-origin-when-cross-origin`

### 9. API Security
- Rate limit all public endpoints
- Validate `Content-Type` header
- Implement request size limits
- Use API versioning for breaking changes
- Log all authentication failures with IP + user agent

### 10. Infrastructure File Protection
These files require **explicit approval** before modification:
- `next.config.*`, `nuxt.config.*`, `remix.config.*`
- `Dockerfile`, `docker-compose.*`
- `.env`, `.env.*`
- `package.json` (dependency changes)
- Database migration files
- Auth configuration files
- Nginx / Akamai / CDN configs
- CI/CD workflow files
- Kubernetes manifests

## Pre-Commit Checklist
Before suggesting a commit, verify:
- [ ] No secrets in code or config files
- [ ] All user inputs validated
- [ ] Error responses don't leak internals
- [ ] Auth checks on all protected routes
- [ ] `.env` files in `.gitignore`
- [ ] No `console.log` with sensitive data
