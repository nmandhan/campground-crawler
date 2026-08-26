# Deferred Items — Phase 05

Out-of-scope discoveries logged during plan execution, not fixed per the scope-boundary rule
(only auto-fix issues directly caused by the current task's changes).

## Pre-existing typecheck failures (not caused by 05-01)

`npm run typecheck` in `dashboard/` fails on 5 pre-existing errors, all unrelated to this
plan's files (`dashboard/lib/schema.ts`, `dashboard/lib/github-write.ts`):

- `lib/derive-status.test.ts:66,80` — `MatchedSlot` literal missing `facilityType`
- `lib/derive-timeline.test.ts:66,81,85` — same root cause, `WatchOutcome`/`MatchedSlot` literals missing `facilityType`
- `lib/page-data.test.ts:45` — same root cause
- `lib/schema.test.ts:42` — the pre-existing `validRun` fixture (not part of 05-01's new tests) is missing `facilityType` on its `MatchedSlot` literal

Root cause: `MatchedSlot.facilityType` (`lib/types.ts`) is a required field, added in Phase 4,
but these four test fixtures (created before/around that change) were never updated to include
it. `npm test` still passes because these are compile-time-only errors — the test runner
(`tsx`) doesn't do full type-checking, only `tsc --noEmit` catches this.

**Status:** Deferred — out of scope for 05-01 (files not modified by this plan). Should be
fixed by whichever plan next touches these test files, or as a standalone chore.
