---
phase: 04-area-based-search
plan: 05
subsystem: api
tags: [ridb, zod, area-search, resolver, node-test]

# Dependency graph
requires:
  - phase: 04-area-based-search (04-02)
    provides: "Watch discriminated union (FacilityWatch | AreaWatch), flat ResolvedWatch, TruncationInfo"
  - phase: 04-area-based-search (04-03)
    provides: "resolveArea() and listAreaFacilities() in src/recreation-gov/client.ts"
provides:
  - "resolveWatches() area branch: expands each named area to filtered reservable campgrounds"
  - "AREA_FACILITY_CAP = 20, shared across all areas in one watch, applied after filter+dedup, before polling"
  - "ResolveResult.truncations: Array<{ watchId, requested, kept }> for run.ts to consume"
  - "Per-run areaCache memoizing the resolved facility list per unique area (name or recAreaId)"
  - "Per-watch failure isolation preserved: a bad area name or zero-facility area fails only its own watch"
affects: [04-06, run.ts, dashboard write-path]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-run Map<string, Promise<T>> memoization keyed by normalized name or explicit id override, shared by both the facility and area resolution paths"
    - "Cap-after-filter-and-dedup pattern: collect -> dedup by id -> slice(0, CAP) -> record truncation, never re-sorted"

key-files:
  created: []
  modified:
    - src/config/watches.ts
    - src/config/watches.test.ts

key-decisions:
  - "AREA_FACILITY_CAP (20) is unconditional and shared across all areas in one watch (D-10) — there is no UI in this phase to also gate it, so this resolver is the sole enforcement point"
  - "A zero-facility area watch throws into the existing per-watch try/catch rather than special-casing, keeping failure isolation uniform across facility and area watches"
  - "ridbCallCount is logged (not enforced) per RESEARCH.md Pitfall 1 — a realistic single-user config stays comfortably under RIDB's 50 req/min, so visibility beats a premature TTL cache"

requirements-completed: [AREA-01, AREA-02, AREA-03]

# Metrics
duration: 35min
completed: 2026-08-26
---

# Phase 4 Plan 5: Area-Aware resolveWatches() Summary

**Taught resolveWatches() to expand AreaWatch entries into deduplicated, cap-enforced ResolvedWatch lists via resolveArea()/listAreaFacilities(), while keeping the facility path byte-identical in behavior.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-08-25T20:56:00Z (approx, per worktree base commit history)
- **Completed:** 2026-08-26T01:30:29Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `resolveWatches()` now branches on `watch.type`, producing the flat `ResolvedWatch` shape for both `facility` and `area` watches with no spread of the union-typed input
- Area watches expand to every reservable campground across all their listed areas, deduped by `facilityId`, capped at `AREA_FACILITY_CAP = 20` shared across the whole watch (not per-area)
- `ResolveResult` gained a `truncations: Array<{ watchId, requested, kept }>` field so `run.ts` (plan 04-06) can surface truncation without recomputing it
- Per-run `areaCache` memoizes the fully resolved+filtered facility list per unique area (keyed by `recAreaId` override or normalized name), so two watches naming the same area cost exactly one `resolveArea` + one `listAreaFacilities` call
- A bad area name (`RecAreaNotFoundError`) or a zero-facility area produces exactly one `failures` entry for its own watch id and never blocks other watches
- A per-run `logger.info('RIDB resolution calls this run: N')` line lands request-budget visibility in every run's log (RESEARCH.md Pitfall 1)

## Task Commits

Each task was committed atomically:

1. **Task 1: Adapt the facility branch to the union and widen ResolveResult** - `8f79555` (feat)
2. **Task 2: Implement the area branch with the shared 20-facility cap** - `7b31506` (feat)

_Note: TDD tasks were implemented behavior-first with tests added alongside each task's implementation in the same commit, per this plan's `tdd="true"` task markers; both RED and GREEN were verified locally (all new tests passing) before each commit._

## Files Created/Modified
- `src/config/watches.ts` - `resolveWatches()` now branches on `watch.type`; facility path produces the flat six-field `ResolvedWatch` (no more `...watch` spread); new area branch expands/dedupes/caps area watches; `AREA_FACILITY_CAP` exported; `ResolveResult.truncations` added; `ResolveWatchesOptions` gained injectable `resolveArea`/`listAreaFacilities`
- `src/config/watches.test.ts` - Added 15 new tests covering the flat resolved shape, empty-input truncations, area expansion/ordering/cap/dedup/cache/failure-isolation, zero-facility failure, truncation warning text, and the RIDB call-count log line — all network-free via injected resolver stubs

## Decisions Made
- Cap is applied unconditionally at the resolver, the only enforcement point in this phase (no dashboard UI yet) — matches the plan's threat model disposition for T-04-02
- `logger.info`/`logger.warn` text for area resolution mirrors the existing facility-resolution log format for consistency (`resolved "X" -> recArea N (name)` / `other RIDB areas for "X": ...`)
- Zero-facility areas throw a plain `Error` (not a new error class) since `describeFailure` already passes through generic `Error.message` verbatim, and the message contains no credential or URL

## Deviations from Plan

None - plan executed exactly as written. All `<behavior>` cases and acceptance-criteria greps from both tasks are implemented and verified.

## Issues Encountered

Initial task execution wrote Task 1 and Task 2 code together in one pass (since both were read into context up front); to preserve atomic per-task commits as required by the execution protocol, the combined implementation was split by writing an intermediate Task-1-only version of `watches.ts`/`watches.test.ts` (facility branch only, matching the plan's Task 1 action block exactly, including a placeholder comment for the area branch), committing that, then restoring the Task 2 additions (area branch, `AREA_FACILITY_CAP`, `areaCache`, `ridbCallCount` logging, and the corresponding tests) and committing separately. Both intermediate and final states were verified with `npx tsc --noEmit` and `npm test` before each commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `ResolveResult.truncations` is ready for plan 04-06 (`run.ts`) to consume directly and surface via `WatchOutcome.truncated`
- `resolveWatches()` is fully area-aware; `run.ts` and its tests (currently showing pre-existing, out-of-scope tsc errors per this plan's dependency note) can now be updated in 04-06 without further changes to `src/config/watches.ts`
- No blockers identified

---
*Phase: 04-area-based-search*
*Completed: 2026-08-26*

## Self-Check: PASSED

- FOUND: src/config/watches.ts
- FOUND: src/config/watches.test.ts
- FOUND: .planning/phases/04-area-based-search/04-05-SUMMARY.md
- FOUND commit: 8f79555 (Task 1)
- FOUND commit: 7b31506 (Task 2)
