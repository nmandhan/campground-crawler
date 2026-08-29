# Project Research Summary

**Project:** Campground Crawler — v1.2 "Discovery & Polish" milestone
**Domain:** Additions to an existing single-user Next.js 16 App Router dashboard: full-catalog discovery/search, a map view, and a visual redesign
**Researched:** 2026-08-29
**Confidence:** MEDIUM-HIGH

## Executive Summary

This milestone adds three tightly-coupled surfaces to an already-shipped, single-user Recreation.gov watcher dashboard: a standalone discovery/search page over RIDB's full campground catalog, a map layered onto that page showing both search results and the user's active watches, and a genuine visual redesign of the existing hand-rolled CSS design system. All four research passes agree this is buildable with exactly one new runtime dependency (a map library) — the discovery search and redesign work reuse patterns (debounce, RIDB client conventions, CSS custom-property tokens) already proven in Phases 3-5 of this codebase. The map is the one place where research materially diverged, and that had to be resolved rather than left ambiguous — see below.

The dominant risk across all four research files is not "can this be built" but "will it stay within the shared RIDB request budget and the existing auth boundary once a bounded, authenticated feature (the watch-creation typeahead) becomes an open-ended, potentially-public, full-catalog browse experience." Every research pass converges on the same two structural safeguards: (1) cache RIDB metadata calls via Next.js's per-`fetch()` Data Cache and add an explicit request-budget guard rather than trusting caller discipline, and (2) treat every new RIDB-key-bearing route as gated-by-default under the existing `proxy.ts` matcher, verified in the same commit that adds it. A secondary, RIDB-data-quality risk (facilities with missing, zero, or out-of-range lat/long) is well-understood and has a known, cheap mitigation (validate coordinates before plotting, never drop bad-coordinate facilities from the list, only from the map).

The recommended approach: build the RIDB data layer (`lib/ridb-catalog.ts` + `/api/ridb/facilities`, cached and budgeted) first and validate its rate-limit/coordinate assumptions against a live response immediately, then discovery search UI, then the map (buildable in parallel against fixtures but integrated only after search is stable), then the visual redesign last so it covers all new and existing surfaces in one consistent pass instead of two.

## Key Findings

### Recommended Stack

