---
phase: 04-area-based-search
plan: 06
subsystem: pipeline
tags: [aggregation, run-loop, matcher, email, node-test]

# Dependency graph
requires:
  - phase: 04-area-based-search (04-05)
    provides: "resolveWatches() area-aware, ResolveResult.truncations"
  - phase: 04-area-based-search (04-02)
    provides: "MatchedSlot.facilityType, TruncationInfo, FacilityFailure, WatchOutcome.truncated/facilityFailures"
provides:
  - "src/matcher/match.ts: facilityType carried from ResolvedWatch onto every MatchedSlot"
  - "src/notify/email.ts: [GROUP] tag on group-campground digest section headers"
  - "src/run.ts: group-then-aggregate restructure — one WatchOutcome per watch id, per-facility failure isolation, truncation attachment, checked counts watches not facilities"
affects: [dashboard, runs.json consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Group-then-aggregate: Map<string, ResolvedWatch[]> keyed by watch id, built once, iterated to produce exactly one outcome per key — closes ARCHITECTURE.md Anti-Pattern 2 structurally rather than incidentally"
    - "Per-facility try/catch inside the per-watch aggregation loop: a watch is only FAILED when every facility in its group failed; partial failure degrades to MATCH/NO_MATCH plus a facilityFailures array"

key-files:
  created: []
  modified:
    - src/matcher/match.ts
    - src/matcher/match.test.ts
    - src/notify/email.ts
    - src/notify/email.test.ts
    - src/run.ts
    - src/run.test.ts
    - src/runSummaryFile.test.ts

key-decisions:
  - "checked counts groups.size + failures.length (distinct watches attempted), not facilities polled — a 20-campground area watch is 1, matching every existing dashboard consumer's assumption"
  - "A watch is FAILED only when facilityFailures.length === facilities.length; any partial success reports MATCH or NO_MATCH with facilityFailures attached, per RESEARCH.md Open Question 3"
  - "truncationByWatch lookup applies to both resolution-failure (FAILED from loadResolved().failures) and post-poll outcomes, so a watch whose resolution failed entirely still surfaces its truncation"

requirements-completed: [AREA-01, AREA-02, AREA-05]

# Metrics
duration: 75min
completed: 2026-08-26
---

# Phase 4 Plan 6: run() Group-Then-Aggregate Restructure Summary

**Restructured `run()`'s flat 1:1 watch loop into group-then-aggregate by watch id, carrying `facilityType` from the matcher into the email digest's `[GROUP]` tag, so an N-facility area watch collapses into exactly one `WatchOutcome` with per-facility failure isolation and truncation attribution — live-verified end to end against a real 2-area, 70-campground Recreation.gov region.**

## Status

All 3 tasks complete. Tasks 1 and 2 (`type="auto"`) were implemented, tested, and committed.
Task 3 (`checkpoint:human-verify`, `gate="blocking"`) was live-verified by the developer against
real RIDB/Recreation.gov traffic — see Live Verification Evidence below.

## Performance

- **Duration:** 75 min (Tasks 1-2 implementation + Task 3 live verification)
- **Tasks:** 3 of 3 complete
- **Files modified:** 7

## Accomplishments

- `matchWatch()` now stamps every `MatchedSlot` with `facilityType: watch.facilityType` — the matcher stays a pure module (no new imports)
- `buildBody()` in `src/notify/email.ts` labels a group-campground section `[GROUP]` in its header (e.g. `Hume Lake Group [GROUP] — watch "sierra"`) while leaving `sanitize()`, `safeBookingUrl()`, `buildSubject()`, and the per-campground grouping key (`${m.watchId} ${m.facilityName}`) untouched
- `run()`'s flat `for (const watch of resolved)` loop is replaced by a `Map<string, ResolvedWatch[]>` group-then-aggregate structure: three `ResolvedWatch` entries sharing id `'sierra'` now produce exactly ONE outcome, closing ARCHITECTURE.md Anti-Pattern 2 structurally
- Per-facility failures are isolated with their own `try/catch`: one flaky campground inside an area watch no longer hides matches found on its healthy siblings; a watch is `FAILED` only when every facility in its group failed
- `ResolveResult.truncations` is attached to the matching outcome via a `truncationByWatch` lookup, applied to both resolution-failures and post-poll outcomes (so a watch whose entire resolution failed still surfaces its truncation)
- `checked` now counts `groups.size + failures.length` (distinct watches attempted), not facility count — a 20-campground area watch counts as 1, not 20
- `dedupKey(watchId, campsiteId, startDate, endDate)` is unchanged (verified via `git diff --stat src/state/store.ts` showing no changes); a campsite reported by two facilities in the same group is suppressed correctly, not double-notified

## Task Commits

1. **Task 1: Carry facilityType through the matcher and into the email digest** - `c746c68` (feat)
2. **Task 2: Restructure run() to group-then-aggregate by watch id** - `9a98a5f` (feat)
3. **Task 3: Verify an area watch end to end against live Recreation.gov** - checkpoint, no code changes; verified live by the developer (see Live Verification Evidence)

## Files Created/Modified

- `src/matcher/match.ts` — one line added to the `matches.push({...})` object: `facilityType: watch.facilityType`
- `src/matcher/match.test.ts` — `parkName` removed from the local `watch()` fixture (stale field, no longer on `ResolvedWatch`), `facilityType: 'standard'` added to every fixture, new test asserting a `group`-type watch yields `group`-type matches
- `src/notify/email.ts` — `groups` Map value type widened to carry `facilityType`; section header appends `groupTag` (` [GROUP]` or `''`) ahead of the existing `sanitize(group.facilityName)` call
- `src/notify/email.test.ts` — `facilityType: 'standard'` added to the `matched()` fixture; two new tests for the `[GROUP]` tag present/absent
- `src/run.ts` — new `groups`/`truncationByWatch` construction, group-then-aggregate loop replacing the flat loop, `checked` fixed to `groups.size + failures.length`, `NO_MATCH` log lookup changed from `resolved.find(...)` to `groups.get(outcome.watchId)?.[0]`
- `src/run.test.ts` — `parkName` removed from the `watch()` fixture, `loadResolvedOf()` widened to accept `truncations`, 14 new tests covering single-outcome-per-group, cross-facility match aggregation with attribution, poll ordering, partial/total facility failure, truncation attachment (including on a fully-failed watch), `facilityFailures` key omission when empty, `checked` counting watches not facilities, cross-facility dedup suppression, and the NO_MATCH night-count log line for a group
- `src/runSummaryFile.test.ts` — added `facilityType: 'standard'` to two pre-existing `MatchedSlot` fixtures (out-of-scope file per this plan's file list, but its missing field was blocking `npx tsc --noEmit` across the whole repo — Rule 3 blocking-issue fix)

## Decisions Made

- `checked` semantics: watches attempted, not facilities polled — matches every existing dashboard consumer's assumption and avoids inflating the number up to 20x per area watch (T-04-23)
- A watch is `FAILED` only when 100% of its facilities failed; any partial success is reported as `MATCH`/`NO_MATCH` with `facilityFailures` attached, so a transient error on one campground in a 15-campground watch cannot mask real openings on the other 14 (T-04-06)
- `truncationByWatch` construction moved ahead of the initial `failures.map(...)` mapping so a watch whose resolution failed entirely can still carry its `truncated` field

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Fixed stale `ResolvedWatch.parkName` field and missing `MatchedSlot.facilityType` blocking whole-repo `npx tsc --noEmit`**
- **Found during:** Task 1/Task 2 pre-flight `npx tsc --noEmit` check
- **Issue:** `src/matcher/match.test.ts` and `src/run.test.ts` fixtures still constructed `ResolvedWatch` objects with a `parkName` field that no longer exists on the type (removed in an earlier phase-4 plan when `Watch` became a discriminated union). `src/runSummaryFile.test.ts` (not in this plan's `files_modified` list) had two `MatchedSlot` fixtures missing the now-required `facilityType` field.
- **Fix:** Removed `parkName` from the `watch()` fixtures in `match.test.ts` and `run.test.ts`; added `facilityType: 'standard'` to all affected fixtures, including the two in `runSummaryFile.test.ts`.
- **Files modified:** `src/matcher/match.test.ts`, `src/run.test.ts`, `src/runSummaryFile.test.ts`
- **Commit:** `c746c68` (match.test.ts), `9a98a5f` (run.test.ts, runSummaryFile.test.ts)

### Logged, Not Fixed (Out of Scope)

**dashboard/tsconfig.json: `baseUrl` removed in newer TypeScript** — `npx tsc --noEmit` inside `dashboard/` fails with `TS5102: Option 'baseUrl' has been removed`. Pre-existing since the dashboard scaffold commit (`2199d88`, plan 03-02), unrelated to any file this plan touches; `dashboard/tsconfig.json` was not modified. `dashboard`'s `npm test` passes (88/88) — this is a type-check-only config issue. Logged to `.planning/phases/04-area-based-search/deferred-items.md`.

## Verification Evidence

- `npm test` (root, `src/`): 216/216 passing
- `npx tsc --noEmit` (root, whole repo): 0 errors
- `cd dashboard && npm test`: 88/88 passing
- `cd dashboard && npx tsc --noEmit`: fails on a pre-existing, out-of-scope config issue (see Deviations)
- `git diff --stat src/state/store.ts`: no changes (dedup store untouched, as required)
- Acceptance-criteria greps for both tasks (see plan `04-06-PLAN.md` Task 1/Task 2 `<acceptance_criteria>`) all pass

## Live Verification Evidence (Task 3)

Verified by the developer (authorized run against a temporary `tmp-area-check` area watch,
`watches.json` and `state.json` both restored afterward — no test artifacts committed):

- **First attempt (bare area names, no `recAreaId` override):** both "Sequoia National Forest"
  and "Sierra National Forest" RIDB text-search top-matched the wrong RecArea ("Kiavah
  Wilderness", id 14780 — a wilderness area with no reservable campgrounds). This is a known
  RIDB fuzzy-match quirk (the same class of mismatch seen during 04-01's fixture capture, where
  "Yosemite National Park" top-matched "Wrangell - St Elias"). The system produced exactly one
  clean outcome line — `FAILED tmp-area-check — no reservable campgrounds found across 2 area(s)`
  — not a crash, not a silent wrong match, confirming resolveWatches()'s per-watch failure
  isolation extends correctly to this failure mode.
- **Second attempt, using the `recAreaId` override escape hatch (D-02)** with the correct IDs
  (1072, 1074, confirmed via direct RIDB API query):
  - `resolved area "..." -> recArea <id> (<name>)` lines present per area
  - a single `RIDB resolution calls this run: N` line present
  - `watch "tmp-area-check" resolved 70 campgrounds — showing 20 of 70 (capped at AREA_FACILITY_CAP=20)`
    — the truncation warning surfaced correctly
  - exactly ONE result line for `tmp-area-check` in the console log
    (`OK tmp-area-check — 76 new, 0 already notified: ...`), not one per campground
  - via `RUN_SUMMARY_FILE`, the structured run-summary equivalent of what CI appends to
    `runs.json` contained exactly ONE outcome object with `"watchId": "tmp-area-check"`,
    including `"truncated": {"requested": 70, "kept": 20}`
  - all 5 unique resolved facility names are plausible campgrounds — **COY FLAT, FRENCH GULCH,
    QUAKING ASPEN, WISHON, WISHON CABIN** — each tagged `"facilityType": "standard"`; no visitor
    centers, boat ramps, or day-use areas (AREA-03 filter confirmed working at region scale)
  - no `apikey` value anywhere in console output (grep-verified)
  - `watches.json` restored to pre-test contents (`git diff watches.json` empty)
  - `state.json` (dedup store), polluted by the test run's 76 matches, reverted
    (`git checkout -- state.json`) so no test artifacts leak into dedup history

All Task 3 acceptance criteria met: exactly one `tmp-area-check` outcome in both the log and the
run summary, every resolved facility name plausibly a campground, no `apikey` leakage,
`watches.json` restored.

## Issues Encountered

None beyond the Rule 3 fixes documented above and the expected RIDB fuzzy-match miss on bare
area names during Task 3's first live-verification pass (correctly handled by existing
per-watch failure isolation, no code change required).

## User Setup Required

None — Task 3's live verification (requiring a `RIDB_API_KEY` and a temporary `watches.json`
edit) is complete; no further setup needed.

## Next Phase Readiness

- All 3 tasks are complete, tested, committed, and live-verified. Phase 4's `run()` restructure
  is production-ready.
- The RIDB fuzzy-match quirk observed during live verification (bare area names occasionally
  top-matching the wrong RecArea) is not a Phase 4 bug — it's the documented behavior D-02's
  `recAreaId` override exists to correct, and it was exercised successfully in this same
  verification pass. No follow-up action needed.
- No blockers identified for Phase 4 completion.

---
*Phase: 04-area-based-search*
*Status: Complete — all 3 tasks done, live-verified against real Recreation.gov traffic*

## Self-Check: PASSED

- FOUND: src/matcher/match.ts
- FOUND: src/notify/email.ts
- FOUND: src/run.ts
- FOUND: .planning/phases/04-area-based-search/04-06-SUMMARY.md
- FOUND commit: c746c68 (Task 1)
- FOUND commit: 9a98a5f (Task 2)
