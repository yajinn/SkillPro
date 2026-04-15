---
name: turna-platform
description: >
  Turna.com travel platform domain conventions. Auto-invoke when working on
  Akamai CDN configuration, multi-currency/multi-language cache keys, Core Web
  Vitals optimization, ISR/SSG distributed coordination, flight/hotel search
  performance, redirect proxy, Google Analytics/GTM setup, Meta Pixel integration,
  or any Turna-specific infrastructure. Invoke for CDN cache headers, currency
  switching, language routing, and search result caching strategies.
---

# ✈️ Turna.com Platform — Domain Layer

Domain-specific rules and patterns for the Turna.com travel booking platform.

> ⚠️ This is a TEMPLATE. Customize with your actual infrastructure details.
> Place in your project's `.claude/skills/turna-platform/SKILL.md`

## Architecture Context

!`echo "=== Deployment ===" && ([ -f "docker-compose.yml" ] && echo "Docker/Coolify" || echo "Check deployment config")`
!`echo "=== CDN ===" && grep -rn "akamai\|cloudflare\|fastly" next.config.* .env* 2>/dev/null | head -3 || echo "No CDN config found"`
!`echo "=== i18n ===" && grep -rn "locale\|i18n\|language" next.config.* 2>/dev/null | head -3 || echo "No i18n config found"`

## 1. Akamai CDN Strategy

### Cache Key Management
Currency and language switching creates cache key permutations. Rules:

```
Cache Key = URL + Currency + Language
Example:  /flights/istanbul-antalya + TRY + tr
          /flights/istanbul-antalya + USD + en
          /flights/istanbul-antalya + EUR + de
```

**Implementation:**
- Pass `X-Currency` and `X-Language` headers from client
- Akamai uses these as cache key modifiers via `Vary` or custom cache ID
- Set `Cache-Control: s-maxage=300, stale-while-revalidate=600` for search results
- Static pages (blog, about): `s-maxage=86400`
- Dynamic pages (search results): `s-maxage=60, stale-while-revalidate=300`
- User-specific pages (bookings, profile): `Cache-Control: private, no-store`

### Early Hints (103)
- Preconnect to critical origins:
  ```
  Link: <https://fonts.googleapis.com>; rel=preconnect
  Link: <https://cdn.turna.com>; rel=preconnect
  Link: </styles/critical.css>; rel=preload; as=style
  ```
- Configure at Akamai edge, not in application code
- Verify with `server-timing` header analysis

### Edge Caching Rules
| Path Pattern | Cache TTL | Vary | Notes |
|---|---|---|---|
| `/` (homepage) | 5 min | Currency, Language | Revalidate on deploy |
| `/flights/*` (search) | 1 min | Currency, Language, Query | Short TTL, SWR 5 min |
| `/hotels/*` (search) | 2 min | Currency, Language, Query | Short TTL, SWR 5 min |
| `/blog/*` | 24 hours | Language | Long cache, ISR revalidate |
| `/api/*` | No cache | - | Always dynamic |
| `/account/*` | No cache | - | Private, authenticated |
| `/_next/static/*` | 1 year | - | Immutable, hashed filenames |

### Brotli Compression
- Enable Brotli at Akamai edge (br > gzip > identity)
- Verify with: `curl -H "Accept-Encoding: br" -I https://turna.com`
- Expected savings: ~15-25% over gzip for HTML/JS/CSS

## 2. Multi-Currency Architecture

### Currency Switch Flow
```
User changes currency → 
  1. Set cookie: `currency=USD; Path=/; SameSite=Lax; Max-Age=31536000`
  2. Update React state (Zustand/Context)
  3. Client-side: re-fetch prices from API with new currency
  4. CDN: new requests hit different cache variant
```

### Price Display Rules
- Always show currency symbol/code: `1,500 ₺` or `$85 USD`
- Round per currency: TRY → integer, USD/EUR → 2 decimals
- Exchange rate source: server-side, cached 15 min
- Never convert client-side — always fetch from pricing API
- Show "prices may vary" disclaimer on currency-converted prices

