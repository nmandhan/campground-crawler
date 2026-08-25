# Phase 4: Area-Based Search - Context

**Gathered:** 2026-08-25
**Status:** Ready for planning

<domain>
## Phase Boundary

A watch can target one or more named Recreation Areas (park/forest) instead of one pinned campground. The poller resolves each named area to its constituent campgrounds at poll time — filtered to real, reservable campgrounds, capped at a combined maximum, and attributed correctly (which specific campground matched) in the output. This phase is pure `src/` poller logic — no new UI, no new auth surface. A user can hand-write an area watch into `watches.json` today and get value immediately; the dashboard write-path UI for creating area watches is Phase 5.

</domain>

<decisions>
## Implementation Decisions

### Area Resolution Method

- **D-01:** Area watches resolve via RIDB's **RecArea entity**, not lat/long+radius geo-search. Flow: `GET /recareas?query={name}` → pick top match → `RecAreaID` → `GET /recareas/{RecAreaID}/facilities` → campground list. This matches the requirement language ("named Recreation Areas (park/forest)"), matches RIDB's actual data model (RecArea contains Facilities), and sets up Phase 5's typeahead search naturally (same `/recareas` endpoint). Lat/long+radius geo-search was considered and rejected — REQUIREMENTS.md already deferred that approach to v2 as AREA-06 specifically because RIDB lat/long data is unreliable, which corroborates this choice.
- **D-02:** RecArea name matching follows the **exact same ambiguity-handling pattern as the existing `resolveFacility()`** for single-campground watches: auto-pick the top RIDB text match, record the rest as `alternatives` (mirroring `ResolvedFacility.alternatives`), and support an optional explicit `recAreaId` override in `watches.json` as the escape hatch for a bad auto-match — parallel to the existing `Watch.facilityId` override.
- **D-03:** No "fail closed on ambiguous match" behavior — consistent with how single-campground watches already behave (auto-pick + override, not a hard error).

### Facility Type Filtering

- **D-04:** Include both standard (individual-site) campgrounds and group campgrounds when expanding a RecArea — do not exclude group campgrounds. Still exclude clearly non-campground facility types via RIDB's `FacilityTypeDescription` (visitor centers, boat ramps, day-use areas, ranger stations, etc.) and restrict to reservable facilities only.
- **D-05:** Every resolved campground carries a standard-vs-group type tag through to match output. The user expects clear visual/textual distinction between a standard campground match and a group-campground match — their actual use case is mostly 1-2 tent sites, so group-campground matches need to be unambiguous, not filtered out.
- **D-06:** The standard-vs-group tag surfaces in **match output only** (notification content / dashboard match display) for this phase. It does NOT need to appear in `runs.json` history for non-matching/unmatched resolved facilities — that broader "preview what an area resolves to" surface is Phase 5's MGMT-05 job, not Phase 4's.

### Facility Cap & Truncation

