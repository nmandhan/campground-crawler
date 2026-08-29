# Architecture Research: Discovery Search + Map View

**Domain:** Next.js 16 App Router dashboard, adding full-RIDB-catalog search and a map layer onto an existing read-mostly-with-a-gated-write-surface app
**Researched:** 2026-08-29
**Confidence:** MEDIUM-HIGH (grounded in the actual codebase for integration points; MEDIUM on RIDB's exact rate-limit number and `GEOJSON` field shape, which are WebSearch/training-data-sourced and should be spot-checked against a live RIDB response early in implementation)

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│ dashboard/app/discover/  (NEW route)                                 │
│                                                                        │
│  page.tsx (Server Component, shell)                                  │
│   - reads cookies() for `unlocked` (same pattern as app/page.tsx)    │
│   - renders <DiscoveryClient unlocked={unlocked} />                  │
│        ↓                                                              │
│  discovery-client.tsx ('use client', NEW — owns fetched result state)│
│   ├─ discovery-search.tsx  (filters: name / state / activity, paged) │
│   ├─ result-list.tsx       (cards + "Watch this" → existing form)    │
│   └─ map-view.tsx          (dynamic import, ssr:false, Leaflet)      │
│        ↕ same in-memory result array, ONE fetch feeds both views     │
├──────────────────────────────────────────────────────────────────────┤
│ dashboard/app/api/ridb/facilities/route.ts  (NEW Route Handler)      │
│  - gated by proxy.ts's existing `/api/ridb/:path*` matcher (free)    │
│  - zod-validates query params (q/state/activity/limit/offset)        │
│  - calls dashboard/lib/ridb-catalog.ts                               │
├──────────────────────────────────────────────────────────────────────┤
│ dashboard/lib/ridb-catalog.ts  (NEW — sibling to lib/ridb.ts)        │
│  - searchFacilities(): GET https://ridb.recreation.gov/api/v1/       │
│    facilities?query=&state=&activity=CAMPING&limit=&offset=          │
│  - fetch() with `next: { revalidate: 300..900 }` (Data Cache)        │
│  - reuses classifyFacility()-equivalent from lib/ridb.ts (same file, │
│    no src/↔dashboard/ boundary crossed — this is dashboard-internal) │
├──────────────────────────────────────────────────────────────────────┤
│ RIDB (ridb.recreation.gov/api/v1) — full catalog, ~50 req/min/key    │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|-------------------------|
| `dashboard/app/discover/page.tsx` | Server Component shell; auth-state read for gating "Watch this" | Mirrors `app/page.tsx`'s `cookies()` + `hasValidSession` pattern, no data fetching of its own |
| `dashboard/app/discover/discovery-client.tsx` | Owns the single source of truth for search results (list + map both read it) | 'use client', holds `facilities: DiscoveryFacility[]` state, fetches `/api/ridb/facilities`, passes down as props |
| `dashboard/app/discover/discovery-search.tsx` | Filter inputs (name/state/activity), pagination controls | 'use client', debounced (reuse `lib/debounce.ts`), mirrors `area-typeahead.tsx`'s sequence-guard pattern to avoid stale-response races |
| `dashboard/app/discover/result-list.tsx` | Renders result cards, "Watch this" CTA | 'use client' or server-rendered from client state; opens existing watch-create form pre-filled with `facilityId` |
| `dashboard/app/discover/map-view.tsx` | Renders markers for the same result set | 'use client', `next/dynamic(..., { ssr: false })`, react-leaflet, filters out facilities with missing/implausible coordinates |
| `dashboard/app/api/ridb/facilities/route.ts` | Server-only proxy so `RIDB_API_KEY` never reaches the browser; zod-validates and bounds query params | Same shape as `recareas/route.ts` / `preview/route.ts` — session check, param validation, delegate to lib |
| `dashboard/lib/ridb-catalog.ts` | Full-catalog RIDB query pattern: paginated facility search by name/state/activity, including coordinates | New module; NOT a mirror of `src/recreation-gov/client.ts` (poller has no equivalent — this is net-new dashboard-only capability) |

## Integration Points (explicit)

**Does discovery reuse `dashboard/lib/ridb.ts`'s `searchRecAreas`? No — it needs a materially different query.**

- `searchRecAreas()` hits `GET /recareas?query=` — RecArea (park/forest) name search only, capped to 50 fetched → 10 ranked results, **no coordinates, no facility-level data, no state/activity filter.** It exists purely to resolve a chip in the watch-creation typeahead to a `recAreaId`.
- `listAreaFacilities()` hits `GET /recareas/{id}/facilities` — scoped to **one already-known RecArea**, capped at 50 facilities, used only for preview-before-save. Neither function can page through the whole country or filter by state/activity.
- Full-catalog discovery ("search/browse by name/area/state," per PROJECT.md) needs `GET /facilities?query=&state=&activity=CAMPING&limit=&offset=` — RIDB's facility-level search, which supports state and activity filters and pagination that neither existing function exposes. **This is a new query pattern, not a reuse of existing functions**, though it can and should reuse the existing `classifyFacility`-style campground/reservable filtering logic already in `dashboard/lib/ridb.ts` (import it, don't re-duplicate a third time inside the same project — the project's "never import across src/↔dashboard/" rule is about the two top-level projects, not about reuse within `dashboard/lib/`).
- Area-scoped browsing inside discovery (a user narrowing to one RecArea) *can* reuse `listAreaFacilities()` as-is, since that's exactly what it does.

**Does a discovery search hit RIDB live per-request, or does it need caching?**

Needs caching. Two independent constraints justify it:
1. **RIDB's own rate limit** — commonly documented at ~50 requests/minute per API key (WebSearch-sourced, MEDIUM confidence — verify against a live 429 response early). Interactive search (debounced keystrokes, filter changes, pagination) can easily exceed that within a single session if every request goes live.
2. **Vercel's stateless/serverless model** — there is no long-lived in-process cache across invocations (unlike the poller's committed `state.json`). The project already has an established answer to this exact problem: `dashboard/lib/github.ts` uses Next.js's `fetch()` Data Cache (`next: { revalidate: 30 }`) to absorb repeat traffic to `raw.githubusercontent.com`, and `app/page.tsx` is deliberately written to avoid a route-level dynamic-rendering opt-out that would defeat it. Apply the same mechanism to `lib/ridb-catalog.ts`'s `fetch()` calls: `next: { revalidate: 300–900 }` (5–15 min — RIDB catalog data changes far less often than the poller's live availability, so a longer window than the existing 30s is appropriate and safe). This is a per-`fetch()`-call cache, independent of whether the *Route Handler* itself is dynamic — Route Handlers execute per-request regardless, but the underlying `fetch()` to RIDB still gets deduplicated/cached by Next's Data Cache keyed on URL+options, which directly reduces RIDB call volume for repeated/popular queries (e.g. multiple users — or the same user re-opening the page — searching "Yosemite" or state=CA within the cache window).

Do **not** add a second bespoke caching layer (e.g. a KV store) for this milestone — the fetch-level Data Cache is already the established, proven pattern in this codebase and is sufficient at single-user scale.

**Does map view depend on discovery search shipping first, or can they be built in parallel?**

Structurally coupled, but only at the data layer — not visually/component-wise:

- PROJECT.md scopes the map as "**layered onto** the discovery page," not a standalone route with its own search. That means the map is a second *rendering* of the exact same result set discovery search already fetched — it must NOT issue its own separate RIDB query pattern (that would double RIDB traffic against the same rate-limit budget for no reason, and risks the list and map disagreeing on results).
- Practically: `lib/ridb-catalog.ts` + the `/api/ridb/facilities` route (the data layer) must exist before either list or map can render real data, but the **map component itself** (Leaflet setup, marker rendering, coordinate-validity filtering, missing-coordinate fallback UI) can be built and tested in isolation against a mock/fixture array of `DiscoveryFacility[]` in parallel with `discovery-search.tsx`. Final integration — wiring the map to `discovery-client.tsx`'s live state — is the dependent step, and should happen after `discovery-client.tsx`'s fetch/state layer is stable, not before.

## Recommended Project Structure

```
dashboard/
├── app/
│   ├── discover/                        # NEW route
│   │   ├── page.tsx                     # Server Component shell (cookies() → unlocked)
│   │   ├── discovery-client.tsx         # 'use client' — owns fetched result state
│   │   ├── discovery-search.tsx         # 'use client' — filters, debounce, pagination
│   │   ├── result-list.tsx              # cards, "Watch this" CTA
│   │   └── map-view.tsx                 # 'use client' — Leaflet, dynamic-imported ssr:false
│   ├── api/
│   │   └── ridb/
│   │       ├── recareas/route.ts        # EXISTING — unchanged
│   │       ├── preview/route.ts         # EXISTING — unchanged
│   │       └── facilities/route.ts      # NEW — proxies lib/ridb-catalog.ts
│   ├── watches/
│   │   └── area-typeahead.tsx           # EXISTING — reference pattern only, not modified
│   └── page.tsx                         # EXISTING — reference pattern only, not modified
├── lib/
│   ├── ridb.ts                          # EXISTING — unchanged; discovery imports its
│   │                                     #   classifyFacility-equivalent, does not duplicate it
│   ├── ridb-catalog.ts                  # NEW — searchFacilities(): full-catalog RIDB query
│   ├── types.ts                         # MODIFIED — add DiscoveryFacility (incl. lat/lng)
│   └── debounce.ts                      # EXISTING — reused as-is by discovery-search.tsx
└── proxy.ts                             # MODIFIED (matcher already covers new route) —
                                          #   verify /api/ridb/facilities is caught by the
                                          #   existing '/api/ridb/:path*' matcher; no edit
                                          #   needed if the new route lives under that prefix
                                          #   (this is the point: don't need to touch proxy.ts)
```

### Structure Rationale

- **`app/discover/`, not `app/page.tsx`:** PROJECT.md calls it a "standalone discovery page," and it has an entirely different interaction model (open-ended search/browse vs. the landing page's fixed watch list) — a new route keeps it decoupled from the existing dashboard model/session-parsing logic in `page.tsx`.
- **New `lib/ridb-catalog.ts` instead of extending `lib/ridb.ts`:** `lib/ridb.ts`'s own file-header docstring scopes it tightly ("Read-only RIDB access for the dashboard's area typeahead... and campground preview" — feeding watch-creation, never persisted). Full-catalog browsing is a different concern (feeds a browse UI, never touches `watches.json` at all) and a different query shape (paginated, state/activity-filterable, coordinate-bearing). Keeping them separate avoids overloading one file's contract while still allowing `ridb-catalog.ts` to `import` the classification helper from `ridb.ts` rather than tripling the hand-copied logic.
- **New route under `app/api/ridb/`, not `app/api/discover/`:** `proxy.ts`'s matcher is `['/api/watches/:path*', '/api/ridb/:path*']`. Placing the new route under the existing `/api/ridb/` prefix means it is gated automatically with zero changes to `proxy.ts` — this directly avoids repeating the exact class of bug the Phase 5 tech-debt list already flags ("the auth gate... is an inclusion allowlist with no automated check tying new routes to protection"). Do not create a new top-level `/api/discover/*` prefix; it would require a `proxy.ts` matcher edit and reintroduce that exact risk.
- **`discovery-client.tsx` as the single state owner:** both the list and the map need the *same* result set. Fetching independently in two components would double RIDB call volume against the shared rate-limit budget and risk the two views disagreeing. One parent owns the fetch; list and map are pure display children.

## Architectural Patterns

### Pattern 1: Server-only RIDB proxy, gated by the existing prefix matcher

**What:** Every RIDB call originates server-side (`import 'server-only'`), behind a Route Handler under `/api/ridb/*`, which `proxy.ts` already protects. `RIDB_API_KEY` never reaches the client bundle.
**When to use:** Any new RIDB query pattern added this milestone.
**Trade-offs:** Gating discovery means it's not publicly browsable without unlocking the session — consistent with the existing posture ("any anonymous visitor a free RIDB proxy backed by this project's API key" is explicitly treated as a threat in `preview/route.ts`'s own comments), but is a product decision worth confirming: PROJECT.md doesn't say whether discovery should be public. Recommend keeping it gated by default, consistent with every other RIDB-touching route today, and revisiting only if the user explicitly wants discovery to be publicly browsable like the landing page.

**Example:**
```typescript
// dashboard/app/api/ridb/facilities/route.ts
import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE, hasValidSession } from '@/lib/session';
import { searchFacilities } from '@/lib/ridb-catalog';

const QuerySchema = z.object({
  q: z.string().max(100).optional(),
  state: z.string().length(2).optional(),
  activity: z.literal('CAMPING').default('CAMPING'),
  limit: z.coerce.number().int().min(1).max(50).default(20), // RIDB's documented per-page max
  offset: z.coerce.number().int().min(0).max(2000).default(0), // DoS guard, mirrors T-05-10 precedent
});

export async function GET(request: Request) {
  const store = await cookies();
  if (!hasValidSession(store.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Malformed query' }, { status: 400 });

  const result = await searchFacilities(parsed.data);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true, facilities: result.facilities });
}
```

### Pattern 2: Cache the outbound RIDB fetch itself, not a bespoke store

**What:** Use Next.js's per-`fetch()` Data Cache (`next: { revalidate: N }`) inside `lib/ridb-catalog.ts`, exactly like `lib/github.ts` already does for the GitHub raw-file reads.
**When to use:** Every RIDB call from the discovery path.
**Trade-offs:** Simple, zero new infra, matches an established codebase convention reviewers already understand. Downside: cache is keyed on the exact URL, so highly-specific queries (long-tail name searches) still hit RIDB live most of the time — acceptable, since the goal is protecting the 50 req/min budget from *repeat* traffic (re-renders, popular state browses), not eliminating live calls entirely.

**Example:**
```typescript
// dashboard/lib/ridb-catalog.ts
const res = await fetch(url.toString(), {
  headers: { apikey: process.env.RIDB_API_KEY ?? '' },
  next: { revalidate: 600 }, // 10 min — catalog metadata changes far less than live availability
});
```

### Pattern 3: Client owns fetch state, map/list are pure children (no duplicate RIDB calls)

**What:** `discovery-client.tsx` performs the one fetch to `/api/ridb/facilities` per search action; `result-list.tsx` and `map-view.tsx` both receive the same `facilities` array as props and never fetch independently.
**When to use:** Any UI that renders the same backend result set two different ways (here: list + map).
**Trade-offs:** Slightly more prop-drilling than letting each component fetch its own data, but it's the only way to keep RIDB call volume from doubling for no functional benefit, and it guarantees list/map never disagree.

## Data Flow

### Discovery search request flow

```
User types query / picks state+activity / clicks "next page"
    ↓ (debounced, sequence-guarded — mirrors area-typeahead.tsx's threat T-05-25 fix)
discovery-search.tsx → fetch('/api/ridb/facilities?...')
    ↓
proxy.ts (session check, no code change needed — inherits '/api/ridb/:path*')
    ↓
app/api/ridb/facilities/route.ts (session re-check + zod param validation)
    ↓
lib/ridb-catalog.ts:searchFacilities() → fetch(RIDB, { next: { revalidate: 600 } })
    ↓                                          ↓ (Data Cache hit on repeat queries)
RIDB /facilities (live only on cache miss)
    ↓
zod-parsed DiscoveryFacility[] ← classifyFacility (reused from lib/ridb.ts)
    ↓
Route Handler JSON response
    ↓
discovery-client.tsx state update
    ↓                              ↓
result-list.tsx (renders)      map-view.tsx (filters facilities with missing/
                                implausible coords, renders markers for the rest)
```

### "Watch this" flow (discovery → existing write path, not reinvented)

```
User clicks "Watch this" on a discovery result
    ↓
Opens the EXISTING watch-create form (from watch-manager.tsx / Phase 5's write path),
pre-filled with { facilityId, facilityName } from the discovery result
    ↓
User fills in the still-required fields the discovery result can't supply
(date range, site type — a raw RIDB facility has neither)
    ↓
Existing POST /api/watches (gated, unchanged) — no new write path needed
```

This deliberately reuses Phase 5's watch-creation Route Handler and validation rather than building a second, parallel "create a watch" code path — a raw discovery result is missing the date-range/site-type fields a watch requires, so "Watch this" realistically means "open the existing form, pre-filled," not a true one-click blind create.

## Scaling Considerations

At this project's scale (single user), the relevant axis isn't user count, it's **RIDB request volume per session** against the ~50 req/min shared budget:

| Load | Architecture Adjustments |
|------|---------------------------|
| Single user, occasional discovery searches | Data Cache alone (Pattern 2) is sufficient; no further work needed |
| Single user, rapid filter/pagination churn in one session | Debounce (already the codebase convention) + sequence-guard against stale responses; cache absorbs repeat queries within the revalidate window |
| Map rendering many results at once | Reuse the same fetched result set for markers — do NOT add a per-facility hydration/geocoding call; if `GEOJSON` coordinates prove too sparse in practice, that's a data-quality gap to surface in the UI ("N results have no location data"), not a reason to add more RIDB calls |
| If this ever became multi-user | Out of scope per PROJECT.md's constraints (single-user, no auth system) — not a near-term concern, but worth noting the current gate (shared session cookie) would not scale to genuinely concurrent independent users hammering RIDB from one shared API key |

### Scaling priorities

1. **First (and really only) bottleneck at this scale:** RIDB's request budget being burned by an ungated or uncached discovery page. Both mitigations (gate under the existing `/api/ridb/*` matcher, cache the outbound fetch) are cheap and should ship with the very first version of discovery search, not retrofitted later.
2. **Second-order concern:** map rendering with hundreds of markers if a state-wide browse returns a large result set — mitigate with RIDB's own pagination (`limit`/`offset`) rather than fetching everything into memory at once; don't over-build clustering/virtualization for this milestone unless a live test shows it's actually needed.

## Anti-Patterns

### Anti-Pattern 1: Giving discovery its own RIDB query path that duplicates `searchRecAreas`/`listAreaFacilities`'s classification logic a third time

**What people do:** Copy-paste `classifyFacility` again into a new discovery-specific module because it "only needs a couple of fields."
**Why it's wrong:** The project already accepts one instance of hand-duplication (poller ↔ dashboard, across the `src/`↔`dashboard/` boundary, documented and intentional). A third copy *within* `dashboard/` for no cross-project reason is unforced drift risk — if RIDB's `FacilityTypeDescription`/`Reservable` semantics ever need a fix, someone has to remember three places.
**Instead:** Export the classification helper from `lib/ridb.ts` and import it into `lib/ridb-catalog.ts`. Reuse *within* one project is fine and encouraged; only the `src/`↔`dashboard/` boundary is the hard rule.

### Anti-Pattern 2: Letting the map view issue its own RIDB fetch, separate from the list

**What people do:** Build `map-view.tsx` as a self-contained component that fetches `/api/ridb/facilities` itself, because it's "layered onto" the page and easiest to build in isolation.
**Why it's wrong:** Doubles RIDB call volume against the shared budget for the exact same data, and risks the list and map silently showing different result sets if one request succeeds and the other doesn't (e.g. a cache-miss race).
**Instead:** Lift the fetch to `discovery-client.tsx`; both list and map are pure props-driven children of the same state.

### Anti-Pattern 3: Rendering markers for every returned facility without validating coordinates

**What people do:** Trust `GEOJSON.COORDINATES` (or `FacilityLatitude`/`FacilityLongitude`) at face value and plot every result.
**Why it's wrong:** PROJECT.md explicitly flags RIDB's lat/long as "inconsistently populated" — in practice this means missing fields, `0,0` (null-island) placeholders, and occasionally swapped lat/lng. Plotting these naively either crashes the map component or silently mis-places pins in the ocean.
**Instead:** Validate coordinates exist and fall within plausible US bounds before rendering a marker; facilities that fail the check still appear in the list, just not on the map, with the gap surfaced rather than hidden (e.g. "N results shown, M without map location").

### Anti-Pattern 4: A route-level `dynamic = 'force-dynamic'` or `cache: 'no-store'` on the discovery fetch

**What people do:** Reflexively opt a new Route Handler out of caching "to make sure results are fresh," following instinct rather than the codebase's own established convention.
**Why it's wrong:** `app/page.tsx`'s own comments explicitly call this out as the thing to avoid for the GitHub raw-file fetches, for exactly this reason: it defeats the Data Cache window that's the whole point of Pattern 2, and here it would mean every discovery keystroke/pagination click hits RIDB live, burning the 50 req/min budget far faster than needed for data that doesn't change minute-to-minute.
**Instead:** Let `next: { revalidate: 600 }` on the RIDB `fetch()` do the work; don't add a dynamic/no-store override on top of it.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|----------------------|-------|
| RIDB `/facilities` (new query pattern) | Server-only `fetch()` from `lib/ridb-catalog.ts`, `next: { revalidate: 600-900 }`, behind `/api/ridb/facilities` | ~50 req/min per key (MEDIUM confidence, WebSearch-sourced — verify with a live 429 during implementation); RIDB's own per-page max is 50 (already established fact in `lib/ridb.ts`'s comments) |
| RIDB coordinate data (`GEOJSON` or `FacilityLatitude`/`FacilityLongitude`) | Consumed from the same `/facilities` response, no extra per-facility call | MEDIUM confidence on exact field shape (training-data-sourced) — confirm against one live response early; known to be inconsistently populated per PROJECT.md, so treat as optional/untrusted |
| Map tile provider (NEW dependency — nothing installed yet) | `react-leaflet` + `leaflet`, OpenStreetMap tiles | Recommended over MapLibre GL / Mapbox: no API key required (keeps the "no new paid infra" posture consistent with the rest of the project), lighter weight, sufficient for point markers. Must be dynamically imported with `{ ssr: false }` — Leaflet touches `window` at import time and will break server rendering otherwise. Needs `leaflet/dist/leaflet.css` imported once. **Not yet in `dashboard/package.json`** — `npm install leaflet react-leaflet` (plus `@types/leaflet` as a dev dependency) is a prerequisite step. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|----------------|-------|
| `dashboard/lib/ridb.ts` ↔ `dashboard/lib/ridb-catalog.ts` | Direct import (same project, no restriction) | Reuse classification logic; keep the two files' *concerns* separate (watch-creation preview vs. full-catalog browse) even while sharing helpers |
| `dashboard/app/discover/*` ↔ `dashboard/app/watches/*` (existing watch-create form) | "Watch this" opens/pre-fills the existing form component rather than a new one | Avoids a second, drifting watch-creation code path; the existing gated `POST /api/watches` stays the single write path |
| `dashboard/` ↔ `src/` | **Unchanged — still never import across this boundary.** Discovery/map is entirely a dashboard-side, read-only-against-RIDB feature; the poller has no equivalent capability and doesn't need one (it only ever resolves the user's configured watches, never browses the full catalog) | No new coupling introduced by this milestone |
| `proxy.ts` ↔ new `/api/ridb/facilities` route | Automatic — route lives under the already-matched `/api/ridb/:path*` prefix | Deliberately chosen so this milestone doesn't need to touch `proxy.ts` at all, sidestepping the exact "route not covered by the allowlist" risk already logged as Phase 5 tech debt |

