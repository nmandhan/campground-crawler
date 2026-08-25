---
phase: 01-core-polling-engine
plan: 03
subsystem: matcher-and-state
tags: [typescript, node-test, tdd, date-math, json-file-persistence, dedup]

# Dependency graph
requires:
  - phase: 01-core-polling-engine (plan 01)
    provides: "src/types.ts (AvailabilitySlot, MatchedSlot, ResolvedWatch, buildBookingUrl), src/state/store.ts (StateStore interface, StateEntry, StateFile, dedupKey)"
provides:
  - "src/matcher/dates.ts: UTC-safe nightsInRange/addDays date helpers"
  - "src/matcher/match.ts: pure matchWatch/siteTypeMatches contiguous-range matcher"
  - "src/state/fileStore.ts: FileStateStore, a durable JSON-file StateStore implementation"
affects: [run-orchestrator, cli-entrypoint, phase-02-email-and-scheduling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "UTC-safe date math via Date.UTC()/getUTCDate() instead of local-time Date parsing, to avoid timezone-dependent off-by-one-day bugs"
    - "Pure functions (no I/O) for domain logic (matcher), isolated from adapter/state modules"
    - "Atomic file writes: write to path.tmp then rename(tmp, path) to avoid truncated state on interrupted writes"
    - "Structural validation on load with graceful degradation to empty state + logged warning, never throw, for untrusted on-disk state"

key-files:
  created:
    - src/matcher/dates.ts
    - src/matcher/dates.test.ts
    - src/matcher/match.ts
    - src/matcher/match.test.ts
    - src/state/fileStore.ts
    - src/state/fileStore.test.ts
  modified: []

key-decisions:
  - "nightsInRange/addDays compute entirely via Date.UTC()/getUTCDate() and YYYY-MM-DD string comparison, never local-time Date parsing, so results are identical under any machine timezone (verified under TZ=Pacific/Kiritimati and TZ=Pacific/Midway)"
  - "matchWatch treats a missing slot for a required night as non-availability, never as availability by omission — matches T-03-05 threat mitigation"
  - "FileStateStore.load() degrades to an empty store plus a logged warning for ENOENT, invalid JSON, and structurally-invalid StateFile shapes, and drops individually malformed entries rather than the whole file where unambiguous"

patterns-established:
  - "Pattern: TDD RED/GREEN commit pairs per task (test(...) commit with failing tests, then feat(...) commit with the implementation that makes them pass)"

requirements-completed: [WATCH-02, OPS-01, POLL-02]

# Metrics
duration: ~20min
completed: 2026-08-17
---

# Phase 01 Plan 03: Matcher and Durable State Store Summary

**Pure UTC-safe contiguous-range/site-type matcher plus an atomic JSON-file dedup state store implementing `StateStore`, both fully unit-tested with no dependency on the Recreation.gov API adapter**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-17T00:05:00Z (approx)
- **Completed:** 2026-08-17T00:25:24Z
- **Tasks:** 2 completed
- **Files modified:** 6 (all newly created)

## Accomplishments
- `src/matcher/dates.ts` / `src/matcher/match.ts`: a pure matcher that requires every night in a watch's `[start, end)` range to be `available: true` for the same campsite (D-03) before it counts as a match, filtered by a four-value site-type enum with `'any'` as the only wildcard (D-04) — verified correct under three different system timezones including +14 and -11 UTC offsets
- `src/state/fileStore.ts`: `FileStateStore`, the sole implementation of the `StateStore` interface, round-trips dedup keys across process restarts, degrades a corrupt/missing/malformed `state.json` to an empty store plus a logged warning rather than crashing the poller, and writes atomically via `path.tmp` + `rename` with sorted keys for stable git diffs
- Both modules verified free of any coupling to `src/recreation-gov/` (grep-clean), satisfying the plan's parallel-execution isolation constraint

## Task Commits

Each task was committed atomically, following TDD RED -> GREEN:

1. **Task 1: Contiguous-range, site-type-filtered matcher**
   - `8ae9160` - `test(01-03): add failing tests for matcher (dates + match)` (RED)
   - `101416d` - `feat(01-03): implement contiguous-range site-type matcher` (GREEN)
   - `6142d14` - `fix(01-03): remove literal 'recreation-gov' string from matcher comment` (post-GREEN correction, see Deviations)
2. **Task 2: Durable JSON-file dedup state store**
   - `702d498` - `test(01-03): add failing tests for FileStateStore` (RED)
   - `b2851c1` - `feat(01-03): implement durable JSON-file dedup state store` (GREEN)

**Plan metadata:** committed alongside this SUMMARY.md (worktree mode — orchestrator handles the shared metadata commit after merge)

## Files Created/Modified
- `src/matcher/dates.ts` - `nightsInRange`/`addDays`, UTC-safe date helpers for `[start, end)` stay ranges
- `src/matcher/dates.test.ts` - month/year/leap-year boundary cases, reversed-range empty-array case, timezone-independence
- `src/matcher/match.ts` - `matchWatch`/`siteTypeMatches`, the pure contiguous-range site-type matcher
- `src/matcher/match.test.ts` - contiguity gap/missing-night cases, site-type filtering, sort order, non-mutation, MatchedSlot field mapping
- `src/state/fileStore.ts` - `FileStateStore`/`createFileStateStore`/`DEFAULT_STATE_PATH`, durable JSON-file `StateStore` implementation
- `src/state/fileStore.test.ts` - corrupt/missing/malformed-file recovery, round-trip persistence, atomic write, per-watch key isolation, nested-directory creation

## Decisions Made
- Used UTC-only date arithmetic (`Date.UTC`, `getUTCDate`, lexicographic YYYY-MM-DD string comparison) throughout `dates.ts` rather than any local-time `Date` parsing, per the plan's explicit "Don't Hand-Roll" guidance — this is what makes the matcher correct under `TZ=Pacific/Kiritimati` (+14) and `TZ=Pacific/Midway` (-11), both of which were run as part of verification
- `FileStateStore.load()` drops individually malformed entries within an otherwise well-formed `StateFile` rather than discarding the entire file, since the plan's action block specified this behavior explicitly ("drop individual malformed entries rather than the whole file where that is unambiguous")

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed a literal `recreation-gov` substring from a match.ts comment that broke the plan's own verification check**
- **Found during:** Task 2, while re-running the plan's step-5 overall verification (`grep -r "recreation-gov" src/matcher/ src/state/` must return nothing) before writing this summary
- **Issue:** The doc comment at the top of `src/matcher/match.ts` (written during Task 1) explained the module's isolation by naming the path `src/recreation-gov/` directly. This is prose, not an import, but it made the plan's own grep-based "no coupling to the API adapter" verification step falsely report coupling.
- **Fix:** Reworded the comment to describe the constraint ("no imports from the API adapter module") without spelling out the literal module path string.
- **Files modified:** `src/matcher/match.ts`
- **Verification:** `grep -r "recreation-gov" src/matcher/ src/state/` now returns nothing; `npm test` (59/59) and `npm run typecheck` still pass after the edit
- **Committed in:** `6142d14`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Cosmetic-only fix to a doc comment; no behavior change. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `matchWatch` and `FileStateStore` are both ready to be wired into `src/run.ts` (plan 04 / wave 3), which will call `matchWatch(slots, resolvedWatch)` per watch and consult `FileStateStore` via `dedupKey()` before emitting a new-match notification
- Both modules are fully self-contained (no dependency on `src/recreation-gov/`, verified by plan 02's parallel work not being required here) and pass under all tested timezones
- No blockers for downstream orchestration work

---
*Phase: 01-core-polling-engine*
*Completed: 2026-08-17*

## Self-Check: PASSED

All 6 created source/test files verified present on disk; all 5 task commit hashes (`8ae9160`, `101416d`, `6142d14`, `702d498`, `b2851c1`) verified present in git log.