### `useLanguageAndCurrency` Hook
```typescript
// Pattern for the shared hook
function useLanguageAndCurrency() {
  const [currency, setCurrency] = useStore(state => state.currency);
  const [language, setLanguage] = useStore(state => state.language);

  const switchCurrency = useCallback((newCurrency: Currency) => {
    setCurrency(newCurrency);
    setCookie('currency', newCurrency, { maxAge: 31536000 });
    // Invalidate price-related queries
    queryClient.invalidateQueries({ queryKey: ['prices'] });
    queryClient.invalidateQueries({ queryKey: ['flights'] });
  }, []);

  return { currency, language, switchCurrency, switchLanguage };
}
```

## 3. Core Web Vitals Optimization

### LCP Targets (< 2.5s)
- Hero image: preload with `<link rel="preload" as="image">`
- Critical CSS: inline above-the-fold styles
- Font loading: `next/font` with `display: swap`
- Server response: target TTFB < 800ms (Akamai edge helps)
- Avoid client-side rendering for above-the-fold content

### INP Targets (< 200ms)
- Search form submission: use `startTransition` for non-urgent updates
- Filter changes: debounce by 150ms
- Move analytics scripts to Web Workers (Partytown)
- Use `@next/third-parties` for Google Analytics, GTM

### CLS Targets (< 0.1)
- Set explicit dimensions on ALL images and ads
- Reserve space for dynamic content (skeleton screens)
- Use `font-display: optional` for custom fonts (prevents layout shift)
- Avoid injecting content above existing content

### Third-Party Script Strategy
```typescript
// ✅ Proper script loading order
// 1. Critical (blocking): None — nothing blocks rendering
// 2. High priority (afterInteractive): GTM (needs to be early for data layer)
// 3. Low priority (lazyOnload): Chat widget, remarketing pixels
// 4. Web Worker (Partytown): Google Analytics, Meta Pixel, Hotjar

import { GoogleTagManager } from '@next/third-parties/google';

// In layout.tsx
<GoogleTagManager gtmId="GTM-XXXXX" />

// Meta Pixel — load via Partytown or lazyOnload
<Script
  src="https://connect.facebook.net/en_US/fbevents.js"
  strategy="lazyOnload"
/>
```

## 4. ISR/SSG Distributed Coordination

### Multi-Pod Revalidation
With 5+ Next.js pods on Kubernetes:
- Use Redis-based locking for ISR revalidation
- Only ONE pod regenerates a page at a time
- Other pods serve stale content during regeneration
- Custom cache handler coordinates via Redis pub/sub

```typescript
// Pattern: Redis-based ISR lock
async function revalidateWithLock(path: string) {
  const lockKey = `isr:lock:${path}`;
  const acquired = await redis.set(lockKey, '1', 'EX', 30, 'NX');

  if (!acquired) {
    // Another pod is already regenerating
    return;
  }

  try {
    await revalidatePath(path);
  } finally {
    await redis.del(lockKey);
  }
}
```

## 5. Redirect Proxy

### URL Migration Rules
- Lazy CMS lookup: check redirect rules on cache miss only
- Per-URL caching: cache redirect results for 24 hours
- 301 for permanent redirects (SEO), 302 for temporary
- Preserve query parameters in redirects
- Log redirect hits for cleanup analysis

## 6. Analytics & Tracking

### GA4 Custom Dimensions
- `search_type`: flight / hotel / car
- `currency`: active currency code
- `language`: active language
- `user_type`: guest / member / premium
- `booking_step`: search / select / passenger / payment / confirm

### GTM Data Layer
```javascript
// ✅ Standard data layer push
window.dataLayer.push({
  event: 'flight_search',
  search_origin: 'IST',
  search_destination: 'AYT',
  search_date: '2025-06-15',
  passengers: 2,
  currency: 'TRY',
});
```

## 7. Critical File Protection (Turna-Specific)

In addition to standard infrastructure files, these are Turna-critical:
- `useLanguageAndCurrency` hook — affects all pricing display
- Currency/language middleware — affects CDN cache keys
- Pricing API routes — financial accuracy critical
- Booking flow components — revenue-critical path
- Redirect rules/CMS — SEO impact
- Akamai/CDN configuration — affects all traffic