## Suggested Build Order

1. **`lib/ridb-catalog.ts` + `app/api/ridb/facilities/route.ts`** (data layer first, no UI). Verify live against RIDB: confirm the `/facilities` query/state/activity params behave as expected, confirm the actual shape/reliability of coordinate fields (resolves the two MEDIUM-confidence items above), confirm the Data Cache actually reduces live RIDB calls on repeat queries. This de-risks everything downstream and has no dependency on any other new-milestone work.
2. **`discovery-client.tsx` + `discovery-search.tsx` + `result-list.tsx`** (discovery search, no map yet). Depends on step 1. Wire "Watch this" into the existing watch-create form here — this validates the write-path integration early, independent of the map.
3. **`map-view.tsx`** — can be *built* in isolation/parallel with step 2 (Leaflet setup, marker rendering, coordinate-validity filtering, missing-data fallback UI, all testable against a fixture array), but final *integration* into `discovery-client.tsx`'s live state is a dependent step that should land after step 2 is stable, since the map has no independent data-fetching role per PROJECT.md's "layered onto the discovery page" framing. Install `leaflet`/`react-leaflet` as part of this step, not step 1 or 2.
4. **Visual redesign** last, once discovery search and map are functionally working end to end. Restyling before the new screens exist means restyling twice; sequencing it last lets the redesign cover the landing page, discovery page, and map in one consistent pass instead of two.

