# Deferred Items — Phase 05

Out-of-scope discoveries logged during plan execution, not fixed per the scope-boundary rule
(only auto-fix issues directly caused by the current task's changes).

## Pre-existing typecheck/build failures (not caused by Phase 5)

Independently discovered by 05-01, 05-02, and 05-04 during execution — each confirmed it was
present on the base commit (`196161fa35ad1d9a1b5699f6a232fbba49adb5c6`) before any Phase 5
changes, by stashing their own diffs and re-running the check. `npm run typecheck` (and
`next build`'s type-check step) in `dashboard/` fails on the same pre-existing errors, unrelated
to any Phase 5 file:

- `lib/derive-status.test.ts` (2 errors)
- `lib/derive-timeline.test.ts` (3 errors)
- `lib/page-data.test.ts` (1 error)
- `lib/schema.test.ts` (1 error)

**Cause:** Phase 4 added a required `facilityType: 'standard' | 'group'` field to `MatchedSlot`
(`dashboard/lib/types.ts:56`, commits `7051d27`/`dcd5291` — area-based search `[GROUP]` tag
support), but these four pre-existing test fixtures were never updated to include it. `npm test`
still passes because these are compile-time-only errors — the test runner (`tsx`) doesn't do
full type-checking; only `tsc --noEmit` (`npm run typecheck`) and `next build` catch it, with
`TS2741: Property 'facilityType' is missing in type ... but required in type 'MatchedSlot'`.

**Fix (not applied by any Phase 5 plan):** add `facilityType: 'standard'` (or `'group'` where
relevant) to each `MatchedSlot` fixture literal in the four files above.

**Impact:** Because this failure is independent of any Phase 5 file, `npm run build` and
`npm run typecheck` cannot exit 0 for *any* plan in this phase until it's fixed. Each affected
plan adapted verification to target-check only its own modified files plus a before/after diff
of the error set, confirming zero new errors introduced.

**Status:** RESOLVED (orchestrator, post-Wave-1) — added `facilityType: 'standard'` to the
four fixture literals above. `npm run typecheck` and `npm run build` both now exit 0. Fixed
before Wave 2 rather than deferred further, since the final wave (05-08)'s production-build
auth probe explicitly depends on `next build` succeeding, and every subsequent Phase 5 plan
would otherwise have hit the same wall.
