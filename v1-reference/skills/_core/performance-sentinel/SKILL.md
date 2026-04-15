---
name: performance-sentinel
description: >
  CORE PERFORMANCE LAYER - Auto-invoke when writing components, API routes, database
  queries, imports, images, CSS, third-party scripts, or any code that affects bundle
  size, rendering, network requests, or memory. Detects N+1 queries, unnecessary
  re-renders, large bundle imports, memory leaks, unoptimized images, blocking scripts,
  and Core Web Vitals regressions. ALWAYS active for all project types.
---

# ⚡ Performance Sentinel — Core Layer

This is a **mandatory** performance awareness layer. Apply these principles to EVERY
code change to prevent performance regressions.

## Live Project Scan

!`echo "=== Bundle size check ===" && ([ -d ".next" ] && du -sh .next/static/chunks/*.js 2>/dev/null | sort -rh | head -5 || echo "No Next.js build found")`
!`echo "=== Large dependencies ===" && ([ -f "package.json" ] && jq -r '.dependencies // {} | keys[]' package.json 2>/dev/null | head -20 || echo "No package.json")`
!`echo "=== Image optimization ===" && find src app public -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" \) -size +500k 2>/dev/null | head -5 || echo "No large images found"`

## Universal Performance Rules

### 1. Bundle Size Awareness
- **ALWAYS** use dynamic imports for heavy libraries
- Prefer tree-shakeable imports: `import { pick } from 'lodash-es'` not `import _ from 'lodash'`
- Analyze impact before adding new dependencies: check bundlephobia.com
- Use `next/dynamic` or `React.lazy()` for non-critical components
- Code split by route — never load the entire app upfront

```typescript
// ✅ CORRECT: Dynamic import for heavy library
const Chart = dynamic(() => import('@/components/Chart'), {
  loading: () => <ChartSkeleton />,
  ssr: false,
});

// ❌ WRONG: Static import of heavy component
import Chart from '@/components/Chart';
```

### 2. Rendering Performance
- Avoid unnecessary re-renders: use `React.memo`, `useMemo`, `useCallback` where measured
- **NEVER** create objects/arrays/functions inside JSX props without memoization
- Virtualize long lists: use `react-window` or `@tanstack/react-virtual`
- Debounce/throttle expensive handlers (search, scroll, resize)
- Avoid layout thrashing: batch DOM reads and writes

```typescript
// ✅ CORRECT: Stable reference
const handleSearch = useCallback(
  debounce((query: string) => { search(query); }, 300),
  [search]
);

// ❌ WRONG: New function every render
<Input onChange={(e) => debounce(() => search(e.target.value), 300)()} />
```

### 3. Data Fetching
- Implement proper caching: HTTP cache headers, SWR/TanStack Query stale times
- Avoid waterfalls: parallelize independent requests
- Use pagination or infinite scroll for large datasets
- Implement optimistic updates for better perceived performance
- Cancel stale requests on navigation (AbortController)

```typescript
// ✅ CORRECT: Parallel fetching
const [flights, hotels] = await Promise.all([
  fetchFlights(params),
  fetchHotels(params),
]);

// ❌ WRONG: Sequential waterfall
const flights = await fetchFlights(params);
const hotels = await fetchHotels(params); // waits for flights unnecessarily
```

### 4. Database & API Performance
- **DETECT N+1 QUERIES**: If iterating over a list and making a query per item → refactor to batch
- Use database indexes for frequently queried columns
- Implement query result caching (Redis, in-memory) for hot paths
- Limit query results: always use pagination, never `SELECT *` without LIMIT
- Use connection pooling (PgBouncer, Prisma connection pool)

```typescript
// ❌ N+1 QUERY — ALWAYS FLAG THIS
const users = await db.user.findMany();
for (const user of users) {
  const orders = await db.order.findMany({ where: { userId: user.id } });
}

// ✅ CORRECT: Eager loading / Include
const users = await db.user.findMany({
  include: { orders: true },
});
```

### 5. Image & Asset Optimization
- Use `next/image` or equivalent optimized image component
- Serve WebP/AVIF formats with fallback
- Implement responsive images with `srcSet` / `sizes`
- Lazy load below-the-fold images
- Set explicit `width` and `height` to prevent CLS (Cumulative Layout Shift)
- Compress images: target <200KB for hero images, <50KB for thumbnails

### 6. Third-Party Scripts
- Load analytics, chat widgets, etc. with `afterInteractive` or `lazyOnload` strategy
- Use `@next/third-parties` for Google Analytics, GTM, etc.
- Consider Partytown for moving third-party scripts to Web Workers
- Audit third-party impact: each script adds to TBT (Total Blocking Time)
- Preconnect to required origins: `<link rel="preconnect" href="..." />`

### 7. Core Web Vitals Targets
| Metric | Good    | Needs Work | Poor    |
|--------|---------|------------|---------|
| LCP    | ≤2.5s   | ≤4.0s      | >4.0s   |
| INP    | ≤200ms  | ≤500ms     | >500ms  |
| CLS    | ≤0.1    | ≤0.25      | >0.25   |

- **LCP**: Optimize critical rendering path, preload hero images, use CDN
- **INP**: Keep event handlers <50ms, use `startTransition` for non-urgent updates
- **CLS**: Set dimensions on all media, avoid dynamic content injection above fold

### 8. Memory Management
- Clean up event listeners in `useEffect` return
- Cancel timers (`setTimeout`, `setInterval`) on unmount
- Abort fetch requests on component unmount
- Avoid storing large data in React state — use refs for non-rendered data
- Be careful with closures over large arrays/objects

```typescript
// ✅ CORRECT: Cleanup
useEffect(() => {
  const controller = new AbortController();
  fetchData({ signal: controller.signal });
  return () => controller.abort();
}, []);
```

### 9. CSS Performance
- Avoid runtime CSS-in-JS in performance-critical paths (prefer Tailwind, CSS Modules)
- Remove unused CSS: audit with PurgeCSS or Tailwind's built-in purge
- Minimize CSS specificity wars — flat selectors are faster
- Use `contain: layout` for isolated sections
- Preload critical CSS, defer non-critical

### 10. Caching Strategy
- **CDN**: Cache static assets aggressively (immutable, max-age=31536000)
- **API**: Set appropriate `Cache-Control` and `stale-while-revalidate`
- **ISR/SSG**: Use incremental static regeneration for semi-dynamic content
- **Client**: Implement service worker for offline capability where appropriate
- **Edge**: Use Early Hints (103) for critical resource preloading

## Performance Code Review Checklist
Before approving changes, verify:
- [ ] No new large dependency without justification
- [ ] Dynamic imports for heavy components
- [ ] No N+1 queries introduced
- [ ] Images optimized and using proper components
- [ ] No unnecessary re-renders in hot paths
- [ ] Third-party scripts loaded with proper strategy
- [ ] Caching headers set correctly
- [ ] useEffect cleanup functions present
