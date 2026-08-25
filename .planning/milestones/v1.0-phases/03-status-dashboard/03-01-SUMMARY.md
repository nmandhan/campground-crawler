---
phase: 03-status-dashboard
plan: 01
subsystem: infra
tags: [github-actions, jq, ci, json, node-test]

requires:
  - phase: 02-notification-delivery-deployment
    provides: state.json dedup persistence and the GitHub Actions poll.yml workflow this plan extends
provides:
  - Atomic writeRunSummaryFile() writer for serialising a completed cycle's RunSummary to disk
  - CI-only wiring in src/cli.ts's runOnce() gated on RUN_SUMMARY_FILE (no local behavior change)
  - Committed, seeded runs.json (empty array) as the dashboard's run-history data source
  - Workflow steps that append each cycle to a 50-entry-capped runs.json and commit it alongside state.json in one [skip ci] bot commit
affects: [03-status-dashboard]

tech-stack:
  added: []
  patterns:
    - "Atomic tmp+rename JSON writes (mirrors src/state/fileStore.ts's save() convention)"
    - "Env-gated CI-only side effect in the thin trigger adapter (src/cli.ts), run()'s shape untouched"
    - "jq --slurpfile append-and-cap pattern for bounded JSON history logs in CI"

key-files:
  created:
    - src/runSummaryFile.ts
    - src/runSummaryFile.test.ts
    - runs.json
  modified:
    - src/cli.ts
    - .gitignore
    - .github/workflows/poll.yml

key-decisions:
  - "writeRunSummaryFile lives outside run() and is called from cli.ts's runOnce(), gated on RUN_SUMMARY_FILE, per the plan's design_decision (Option a) to keep run()'s signature untouched"
  - "runs.json entries are the full RunSummary object verbatim (no separate schema) to keep the dashboard's type copy 1:1 with src/types.ts"
  - "A synthesised FAILED entry is written when run-summary.json is absent (poller crash before returning), so the always()-run append step still produces an honest runs.json record"

patterns-established:
  - "Pattern: atomic tmp+rename writer for any future JSON artifact, matching fileStore.ts"
  - "Pattern: CI-only side effects belong in cli.ts behind an env var, never inside run()"

requirements-completed: []

duration: ~20min
completed: 2026-08-24
---

# Phase 03 Plan 01: Run-Summary Emission and CI History Log Summary

**Poller now emits a per-cycle RunSummary file in CI, appended to a rolling 50-entry-capped `runs.json` committed alongside `state.json`, giving the dashboard its sole data source.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-24
- **Tasks:** 3 completed
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- Atomic, no-op-on-falsy-path `writeRunSummaryFile()` writer, covered by 6 passing tests
- `src/cli.ts`'s `runOnce()` writes the summary only when `RUN_SUMMARY_FILE` is set (CI), leaving local `npm start` behavior unchanged
- Seeded `runs.json` (`[]`) committed to the repo so the dashboard's fetch never 404s before the first workflow run
- `.github/workflows/poll.yml` appends each cycle's summary to `runs.json`, caps it at 50 entries via `jq '.[-50:]'`, synthesizes a FAILED entry on poller crash, and commits `state.json` + `runs.json` together in one `[skip ci]` bot commit

## Task Commits

Each task was committed atomically:

1. **Task 1: Atomic run-summary file writer** - `2cda7dc` (feat)
2. **Task 2: Wire the writer into cli.ts, seed runs.json, update .gitignore** - `cc9e702` (feat)
3. **Task 3: Workflow append-and-cap step + extended commit step** - `179d625` (feat)

_No TDD task-splitting needed beyond the tdd="true" Task 1, which was implemented and tested together (writer + full test suite) in a single commit — all 6 acceptance-criteria tests pass._

## Files Created/Modified
- `src/runSummaryFile.ts` - Atomic `writeRunSummaryFile(summary, path)` writer (tmp+rename), no-op on falsy path
- `src/runSummaryFile.test.ts` - 6 tests: round-trip, formatting, no leftover `.tmp`, both falsy-path no-ops, nested directory creation
- `src/cli.ts` - `runOnce()` now calls `writeRunSummaryFile(summary, process.env.RUN_SUMMARY_FILE)` after `run()`
- `runs.json` - Seeded empty array `[]`, committed as the dashboard's run-history log
- `.gitignore` - Added `run-summary.json`, `run-summary.json.tmp`, `runs.json.tmp`, `.next/`
- `.github/workflows/poll.yml` - `RUN_SUMMARY_FILE` env var on the poller step; new "Append run to history log" step (`if: always()`, jq append-and-cap, crash-fallback FAILED entry); commit step extended to stage and push both `state.json` and `runs.json`

## Decisions Made
- Followed the plan's design_decision verbatim: `runOnce()` in `src/cli.ts` owns the CI-only write, gated on `RUN_SUMMARY_FILE`; `run()`'s signature and return shape are untouched.
- `runs.json` entries store the full `RunSummary` object as-is (no trimming/reshaping) per the plan's schema note, minimizing drift with `src/types.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Comment text collided with acceptance-criteria grep count**
- **Found during:** Task 3 (workflow append-and-cap step)
- **Issue:** The plan's suggested inline comment for the crash-fallback branch contained the literal string `` `if: always()` ``, which pushed `grep -c "if: always()" .github/workflows/poll.yml` from the expected 2 to 3, failing that task's own acceptance criterion.
- **Fix:** Reworded the comment to "so this always-run step still produces an honest record" — same meaning, no literal string collision.
- **Files modified:** `.github/workflows/poll.yml`
- **Verification:** `grep -c "if: always()" .github/workflows/poll.yml` now returns exactly 2; YAML still parses via `python3 -c "import yaml,sys;yaml.safe_load(open(...))"`.
- **Committed in:** `179d625` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Cosmetic wording fix only, no behavioral change. No scope creep.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. `RUN_SUMMARY_FILE` and the workflow steps run entirely inside the existing GitHub Actions job with no new secrets.

## Next Phase Readiness

`runs.json` (seeded, committed, capped at 50 entries per cycle) is now the dashboard's sole data source, ready for the remaining Phase 3 plans (03-02 through 03-05: reading, rendering, and deploying the dashboard against this file). No blockers.

---
*Phase: 03-status-dashboard*
*Completed: 2026-08-24*

## Self-Check: PASSED

All created files and referenced commit hashes verified present.
