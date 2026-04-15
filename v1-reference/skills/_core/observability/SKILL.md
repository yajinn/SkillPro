---
name: observability
description: >
  CORE OBSERVABILITY LAYER - Auto-invoke when implementing error handling, logging,
  try/catch blocks, API responses, monitoring setup, alerting, health checks,
  performance tracking, or debugging production issues. Enforces structured logging,
  error boundaries, Sentry/Crashlytics integration patterns, health endpoints,
  and proper error classification. Active for all project types.
---

# 📊 Observability — Core Layer

Every production system needs proper error handling, logging, and monitoring.

## Rules

### 1. Structured Logging
- Use structured JSON logs, not string concatenation
- Include context: `userId`, `requestId`, `action`, `duration`
- Log levels: `error` (action needed), `warn` (degraded), `info` (business events), `debug` (development)
- **NEVER** log sensitive data: passwords, tokens, PII, credit card numbers

```typescript
// ✅ CORRECT: Structured log
logger.error('Payment failed', {
  userId: user.id,
  orderId: order.id,
  provider: 'stripe',
  errorCode: err.code,
  duration: Date.now() - startTime,
});

// ❌ WRONG: String concat with sensitive data
console.log(`Payment failed for ${user.email} with card ${card.number}: ${err.stack}`);
```

### 2. Error Boundaries (React)

```typescript
// ✅ Every major route segment needs an error boundary
// app/flights/error.tsx (Next.js App Router)
'use client';

export default function FlightError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report to error tracking service
    captureException(error, { tags: { page: 'flights' } });
  }, [error]);

  return (
    <div role="alert">
      <h2>Something went wrong loading flights</h2>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

**Error boundary rules:**
- Place at route segment level (not individual component level)
- Always report to error tracking service
- Provide user-friendly message + retry action
- Log the original error server-side, show safe message client-side

### 3. API Error Handling Pattern

```typescript
// ✅ Consistent error response format
interface ApiError {
  code: string;        // Machine-readable: 'FLIGHT_NOT_FOUND'
  message: string;     // Human-readable: 'The requested flight is no longer available'
  status: number;      // HTTP status: 404
  details?: unknown;   // Optional additional context
  requestId?: string;  // For support/debugging correlation
}

// ✅ API route with proper error handling
export async function GET(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const params = validateSearchParams(req); // throws ValidationError
    const flights = await flightService.search(params);

    return Response.json({ data: flights, requestId });
  } catch (error) {
    if (error instanceof ValidationError) {
      return Response.json(
        { code: 'VALIDATION_ERROR', message: error.message, requestId },
        { status: 400 }
      );
    }

    // Unexpected error — log details, return safe response
    logger.error('Flight search failed', { error, requestId, params: req.url });
    captureException(error, { extra: { requestId } });

    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId },
      { status: 500 }
    );
  }
}
```

### 4. Error Classification

| Type | HTTP | Log Level | Alert | Example |
|------|------|-----------|-------|---------|
| Validation | 400 | warn | No | Invalid email format |
| Auth | 401/403 | warn | Rate spike | Expired token, missing permission |
| Not Found | 404 | info | No | Flight no longer available |
| Rate Limit | 429 | warn | Yes | Too many requests |
| Upstream | 502/503 | error | Yes | Payment provider down |
| Internal | 500 | error | Immediate | Unhandled exception |

### 5. Health Checks

```typescript
// ✅ Every service needs a health endpoint
// app/api/health/route.ts
export async function GET() {
  const checks = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    externalApi: await checkFlightApi(),
  };

  const healthy = Object.values(checks).every(c => c.status === 'ok');

  return Response.json(
    { status: healthy ? 'healthy' : 'degraded', checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 }
  );
}

async function checkDatabase(): Promise<HealthCheck> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { status: 'ok', latency: '2ms' };
  } catch {
    return { status: 'error', message: 'Connection failed' };
  }
}
```

### 6. Mobile Crash Reporting

- Initialize Sentry/Crashlytics at app startup (before any UI renders)
- Set user context after login (anonymized userId, not PII)
- Capture native crashes + JS exceptions
- Add breadcrumbs for navigation events, API calls, user actions
- Tag crashes by: app version, OS version, device model, screen name

```typescript
// ✅ React Native crash reporting setup
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.2,   // 20% of transactions
  profilesSampleRate: 0.1,  // 10% of profiled transactions
  beforeSend(event) {
    // Scrub PII
    delete event.user?.email;
    delete event.user?.ip_address;
    return event;
  },
});

// On navigation
Sentry.addBreadcrumb({
  category: 'navigation',
  message: `Navigated to ${routeName}`,
  level: 'info',
});
```

### 7. Performance Monitoring

Track these metrics in production:
- **API latency**: p50, p95, p99 for each endpoint
- **Error rate**: errors/total requests per endpoint
- **Core Web Vitals**: LCP, INP, CLS (web)
- **App startup time**: cold start, warm start (mobile)
- **Memory usage**: heap size trends, leak detection

```typescript
// ✅ Simple timing wrapper
async function withTiming<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = performance.now() - start;
    logger.info(`${name} completed`, { duration, status: 'success' });
    metrics.histogram(`${name}.duration`, duration);
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    logger.error(`${name} failed`, { duration, error });
    metrics.increment(`${name}.errors`);
    throw error;
  }
}
```

### 8. Request Tracing
- Generate a `requestId` at the entry point (API gateway, middleware)
- Pass it through all service calls via headers (`X-Request-Id`)
- Include in all log entries and error reports
- Return it in error responses for support correlation

### 9. Alerting Rules
- **Critical** (page someone): Error rate > 5%, all health checks failing
- **Warning** (Slack notification): Latency p95 > 2x baseline, single service degraded
- **Info** (dashboard): Deployment completed, traffic spike
- Don't alert on single occurrences — use thresholds and windows

### 10. Checklist
- [ ] Error boundaries at route level
- [ ] Structured logging (no console.log in production)
- [ ] Health check endpoint exists
- [ ] Error responses are safe (no stack traces, no internals)
- [ ] Request IDs for tracing
- [ ] Crash reporting initialized
- [ ] PII scrubbed from all logs and error reports
- [ ] Alerting configured for critical paths
