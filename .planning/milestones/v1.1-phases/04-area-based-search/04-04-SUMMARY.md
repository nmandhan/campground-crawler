---
phase: 04-area-based-search
plan: 04
subsystem: ui
tags: [nextjs, zod, dashboard, area-search, hand-mirrored-types]

# Dependency graph
requires:
  - phase: 04-area-based-search (plan 04-02)
    provides: "FacilityWatch | AreaWatch discriminated union, MatchedSlot.facilityType, WatchOutcome.truncated/facilityFailures in src/types.ts and src/config/schema.ts"
provides:
  - "dashboard/lib/types.ts and dashboard/lib/schema.ts mirroring the poller's area-watch union"
  - "watchLabel(watch) — the single place a Watch becomes display text"
  - "Area-aware status rows (deriveWatchStatuses) surfacing truncation and per-facility failures"
  - "Per-campground match attribution (deriveActiveMatches) with group-campground [GROUP] flagging"
affects: [04-05, phase-05-watch-management-write-path]

# Tech tracking
tech-stack:
  added: []
  patterns: ["hand-mirrored type/schema pairs kept in sync via _assert compile-time checks", "watchLabel() as single label-formatting entry point"]

key-files:
  created: []
  modified:
    - dashboard/lib/types.ts
    - dashboard/lib/schema.ts
    - dashboard/lib/schema.test.ts
    - dashboard/lib/format.ts
    - dashboard/lib/format.test.ts
    - dashboard/lib/derive-status.ts
    - dashboard/lib/derive-status.test.ts
    - dashboard/lib/derive-active-matches.ts
    - dashboard/lib/derive-active-matches.test.ts

key-decisions:
  - "Mirrored the poller's exact WatchSchema preprocess guard (no-type -> facility) into the dashboard so legacy watches.json entries keep rendering"
  - "MatchedSlotSchema.facilityType defaults to 'standard' so pre-Phase-4 runs.json entries parse without a migration step"
  - "Active-match attribution looks up the specific MatchedSlot in the latest run (reusing isStillOpen's lookup) rather than deriving the campground name from the watch itself"

patterns-established:
  - "watchLabel(watch): string is the only place a Watch becomes display text across the dashboard"

requirements-completed: [AREA-01, AREA-02, AREA-05]

# Metrics
duration: 3min
completed: 2026-08-25
---

# Phase 4 Plan 4: Dashboard Area-Aware Rendering Summary

**Mirrored the poller's FacilityWatch/AreaWatch union into dashboard/lib by hand, added watchLabel() as the single label-formatting entry point, and made both derive modules area-aware (per-campground match attribution, group-campground flagging, truncation/failure surfacing).**

## Performance

- **Duration:** ~3 min (task commits 14:45:00 -> 14:47:18 local time)
- **Started:** 2026-08-25T20:44:xx Z (approx, not recorded at agent start)
- **Completed:** 2026-08-25T20:47:18Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- `dashboard/lib/types.ts` / `dashboard/lib/schema.ts` mirror `src/types.ts` / `src/config/schema.ts` exactly by hand, with zero cross-boundary imports and the same no-type -> facility migration preprocess
- `watchLabel(watch)` gives every area watch a real, unmistakable label (`"X + Y (area)"`), and every facility watch keeps its `parkName`
- Status rows (`deriveWatchStatuses`) surface truncation (`showing N of M campgrounds`) and per-facility failures (`N campgrounds could not be checked`) without disturbing any pre-existing detail string
- Active-match rows (`deriveActiveMatches`) now name the specific campground that matched an area watch (AREA-05), flag group campgrounds with `[GROUP]` (D-05), and fall back to `watchLabel(watch)` then the raw `watchId` when no match/watch is found

## Task Commits

Each task was committed atomically:

1. **Task 1: Mirror the Watch union and outcome fields into dashboard/lib** - `7051d27` (feat)
2. **Task 2: Add watchLabel() and make status rows area-aware** - `dcd5291` (feat)
3. **Task 3: Attribute active matches to the specific campground** - `6ec3c18` (feat)

**Plan metadata:** committed by orchestrator after worktree merge (worktree mode — this agent does not create the metadata commit)

_Note: no TDD RED/GREEN split — tests were added alongside implementation in each task, matching the existing dashboard/lib test-alongside-source convention._

## Files Created/Modified
- `dashboard/lib/types.ts` - FacilityWatch/AreaWatch union, TruncationInfo, FacilityFailure, MatchedSlot.facilityType, WatchOutcome.truncated/facilityFailures
- `dashboard/lib/schema.ts` - FacilityWatchSchema/AreaWatchSchema + preprocessed discriminated union, MatchedSlotSchema.facilityType (default 'standard'), WatchOutcomeSchema truncated/facilityFailures on all 3 variants
- `dashboard/lib/schema.test.ts` - coverage for legacy facility watches, area watches (incl. empty areas), group facilityType, truncated/facilityFailures
- `dashboard/lib/format.ts` - `watchLabel(watch)` 
- `dashboard/lib/format.test.ts` - watchLabel coverage (facility, single area, multi-area, empty areas)
- `dashboard/lib/derive-status.ts` - `parkName: watchLabel(watch)` in all 4 branches, `outcomeSuffix()` appending truncation/failure text to detail
- `dashboard/lib/derive-status.test.ts` - area-label and truncation/failure detail coverage, plus `type: 'facility'` added to existing fixtures
- `dashboard/lib/derive-active-matches.ts` - `findMatchedSlot()` helper, per-campground `parkName` attribution with `[GROUP]` flag and `watchLabel` fallback
- `dashboard/lib/derive-active-matches.test.ts` - AREA-05 attribution, group-flagging, and area-fallback coverage, plus `type: 'facility'`/`facilityType: 'standard'` added to existing fixtures

## Decisions Made
- Preserved every existing `_assert*` drift-check line and the "no `.min(1)`/no unique-id refine on `WatchesSchema`" read-only-viewer convention, adding new fields (`facilityType`, `truncated`, `facilityFailures`) as optional/defaulted so historical `runs.json`/`watches.json` data keeps parsing unchanged
- Kept `WatchStatusRow.parkName` and `ActiveMatchRow.parkName` field NAMES unchanged (only their computed values changed) since `dashboard/app/sections.tsx` renders `row.parkName` and is explicitly out of scope for this plan

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `npx tsc --noEmit` fails on a pre-existing, unrelated `tsconfig.json` error (`Option 'baseUrl' has been removed`) that predates this plan and is outside its file scope (`tsconfig.json` was not touched). Confirmed via the acceptance criterion's own grep (`tsc --noEmit 2>&1 | grep -c "lib/types.ts\|lib/schema.ts"` returns `0`) that no new type errors were introduced by this plan's changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Dashboard now renders area watches without crashing, labels them clearly, attributes matches to the specific campground, flags group campgrounds, and surfaces truncation/per-facility-failure info — unblocking Phase 5's watch-management write UI, which depends on the dashboard's finalized `Watch` type.
- `dashboard/app/sections.tsx` (out of scope here) still renders `row.parkName` directly and needs no changes to pick up this plan's work, since only the underlying value changed, not the field name.

---
*Phase: 04-area-based-search*
*Completed: 2026-08-25*

## Self-Check: PASSED

All 9 modified files confirmed present on disk; all 3 task commits (7051d27, dcd5291, 6ec3c18) confirmed present in `git log`.
