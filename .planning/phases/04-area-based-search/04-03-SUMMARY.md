---
phase: 04-area-based-search
plan: 03
subsystem: api
tags: [ridb, recarea, zod, hydration, error-handling]

# Dependency graph
requires:
  - phase: 04-01
    provides: RidbRecAreaSearchSchema, RidbRecAreaFacilitiesSchema (zod schemas for RIDB RecArea endpoints, live-verified)
provides:
  - resolveArea(areaName) — resolves a RecArea name to its top-matching id/name plus alternatives
  - listAreaFacilities(recAreaId) — returns reservable campground facilities in a RecArea, filtered and tagged standard/group
  - RecAreaNotFoundError — typed error for a RecArea name matching nothing
affects: [04-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "resolveArea() is a structural mirror of resolveFacility(): new URL + searchParams, apikey header only, retryWithBackoff(fetchJson), safeParse-or-throw with formatZodIssues, [first, ...rest] destructure for top-match + alternatives"
    - "classifyFacility() is a single module-private allowlist classifier shared by both the direct-parse path and the hydration path, so filtering and tagging can never disagree"
    - "Bounded per-facility hydration (AREA_HYDRATION_LIMIT=40) with per-facility try/catch isolation — one bad facility never fails the whole area"

key-files:
  created: []
  modified:
    - src/errors.ts
    - src/recreation-gov/client.ts
    - src/recreation-gov/client.test.ts

key-decisions:
  - "classifyFacility() treats FacilityTypeDescription === undefined as 'needs hydration' (not excluded, not passed) — distinguishing 'no type data yet' from 'typed but not a campground'"
  - "Reservable !== true is treated as fail-closed (undefined Reservable is NOT reservable), matching the plan's strict-check requirement"
  - "sort=Name intentionally NOT applied to /recareas search (unlike resolveFacility), preserving RIDB's relevance ranking for top-match selection (D-09)"

patterns-established:
  - "Per-facility hydration fallback pattern: bounded loop counter + try/catch isolation, reusable for any future RIDB endpoint that may return compact stubs"

requirements-completed: [AREA-01, AREA-03]

duration: 25min
completed: 2026-08-25
---

# Phase 4 Plan 3: RecArea Resolution + Facility Filtering Summary

**Two new RIDB client calls — `resolveArea(areaName)` and `listAreaFacilities(recAreaId)` — that turn a named Recreation Area into a filtered, tagged list of reservable campground facilities, with a bounded per-facility hydration fallback and a new `RecAreaNotFoundError`.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-25T20:35Z (approx, per STATE.md phase start)
- **Completed:** 2026-08-25T20:50:53Z
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments
- `resolveArea(areaName)` resolves a RecArea name to `{ recAreaId, recAreaName, alternatives }`, throwing `RecAreaNotFoundError` on no match — a structural mirror of the existing `resolveFacility()`
- `listAreaFacilities(recAreaId)` filters `/recareas/{id}/facilities` to reservable campgrounds only (AREA-03's BANDIDO-class defense: visitor centers, boat ramps, and day-use areas are provably excluded by test), tagging survivors `'standard'` or `'group'`, preserving RIDB's returned order (D-09)
- Bounded per-facility hydration (`AREA_HYDRATION_LIMIT = 40`) covers the case where `/recareas/{id}/facilities` returns a compact stub without `FacilityTypeDescription`; one hydration failure is isolated and never fails the whole area
- 10 new network-free unit tests cover every filtering/tagging/hydration/error-path bullet in the plan's `<behavior>` section

## Task Commits

Each task was committed atomically:

1. **Task 1: Add RecAreaNotFoundError to the error taxonomy** - `2e176c9` (feat)
2. **Task 2: Implement resolveArea() and listAreaFacilities()** - `7c23ddf` (feat)

## Files Created/Modified
- `src/errors.ts` - Added `RecAreaNotFoundError` class + `describeFailure` branch, mirroring `FacilityNotFoundError` exactly
- `src/recreation-gov/client.ts` - Added `resolveArea()`, `listAreaFacilities()`, `AreaFacility`/`ResolvedRecArea` types, `AREA_HYDRATION_LIMIT` constant, module-private `classifyFacility()`/`hydrateFacility()` helpers, and bound both new functions on `createClient()`
- `src/recreation-gov/client.test.ts` - Added `describe`-style test blocks (10 new tests) for `resolveArea` and `listAreaFacilities`, using the existing injected-`fetchImpl` stub idiom (no test touches the network)

## Exact Signatures (for plan 04-05)

```typescript
export interface ResolvedRecArea {
  recAreaId: number;
  recAreaName: string;
  alternatives: string[];
}

export interface AreaFacility {
  facilityId: number;
  facilityName: string;
  facilityType: 'standard' | 'group';
}

export const AREA_HYDRATION_LIMIT = 40;

export async function resolveArea(areaName: string, opts?: ClientOptions): Promise<ResolvedRecArea>;
export async function listAreaFacilities(recAreaId: number, opts?: ClientOptions): Promise<AreaFacility[]>;
```

Both are also bound on `createClient()`'s returned object as `resolveArea` and `listAreaFacilities`.

```typescript
export class RecAreaNotFoundError extends Error {
  constructor(message: string, readonly areaName: string);
}
```

## Decisions Made
- `classifyFacility()` distinguishes three outcomes precisely: `FacilityTypeDescription === undefined` → needs hydration (caller decides); typed but not matching the campground allowlist or not `Reservable === true` → excluded; typed campground + reservable → kept and tagged. This single classifier is shared by both the direct-parse path and the post-hydration path so filtering and tagging logic can never diverge.
- `Reservable !== true` treated as fail-closed per the plan's explicit strict-check requirement (an `undefined` Reservable field never counts as reservable).
- Did not apply `sort=Name` to the `/recareas` search request (unlike `resolveFacility`'s `/facilities` search) — RIDB's default relevance ranking is preserved for top-match selection per D-09.

## Deviations from Plan

None — plan executed exactly as written. The plan's provided code blocks were used verbatim for `resolveArea`, `classifyFacility`, `hydrateFacility`, `listAreaFacilities`, and the `createClient` bindings.

One implementation detail required care during test-writing (not a deviation from the plan's action code, only from a naive test approach): the shared test helper `makeFetchImpl` clamps to the last provided `Response` for any call beyond the response array length, and a single `Response` object's body can only be read once. For the hydration-cap test (100 stub entries, 40 hydration calls) and the hydration-isolation test (one rejecting hydration), a custom `fetchImpl` was written per-test that returns a fresh `Response` per call and routes by URL/facility-id, rather than reusing `makeFetchImpl`'s clamp-to-last-response behavior. This is a test-authoring detail with no production code impact.

## Issues Encountered

During test authoring, an initial version of the "rejecting hydration call still returns successfully-resolved facilities" test used a global call-counter to decide when to return a 500 response. This interacted badly with `retryWithBackoff`'s built-in retry-on-5xx behavior (500 is retryable per `defaultIsRetryable` in `src/recreation-gov/http.ts`), causing the test's counter-based routing to produce a false pass on the wrong facility. Fixed by routing the stub response by facility id in the URL and using a non-retryable 404 for the "should fail" facility instead of a counter-based 500, which now correctly and deterministically exercises the hydration try/catch isolation path.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `resolveArea()` and `listAreaFacilities()` are exported from `src/recreation-gov/client.ts` and bound on `createClient()`, ready for plan 04-05 to call directly when building the area-watch resolution pipeline.
- `AreaFacility` and `ResolvedRecArea` types are stable and documented above for 04-05's consumption.
- No blockers identified for downstream plans.

---
*Phase: 04-area-based-search*
*Completed: 2026-08-25*

## Self-Check: PASSED
All created/modified files exist on disk; both task commits (2e176c9, 7c23ddf) verified present in git log.
