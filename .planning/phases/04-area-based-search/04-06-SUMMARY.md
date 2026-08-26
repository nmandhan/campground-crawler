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
duration: 55min
completed: 2026-08-26
---

# Phase 4 Plan 6: run() Group-Then-Aggregate Restructure Summary (Tasks 1-2 complete; Task 3 checkpoint pending)

**Restructured `run()`'s flat 1:1 watch loop into group-then-aggregate by watch id, carrying `facilityType` from the matcher into the email digest's `[GROUP]` tag, so an N-facility area watch collapses into exactly one `WatchOutcome` with per-facility failure isolation and truncation attribution.**

## Status

Tasks 1 and 2 (both `type="auto"`) are complete, committed, and verified. Task 3 is a
`checkpoint:human-verify` gate (`gate="blocking"`) requiring a live `RIDB_API_KEY` and real
Recreation.gov traffic against a real multi-campground Recreation Area — this cannot be
exercised by Claude. Execution is paused at this checkpoint per the plan's execution protocol;
see the checkpoint message returned alongside this summary for the exact verification steps
handed to the developer.

## Performance

- **Duration:** 55 min (Tasks 1-2 only; Task 3 duration TBD pending developer verification)
- **Tasks:** 2 of 3 complete (Task 3 blocked on live human verification)
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

Task 3 (checkpoint:human-verify, blocking) is pending developer action — not yet executed.

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

## Issues Encountered

None beyond the Rule 3 fixes documented above.

## User Setup Required

Task 3's live verification requires a `RIDB_API_KEY` and a temporary edit to `watches.json` —
see the checkpoint message for exact steps. No permanent setup required.

## Next Phase Readiness

- Tasks 1-2 are code-complete, tested, and committed. Phase 4 cannot be marked complete until
  Task 3's live end-to-end verification is confirmed by the developer (exactly one
  `tmp-area-check` outcome in both the log and `runs.json`, plausible campground names, no
  `apikey` leakage, `watches.json` restored).
- Once Task 3 is approved, this SUMMARY should be updated with the live-verification evidence
  (resolved campground names) per the plan's `<output>` spec, and the phase can be marked
  complete.

---
*Phase: 04-area-based-search*
*Status: Tasks 1-2 complete; Task 3 (blocking checkpoint) awaiting developer verification*

## Self-Check: PASSED

- FOUND: src/matcher/match.ts
- FOUND: src/notify/email.ts
- FOUND: src/run.ts
- FOUND: .planning/phases/04-area-based-search/04-06-SUMMARY.md
- FOUND commit: c746c68 (Task 1)
- FOUND commit: 9a98a5f (Task 2)
