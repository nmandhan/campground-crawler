# Pitfalls Research

**Domain:** Adding full-catalog discovery search, map view, and visual redesign to an existing single-user Recreation.gov watcher (Next.js/Vercel dashboard + RIDB API)
**Researched:** 2026-08-29
**Confidence:** HIGH (grounded directly in this repo's existing code — `dashboard/lib/ridb.ts`, `dashboard/lib/github.ts`, `dashboard/proxy.ts`, `dashboard/app/globals.css` — plus MEDIUM/LOW confidence items flagged inline for anything relying on general RIDB/Vercel/Next.js knowledge beyond what's in this codebase)

## Critical Pitfalls

### Pitfall 1: Discovery search fans out into many more RIDB calls than the typeahead ever did, blowing the ~50 req/min budget

**What goes wrong:**
The existing RIDB usage (`searchRecAreas` + `listAreaFacilities` in `dashboard/lib/ridb.ts`) is bounded: one typeahead search + one preview per watch-creation session, gated behind auth (`proxy.ts` matches `/api/ridb/:path*`). A full-catalog discovery page is structurally different — it's a *public, unauthenticated* page (per PROJECT.md's existing pattern of "reads stay public"), so every visitor's every search keystroke, every pagination click, and every "show availability at a glance" render can trigger RIDB calls. If "availability at a glance" means calling the per-campground `GET /api/camps/availability/campground/{id}/month` endpoint for every result row (e.g., 20 results per search × N searches), the 50 req/min ceiling is exhausted by a single active user browsing, let alone concurrent visitors.

**Why it happens:**
The mental model from watch-creation (bounded, authenticated, one-shot) gets carried over to discovery (unbounded, public, repeated) without re-deriving the request budget. RIDB has no per-key concurrency isolation the dashboard controls — the same `RIDB_API_KEY` is shared across the poller (`src/`), the existing typeahead, and the new discovery page.

**How to avoid:**
- Discovery results list should show *facility metadata* (name, location, type) from RIDB without per-row live availability by default — availability-at-a-glance should be a cached/batched lookup, not N synchronous calls per page render.
- Add a request budget/queue shared across all RIDB call sites in `dashboard/lib/ridb.ts` (not just discovery) — e.g., a simple token-bucket or minimum-interval guard, mirroring the poller's existing "~1 req/sec" discipline described in STACK.md, rather than trusting caller discipline.
- Cache RIDB facility search/list responses at the Next.js fetch layer (`next: { revalidate: N }`) the same way `github.ts` already does for the JSON files — facility metadata changes rarely, so a multi-minute-to-hour revalidate window is safe and cuts request volume dramatically for repeat/concurrent visitors.
- Do not call live availability for every visible search result on every request; if shown, batch it and cache aggressively (see Pitfall 4).