The dashboard currently has exactly 5 runtime dependencies and a deliberate "zero non-essential dependencies" posture spanning two prior milestones. This milestone adds exactly one: a map-rendering library. Everything else (discovery search, redesign) is achievable by extending code/patterns that already exist (`lib/debounce.ts`, `lib/ridb.ts`, `globals.css`'s token system) with no new packages.

**Core technologies:**
- `maplibre-gl@^6.6.0` (WebGL vector-tile map renderer) — the map's rendering engine, no API key, no vendor lock-in, ships its own TypeScript types
- OpenFreeMap tiles (`https://tiles.openfreemap.org/styles/liberty`) — free, no-signup vector tile source, avoids adding another API key to the project's env-var surface
- `next/font` (already bundled with Next.js) — optional webfont for the redesign, zero new dependency
- Continue hand-rolled CSS custom properties in `dashboard/app/globals.css`, extended (not replaced) with elevation/shadow, richer color ramp, and motion tokens

**Map library decision — resolved:** STACK.md and ARCHITECTURE.md disagreed (MapLibre GL vs. Leaflet/react-leaflet); FEATURES.md treated both as open options. **Recommendation: MapLibre GL (raw `maplibre-gl`, no `react-map-gl` wrapper), not Leaflet.** Rationale, weighing both concerns explicitly:
  - The milestone's stated bar is "genuinely polished, beautiful" — not just functional. MapLibre's GPU-rendered vector tiles look materially more modern than Leaflet's raster-tile-plus-DOM-marker rendering, which is the single most visible surface of the redesign goal (a map is the largest new UI element this milestone adds). This is the deciding factor.
  - MapLibre also has clustering built in (`GeoJSONSource` with `cluster: true`, bundled supercluster) — a near-certain requirement once full-catalog search returns dense regional results (Yosemite/Sequoia-style clusters), called out as a P2 differentiator in FEATURES.md. Leaflet needs a separate plugin for the same feature — that's a second dependency, working against the project's stated dependency discipline, not in favor of it.
  - The integration-risk argument for Leaflet (documented `next/dynamic({ ssr: false })` SSR-hydration precedent) does not actually hold up: MapLibre's `Map` constructor is only invoked inside a `useEffect`, exactly like `area-typeahead.tsx` already isolates browser-only work, so it needs no `ssr:false` workaround at all — if anything this is simpler than the Leaflet pattern, not riskier.
  - Concretely: use raw `maplibre-gl` (not `react-map-gl`) in a ~40-line hand-rolled `<Map>` client component, following the same imperative `useRef`/`useEffect` pattern the codebase already uses for the typeahead. This keeps the new-dependency count at exactly one.
  - ARCHITECTURE.md's react-leaflet recommendation and Route Handler/data-flow diagrams remain valid as written except for this one substitution — swap `leaflet`/`react-leaflet`/`next/dynamic({ssr:false})` references for `maplibre-gl` with in-effect initialization; nothing else in the architecture changes.

### Expected Features

**Must have (table stakes, v1.2 launch scope):**
- Full-catalog text/name search over RIDB facilities (not just watched campgrounds)
- Filter by state/region and site type
- Availability shown at a glance per result — must be on-demand/paginated, never eager-loaded per result, to protect the shared RIDB budget
- "Watch this" action from a search result, pre-filling the existing watch-creation form
- Graceful handling of facilities with no reservable sites or missing data
- Map view layering search results + active watches, distinguishable, with graceful bad-coordinate handling
- Responsive/mobile-usable layout
- Visually coherent design system extension (not a framework swap)

**Should have (differentiators):**
- Map showing both search results and active watches with distinct pin styling — unique to a personal tool that already has a watch list
- Compact availability-at-a-glance indicator (sparkline/strip) beyond a binary badge
- "Watch this" pre-fills date range/site type from search filters
- Clustering for dense regions (P2 — add once real usage shows it's needed, MapLibre has this built in)

**Defer (v2+ / explicit anti-features):**
- Campsite reviews, hiking trails (both already deferred in PROJECT.md, blocked on data-source research)
- Eager-loading availability for every visible result (rate-limit risk)
- User accounts / saved searches / social sharing (contradicts single-user constraint)
- Full commercial mapping stack (Mapbox paid tiers, 3D terrain, offline maps)
- Booking/checkout integration
- Real-time/WebSocket live-updating search (duplicates the poller's existing 5-min cron infra)
- Drive-time-based search (needs a geocoding/routing dependency not yet in the project)

### Architecture Approach

New route `dashboard/app/discover/` (Server Component shell + client-state-owning `discovery-client.tsx`) composes a new data layer (`dashboard/lib/ridb-catalog.ts` + `dashboard/app/api/ridb/facilities/route.ts`) that is a *materially new* RIDB query pattern (full-catalog `/facilities?query=&state=&activity=&limit=&offset=`), not a reuse of the existing bounded `searchRecAreas`/`listAreaFacilities` functions — though it should import and reuse the existing `classifyFacility`-equivalent logic rather than triple-duplicating it. The route lives under the already-gated `/api/ridb/:path*` prefix so `proxy.ts` needs no changes. Both the result list and the map render from one client-owned fetch/state, never issuing independent RIDB calls, to avoid doubling request volume and avoid the list/map disagreeing.

**Major components:**
1. `dashboard/app/discover/page.tsx` + `discovery-client.tsx` — Server shell + client state owner for search results, feeding both list and map
2. `dashboard/lib/ridb-catalog.ts` + `app/api/ridb/facilities/route.ts` — new, cached (`next: { revalidate: 600-900 }`), zod-validated, session-gated full-catalog RIDB query layer
3. `dashboard/app/discover/map-view.tsx` — MapLibre client component (in-effect init, no `ssr:false` needed), consumes the same result array, filters/flags invalid coordinates before plotting
4. `dashboard/app/discover/result-list.tsx` — result cards + "Watch this" CTA, opens the existing Phase-5 watch-creation form pre-filled, no new write path
5. Redesign — extends `globals.css` tokens (elevation, richer color ramp, motion, radius scale) across landing, discovery, and map screens in one pass, done last

### Critical Pitfalls

1. **Discovery search fans out into far more RIDB calls than the bounded typeahead ever did, blowing the shared ~50 req/min budget.** Avoid by building a request-budget guard (token-bucket/min-interval) and aggressive `fetch()`-level caching *before or alongside* the discovery page ships, not after — and never eager-fetch per-row live availability for a full result list.
2. **Map renders crash or silently mis-plot pins on RIDB's known-bad lat/long data** (missing, `0,0` null-island, swapped, out-of-range). Avoid with a first-class coordinate-validation step before any facility reaches the map; excluded facilities stay in the list, labeled "location unavailable," never silently dropped from search results.
3. **The redesign quietly breaks the design-token contract or the auth allowlist.** A broad "make it pretty" pass gets reviewed on visual diff alone, missing new inline hex/px values that bypass `globals.css` tokens, and missing new API routes that read `RIDB_API_KEY` but aren't covered by `proxy.ts`'s matcher. Avoid by treating token extension as a deliberate up-front decision and adding an automated route-coverage check (already flagged as Phase 5 tech debt) before or during this milestone's new routes.
4. **Caching feels "already solved" from the 3-file dashboard pattern but degenerates for a full-catalog search's effectively unbounded query-key space.** Long-tail free-text searches will mostly miss cache regardless of `revalidate` tuning — the request-budget guard (not caching alone) is what actually bounds RIDB load; solve with conservative windows + request budgeting, not a new KV/Redis dependency (would violate the dependency-discipline constraint).
5. **Full-catalog scale multiplies the blast radius of the already-documented `classifyFacility` duplication** between poller (`src/`) and dashboard (`dashboard/lib/ridb.ts`). What was an acceptable risk at typeahead scale (a handful of facilities/session) becomes far more dangerous run across thousands of records on every public search. Add a drift-detection test (golden-file diff between the two copies) or an explicit, documented divergence — do not add a third copy.

## Implications for Roadmap

Based on combined research, suggested phase structure:

### Phase 1: RIDB Discovery Data Layer (budgeted + cached)
**Rationale:** Every other surface (search UI, map, availability-at-a-glance) depends on this layer's shape and its rate-limit/coordinate assumptions. Building it first, validated against a live RIDB response, de-risks everything downstream and resolves the two MEDIUM-confidence unknowns (exact rate limit, exact coordinate field shape) early rather than discovering them mid-integration.
**Delivers:** `dashboard/lib/ridb-catalog.ts` (`searchFacilities()`), `dashboard/app/api/ridb/facilities/route.ts` (session-gated, zod-validated, under the existing `/api/ridb/:path*` matcher — no `proxy.ts` change needed), a request-budget guard shared across all RIDB call sites, `next: { revalidate: 600-900 }` caching, and a coordinate-validation utility with fixture-based tests (missing/zero/out-of-range).
**Addresses:** Full-catalog search capability underlying all of FEATURES.md's P1 items.
**Avoids:** Pitfall 1 (RIDB budget exhaustion), Pitfall 4 (caching-isn't-free-at-scale), and lays groundwork for Pitfall 2 (bad coordinates) and Pitfall 5 (classification drift — decide reuse-vs-diverge here, before wiring UI to it).

### Phase 2: Discovery Search UI + "Watch This"
**Rationale:** Depends on Phase 1's data layer. Validates the write-path integration (pre-filled existing watch-creation form) early and independently of the map, which is the higher-risk/higher-effort surface.
**Delivers:** `dashboard/app/discover/page.tsx`, `discovery-client.tsx` (single fetch/state owner), `discovery-search.tsx` (debounced via existing `lib/debounce.ts`, sequence-guarded), `result-list.tsx` with "Watch this" opening the existing gated `POST /api/watches` form pre-filled.
**Uses:** Existing `lib/debounce.ts`, existing watch-creation write path (Phase 5), Phase 1's data layer.
**Implements:** ARCHITECTURE.md's "client owns fetch state, children are pure props" pattern.

### Phase 3: Map View (MapLibre GL)
**Rationale:** Can be *built* in isolation against fixture data in parallel with Phase 2, but final integration into `discovery-client.tsx`'s live state is a dependent step and should land after Phase 2 is stable, since the map has no independent data-fetching role — it's explicitly "layered onto" the same result set, never a second RIDB query path.
**Delivers:** `dashboard/app/discover/map-view.tsx` — MapLibre GL (`maplibre-gl@^6.6.0`, OpenFreeMap tiles), in-effect initialization (no `ssr:false` needed), markers for both search results and active watches with distinct styling, coordinate-validity filtering with "N results have no location data" surfaced in the UI, cluster layer enabled from day one (built in, low marginal cost).
**Implements:** The one new dependency this milestone adds; ARCHITECTURE.md's map-view component contract with the maplibre-gl substitution noted above.
**Avoids:** Pitfall 2 (bad-coordinate crashes/mis-plots) — must be handled in this phase's first version, not deferred.

### Phase 4: Visual Redesign
**Rationale:** Sequenced last so it covers the landing page, discovery page, and map in one consistent pass instead of restyling discovery/map twice (once ad hoc during construction, once during redesign).
**Delivers:** Extended `globals.css` tokens (elevation/shadow, richer color ramp beyond today's 2 status + 1 accent + 1 destructive, motion/transition, border-radius scale), applied across all screens; optional `next/font` webfont; no component library, no Tailwind, no icon package (inline SVG only if needed).
**Addresses:** FEATURES.md's explicit "visually coherent design system" table-stakes item and the milestone's stated "genuinely polished, beautiful" bar.
**Avoids:** Pitfall 3 (token drift, auth-matcher regression) — checklist "any new route this phase? matcher updated?" as part of PR review even though this phase is nominally CSS-only, since redesign PRs are exactly where route-coverage regressions slip through unnoticed.

### Phase Ordering Rationale

- Data layer before UI: the map and search UI are both consumers of the same request-budget/caching/coordinate-validation decisions — building those decisions into the foundation avoids a "ship fragile, harden later" gap the pitfalls research explicitly warns against (Pitfall 1 and 4 are described as "two sides of the same problem," addressed in the same phase).
- Search before map integration: reduces the blast radius of "Watch this" write-path bugs to a smaller surface first; the map's *construction* can still happen in parallel to avoid serializing all work.
- Redesign last: architecture research explicitly flags that building new UI against provisional styling and reworking it during redesign is more expensive than sequencing redesign after the new surfaces exist.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (RIDB Discovery Data Layer):** Needs live verification of RIDB's actual rate-limit behavior (research only has a MEDIUM-confidence ~50 req/min figure from WebSearch, not corroborated against official docs) and the actual `GEOJSON`/lat-long field shape on `/facilities` responses (also MEDIUM-confidence, training-data-sourced). Confirm both against a real RIDB response before finalizing the caching/budgeting design.
- **Phase 3 (Map View):** MapLibre + OpenFreeMap integration specifics (exact clustering config, style URL stability, CSS import location) are corroborated by only 1-2 sources each (MEDIUM confidence per STACK.md) — worth a quick implementation-time check of OpenFreeMap's current terms/uptime before committing, with MapTiler's free tier as the documented fallback if it proves unreliable.

Phases with standard patterns (skip research-phase):
- **Phase 2 (Discovery Search UI):** Directly extends already-proven, in-repo patterns (`lib/debounce.ts`, the typeahead's sequence-guard, the existing watch-creation write path) — HIGH confidence, ground-truthed against the actual codebase.
- **Phase 4 (Visual Redesign):** Extending an existing, documented CSS token system with no new libraries — HIGH confidence, low integration risk.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH (dependency choice) / MEDIUM (OpenFreeMap reliability, verified against only 1-2 sources) | Map library decision itself is well-reasoned against the milestone's explicit "polish" goal; the tile-source choice is the one soft spot |
| Features | MEDIUM | Competitor UX patterns cross-verified across 3+ sources; RIDB data-shape limitations verified against this project's own PROJECT.md notes, which is a strong internal source |
| Architecture | MEDIUM-HIGH | Integration points grounded directly in the actual codebase (HIGH); RIDB's exact rate-limit number and `GEOJSON` field shape are WebSearch/training-data-sourced (MEDIUM) and need a live spot-check early in Phase 1 |
| Pitfalls | HIGH | Grounded directly in this repo's existing code (`lib/ridb.ts`, `lib/github.ts`, `proxy.ts`, `globals.css`) — the risk analysis is not speculative, it traces to documented tradeoffs already in the codebase |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Map library reconciliation:** Two of the four research passes initially disagreed (MapLibre GL vs. Leaflet/react-leaflet). Resolved above in favor of MapLibre GL, weighing the "genuinely polished, beautiful UI" goal and built-in clustering against Leaflet's (overstated, in this case) integration-risk advantage. Treat this as decided going into roadmap creation, not open.
- **RIDB rate limit and coordinate field shape (~50 req/min, `GEOJSON` shape):** MEDIUM confidence, not verified against live RIDB responses in this research pass. Must be confirmed during Phase 1 implementation — this directly affects the request-budget guard's exact thresholds and the coordinate-validation function's field-name assumptions.
- **Discovery page auth gating — open product decision, not resolved by research:** ARCHITECTURE.md recommends gating the entire `/discover` page behind the same shared-secret session cookie as the rest of the write path (consistent with every other RIDB-touching route today, and explicitly protects the shared RIDB rate-limit budget from anonymous/public traffic). This is flagged as unsettled in PROJECT.md and is a product call, not something research can resolve unilaterally — **surface this explicitly for the user's decision during roadmap/requirements work, do not silently default it.** If left public (matching the existing "reads stay public" posture for the landing page), the request-budget guard in Phase 1 becomes materially more important, since it would then need to defend against genuinely anonymous traffic rather than just a single authenticated user's session.
- **OpenFreeMap tile-source durability:** No SLA, single-vendor free service; MapTiler's free tier (100k loads/mo, API key required) is the documented fallback if reliability issues surface post-launch — worth a quick uptime/terms check before Phase 3, not a blocker to starting.
- **Classification-logic reuse-vs-diverge decision (Pitfall 5):** Not resolved by research — needs an explicit choice during Phase 1 planning: add a drift-detection test between the poller's and dashboard's `classifyFacility` copies, or deliberately diverge (e.g., discovery shows non-reservable facilities as "browse only" instead of excluding them) and document it. Either is acceptable; silently doing neither is not.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `dashboard/lib/ridb.ts`, `dashboard/lib/github.ts`, `dashboard/proxy.ts`, `dashboard/app/globals.css`, `dashboard/lib/debounce.ts`, `dashboard/app/watches/area-typeahead.tsx`, `dashboard/app/page.tsx`, `dashboard/package.json`, `src/recreation-gov/client.ts`, `.planning/PROJECT.md`
- npm registry live version checks (`maplibre-gl@6.6.0`, `react-map-gl@8.1.2`, `leaflet@1.9.4`, `react-leaflet@5.0.0`) — 2026-08-29
- MapLibre GL JS official docs — https://maplibre.org/maplibre-gl-js/docs/, https://maplibre.org/projects/gl-js/

### Secondary (MEDIUM confidence)
- OpenFreeMap Quick Start Guide — https://openfreemap.org/quick_start/ — no-API-key, free vector tile hosting claim, corroborated by one GitHub discussion (https://github.com/maplibre/maplibre-gl-js/discussions/4736)
- RIDB ~50 req/min rate limit and `GEOJSON` field shape — WebSearch/training-data-sourced, not independently corroborated against RIDB's own official documentation; flagged for live verification in Phase 1
- The Dyrt, Campflare, Recreation.gov competitor feature/UX analysis — https://www.parkedinparadise.com/dyrt-pro-review/, https://thedyrt.com/magazine/gear/new-pro-maps-are-here-just-in-time-for-summer/, https://campflare.com/, https://www.recreation.gov/search, https://campnab.com/
- MapLibre GL JS vs. Leaflet comparison (general framing only) — https://blog.jawg.io/maplibre-gl-vs-leaflet-choosing-the-right-tool-for-your-interactive-map/, https://retool.com/blog/react-map-library, https://www.pkgpulse.com/guides/mapbox-vs-leaflet-vs-maplibre-interactive-maps-2026

### Tertiary (LOW confidence)
- None flagged separately — lowest-confidence claims (RIDB rate limit, coordinate field shape, OpenFreeMap durability) are captured above as MEDIUM-confidence gaps requiring live verification, not treated as unusable.

---
*Research completed: 2026-08-29*
*Ready for roadmap: yes*
