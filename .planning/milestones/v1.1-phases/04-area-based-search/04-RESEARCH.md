# Phase 4: Area-Based Search - Research

**Researched:** 2026-08-25
**Domain:** RIDB RecArea resolution + poller aggregation for multi-facility watches
**Confidence:** MEDIUM (endpoint paths and existing-codebase patterns HIGH; exact `/recareas` and `/recareas/{id}/facilities` JSON field names MEDIUM — could not verify live, no `RIDB_API_KEY` available in this session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area Resolution Method**
- **D-01:** Area watches resolve via RIDB's **RecArea entity**, not lat/long+radius geo-search. Flow: `GET /recareas?query={name}` → pick top match → `RecAreaID` → `GET /recareas/{RecAreaID}/facilities` → campground list. This matches the requirement language ("named Recreation Areas (park/forest)"), matches RIDB's actual data model (RecArea contains Facilities), and sets up Phase 5's typeahead search naturally (same `/recareas` endpoint). Lat/long+radius geo-search was considered and rejected — REQUIREMENTS.md already deferred that approach to v2 as AREA-06 specifically because RIDB lat/long data is unreliable, which corroborates this choice.
- **D-02:** RecArea name matching follows the **exact same ambiguity-handling pattern as the existing `resolveFacility()`** for single-campground watches: auto-pick the top RIDB text match, record the rest as `alternatives` (mirroring `ResolvedFacility.alternatives`), and support an optional explicit `recAreaId` override in `watches.json` as the escape hatch for a bad auto-match — parallel to the existing `Watch.facilityId` override.
- **D-03:** No "fail closed on ambiguous match" behavior — consistent with how single-campground watches already behave (auto-pick + override, not a hard error).

**Facility Type Filtering**
- **D-04:** Include both standard (individual-site) campgrounds and group campgrounds when expanding a RecArea — do not exclude group campgrounds. Still exclude clearly non-campground facility types via RIDB's `FacilityTypeDescription` (visitor centers, boat ramps, day-use areas, ranger stations, etc.) and restrict to reservable facilities only.
- **D-05:** Every resolved campground carries a standard-vs-group type tag through to match output. The user expects clear visual/textual distinction between a standard campground match and a group-campground match — their actual use case is mostly 1-2 tent sites, so group-campground matches need to be unambiguous, not filtered out.
- **D-06:** The standard-vs-group tag surfaces in **match output only** (notification content / dashboard match display) for this phase. It does NOT need to appear in `runs.json` history for non-matching/unmatched resolved facilities — that broader "preview what an area resolves to" surface is Phase 5's MGMT-05 job, not Phase 4's.

**Facility Cap & Truncation**
- **D-07:** Hard cap of **20 facilities** per area watch (within the roadmap's 15-25 range) — applied after type/reservable filtering, before availability polling begins.
- **D-08:** When resolution exceeds the cap, truncation is surfaced **both** in match-adjacent output (dashboard, e.g. "showing 20 of 34 campgrounds") **and** logged in `runs.json` — satisfies Phase 4's success criterion #3 ("truncation indicator shown when the cap is hit") rather than a silent-log-only approach.
- **D-09:** Which facilities survive the cap: **keep RIDB's returned order**, truncate the rest. No secondary sort (alphabetical, distance) — simplest, no new sorting/geo logic needed.

**Multi-Area Watch Cap Semantics**
- **D-10:** For a watch listing multiple named areas, the 20-facility cap is **shared across the whole watch**, not per-area — matches AREA-02's "capped at a maximum **combined** facility count" wording. A 3-area watch still tops out at 20 total resolved facilities, not 60.

### Claude's Discretion

- Exact resolver code structure (new `resolveArea()` shape, cache-key normalization for multi-area watches, how `run.ts`'s aggregation groups multiple areas' facilities under one `WatchOutcome`) — architecture direction is already well-specified in `.planning/research/ARCHITECTURE.md`; only the RecArea-vs-geo swap changes from that document.
- Order in which multiple named areas within one watch are resolved/capped (e.g., first-listed-area-first when applying the shared 20 cap) — no user preference expressed; pick a simple, deterministic rule (area list order, same "keep RIDB's returned order" spirit as D-09).
- Exact `AreaNotFoundError`/error taxonomy naming and exact zod schema field names for the new `AreaWatch` variant.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope. (Lat/long+radius search already lives in REQUIREMENTS.md as v2-deferred AREA-06; per-facility allowlist/denylist already lives as v2-deferred MGMT-07.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| AREA-01 | User can define a watch for one or more named Recreation Areas (park/forest) instead of one specific campground, and the system checks availability across every campground in the selected area(s) | Architecture Patterns (System Diagram, Pattern 1-2), Standard Stack, Code Examples (discriminated union `AreaWatch`) — resolve-via-RecArea flow fully mapped to existing `resolveFacility()`/`resolveWatches()` patterns |
| AREA-02 | Area watches are capped at a maximum combined number of facilities across all selected areas (~15-25) with a truncation indicator, protecting the existing rate-limit budget | Architecture Patterns (cap-after-concat step), Pitfall 1 (request budget calculation confirms resolve-at-poll-time fits RIDB's 50 req/min cap), Open Question 4 (truncation metadata placement) |
| AREA-03 | Area watch facility resolution filters out non-campground facility types (visitor centers, boat ramps, group day-use areas, etc.) to avoid a wrong-match failure at region scale (the v1.0 "BANDIDO" bug class) | Pitfall 2 (endpoint response shape uncertainty), Pitfall 3 (allowlist-over-denylist filtering strategy), Don't Hand-Roll table, Open Questions 1-2 |
| AREA-05 | When an area watch matches, the notification/dashboard shows which specific campground(s) within the area(s) matched, not just the area name | Architecture Patterns (Pattern 4 — `MatchedSlot` already carries `facilityId`/`facilityName` per match, so aggregation doesn't lose attribution), Code Examples (`ResolvedWatch.facilityType` for D-05's standard-vs-group tag) |
</phase_requirements>

## Summary

Phase 4 adds a second `Watch` variant (`AreaWatch`) that resolves one or more named Recreation Areas to a capped, filtered, deduplicated list of campground facilities at poll time, then aggregates all matches across those facilities into a single `WatchOutcome` per watch. The mechanical shape of this work mirrors what already exists almost exactly: `resolveFacility()` → `resolveArea()`, `resolveWatches()`'s per-run `Map` cache → same cache reused for area criteria, and the existing zod-parse-everything discipline extends to two new RIDB response shapes.

The one genuinely new structural piece is `src/run.ts`: today's loop is a flat `for (watch of resolved)` that assumes 1:1 `ResolvedWatch` → `WatchOutcome`. Area watches break that invariant — one `AreaWatch` can produce N `ResolvedWatch` entries (one per resolved facility, sharing the parent watch's `id`), which must collapse back into exactly one `WatchOutcome` per watch id before dashboard/state code ever sees it. This is `ARCHITECTURE.md`'s "Anti-Pattern 2" and is the load-bearing change for this phase.

RIDB's `/recareas` and `/recareas/{RecAreaID}/facilities` endpoints exist and are stable, well-established parts of RIDB's API surface (confirmed via the generated `ships/ridb` OpenAPI client and RIDB's general PascalCase-JSON convention already proven correct for `/facilities` in this codebase). However, this research could not obtain a live authenticated response for either endpoint — no `RIDB_API_KEY` was available in this session (same gap already flagged in `STATE.md`'s blockers list). Field names below are inferred from (a) the same PascalCase convention already validated in `RidbFacilitySchema`, and (b) a generated Rust OpenAPI client's snake_case docs (a reliable proxy for field *existence*, not exact JSON casing). **Do not trust the exact field names as final** — plan a fixture-capture spike (`scripts/capture-fixtures.ts`-style live call) as the first task of this phase, before writing the production zod schema.

**Primary recommendation:** Build `resolveArea()` as a structural mirror of `resolveFacility()` (two sequential RIDB calls: search `/recareas`, then list `/recareas/{id}/facilities`), reuse `resolveWatches()`'s existing per-run cache and error-isolation pattern for area criteria, and restructure `run.ts` around a `Map<watchId, ResolvedWatch[]>` group-then-aggregate step before constructing `WatchOutcome[]`. Do the live fixture-capture spike first — it is the single highest-leverage unblock for correct zod schema field names and directly informs whether `FacilityTypeDescription`/`Reservable` are even present on the `/recareas/{id}/facilities` response (see Open Questions).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| RecArea name → RecAreaID resolution | Backend poller (`src/recreation-gov/client.ts`) | — | Same tier that already owns `resolveFacility()`; RIDB is a backend-only integration, no browser exposure |
| RecAreaID → facility list (filter + cap) | Backend poller (`src/config/watches.ts`) | — | Filtering/capping is business logic over RIDB response data, same tier as existing `resolveWatches()` |
| Multi-facility → single WatchOutcome aggregation | Backend poller (`src/run.ts`) | — | Pure in-process orchestration change; no I/O, no new external dependency |
| Standard-vs-group tag display | Backend poller produces data (`MatchedSlot`) | Dashboard renders it (`dashboard/`) | Poller computes the tag once at match time; dashboard is a pure renderer, mirrors existing hand-duplicated-schema convention |
| Truncation indicator | Backend poller computes + persists (`runs.json`) | Dashboard renders it | Same split as above — poller is source of truth for what was capped, dashboard only displays |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| `zod` | `^4.4.3` (already installed, confirmed in `package.json`) | Validate two new RIDB response shapes (`/recareas` search, `/recareas/{id}/facilities` list) | Matches existing project-wide "zod-parse everything before field access" convention (`client.ts` module doc comment, Security Domain V5) |

No new libraries are needed. This phase is entirely additive logic inside `src/`, reusing the existing RIDB client scaffolding (`retryWithBackoff`, `fetchJson`, `RIDB_BASE`).

### Alternatives Considered
None — CONTEXT.md's D-01 already locks the RecArea-entity approach over lat/long+radius geo-search; no alternative stack decisions remain open for this phase.

**Installation:** none required — no new dependencies.

**Version verification:** `zod@^4.4.3` already verified current in `.planning/research/STACK.md`'s sources (`npm view` run in that research pass). No re-verification needed for this phase; it does not touch the dependency surface.

## Architecture Patterns

### System Architecture Diagram

```
watches.json (AreaWatch entry)
  { id: "sequoia-multi", type: "area",
    areas: [{ name: "Sequoia National Forest" }, { name: "Sierra National Forest", recAreaId: 123 }],
    dateRange: {...}, siteType: "tent" }
        │
        ▼
config/watches.ts: resolveWatches()
        │  branch on watch.type === 'area'
        ▼
recreation-gov/client.ts: resolveArea(areaCriteria)
        │  1. GET /recareas?query={name}  → pick top RecAreaID match (or use explicit recAreaId override)
        │  2. GET /recareas/{RecAreaID}/facilities → raw facility list
        │  3. filter: FacilityTypeDescription excludes non-campground types, Reservable === true
        │  4. tag each surviving facility standard-vs-group (D-05)
        │  (cached once per unique area name/recAreaId per run — mirrors existing parkName cache)
        ▼
per-watch: concat facilities across all areas in the watch, in area-list order (D-10/discretion)
        │  apply shared 20-facility cap AFTER concat, keep RIDB's returned order (D-07/D-09)
        │  if truncated: record { requested: N, kept: 20 } for this watch id (D-08)
        ▼
ResolvedWatch[] = [ {id:"sequoia-multi", facilityId: 111, facilityType:'standard', ...},
                     {id:"sequoia-multi", facilityId: 222, facilityType:'group', ...}, ... up to 20 total ]
        │
        ▼
run.ts: group resolved by watch.id → Map<string, ResolvedWatch[]>
        │  for each group: fetch availability per facility (existing pacing), matchWatch() per facility
        │  aggregate all facilities' matches into ONE WatchOutcome per watch id
        │  attach truncation metadata to that outcome (or a sibling runs.json field — Claude's discretion)
        ▼
one aggregated WatchOutcome{ watchId: "sequoia-multi", status: 'MATCH',
                              newMatches: [...across facilities, each MatchedSlot already
                                           carries facilityId/facilityName (AREA-05 attribution
                                           requires no new field — it's already there)] }
```

### Recommended Project Structure
No new files/directories — all changes are inside existing modules:
```
src/
├── types.ts                    # Watch discriminated union, ResolvedWatch, MatchedSlot gains facilityType
├── config/schema.ts            # WatchSchema -> z.discriminatedUnion + z.preprocess migration
├── config/watches.ts           # resolveWatches() gains area branch, shared cache, cap logic
├── recreation-gov/client.ts    # new resolveArea()
├── recreation-gov/types.ts     # new RidbRecAreaSearchSchema, RidbRecAreaFacilitiesSchema
├── errors.ts                   # new AreaNotFoundError (name: discretion, per D-10 section)
├── run.ts                      # group-by-watch-id aggregation (the one structural change)
dashboard/lib/
├── types.ts                    # mirror Watch union, MatchedSlot.facilityType
├── schema.ts                   # mirror zod schemas
```

### Pattern 1: Mirror `resolveFacility()`'s shape exactly for `resolveArea()`

**What:** Same `RIDB_BASE`, `retryWithBackoff(() => fetchJson(...))`, zod-`safeParse`-or-throw pipeline, top-match + `alternatives` return shape.
**When to use:** For both the `/recareas` search call and (conceptually) the `/recareas/{id}/facilities` call.
**Example (search half, existing pattern to extend):**
```typescript
// Source: src/recreation-gov/client.ts (existing resolveFacility, lines 38-72)
export async function resolveFacility(parkName: string, opts?: ClientOptions): Promise<ResolvedFacility> {
  const url = new URL(`${RIDB_BASE}/facilities`);
  url.searchParams.set('query', parkName);
  url.searchParams.set('limit', '10');
  url.searchParams.set('sort', 'Name');
  const headers: Record<string, string> = {};
  if (opts?.ridbApiKey) headers['apikey'] = opts.ridbApiKey;
  const raw = await retryWithBackoff(() => fetchJson(url.toString(), { headers, fetchImpl: opts?.fetchImpl }), { sleep: opts?.sleep });
  const parsed = RidbFacilitySearchSchema.safeParse(raw);
  if (!parsed.success) throw new ResponseSchemaError(/* ... */);
  const [first, ...rest] = parsed.data.RECDATA;
  if (!first) throw new FacilityNotFoundError(/* ... */);
  return { facilityId: first.FacilityID, facilityName: first.FacilityName, alternatives: rest.map((r) => r.FacilityName) };
}
```
`resolveArea()` should follow this exact shape for `GET /recareas?query={name}` (same `RECDATA`/`METADATA` envelope expected — RIDB uses this envelope project-wide per its OpenAPI convention), returning a `ResolvedRecArea { recAreaId, recAreaName, alternatives }`. Then a second internal call (or a second exported function, `listAreaFacilities(recAreaId)`) hits `GET /recareas/{RecAreaID}/facilities` and applies the D-04 filter.

### Pattern 2: Per-run resolution cache, keyed by normalized criteria

**What:** `resolveWatches()`'s existing `Map<string, Promise<ResolvedFacility>>` cache, keyed by `parkName.trim().toLowerCase()`.
**When to use:** Extend the same cache (or a sibling one) for area criteria — cache key should combine area name (or explicit `recAreaId`) with... nothing else, since D-01/D-02 resolution has no other varying input. A single watch listing the same area twice, or two different watches both watching "Yosemite," should only trigger one live resolution per run.
**Example:**
```typescript
// Source: src/config/watches.ts (existing pattern, lines 62-118)
const cache = new Map<string, Promise<ResolvedFacility>>();
// ...
const cacheKey = watch.parkName.trim().toLowerCase();
let pending = cache.get(cacheKey);
if (!pending) {
  pending = resolve(watch.parkName, opts);
  cache.set(cacheKey, pending);
}
const facility = await pending;
```
For area watches, key by `area.name.trim().toLowerCase()` (or `area.recAreaId` if the override is set) and cache the *resolved facility list*, not just the RecArea match — the expensive part (two sequential RIDB calls) is what benefits from memoization within a run.

### Pattern 3: Explicit-override escape hatch (D-02)

**What:** `Watch.facilityId?: number` already exists as the "trust my override, skip resolution" pattern (`resolveWatches()` lines 76-83: if `facilityId` is set, skip RIDB entirely and use it directly, with `facilityName` falling back to `parkName`).
**When to use:** Extend identically for `AreaWatch` — each entry in `areas[]` should support an optional `recAreaId` override that skips the `/recareas` search call but still runs the `/recareas/{id}/facilities` expansion (unlike the facility-watch override, which skips resolution entirely — an area override only skips the *name-search* half, since facility expansion is still required).

### Pattern 4: Aggregation restructure in `run.ts` (the load-bearing change)

**What:** Today: `for (const watch of resolved) { ...; outcomes.push({watchId: watch.id, ...}) }` — one iteration, one push, 1:1 by construction because `resolved` only ever has one entry per watch id today.
**When to use:** Once `resolved` can contain multiple entries sharing a watch id (from an `AreaWatch`), this loop must change to a two-phase structure: group first, then iterate groups.
**Recommended shape:**
```typescript
// Illustrative restructure of src/run.ts:60-87 — not verified against a live RIDB
// response, but the grouping mechanics are pure TypeScript and can be planned with
// full confidence.
const groups = new Map<string, ResolvedWatch[]>();
for (const w of resolved) {
  const arr = groups.get(w.id) ?? [];
  arr.push(w);
  groups.set(w.id, arr);
}

for (const [watchId, facilities] of groups) {
  try {
    const allMatches: MatchedSlot[] = [];
    for (const facility of facilities) {
      const responses = await fetchRange(facility.facilityId, facility.dateRange.start, facility.dateRange.end);
      const slots = mergeSlots(...responses.map(parseAvailability));
      allMatches.push(...matchWatch(slots, facility));
    }
    if (allMatches.length === 0) {
      outcomes.push({ watchId, status: 'NO_MATCH' });
      continue;
    }
    // existing dedup-split logic against allMatches, unchanged
    outcomes.push({ watchId, status: 'MATCH', newMatches, suppressed });
  } catch (err) {
    outcomes.push({ watchId, status: 'FAILED', reason: describeFailure(err) });
  }
}
```
**Important — per-facility failure isolation is a genuine open design choice, not something the current single-facility code has to answer:** if one facility in a 15-facility area watch throws (e.g. a transient `HttpError` on `fetchRange`), should that fail the *whole* watch (current `try/catch` wraps the whole group, matching today's single-facility behavior) or should it degrade gracefully (skip that one facility, still report matches from the other 14)? CONTEXT.md does not decide this — flagging as an Open Question below since it directly shapes the `run.ts` task.

**Why dedup keys stay safe unchanged:** `dedupKey(watchId, campsiteId, startDate, endDate)` already includes `campsiteId`, which is globally unique across facilities (RIDB campsite IDs are not facility-scoped in a way that collides). No `state/store.ts` change needed — confirmed by reading `dedupKey`'s call site in `run.ts:74`.

### Anti-Patterns to Avoid
- **Producing multiple `WatchOutcome` entries with the same `watchId`:** `ARCHITECTURE.md`'s documented Anti-Pattern 2 — dashboard derive modules and any future `runs.json` consumer assume one outcome per watch id per run. This is the single most important invariant this phase must preserve.
- **Baking a frozen facility-ID list into `watches.json` at watch-creation time:** `ARCHITECTURE.md`'s Anti-Pattern 1 — area resolution must stay resolve-at-poll-time, not resolve-and-freeze. (Not applicable to Phase 4 directly since there's no write UI yet, but the schema/type design must not accidentally make freezing the only option — keep `AreaWatch` storing *criteria* — `areas: [{name, recAreaId?}]` — never a resolved facility list.)
- **Re-sorting or re-ranking facilities before applying the cap:** D-09 explicitly locks "keep RIDB's returned order" — do not add alphabetical or distance sorting, even if it seems more "helpful."
- **Applying the 20-facility cap per-area instead of per-watch:** D-10 explicitly locks the cap as shared across all areas in one watch — a 3-area watch tops out at 20 total, not 60.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| RecArea name matching / disambiguation | A custom fuzzy-match or scoring algorithm over RIDB search results | RIDB's own `query=` param + `sort=Name` + "take first result" (same as existing `resolveFacility()`) | RIDB's search relevance is already what the existing single-facility flow trusts; area search should not invent a different trust model — mirrors D-02 exactly |
| Non-campground facility filtering | A hand-maintained allowlist of "good" RecAreaIDs or facility names | `FacilityTypeDescription` field-based filter (exact value list TBD — see Open Questions) + `Reservable === true` | Matches PITFALLS.md Pitfall 2's prescribed mitigation directly; a hand-maintained allowlist doesn't scale and goes stale as RIDB data changes |
| Standard-vs-group site type tagging | A new heuristic string-matcher independent of existing conventions | Same substring-on-`FacilityTypeDescription` approach the filter step already uses (e.g., contains `"Group"`) | Reuses one classification pass instead of two independent ones that could disagree |

**Key insight:** Every "don't hand-roll" item in this phase already has a locked, in-codebase or in-CONTEXT.md precedent — this phase's job is to extend existing trust boundaries (RIDB's own ranking, RIDB's own type field), not invent new judgment logic.

## Common Pitfalls

### Pitfall 1: RIDB request budget — resolve-at-poll-time is fine at this project's actual scale, but has no ceiling today

**What goes wrong:** PITFALLS.md's Pitfall 1 recommends caching area resolution daily rather than every 5-minute cycle, citing RIDB's confirmed 50 req/min cap `[CITED: RIDB API 1.0.0 OAS 3.0, ridb.recreation.gov/docs]`. CONTEXT.md (D-01 canonical refs) directs research to confirm whether resolve-at-poll-time (reusing the per-run cache) actually fits that budget, rather than re-deciding the caching question.

**Concrete calculation:** With D-01's flow, each *unique* area name in a watch config costs exactly 2 RIDB calls per poll run (`GET /recareas?query=` + `GET /recareas/{id}/facilities`), memoized so a duplicate area name across watches costs nothing extra (Pattern 2 above). For a realistic single-user config (per PROJECT.md's stated single-user scope):
- 5 area watches × 3 areas each, no overlap = 15 unique areas → 30 RIDB calls
- Plus, say, 5 remaining single-facility watches → 5 more RIDB calls (`resolveFacility`)
- **Total: ~35 RIDB calls per 5-minute run**, all fired at the *start* of the run before any availability polling begins (existing `resolveWatches()` structure)

RIDB's 50 req/min cap is a *sliding-window* limit; the existing code has **no artificial delay between RIDB resolution calls** (unlike the availability endpoint, which has an explicit `await sleep(1000)` between month fetches in `fetchAvailabilityForRange` — see `client.ts:141-146`). 35 calls fired back-to-back with only network round-trip latency between them (likely well under a few seconds of wall-clock time) sit comfortably under 50/min even in a burst, **for this project's realistic single-user watch count.** This confirms CONTEXT.md's lean toward resolve-at-poll-time is safe *at current scale* — no daily-cache redesign is needed for Phase 4.

**Where it breaks:** If unique area count across all watches grows past roughly 20-25 (i.e., total RIDB calls per run approaches 50), a burst at run-start could hit the per-minute cap. This is not a realistic near-term risk for a declared single-user tool, but **should be a documented assumption, not a silent gap** — recommend the plan add a lightweight log line (`logger.info` of total RIDB calls made this run) so a future scale-up is visible in `runs.json` history rather than discovered via a live 429.

**How to avoid:** No redesign needed now. Log RIDB call count per run for future visibility. Do not add caching/TTL infrastructure this phase — it would be premature complexity against PITFALLS.md's own "Technical Debt Patterns" table, which flags under-designed request budgets as the risk to fix at this scale, not over-building a cache layer nobody needs at 35 calls/run.

**Confidence:** MEDIUM — the 50 req/min figure is `[CITED: PITFALLS.md, sourced to ridb.recreation.gov/docs]`, not independently re-verified live in this pass (no API key available). The call-count arithmetic above is `[VERIFIED: codebase read of client.ts/watches.ts]` reasoning applied to that cited limit.

### Pitfall 2: Facility-type filtering may not have the data it needs at the `/recareas/{id}/facilities` endpoint specifically

**What goes wrong:** D-04 requires filtering by `FacilityTypeDescription` and `Reservable`. The existing, *validated* `RidbFacilitySchema` (used by `/facilities` search) has these fields. But `GET /recareas/{RecAreaID}/facilities` is a **different endpoint** than `/facilities`, and community client documentation for the RIDB-generated OpenAPI client (`ships/ridb`) shows the *nested* `RecreationArea.FACILITY` sub-resource is a **compact stub** with only three fields: `facility_id`, `facility_name`, `resource_link` — no type or reservable info at all `[CITED: ships/ridb generated docs, RecreationAreaFacility.md]`.

It is not yet confirmed whether the **dedicated** `GET /recareas/{RecAreaID}/facilities` endpoint (D-01's chosen path) returns this same compact stub shape, or the full `Facility` record shape (same as `/facilities` search, with `FacilityTypeDescription`/`Reservable`). If it's the compact stub, D-04's filter cannot be applied directly on that response — the resolver would need a **second RIDB call per facility** (`GET /facilities/{FacilityID}`) to fetch the type/reservable fields, which changes the request-budget math in Pitfall 1 substantially (from 2 calls per area to potentially `2 + N` calls per area, where N is facility count before filtering).

**Why it happens:** RIDB's OpenAPI surface intentionally offers both a "cheap, nested, denormalized" view (facilities embedded directly in a RecArea's expanded response) and "full record" views per resource type — and it is genuinely ambiguous from documentation alone which shape the `/recareas/{id}/facilities` sub-resource endpoint returns without a live call.

**How to avoid:** This is the single most important thing to verify with a live fixture-capture spike before finalizing the zod schema or the `resolveArea()` implementation. Recommend the first task in this phase's plan be: obtain a `RIDB_API_KEY`, run a live `GET /recareas/{RecAreaID}/facilities` call for a known multi-campground RecArea (e.g. Yosemite, `recAreaId` known from prior `resolveFacility` calls or a `/recareas?query=Yosemite` lookup), and inspect the actual field list before writing `RidbRecAreaFacilitiesSchema`. If the endpoint does return the compact stub, the plan needs an explicit additional step (either a per-facility `/facilities/{id}` lookup, or falling back to filtering by `resource_link`/name-pattern heuristics as a degraded fallback) — this materially changes both the schema and the request-budget story and should not be discovered mid-implementation.

**Confidence:** LOW on the exact response shape — this is the single highest-priority open question for this phase. `[ASSUMED]`.

### Pitfall 3: Facility-type filtering will still let some ambiguous cases through — no verified enum of `FacilityTypeDescription` values exists

**What goes wrong:** No authoritative, complete enumeration of RIDB's `FacilityTypeDescription` values was found via web search in this session. `[ASSUMED]` values commonly seen in RIDB-derived tooling and documentation excerpts include: `"Campground"`, `"Group Campground"` (or a variant containing "Group"), `"Day Use"`, `"Boat Ramp"`, `"Trailhead"`, `"Cabin/Lookout"`, `"Yurt"`, `"Picnic Area"`, `"Visitor Center"`. This list is a reasonable planning input but **should not be hardcoded as a denylist without live verification** — the existing project's own committed philosophy (`AVAILABLE_STATUS` allowlist-of-one comment in `types.ts`, "never a denylist... an unrecognized upstream status string must degrade to 'not available', never crash or false-positive") argues for the same allowlist-not-denylist posture here: filter **in** facility types that are known-good campground types, rather than filtering **out** a possibly-incomplete list of bad ones. This is directly analogous to Pitfall 1/Assumption A2 already solved in this codebase for availability status strings.

**How to avoid:** Design the filter as an allowlist (D-04 says "include both standard and group campgrounds" — so the allowlist is something like: `FacilityTypeDescription` containing `"Campground"`, case-insensitive substring match, which naturally captures both "Campground" and "Group Campground" variants) combined with `Reservable === true`. This is more robust to an incomplete denylist than trying to enumerate every non-campground type RIDB might return. Verify the exact substring/values during the same live fixture-capture spike recommended in Pitfall 2 — capture a real multi-facility RecArea response and manually inspect which `FacilityTypeDescription` values actually appear for a real park.

**Confidence:** LOW on exact values, MEDIUM-HIGH on the allowlist-over-denylist *strategy* (directly justified by an existing, locked pattern in this same codebase). `[ASSUMED]` for values, `[VERIFIED: codebase pattern]` for the strategy recommendation.

## Code Examples

### Discriminated union extension (`src/types.ts` + `src/config/schema.ts`)

Following the existing `z.preprocess` migration pattern referenced in CONTEXT.md (the pattern itself was not yet present in `schema.ts` as read — today's `WatchSchema` is a single flat object, not yet a discriminated union — so this phase introduces both the union *and* the migration preprocessing in one step):

```typescript
// Illustrative shape for src/types.ts — field names for AreaWatch are Claude's
// discretion per CONTEXT.md; this shows the structural pattern only.
export interface FacilityWatch {
  type: 'facility';
  id: string;
  parkName: string;
  facilityId?: number;
  dateRange: { start: string; end: string };
  siteType: SiteType;
}

export interface AreaWatch {
  type: 'area';
  id: string;
  areas: Array<{ name: string; recAreaId?: number }>; // D-02 override, per-area
  dateRange: { start: string; end: string };
  siteType: SiteType;
}

export type Watch = FacilityWatch | AreaWatch;

// ResolvedWatch stays per-facility (unchanged shape), but the same watch `id`
// can now appear on multiple ResolvedWatch entries when the parent was an AreaWatch.
export interface ResolvedWatch {
  id: string;
  facilityId: number;
  facilityName: string;
  facilityType: 'standard' | 'group'; // D-05
  dateRange: { start: string; end: string };
  siteType: SiteType;
}
```

```typescript
// Illustrative shape for src/config/schema.ts
const FacilityWatchSchema = z.object({
  type: z.literal('facility'),
  id: z.string().min(1),
  parkName: z.string().min(1),
  facilityId: z.number().int().positive().optional(),
  dateRange: DateRangeSchema,
  siteType: SiteTypeSchema,
});

const AreaWatchSchema = z.object({
  type: z.literal('area'),
  id: z.string().min(1),
  areas: z.array(z.object({
    name: z.string().min(1),
    recAreaId: z.number().int().positive().optional(),
  })).min(1),
  dateRange: DateRangeSchema,
  siteType: SiteTypeSchema,
});

// Migration: existing hand-written watches.json entries have no `type` field at all.
export const WatchSchema = z.preprocess(
  (val) => {
    if (val && typeof val === 'object' && !('type' in val)) {
      return { ...val, type: 'facility' };
    }
    return val;
  },
  z.discriminatedUnion('type', [FacilityWatchSchema, AreaWatchSchema])
);
```

`WatchesFileSchema`'s existing `.refine((ws) => new Set(ws.map((w) => w.id)).size === ws.length, ...)` unique-id check is unaffected — it operates on `.id`, which both variants share.

### New RIDB response schemas (`src/recreation-gov/types.ts`) — placeholder pending live verification

```typescript
// Source: pattern from existing RidbFacilitySchema (src/recreation-gov/types.ts:24-35),
// field names NOT independently verified live — see Pitfall 2/Open Questions.
export const RidbRecAreaSchema = z.object({
  RecAreaID: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  RecAreaName: z.string(),
});

export const RidbRecAreaSearchSchema = z.object({
  RECDATA: z.array(RidbRecAreaSchema),
  METADATA: z.unknown().optional(),
});

// UNVERIFIED shape — see Pitfall 2. If the live spike confirms the compact stub
// (facility_id/facility_name/resource_link only, no type data), this schema and
// the resolveArea() implementation both need rework before D-04 filtering is possible.
export const RidbRecAreaFacilitiesSchema = z.object({
  RECDATA: z.array(RidbFacilitySchema), // reuses existing schema, IF the full shape is confirmed
  METADATA: z.unknown().optional(),
});
```

## State of the Art

Not applicable in the traditional sense — this is a small, additive feature on a stable, already-integrated third-party API (RIDB) and an internal codebase. No deprecated/legacy patterns are being replaced.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|-----------------|
| A1 | `GET /recareas?query={name}` returns the same `{RECDATA: [...], METADATA: {...}}` envelope as `/facilities`, with `RecAreaID`/`RecAreaName` fields in PascalCase | Code Examples, Architecture Patterns | LOW — if wrong, zod parse fails loudly (fail-closed by design), caught immediately in dev/testing, not a silent bug |
| A2 | `GET /recareas/{RecAreaID}/facilities` returns full `Facility` records (with `FacilityTypeDescription`/`Reservable`), not the compact `facility_id`/`facility_name`/`resource_link` stub seen in the nested `RecreationArea.FACILITY` sub-resource | Pitfall 2 | HIGH — if wrong, D-04's filter cannot be applied without an extra per-facility RIDB call, which changes both the schema design and the request-budget math from Pitfall 1 |
| A3 | `FacilityTypeDescription` values for actual campgrounds contain the substring "Campground" (including group campgrounds), and non-campground types (visitor centers, boat ramps, day-use areas) do not | Pitfall 3, Don't Hand-Roll | MEDIUM — if wrong, either good campgrounds get excluded (under-inclusive, user complains matches are missing) or bad facility types leak through (repeats the BANDIDO-class bug D-04 was designed to prevent) |
| A4 | RIDB's 50 req/min cap is a per-minute sliding window, not a hard per-second burst limit, so ~35 sequential calls fired in a few seconds at run-start comfortably fit | Pitfall 1 | LOW-MEDIUM — if RIDB enforces stricter burst limits than a sliding-minute window, resolution calls could occasionally 429 at current or near-future watch counts; recoverable via existing `retryWithBackoff` |
| A5 | `resolveWatches()`'s existing per-run `Map` cache pattern (keyed by normalized string) generalizes cleanly to area criteria with no additional invalidation logic needed | Architecture Patterns, Pattern 2 | LOW — purely a code-structure assumption, verifiable by direct code read (already partially confirmed by reading `watches.ts`) |

## Open Questions

1. **Does `GET /recareas/{RecAreaID}/facilities` return full `Facility` records or a compact stub?**
   - What we know: RIDB's generated OpenAPI client (`ships/ridb`) documents a nested `RecreationArea.FACILITY` sub-resource as a compact 3-field stub (`facility_id`, `facility_name`, `resource_link`). The *dedicated* `/recareas/{id}/facilities` endpoint's exact response shape was not independently confirmed — no live RIDB call was possible in this session (no `RIDB_API_KEY`).
   - What's unclear: Whether the dedicated endpoint returns the same compact shape, or the full `Facility` record shape used by `/facilities` search (which does have `FacilityTypeDescription`/`Reservable`).
   - Recommendation: Make a live fixture-capture spike the first task of Phase 4's plan (extend `scripts/capture-fixtures.ts` or write a one-off script), before finalizing `RidbRecAreaFacilitiesSchema`. If the compact shape is confirmed, the plan must add a `GET /facilities/{FacilityID}` lookup per candidate facility (pre-filter) to get type/reservable data — a design branch that materially changes the request-budget calculation in Pitfall 1.

2. **What is the complete/authoritative list of `FacilityTypeDescription` values RIDB uses?**
   - What we know: General web-search corroboration that values like "Campground," "Day Use," visitor-center-type entries exist as free text. No authoritative enum was found.
   - What's unclear: Exact strings, casing, and whether group campgrounds use a distinct value (e.g. `"Group Campground"`) vs. the same `"Campground"` value with a separate group indicator elsewhere.
   - Recommendation: Capture real data for at least 2-3 diverse RecAreas (e.g. one national forest with many dispersed sites, one national park with a tight campground list) during the same fixture-capture spike, and manually enumerate observed values before finalizing the allowlist substring/pattern.

3. **Per-facility failure isolation within an area watch's aggregation loop — fail the whole watch, or degrade gracefully?**
   - What we know: Today's single-facility `run.ts` wraps one facility's fetch+match in one `try/catch` — a failure there naturally means "this one watch failed." CONTEXT.md does not address what should happen if one of N facilities in an area watch fails.
   - What's unclear: Whether a single transient `HttpError` on facility #7 of 15 should mark the entire watch `FAILED` (losing any matches already found on facilities 1-6, 8-15), or whether the watch should still report `MATCH`/`NO_MATCH` from the facilities that succeeded, with the failure surfaced separately (e.g. a partial-failure note in the outcome, or a `runs.json` log line).
   - Recommendation: Given the aggregation pattern already isolates per-watch failures from crashing the whole run (existing `resolveWatches()` "a watch that fails to resolve never aborts the run for the others" convention), the most consistent design extends that same philosophy one level deeper: isolate per-facility failures within an area watch too, so one flaky campground doesn't hide matches from 14 healthy ones. This is a recommendation, not a locked decision — flag for the planner/discuss-phase to confirm, since it's user-facing behavior (a partial "MATCH, but 1 facility skipped due to error" state doesn't exist in today's three-state `WatchOutcome` union and may need a new field or a fourth state).

4. **Where does truncation metadata (D-08) live structurally?**
   - What we know: D-08 requires truncation surfaced in both match-adjacent output and `runs.json`. `WatchOutcome`'s current three-variant union (`MATCH`/`NO_MATCH`/`FAILED`) has no field for "resolved N, capped at 20."
   - What's unclear: Whether to add an optional field to the existing `WatchOutcome` union (e.g. `truncated?: { requested: number; kept: number }` on all three variants, or just `MATCH`), or introduce a separate top-level array on `RunSummary` (parallel to `failed`/`noMatch`), or attach it to `ResolvedWatch` itself (redundant across N facilities sharing one watch id, needs dedup at read time).
   - Recommendation: A single optional field on `WatchOutcome` (present regardless of match status, since truncation can happen on a `NO_MATCH` cycle too) is the simplest option and requires the smallest ripple through `dashboard/lib/schema.ts`'s mirrored discriminated union. Confirm during planning — this is Claude's discretion per CONTEXT.md, not a locked decision, but it touches both `src/types.ts` and `dashboard/lib/types.ts` so should be decided once, explicitly, rather than emerging ad hoc.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `RIDB_API_KEY` | Live verification of `/recareas` and `/recareas/{id}/facilities` response shapes (Pitfall 2/Open Questions) | ✗ (no `.env` present in this research session) | — | Ship the schema as a best-effort inference from PascalCase convention + `ships/ridb` docs, but treat it as unverified until a live spike runs; existing project convention (`ridb-facilities.json` fixture) already tolerates this by documenting the fixture as "synthetic, unvalidated" until a key becomes available |
| `zod` | Schema validation for new RIDB response types | ✓ | `^4.4.3` (installed) | — |
| Node.js/`tsx` | Running any fixture-capture script | ✓ (existing project runtime, per `package.json`) | Node 22.x LTS per `CLAUDE.md` | — |

**Missing dependencies with no fallback:**
- None that block *planning* this phase. The missing `RIDB_API_KEY` blocks *live verification* of exact field names, but does not block writing a plan whose first task is "obtain a key and capture live fixtures" — this is the same posture the project already took for the `/facilities` search fixture (`ridb-facilities.json`, documented as synthetic/unvalidated in `src/recreation-gov/fixtures/README.md`).

**Missing dependencies with fallback:**
- `RIDB_API_KEY` — fallback is proceeding with best-effort inferred schemas (as shown in Code Examples), explicitly flagged `[ASSUMED]`, with a live-verification task as an early plan step (mirrors the existing project convention for the same gap on the `/facilities` endpoint).

## Security Domain

`security_enforcement` is not present in `.planning/config.json`'s `workflow` block — treated as enabled per the default rule.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | Phase 4 has no new auth surface — it's poller-internal logic. The write-path UI's auth (shared secret) is Phase 5's concern per `ARCHITECTURE.md` |
| V3 Session Management | No | No sessions introduced |
| V4 Access Control | No | No new access-controlled resource |
| V5 Input Validation | Yes | `zod` `safeParse`-before-field-access on every new RIDB response, following the existing project-wide convention (`client.ts` module doc: "Every response is zod-parsed before any field access") |
| V6 Cryptography | No | No new secrets/crypto — reuses the existing `RIDB_API_KEY` passed via `ClientOptions`, never read from env inside `client.ts` (existing discipline, unchanged) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Malformed/unexpected RIDB response (schema drift, RIDB API change) causing a crash or silent bad data | Tampering (of a sort — untrusted external API response) / Denial of Service (poller crash) | zod `safeParse` + `ResponseSchemaError` throw, caught by the existing per-watch `try/catch` isolation in `resolveWatches()`/`run.ts` — one bad response fails one watch, never the whole run |
| Unbounded facility fan-out from a maliciously or accidentally huge RecArea, inflating request volume | Denial of Service (against RIDB's own rate limit, self-inflicted) | D-07's hard 20-facility cap, enforced server-side in the resolver itself (not just a UI-layer suggestion — there is no UI yet in this phase, so this is the *only* enforcement point and must be unconditional) |
| An `AreaNotFoundError`/`ResponseSchemaError` message accidentally leaking the `RIDB_API_KEY` (e.g. via a URL containing the key in an error string) | Information Disclosure | Existing `describeFailure()` discipline already documented as "MUST NOT include HTTP request headers or an `apikey` value in its output" (`errors.ts:49-51`) — extend the same discipline to any new `AreaNotFoundError` message, and confirm the RIDB key is sent as a header (`apikey`), never a query param, in `resolveArea()` (mirrors `resolveFacility()`'s existing header-based auth) |

## Sources

### Primary (HIGH confidence)
- Direct reads of `src/recreation-gov/client.ts`, `src/recreation-gov/types.ts`, `src/types.ts`, `src/config/schema.ts`, `src/config/watches.ts`, `src/errors.ts`, `src/run.ts`, `dashboard/lib/types.ts`, `dashboard/lib/schema.ts` (this repo) — ground truth for all "what exists today" claims and code patterns to mirror.
- `.planning/phases/04-area-based-search/04-CONTEXT.md` — locked decisions D-01 through D-10, canonical refs, discretion areas.
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/research/ARCHITECTURE.md`, `.planning/research/STACK.md`, `.planning/research/PITFALLS.md` (this repo) — upstream research and requirements context.
- Live probe (this session): unauthenticated `curl https://ridb.recreation.gov/api/v1/recareas?query=Yosemite&limit=1` → `HTTP 401 {"error":"Unauthorized Access"}` — confirms `/recareas` requires the same `RIDB_API_KEY` auth model as `/facilities`, consistent with existing project findings.

### Secondary (MEDIUM confidence)
- [ships/ridb generated OpenAPI client README](https://github.com/ships/ridb/blob/master/README.md) — confirms endpoint paths exist: `GET /recareas`, `GET /recareas/{recAreaId}`, `GET /recareas/{recAreaId}/facilities`, and related sub-resources.
- [ships/ridb RecreationArea.md](https://raw.githubusercontent.com/ships/ridb/master/docs/RecreationArea.md) — field list for the `RecreationArea` model (snake_case in this Rust-generated client; actual RIDB JSON is expected PascalCase per this codebase's already-validated `RidbFacilitySchema` convention).
- [ships/ridb RecreationAreaFacility.md](https://raw.githubusercontent.com/ships/ridb/master/docs/RecreationAreaFacility.md) — confirms the nested `RecreationArea.FACILITY` sub-resource is a compact 3-field stub (`facility_id`, `facility_name`, `resource_link`), the basis for Pitfall 2/Open Question 1.

### Tertiary (LOW confidence)
- WebSearch results referencing `recAreaId`/`recAreaName` field usage in third-party RIDB tooling (Apify scraper listing) — corroborates field *existence and rough naming*, not exact casing.
- WebSearch results on `FacilityTypeDescription` values (BLM ArcGIS layer descriptions, general RIDB tooling mentions) — no authoritative complete enum found; basis for Pitfall 3's `[ASSUMED]` value list.
- `usda.github.io/RIDB/` and `ridb.recreation.gov/docs` — both fetched in this session but returned only marketing/shell content (archived-repo notice, marketing header respectively), no usable OpenAPI/schema content extracted.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, pure extension of existing zod/RIDB-client conventions.
- Architecture: MEDIUM-HIGH — the `run.ts` aggregation restructure and discriminated-union extension are code-pattern-level HIGH confidence (verified by direct reads); the exact RIDB response shapes feeding those patterns are MEDIUM-LOW (unverified live).
- Pitfalls: MEDIUM — request-budget math is HIGH confidence given the codebase facts it's built on, but rests on a `[CITED, not re-verified]` 50 req/min figure; facility-type filtering pitfalls are LOW confidence pending live fixture capture.

**Research date:** 2026-08-25
**Valid until:** ~14 days (RIDB API surface is stable/slow-moving, but this research carries an unusually large unverified-live-data gap that should be closed by the first implementation task, not by research staleness alone)
