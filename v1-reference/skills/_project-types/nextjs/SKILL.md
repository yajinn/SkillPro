---
name: nextjs-conventions
description: >
  Next.js project conventions and best practices. Auto-invoke when working on
  Next.js projects (App Router or Pages Router): routing, server components,
  server actions, middleware, API routes, ISR/SSG/SSR, dynamic imports,
  next.config modifications, layout files, metadata, or Core Web Vitals.
  Invoke for next.config.*, app/layout.*, middleware.ts, API routes.
---

# ⚛️ Next.js Conventions — Project Layer

Project-specific rules for Next.js applications.

## Project Detection

!`echo "=== Next.js Version ===" && jq -r '.dependencies.next // .devDependencies.next // "unknown"' package.json 2>/dev/null`
!`echo "=== Router Type ===" && ([ -d "app" ] && echo "App Router" || ([ -d "pages" ] && echo "Pages Router" || echo "Unknown"))`
!`echo "=== Config ===" && ls next.config.* 2>/dev/null || echo "No next.config found"`

## Architecture Rules

### 1. Server vs Client Components (App Router)
- **Default to Server Components** — add `'use client'` only when needed
- Client triggers: `useState`, `useEffect`, `useRef`, event handlers, browser APIs
- Keep `'use client'` boundary as deep as possible in the component tree
- Server Components can import Client Components, not vice versa

### 2. Data Fetching Patterns
```typescript
// ✅ Server Component: Direct data access
async function FlightsPage({ searchParams }: Props) {
  const flights = await getFlights(searchParams); // Server-side
  return <FlightList flights={flights} />;
}

// ✅ Client Component: TanStack Query / SWR
'use client';
function FlightSearch() {
  const { data } = useQuery({
    queryKey: ['flights', params],
    queryFn: () => fetchFlights(params),
  });
}
```

### 3. Rendering Strategy Decision Tree
- **Static (SSG)**: Content rarely changes → `generateStaticParams`
- **ISR**: Content changes periodically → `revalidate: 3600`
- **Dynamic SSR**: User-specific or real-time data → `dynamic = 'force-dynamic'`
- **Client**: Interactive, user-driven content → `'use client'`

### 4. Critical File Protection 🚨
**STOP and request approval before modifying:**
- `next.config.ts/js/mjs` — affects entire build pipeline
- `app/layout.tsx` — affects every page
- `middleware.ts` — affects every request
- `app/globals.css` — affects global styles
- `.env*` files — affects runtime configuration

### 5. Performance Specifics
- Use `next/image` for ALL images — never raw `<img>`
- Use `next/font` for font loading — prevents FOIT/FOUT
- Use `next/script` with `strategy="lazyOnload"` for third-party scripts
- Implement `loading.tsx` for instant navigation feedback
- Use `Suspense` boundaries for streaming SSR

### 6. Metadata & SEO
```typescript
// ✅ CORRECT: Dynamic metadata
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await getData(params.slug);
  return {
    title: data.title,
    description: data.description,
    openGraph: { images: [data.image] },
  };
}
```

### 7. API Routes
- Use Route Handlers (`app/api/*/route.ts`) in App Router
- Always validate request body with zod
- Set proper HTTP status codes
- Implement rate limiting for public endpoints
- Use Edge Runtime for latency-sensitive endpoints

### 8. CDN & Caching
- Configure `Cache-Control` headers per route
- Use `stale-while-revalidate` for API responses
- Set `images.remotePatterns` in next.config for external images
- Consider Early Hints (103) for critical resources
- Use `next/headers` for dynamic cache key management

### 9. Middleware Best Practices
- Keep middleware lightweight — it runs on EVERY request
- Use matcher config to limit scope: `config = { matcher: ['/api/:path*'] }`
- Never do heavy computation or database queries in middleware
- Use for: auth redirects, geolocation, A/B testing headers, locale detection
