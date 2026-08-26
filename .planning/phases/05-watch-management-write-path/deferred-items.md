# Deferred Items — Phase 05

Out-of-scope discoveries logged during plan execution, not fixed per the scope-boundary rule
(only auto-fix issues directly caused by the current task's changes).

## Pre-existing typecheck failures (not caused by Phase 5)

Independently discovered by both 05-01 and 05-02 during execution. `npm run typecheck` in
`dashboard/` fails on pre-existing errors, all unrelated to those plans' files
(`dashboard/lib/schema.ts`, `dashboard/lib/github-write.ts`, `dashboard/lib/ridb.ts`,
`dashboard/lib/session.ts`):

- `lib/derive-status.test.ts` (2 errors) — `MatchedSlot` literal missing `facilityType`
- `lib/derive-timeline.test.ts` (3 errors) — same root cause, `WatchOutcome`/`MatchedSlot` literals missing `facilityType`
- `lib/page-data.test.ts` (1 error) — same root cause
- `lib/schema.test.ts` (1 error) — the pre-existing `validRun` fixture is missing `facilityType` on its `MatchedSlot` literal

Root cause: Phase 4 added a required `facilityType: 'standard' | 'group'` field to `MatchedSlot`
in `dashboard/lib/types.ts` (commits `7051d27` "feat(04-04): mirror Watch union and outcome
fields into dashboard/lib" and `dcd5291`), but these four pre-existing test fixtures were never
updated to include it. `npm test` still passes because these are compile-time-only errors — the
test runner (`tsx`) doesn't do full type-checking; only `tsc --noEmit` (`npm run typecheck`)
catches this.

**Status:** Deferred — out of scope for both 05-01 and 05-02 (files not modified by either
plan). Should be fixed by whichever later Phase 5 plan next touches these test files, or as a
standalone chore before the phase closes — later plans (05-05 through 05-08) will hit the same
`npm run typecheck`/build-failure wall otherwise.
