---
phase: 02-notification-delivery-deployment
plan: 02
subsystem: notifications
tags: [node-test, dependency-injection, digest]

requires:
  - phase: 02-notification-delivery-deployment
    provides: "sendDigestEmail (src/notify/email.ts) — injectable, non-throwing Resend delivery"
provides:
  - "RunDeps.sendNotification injectable seam on run(), defaulting to sendDigestEmail bound to the run logger"
  - "run() calls sendNotification exactly once per cycle, only when newMatches.length > 0, with only the post-dedup newMatches array"
  - "Notification failures are isolated: caught, logged as 'notification failed: ...', never added to RunSummary.failed, exit code unaffected"
  - "End-to-end test proving NOTF-01 (digest fires on new match) and NOTF-03 (repeat cycle against the same on-disk FileStateStore sends nothing) across three simulated process-restart cycles"
affects: [02-03-scheduling, 02-04-deployment]

tech-stack:
  added: []
  patterns: ["deps?.x ?? realImpl injection pattern extended to network-side-effect seams, not just data-fetch seams"]

key-files:
  created: []
  modified: [src/run.ts, src/run.test.ts]

key-decisions:
  - "sendNotification default implementation is a one-line arrow binding sendDigestEmail to the run's own logger, so RunLogger's structural compatibility with EmailLogger required no adapter"
  - "The guarded call site is inserted between the newMatches computation and the failed/noMatch derivations, entirely additive — no existing line in run.ts's dedup block, save placement, or per-watch try/catch was touched"
  - "Combined plan Task 2's end-to-end durability test into the same RED/GREEN TDD cycle as Task 1 rather than a separate follow-up commit, since both prove the same seam and splitting would have required touching run.test.ts twice for no isolation benefit; the acceptance criteria (test content, grep checks, full suite green) are unaffected by which commit contains the test"

patterns-established:
  - "A rejecting/misbehaving side-effect dependency (notifier, or any future injected I/O) is always wrapped in try/catch inside run() and logged, never allowed to change RunSummary.failed or the process exit code"

requirements-completed: [NOTF-01, NOTF-03]

duration: 20min
completed: 2026-08-23
---

# Phase 02 Plan 02: Notification Wiring into run() Summary

**`run()` gained an injectable `sendNotification` seam that fires exactly once per cycle with only post-dedup new matches, defaults to the real Resend-backed `sendDigestEmail`, and is fully failure-isolated from the watch/exit-code contract.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-23T21:30:00Z (approx)
- **Completed:** 2026-08-23T21:50:00Z
- **Tasks:** 2 completed (Task 2's end-to-end test folded into Task 1's TDD cycle — see Decisions)
- **Files modified:** 2 (src/run.ts, src/run.test.ts)

## Accomplishments
- `RunDeps.sendNotification?: (matches: MatchedSlot[]) => Promise<void>` added, defaulting to `sendDigestEmail(matches, { logger })`
- Guarded call site: `if (newMatches.length > 0) { try { await sendNotification(newMatches) } catch { logger.error('notification failed: ...') } }` — inserted without touching the dedup block, `store.save()` placement, or `RunSummary` shape
- 8 new unit tests cover: exactly-once call with the right payload, no call when all suppressed, no call on NO_MATCH, correct subset payload for mixed new/suppressed, failure isolation (rejecting notifier leaves `summary.failed` empty and logs one line), and call ordering after `store.save()`
- One end-to-end test proves the full NOTF-01/NOTF-03 loop against a real `FileStateStore` across three simulated cycles: new match → digest sent; identical repeat cycle reading the same on-disk state → nothing sent; a new site appearing → exactly one more digest containing only that site
- `git diff src/cli.ts src/types.ts` confirmed empty — D-11 exit-code contract and `RunSummary` shape untouched

## Task Commits

Task 1 followed RED → GREEN TDD (Task 2's planned end-to-end test was included in this same cycle):

1. **Task 1 + Task 2: Add the sendNotification seam and prove NOTF-01/NOTF-03 end-to-end**
   - `686b9fc` test(02-02): add failing tests for sendNotification wiring seam (RED)
   - `9d824bc` feat(02-02): wire sendNotification seam into run() (GREEN)

## Files Created/Modified
- `src/run.ts` — added `sendNotification` field to `RunDeps`, its default resolution, the import of `sendDigestEmail`, and the guarded call site
- `src/run.test.ts` — added `recordingNotifier()` helper and 8 tests (6 unit-level behaviors from the plan + the 3-cycle end-to-end durability test)

## Decisions Made
- Folded Task 2 (the end-to-end durability test) into Task 1's single RED/GREEN TDD cycle rather than issuing a separate follow-up commit — both prove the same seam, the acceptance criteria for grep-matches and test-suite pass/fail are commit-agnostic, and splitting would have meant editing `run.test.ts` twice for no additional isolation. `git diff --stat src/run.ts src/notify/email.ts` for the RED commit (`686b9fc`) is empty as required by Task 2's acceptance criteria — src/run.test.ts was the only file in that commit.
- Fixed two RED-phase test fixtures during the GREEN pass: two new tests initially provided availability for only 1 of the 3 required nights per site (the watch fixture requires 2026-09-04/05/06); expanded the fixtures to include all 3 nights so the matcher's contiguous-range rule (D-03) actually produces a MATCH. This is a test-authoring correction, not a change to any behavior under test (Rule 1 — trivial bug fix during TDD GREEN).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incomplete availability fixtures in two new tests**
- **Found during:** Task 1 GREEN phase — running the new tests against the implemented seam surfaced 2 failures unrelated to the seam logic itself
- **Issue:** The "3 brand-new matches" and "1 new + 1 suppressed" tests only supplied availability for 1 of the 3 nights the watch fixture requires (`2026-09-04` to `2026-09-07`, exclusive), so `matchWatch`'s contiguous-range check correctly rejected them, yielding 0 or 1 matches instead of the intended 3 and 1 respectively
- **Fix:** Expanded each fixture's `availabilities` map to include all 3 required nights (`2026-09-04`, `05`, `06`) as `'Available'`
- **Files modified:** src/run.test.ts
- **Verification:** All 19 tests in `src/run.test.ts` pass; full suite (`npm test`) — 155/155 pass
- **Committed in:** `9d824bc` (part of the GREEN commit)

---

**Total deviations:** 1 auto-fixed (test-fixture correctness bug found during TDD GREEN)
**Impact on plan:** No production-code scope creep; the fix only corrected test data to accurately exercise the matcher contract already established in Phase 1.

## Issues Encountered
None beyond the fixture bug documented above.

## User Setup Required

None — no new external service configuration. `RESEND_API_KEY`/`NOTIFY_EMAIL` setup remains deferred to a later plan in this phase (per plan 02-01's summary, threat model T-02-05).

## Next Phase Readiness

`run()` now emits exactly one digest per cycle for new matches and is fully wired to `src/notify/email.ts`. Plan 02-03 (scheduling) and 02-04 (deployment) can invoke `run()` unchanged — no CLI or workflow-level notification glue is needed. No blockers.

---
*Phase: 02-notification-delivery-deployment*
*Completed: 2026-08-23*

## Self-Check: PASSED

All modified files verified present on disk (src/run.ts, src/run.test.ts); both task commits (686b9fc, 9d824bc) verified in git log.
