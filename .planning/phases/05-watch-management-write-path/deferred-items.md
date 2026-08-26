# Deferred Items — Phase 05

Items discovered during execution that are out of scope for the plan in progress
(pre-existing, unrelated to the files that plan touches). Logged, not fixed.

## Pre-existing `npm run build` / `npm run typecheck` failures (dashboard/)

**Found during:** 05-04, Task 2 (running `npm run build` to verify the globals.css changes)

**Confirmed pre-existing:** reproduced with all 05-04 changes stashed, against the same
base commit (`196161fa35ad1d9a1b5699f6a232fbba49adb5c6`) — same 7 errors present before
any Phase 5 work started.

**Issue:** `lib/derive-status.test.ts`, `lib/derive-timeline.test.ts`, `lib/page-data.test.ts`,
and `lib/schema.test.ts` construct `MatchedSlot` test fixtures missing the `facilityType`
field. `facilityType` was added as a required field to `MatchedSlot` in Phase 4
(area-based search, `[GROUP]` tag support — `lib/types.ts:56`), but the Phase 4 test
fixtures in these four files were never updated to include it. This causes both
`tsc --noEmit` (via `npm run typecheck`) and `next build`'s type-check step to fail with
`TS2741: Property 'facilityType' is missing in type ... but required in type 'MatchedSlot'`.

**Fix (not applied here):** add `facilityType: 'standard'` (or `'group'` where relevant) to
each `MatchedSlot` fixture literal in the four test files above.

**Impact on 05-04 verification:** Because this failure exists independent of any Phase 5
file, `npm run build` and `npm run typecheck` cannot exit 0 for *any* plan in this phase
until it's fixed. Verification for 05-04 was adapted to target-check only the files this
plan modifies (`dashboard/lib/copy.ts`, `dashboard/app/globals.css`,
`dashboard/app/watches/unlock-prompt.tsx`) plus a diff of the tsc/build error set
before vs. after, confirming zero new errors introduced.

**Recommendation:** fix in a follow-up task/plan before the phase closes, since later
05-04 plans' acceptance criteria also assume a clean `npm run build`.