Phase 5 tech-debt cleanup (facilityId preservation, area-watch cap consistency, zod on `getWatchesFile()`, typeahead race, `previewAreas()` parallelization, auth-gate coverage check, `requireSession()` dedup) is orthogonal to this feature work and can land independently, in any order relative to steps 1-4 — none of those items are on the discovery/map critical path, though the "auth-gate route coverage check" item is worth doing *before* step 1 if feasible, since it would automatically catch it if the new `/api/ridb/facilities` route were ever accidentally placed outside the gated prefix.

## Sources

- Codebase (HIGH confidence, direct read): `dashboard/lib/ridb.ts`, `dashboard/app/api/ridb/recareas/route.ts`, `dashboard/app/api/ridb/preview/route.ts`, `dashboard/app/watches/area-typeahead.tsx`, `dashboard/app/page.tsx`, `dashboard/proxy.ts`, `dashboard/package.json`, `src/recreation-gov/client.ts`, `.planning/PROJECT.md`
- Prior milestone research (HIGH confidence, same repo): `.planning/milestones/v1.1-research/ARCHITECTURE.md`, `.planning/milestones/v1.1-research/STACK.md` — established the project's existing RIDB-politeness norms (~1 req/sec on the undocumented availability endpoint, distinct from RIDB itself) and the precedent that RIDB's own `/facilities`-family endpoints are not the same rate-limited resource as the availability endpoint
- RIDB rate limit (~50 req/min per key) — MEDIUM confidence, WebSearch-sourced only; not independently corroborated against RIDB's own official documentation in this research pass. **Recommend verifying with a live request during Step 1 of implementation** (RIDB typically returns HTTP 429 with rate-limit headers when exceeded).
- RIDB `GEOJSON`/coordinate field shape on `/facilities` responses — MEDIUM confidence, training-data-sourced. **Recommend confirming against one live response during Step 1**, since this directly affects the map's coordinate-validation logic.

---
*Architecture research for: Campground Crawler discovery search + map view (v1.2 milestone)*
*Researched: 2026-08-29*