- **D-07:** Hard cap of **20 facilities** per area watch (within the roadmap's 15-25 range) — applied after type/reservable filtering, before availability polling begins.
- **D-08:** When resolution exceeds the cap, truncation is surfaced **both** in match-adjacent output (dashboard, e.g. "showing 20 of 34 campgrounds") **and** logged in `runs.json` — satisfies Phase 4's success criterion #3 ("truncation indicator shown when the cap is hit") rather than a silent-log-only approach.
- **D-09:** Which facilities survive the cap: **keep RIDB's returned order**, truncate the rest. No secondary sort (alphabetical, distance) — simplest, no new sorting/geo logic needed.

### Multi-Area Watch Cap Semantics

- **D-10:** For a watch listing multiple named areas, the 20-facility cap is **shared across the whole watch**, not per-area — matches AREA-02's "capped at a maximum **combined** facility count" wording. A 3-area watch still tops out at 20 total resolved facilities, not 60.

### Claude's Discretion

- Exact resolver code structure (new `resolveArea()` shape, cache-key normalization for multi-area watches, how `run.ts`'s aggregation groups multiple areas' facilities under one `WatchOutcome`) — architecture direction is already well-specified in `.planning/research/ARCHITECTURE.md`; only the RecArea-vs-geo swap changes from that document (see canonical refs below).
- Order in which multiple named areas within one watch are resolved/capped (e.g., first-listed-area-first when applying the shared 20 cap) — no user preference expressed; pick a simple, deterministic rule (area list order, same "keep RIDB's returned order" spirit as D-09).
- Exact `AreaNotFoundError`/error taxonomy naming and exact zod schema field names for the new `AreaWatch` variant.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & stack (mostly still applicable — one correction below)
- `.planning/research/ARCHITECTURE.md` — Feature 1 (Area-Based Search) section: resolve-at-poll-time pattern, `run.ts` aggregation-by-watch-id requirement, discriminated-union `Watch` type shape, new-vs-modified file list. **Correction: this doc recommends lat/long+radius geo-search against `/facilities`; that recommendation is superseded by D-01 above (RecArea entity via `/recareas` + `/recareas/{id}/facilities`) — everything else in this doc (aggregation, caching pattern, file list, discriminated union shape) still applies, just swap the resolution API calls.**
- `.planning/research/STACK.md` — RIDB API auth/base URL confirmation (same `RIDB_API_KEY`, same `RIDB_BASE`), zod validation approach. Same correction applies re: geo params vs RecArea.
- `.planning/research/PITFALLS.md` — Pitfall 1 (request budget), Pitfall 2 (facility-type/BANDIDO-class mismatch) — directly inform D-04/D-07 above. Pitfall 1's "cache resolution daily, don't re-resolve every cycle" recommendation should be weighed against STATE.md's existing decision to resolve at poll time reusing the per-run cache (RecArea search isn't the rate-limited resource — RIDB's 50 req/min cap applies, and one `/recareas` + one `/recareas/{id}/facilities` call per unique area per 5-min run is well within that budget); flag this for the researcher to confirm actual RIDB request volume, not something this discussion needs to re-decide.

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — AREA-01, AREA-02, AREA-03, AREA-05 (this phase's scope); note AREA-06 (lat/long+radius, v2-deferred) confirms D-01's direction.
- `.planning/ROADMAP.md` — Phase 4 goal, success criteria, dependency on Phase 3.

### Existing code (ground truth for patterns to mirror)
- `src/recreation-gov/client.ts` — `resolveFacility()` is the pattern D-02 mirrors for `resolveArea()`; `RIDB_BASE`, `retryWithBackoff`, `fetchJson` reuse.
- `src/types.ts` — `Watch`, `ResolvedWatch`, `MatchedSlot`, `WatchOutcome` — the discriminated-union extension point (ARCHITECTURE.md's "New vs. modified" table).
- `src/config/schema.ts` — `WatchSchema` — the `z.discriminatedUnion` + `z.preprocess` migration pattern.
- `src/errors.ts` — existing `FacilityNotFoundError` pattern for the new `RecAreaNotFoundError`-equivalent.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `resolveFacility()` in `src/recreation-gov/client.ts` — direct pattern to mirror for `resolveArea()`: same RIDB base URL, same retry/fetch/zod-parse pipeline, same top-match + alternatives shape.
- `resolveWatches()`'s per-run `Map` cache in `src/config/watches.ts` (lines ~68-90) — reuse for area-criteria caching within a single poll run.
- `RidbFacilitySearchSchema` in `src/recreation-gov/types.ts` — likely needs a sibling `RidbRecAreaSearchSchema`/`RidbRecAreaFacilitiesSchema` for the new `/recareas` endpoints (different response envelope shape than `/facilities` — verify field names live).

### Established Patterns
- Every RIDB/availability response is zod-parsed before field access — no exceptions, per module doc comment in `client.ts`.
- `ClientOptions` (optional `ridbApiKey`, `fetchImpl`, `sleep`) — client module never reads env vars directly; config loader passes credentials in.
- Explicit-override escape hatch pattern (`Watch.facilityId` today) — D-02 extends this to `recAreaId`.

### Integration Points
- `src/config/watches.ts` `resolveWatches()` — gains the `type === 'area'` branch.
- `src/run.ts` — needs the group-by-watch-id aggregation change (today assumes 1 `ResolvedWatch` → 1 `WatchOutcome`); this is the one structurally significant change per ARCHITECTURE.md.
- `dashboard/lib/types.ts`, `dashboard/lib/schema.ts` — mirror the discriminated union so the dashboard doesn't crash rendering an area watch, and so D-05/D-06's standard-vs-group tag can render in match output.

</code_context>

<specifics>
## Specific Ideas

- User's actual usage pattern is mostly 1-2 tent campsites — group-campground matches should be clearly, unmissably tagged as "group" in output so they're not confused with a real 1-2-person tent site opening up.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Lat/long+radius search already lives in REQUIREMENTS.md as v2-deferred AREA-06; per-facility allowlist/denylist already lives as v2-deferred MGMT-07.)

</deferred>

---

*Phase: 04-area-based-search*
*Context gathered: 2026-08-25*
