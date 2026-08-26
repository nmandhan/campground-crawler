# Deferred Items — Phase 05

## Pre-existing `npm run typecheck` failures (out of scope for 05-02)

Discovered while executing plan 05-02. `dashboard && npm run typecheck` reports 6 errors, all in
files not touched by 05-02 and predating this plan (introduced in Phase 4, commits `7051d27`
"feat(04-04): mirror Watch union and outcome fields into dashboard/lib" and `dcd5291`):

- `lib/derive-status.test.ts` (2 errors)
- `lib/derive-timeline.test.ts` (3 errors)
- `lib/page-data.test.ts` (1 error)
- `lib/schema.test.ts` (1 error)

Cause: Phase 4 added a required `facilityType: 'standard' | 'group'` field to `MatchedSlot` in
`dashboard/lib/types.ts`, but several pre-existing test fixtures across these four files were
never updated to include it.

`dashboard/lib/ridb.ts` and `dashboard/lib/session.ts` (this plan's own files) typecheck cleanly —
confirmed no `ridb.ts`/`session.ts` errors appear in the `tsc --noEmit` output. Per the executor's
scope-boundary rule, this pre-existing, unrelated failure was not fixed here. Flagging for a
future plan/task to update those four fixture files with a `facilityType` value.