**Warning signs:**
- RIDB API returning 429s in Vercel function logs, especially correlated with discovery-page traffic spikes rather than poller runs.
- Search-as-you-type triggering a fresh RIDB request per keystroke with no debounce (the existing `lib/debounce.ts` exists for exactly this reason in the typeahead — verify discovery search reuses it, doesn't reinvent unthrottled fetch).
- Local dev "feels fine" testing (single user, low volume) masking that concurrent-visitor load multiplies the same pattern.

**Phase to address:**
Build the RIDB request-budgeting/caching layer *before or alongside* the discovery search page, not after. If discovery ships first and caching is bolted on later, the public unauthenticated page will have already been live (and rate-limit-fragile) for however long the gap is.

---

### Pitfall 2: Map renders crash or silently drop pins on RIDB's known-bad lat/long data

**What goes wrong:**
PROJECT.md/prior research already confirms RIDB facility coordinates are inconsistently populated — some are missing, some are `0,0` (Null Island), some are swapped lat/lng, some are wildly out-of-range placeholder values. A map component built against "happy path" sample data will either throw when `lat`/`lng` is `undefined`/`null`, or silently plot pins at `(0,0)` in the Gulf of Guinea, or zoom-to-fit logic will blow out to a world view because one bad coordinate pair sits at an extreme.

**Why it happens:**
Map libraries (Leaflet, Mapbox GL, etc.) generally assume valid numeric coordinates and don't validate ranges for you. Developers test with a handful of known-good campgrounds (the ones already in `watches.json`) during dev, which all happen to have valid coordinates, so the missing/bad-data path never gets exercised until a real full-catalog search surfaces it.

**How to avoid:**
- Coordinate validation must be a first-class step in the map's data pipeline, not a defensive afterthought: filter/flag facilities where `lat`/`lng` are missing, `0 && 0`, outside plausible US bounds (roughly lat 18–72, lng -180 to -65 to cover CONUS + AK/HI/territories), or otherwise non-finite, *before* they reach the map component.
- Facilities excluded from the map for bad coordinates should still appear in the list/search results (they're real, bookable campgrounds) — don't let "no map pin" silently become "not in search results." Surface it as "location unavailable" in the list UI, not a silent drop.
- Zoom-to-fit / bounds-fitting logic should compute bounds only from the validated coordinate set, not the raw RIDB response.

**Warning signs:**
- Pins clustering at `(0,0)` or in the ocean off Africa.
- Map auto-zoom suddenly showing the whole world instead of the search region.
- Console errors like `Invalid LatLng` or `NaN` from the map library on real (not synthetic) search results.
- Discovery list count and map pin count silently diverging with no explanation shown to the user.

**Phase to address:**
Handle missing/invalid-coordinate facilities in the map component's *first version* — this is explicitly called out in the milestone context as something not to defer to a follow-up. Write the coordinate-validation function and its test cases before wiring up the actual map library, using deliberately malformed fixtures (missing, zero, out-of-range) alongside valid ones.

---

### Pitfall 3: The "polish" visual redesign quietly breaks the design-token discipline or the auth boundary

**What goes wrong:**
Two structurally different failure modes bundled by the same root cause (a redesign pass touching many files at once, reviewed less carefully than a feature PR):

1. **Design-token drift:** `dashboard/app/globals.css` states outright "Values are the contract; do not invent new sizes/colors" and defines an exact palette/spacing/type scale (4 sizes, 2 weights, 60/30/10 color split). A redesign pass under time pressure introduces one-off hex codes, ad-hoc `px` values, or a 5th font size directly in component styles instead of extending the token set deliberately — and because CSS silently accepts any value, nothing errors; the drift just accumulates.
2. **Auth boundary regression:** `dashboard/proxy.ts` is an *inclusion allowlist* (`matcher: ['/api/watches/:path*', '/api/ridb/:path*']`) — already flagged in PROJECT.md's Phase 5 tech debt as having "no automated check tying new routes to protection." A visual redesign that adds new API routes (e.g., a new discovery-page endpoint that proxies RIDB search results, or a new endpoint to batch-fetch availability for map markers) will NOT be protected by the proxy matcher unless someone remembers to add it — and per the file's own comments, `/api/ridb/*` routes must be gated even though they're read-only, because an ungated RIDB proxy hands any anonymous visitor free use of this project's API key.

**Why it happens:**
Redesigns touch layout/styling broadly and reviewers focus on visual diff, not on whether a newly-added route matches the security-relevant regex, or whether a new inline style bypasses the token contract. The two are different files (`globals.css` vs `proxy.ts`) that don't get cross-checked together during a "make it pretty" pass.

**How to avoid:**
- For design tokens: any new discovery/map UI must consume existing `--space-*`, `--text-*`, `--color-*` variables. If the redesign genuinely needs a new value (e.g., a map-specific accent color for pins), that's a deliberate token-set *extension* decided up front and added to `globals.css` with the same "contract" framing — not an inline override in a component.
- For the auth boundary: any new API route created for discovery/map (RIDB proxying, availability batching) must be added to `proxy.ts`'s `matcher` array in the *same commit* that creates the route, following the existing pattern (`/api/ridb/:path*` already covers new sub-paths under that prefix automatically, but a route outside that prefix — e.g. `/api/discovery/*` — will NOT be covered and needs an explicit matcher entry). Since PROJECT.md already flags "no automated check tying new routes to protection" as known debt, resolving that check (e.g., a simple test that enumerates `app/api/**/route.ts` files and asserts each mutating/RIDB-key-bearing one is covered by the matcher) should happen *before or during* this milestone's route additions, not deferred again.
- Read-only discovery endpoints that don't touch the RIDB API key or mutate `watches.json` can stay public (consistent with the existing "reads stay public" pattern) — but any endpoint that calls RIDB server-side using `RIDB_API_KEY` must be gated exactly like `/api/ridb/recareas` and `/api/ridb/preview` already are, since discovery search is a much larger amplifier of that key's usage than the existing typeahead.

**Warning signs:**
- New hex colors or pixel values appearing in component-level CSS/inline styles that don't trace back to a `var(--...)`.
- A new `app/api/.../route.ts` file that reads `process.env.RIDB_API_KEY` but isn't matched by `proxy.ts`'s `matcher` array — check this explicitly for every new route added this milestone.
- Design review approving screenshots without anyone diffing `globals.css` for new/changed token values.

**Phase to address:**
Design-token extension decisions belong in the redesign phase itself (decide the map/discovery-specific tokens up front, not ad hoc per-component). The auth-matcher-coverage check should be resolved as part of (or immediately before) whichever phase adds the first new discovery/map API route — this milestone already lists "auth-gate route coverage check" as Phase 5 debt to resolve in v1.2, so sequence it early enough to cover the new routes this milestone adds, not just retroactively audit the old ones.

---

### Pitfall 4: Serverless request-time rendering means "caching" isn't free the way it felt on the existing 3-file dashboard

**What goes wrong:**
The existing dashboard's caching story is simple and works well *because* it's small: three known files (`watches.json`, `state.json`, `runs.json`) fetched from `raw.githubusercontent.com` with a flat `next: { revalidate: 30 }` (see `dashboard/lib/github.ts`). Vercel serverless functions have no persistent memory between invocations and no in-memory cache that survives across requests/regions — the Next.js Data Cache (`fetch` + `revalidate`) is the only free lunch, and it's keyed per unique URL. A full-catalog discovery page with many distinct query strings (search term × filters × pagination) means many distinct cache keys, so the "cache" degenerates into "cache nothing" for the long tail of unique searches — every unique search still hits RIDB live, at request time, inside the user's page-load latency budget, at the same time the map is trying to plot results.

**Why it happens:**
Developers extrapolate "we already have caching" from the 3-file dashboard case without noticing that case has exactly 3 cache keys total, while discovery search has effectively unbounded cache keys (one per distinct query). The `next: { revalidate }` pattern still works correctly per-key, it just doesn't help unique/long-tail queries at all — and there's no shared in-memory LRU or edge KV to fall back to without adding a new dependency, which conflicts with this project's "zero non-essential dependencies" posture.

**How to avoid:**
- Split what's cached from what's live: RIDB facility/recarea metadata (name, location, type — changes rarely) should be cached aggressively per query with `next: { revalidate }` set to minutes-to-hours, since staleness there is low-cost. Live availability (changes every poll cycle) should NOT be cached the same way, or should have a much shorter window (seconds-to-low-minutes) consistent with the poller's cadence — mirror the 30s window already used for the poller's own JSON files as the ceiling for anything availability-related.
- For the common/popular queries (e.g., top N recreation areas, or whatever the discovery page's default/empty-state view shows), that's a small, bounded key space — cache it well. For arbitrary free-text search, accept that cache hit rate will be low and lean on the RIDB request-budget guard (Pitfall 1) rather than expecting caching alone to solve rate-limiting.
- Consider whether Vercel's Data Cache is even durable across deployments/regions for this use case (it typically is for `fetch`-based caching in Next.js on Vercel, but verify current behavior against Next.js's official caching docs rather than assuming — this is exactly the kind of "training data may be stale" claim that needs a docs check during implementation, not at research time).
- Given the "zero non-essential dependencies" constraint, do NOT reach for Redis/Upstash/a KV store to solve this — solve it with request-budgeting + conservative `revalidate` windows + a bounded "popular queries" cache, all achievable with what's already in the stack (Next.js `fetch` caching, no new package).

**Warning signs:**
- Discovery page feels fast for repeat/canned searches but slow (multi-second) for anything a user actually types.
- RIDB rate-limit pressure (Pitfall 1) correlating with search *diversity*, not just volume — a sign the cache isn't absorbing anything.
- Map view feeling laggy specifically because it's waiting on a live per-result availability fetch chain with no cache underneath.

**Phase to address:**
Design the cache-key strategy (what's cacheable long, what's live-only, what's bounded/popular-query cached) as part of the same phase that builds the RIDB request-budgeting layer (Pitfall 1) — these two concerns are two sides of the same problem and should not be split across phases, or the discovery page will ship functional-but-rate-limit-fragile and need a follow-up hardening phase anyway.

---

### Pitfall 5: Full-catalog search volume stresses the classification-logic drift already flagged as tech debt

**What goes wrong:**
`dashboard/lib/ridb.ts`'s header comment already documents this explicitly: `classifyFacility` is "Hand-duplicated from `src/recreation-gov/client.ts`, never imported... If the poller's classification rules change, this file must be updated by hand — a preview that disagrees with the poller is worse than none." That was an acceptable risk when the only consumer was a bounded watch-creation preview (a handful of facilities per session). A full-catalog discovery page runs this same duplicated classification logic across potentially thousands of facility records, on every visitor's every search — multiplying the blast radius of any future drift between the two copies by orders of magnitude, and making a silent misclassification (e.g., a campground shown as unreservable, or a non-campground shown as bookable) far more visible and far more likely to actually occur given the larger data surface.

**Why it happens:**
The duplication was a deliberate, documented tradeoff (the `dashboard/lib/types.ts` header boundary: dashboard and poller are independent projects, no shared-source mechanism) accepted for a small blast radius. Nothing about that decision changes automatically when the consuming feature's scale changes — the code stays "correct as documented" while the risk profile underneath it shifts substantially.

**How to avoid:**
- This milestone is the natural point to revisit whether the duplication tradeoff still holds, since PROJECT.md's Phase 5 review already flagged "nothing structurally preventing drift" as a known gap. Options in increasing order of effort: (a) at minimum, add a test that asserts `dashboard/lib/ridb.ts`'s `classifyFacility`/`CAMPGROUND_TYPE_PATTERN`/`GROUP_TYPE_PATTERN`/`AREA_FACILITY_CAP` stay byte-identical to `src/recreation-gov/client.ts`'s equivalents (a golden-file/string-diff check, not a build-time import, respecting the project-boundary rule) so drift fails CI instead of failing silently; (b) if the discovery page's classification needs diverge from the poller's (e.g., discovery might want to show non-reservable facilities as "browse only" rather than excluding them entirely, which the poller's fail-closed `Reservable !== true` check doesn't support), that's a deliberate, documented divergence — not further undocumented duplication.
- Do not just copy-paste `classifyFacility` a *third* time into a new discovery-specific module — that compounds the exact debt already flagged, at the exact moment scale makes it more dangerous.

**Warning signs:**
- Discovery search results showing a campground as bookable that the poller correctly excludes (or vice versa) for the same facility ID.
- A future change to `src/recreation-gov/client.ts`'s classification rules with no corresponding PR touching `dashboard/lib/ridb.ts`.

**Phase to address:**
Address this at the start of the discovery-search phase, before wiring the full-catalog browse UI to `dashboard/lib/ridb.ts` — either add the drift-detection test or make an explicit decision to diverge, so the phase's success criteria include "classification logic is verified, not just assumed, to match the poller (or documented as intentionally different)."

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Skip RIDB request budgeting, rely on Next.js `revalidate` alone | Faster to ship discovery search | 429s under real concurrent/varied-query traffic; poller's own RIDB calls could get starved by dashboard traffic sharing the same key | Never for a public page — acceptable only behind auth with known-low call volume (like the existing typeahead) |
| Copy-paste `classifyFacility` a third time for discovery instead of reusing/testing against `dashboard/lib/ridb.ts` | Fast, no cross-module coupling | Three-way drift risk instead of two-way; much larger data surface amplifies any bug | Never — reuse the existing module or add the drift test first |
| Inline a one-off color/spacing value during redesign instead of extending tokens | Faster visual iteration | `globals.css`'s "contract" erodes; future components inconsistent | Only as a throwaway prototype never merged; must be tokenized before merge |
| Add a new API route without updating `proxy.ts`'s matcher | Faster to wire up a feature end-to-end | Silent unauthenticated exposure of RIDB-key-backed or mutating endpoint | Never |
| Fetch live per-row availability for every discovery search result | Simple, "just works" for one user locally | RIDB rate-limit exhaustion at real traffic; slow page loads | Never for the default/list view; acceptable only for a small, deliberately-limited detail view (e.g., a single campground's expanded card) |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|--------------|------------------|--------------------|
| RIDB API (facility/recarea search) | Treating the ~50 req/min limit as "plenty" because dev/local testing is single-user | Budget for concurrent public traffic, not dev-session traffic; add a shared throttle in `dashboard/lib/ridb.ts`, not just per-caller discipline |
| RIDB API (lat/long fields) | Assuming coordinates present ⇒ coordinates valid | Validate range + non-zero + finite before using in any map/geo logic, independent of whether the field exists |
| Vercel Data Cache (`fetch` + `next.revalidate`) | Assuming it behaves like a general-purpose server-side cache (shared across all keys, LRU-evicted, etc.) | It's per-URL/per-key; unique query strings each get their own cache slot — design cache-key granularity deliberately (see Pitfall 4) |
| Next.js `proxy.ts` matcher | Assuming new routes are "probably covered" by an existing prefix matcher | Explicitly verify each new route's path against the matcher array; add a coverage test rather than trusting manual memory |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Per-result live availability fetch on discovery page | Page load time scales linearly with result count; RIDB 429s under load | Cache/batch availability separately from search metadata; don't fetch it synchronously per row | Breaks almost immediately at any concurrent traffic — RIDB's limit is shared, not per-visitor |
| Map re-render / re-fit-bounds on every keystroke of a live search box | Janky map, wasted RIDB calls | Debounce search input (reuse `lib/debounce.ts`) before triggering both the RIDB call and the map update | Breaks as soon as discovery search isn't debounced — will show up in dev testing, not just at scale |
| Long-tail unique-query cache misses treated as if caching solved the rate-limit problem | Rate-limit pressure appears only in production under real diverse queries, not in dev/staging smoke tests | Separate the request-budget guard from the cache layer; don't assume caching alone bounds RIDB call volume | Breaks under any traffic with query diversity — canned demo queries won't reveal it |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| New RIDB-backed API route left out of `proxy.ts`'s matcher | Anonymous visitors get free, unmetered use of this project's `RIDB_API_KEY`, potentially exhausting the shared rate limit for the poller too | Add every new RIDB-key-bearing route to the matcher in the same commit; add an automated coverage check (Phase 5 debt item, resolve before/during this milestone) |
| Assuming "read-only ⇒ safe to leave public" for a new discovery endpoint that happens to call RIDB server-side | Same as above — read-only doesn't mean cost-free or key-safe | Gate anything that spends the `RIDB_API_KEY`, regardless of read/write; only gate-free things that read the dashboard's own already-public committed JSON files |
| Redesign PR reviewed only visually, not for new routes/env-var reads | Auth gaps ship unnoticed because review focus was on CSS/layout | Explicitly checklist "any new route? matcher updated?" as part of redesign PR review, not just feature PR review |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|------------------|
| Facilities with bad/missing coordinates silently vanish from the map with no indication | User doesn't realize a real, bookable campground exists nearby just because it has no pin | Keep them in the list view; label as "location unavailable" rather than dropping |
| Discovery search feels fast for demo queries, slow/rate-limited for real ones | Erodes trust in the "polished, beautiful UI" goal this milestone targets | Load-test with diverse, non-canned queries before considering the phase done |
| Redesign introduces visual inconsistency (off-token colors/spacing) that's subtle enough to not get caught by casual visual review | Undermines the "genuinely polished" goal the milestone explicitly targets | Token-contract check as part of redesign review, not just eyeballing screenshots |

## "Looks Done But Isn't" Checklist

- [ ] **Discovery search:** Often missing a shared RIDB request-budget guard — verify concurrent/rapid searches don't produce 429s, not just a single manual test search.
- [ ] **Map view:** Often missing handling for facilities with null/zero/out-of-range coordinates — verify with a fixture containing deliberately bad data, not just real campgrounds that happen to have good coordinates.
- [ ] **New API routes added this milestone:** Often missing from `proxy.ts`'s matcher array — grep `app/api/**/route.ts` for `RIDB_API_KEY` or mutation logic and cross-check each against the matcher.
- [ ] **Visual redesign:** Often introduces off-token values — grep new/changed CSS for hex codes or raw `px` values not wrapped in `var(--...)`.
- [ ] **Classification logic reused for discovery:** Often silently re-copied a third time instead of reusing `dashboard/lib/ridb.ts`'s existing `classifyFacility` — verify discovery imports/tests against the same logic, doesn't duplicate it again.
- [ ] **Availability-at-a-glance on discovery results:** Often implemented as N synchronous per-row RIDB/availability calls — verify it's batched/cached, not a naive loop.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| RIDB 429s discovered post-launch | MEDIUM | Add the request-budget guard retroactively (Pitfall 1's fix); tighten `revalidate` windows; consider temporarily rate-limiting the discovery page itself (e.g., simple per-IP throttle) while the deeper fix ships |
| Map silently dropping bad-coordinate facilities discovered post-launch | LOW | Add the coordinate-validation filter and "location unavailable" list treatment; no data migration needed since RIDB is the source of truth, just re-render |
| Design-token drift discovered post-launch | LOW–MEDIUM | Audit `globals.css` diff since redesign started; either formally add the new values as tokens (if intentional/good) or revert to token usage (if accidental) |
| Ungated new route discovered post-launch | HIGH (security incident, not just a bug) | Immediately add the route to `proxy.ts`'s matcher and redeploy; rotate `RIDB_API_KEY` if abuse/exhaustion is suspected; add the automated coverage check so this can't recur silently |
| Classification drift between poller and dashboard discovered post-launch | MEDIUM | Diff the two `classifyFacility` implementations directly; add the drift-detection test immediately after fixing, not just fix-and-move-on |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| RIDB rate-limit exhaustion at discovery-search volume | Build alongside/before the discovery search page (RIDB request-budgeting phase) | Load test with diverse concurrent queries; confirm no 429s in logs under realistic traffic simulation |
| Map breaking on missing/bad coordinates | Map component's first version, not a follow-up | Unit test the coordinate-validation function against fixtures with missing/zero/out-of-range values; visually confirm "location unavailable" list treatment |
| Redesign breaking design-token discipline | Redesign phase itself | Diff `globals.css` for the milestone; grep new component styles for raw hex/px values outside `var(--...)` |
| Redesign/new-routes breaking the auth boundary | Same phase that adds each new RIDB-backed or mutating route | Automated test enumerating `app/api/**/route.ts` and asserting matcher coverage for any route reading `RIDB_API_KEY` or `github-write.ts` |
| Serverless caching gaps for long-tail discovery queries | Same phase as RIDB request-budgeting (they're one concern) | Confirm cache-key strategy documented (what's cached long, what's live-only); spot-check unique-query latency under load |
| Classification-logic drift amplified by discovery scale | Start of discovery-search phase, before wiring full-catalog browse to `ridb.ts` | Drift-detection test passes (or divergence is explicitly documented) before discovery ships |

## Sources

- `dashboard/lib/ridb.ts` (this repo) — existing RIDB integration, documented duplication tradeoff, classification logic, rate-limit-adjacent design comments
- `dashboard/lib/github.ts` (this repo) — existing Next.js Data Cache pattern (`next: { revalidate: 30 }`), explicit comment against `force-dynamic`
- `dashboard/proxy.ts` (this repo) — existing auth-gate matcher pattern and its documented rationale/known limitations
- `dashboard/app/globals.css` (this repo) — design-token contract ("do not invent new sizes/colors")
- `.planning/PROJECT.md` (this repo) — Phase 5 tech-debt list (classification drift, auth-gate route-coverage check), milestone goals and constraints ("zero non-essential dependencies," public read-only dashboard model)
- Prior-milestone research (referenced in milestone context, not re-derived here): RIDB ~50 req/min rate limit; RIDB lat/long inconsistent population — both treated as established facts per the task's instructions, not re-verified in this pass

---
*Pitfalls research for: Campground Crawler v1.2 Discovery & Polish milestone*
*Researched: 2026-08-29*
