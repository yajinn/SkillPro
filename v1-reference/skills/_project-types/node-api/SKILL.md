---
name: node-api-conventions
description: >
  Node.js API project conventions. Auto-invoke when working on Express, Fastify,
  NestJS, or any Node.js backend: REST endpoints, middleware, database queries,
  authentication, rate limiting, validation, error handling, background jobs,
  caching, or microservice communication. Also invoke for Dockerfile and
  deployment configs for Node backends.
---

# 🖥️ Node.js API Conventions — Project Layer

Project-specific rules for Node.js backend services.

## Project Detection

!`echo "=== Framework ===" && jq -r '.dependencies | keys[]' package.json 2>/dev/null | grep -iE "express|fastify|@nestjs|hapi|koa" | head -3`
!`echo "=== ORM ===" && jq -r '.dependencies | keys[]' package.json 2>/dev/null | grep -iE "prisma|drizzle|typeorm|sequelize|knex|mongoose" | head -3`
!`echo "=== Node version ===" && node -v 2>/dev/null || echo "N/A"`

## Architecture Rules

### 1. Project Structure
```
src/
├── modules/              # Feature modules (domain-driven)
│   ├── flights/
│   │   ├── flights.controller.ts   # Route handlers
│   │   ├── flights.service.ts      # Business logic
│   │   ├── flights.repository.ts   # Data access
│   │   ├── flights.validator.ts    # Input schemas (zod)
│   │   ├── flights.types.ts        # TypeScript types
│   │   └── __tests__/
│   └── auth/
├── middleware/            # Express/Fastify middleware
├── lib/                  # Shared utilities
├── config/               # Environment & app config
└── index.ts              # App entry point
```

- Separate concerns: controller (HTTP) → service (logic) → repository (data)
- Business logic lives in services, NOT in controllers
- Controllers only: parse request, call service, format response
- Repositories only: database queries, no business logic

### 2. Input Validation at the Edge

```typescript
// ✅ Validate at controller level with zod
import { z } from 'zod';

const searchFlightsSchema = z.object({
  origin: z.string().length(3).toUpperCase(),
  destination: z.string().length(3).toUpperCase(),
  date: z.string().date(),
  passengers: z.number().int().min(1).max(9).default(1),
  currency: z.enum(['TRY', 'USD', 'EUR']).default('TRY'),
});

export async function searchFlights(req: Request, res: Response) {
  const params = searchFlightsSchema.parse(req.query); // throws ZodError
  const flights = await flightService.search(params);
  res.json({ data: flights });
}
```

### 3. Middleware Order (Express/Fastify)
```
1. Request ID generation
2. CORS
3. Security headers (helmet)
4. Body parser (with size limits)
5. Rate limiting
6. Authentication
7. Request logging
8. Route handlers
9. Error handler (LAST)
```

### 4. Database Best Practices
- Use connection pooling (PgBouncer, Prisma pool)
- All queries should have a timeout: `statement_timeout`
- Use transactions for multi-step mutations
- Index all columns used in WHERE, JOIN, ORDER BY
- Use `EXPLAIN ANALYZE` for slow queries
- Paginate everything: `LIMIT` + cursor-based pagination

```typescript
// ✅ Transaction for multi-step operation
const booking = await db.$transaction(async (tx) => {
  const flight = await tx.flight.findUnique({
    where: { id: flightId },
  });

  if (!flight || flight.availableSeats < passengers) {
    throw new InsufficientSeatsError();
  }

  const reservation = await tx.reservation.create({
    data: { flightId, userId, passengers, status: 'PENDING' },
  });

  await tx.flight.update({
    where: { id: flightId },
    data: { availableSeats: { decrement: passengers } },
  });

  return reservation;
});
```

### 5. API Design
- Use REST conventions: `GET /flights`, `POST /bookings`, `PATCH /bookings/:id`
- Consistent response envelope: `{ data, meta, errors }`
- Pagination: `?cursor=xxx&limit=20` (cursor-based preferred)
- Filtering: `?origin=IST&minPrice=500`
- Sorting: `?sort=price:asc,departure:desc`
- Versioning: URL path (`/v1/flights`) or header (`Accept-Version: 1`)
- Use proper HTTP status codes (see observability skill)

### 6. Background Jobs
- Use a proper job queue (BullMQ, Agenda, pg-boss) — not setTimeout
- Idempotent job handlers (safe to retry)
- Set max retries with exponential backoff
- Dead letter queue for permanently failed jobs
- Monitor queue depth and processing latency

### 7. Caching Strategy
- **HTTP caching**: `Cache-Control` headers on GET responses
- **Application cache**: Redis for hot data (session, rates, search results)
- **Query cache**: ORM-level caching for expensive queries
- Cache invalidation: event-driven (on mutation) or TTL-based
- Never cache user-specific data in shared cache without key isolation

### 8. Security Specifics
- Use `helmet` for security headers
- Rate limit auth endpoints: max 5 attempts per 15 min per IP
- Validate `Content-Type` header on POST/PUT/PATCH
- Request body size limit: `express.json({ limit: '1mb' })`
- SQL: parameterized queries only (see security-guardian)
- Use CORS whitelist, not `*`

### 9. Docker Best Practices
```dockerfile
# ✅ Multi-stage build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
USER nodejs
EXPOSE 3000
HEALTHCHECK CMD wget -q --spider http://localhost:3000/api/health || exit 1
CMD ["node", "dist/index.js"]
```

- Multi-stage builds (separate build and runtime)
- Non-root user
- Health check in Dockerfile
- `.dockerignore` for node_modules, .git, tests
- Pin base image versions
