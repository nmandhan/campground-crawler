---
phase: 05-watch-management-write-path
plan: 07
subsystem: ui
tags: [react, next.js, forms, watches-json]

requires:
  - phase: 05-05
    provides: "watch-manager.tsx list, lock gate, delete flow, native-<dialog> pattern"
  - phase: 05-06
    provides: "AreaTypeahead (AreaChip type), AreaPreview components"
provides:
  - "WatchForm: create/edit modal handling both Watch union members via a Facility/Area toggle"
  - "watch-manager.tsx: + Add Watch CTA, per-row Edit control, POST/PATCH orchestration (handleSave)"
affects: []

tech-stack:
  added: []
  patterns:
    - "Native <dialog> + useRef/useEffect showModal()/close() pattern reused identically from watch-manager's delete-confirm dialog"
    - "Flat draft state re-seeded on [open, initial] so toggling Facility/Area never loses the other mode's input and re-opening never leaks the previous edit"
    - "Client validate() mirrors StrictWatchSchema as UX only; server parseStrictWatch remains sole authority"

key-files:
  created:
    - dashboard/app/watches/watch-form.tsx
  modified:
    - dashboard/app/watches/watch-manager.tsx

key-decisions:
  - "handleSave is one function for both verbs — it branches on `editing !== null` rather than duplicating POST/PATCH logic, since WatchForm is the same modal for create and edit."
  - "PATCH URL uses editing.id (the original id captured when Edit was clicked), never watch.id from the submitted draft — this lets a rename PATCH the correct existing resource."

requirements-completed: [MGMT-02, MGMT-03, MGMT-05]

duration: 20min
completed: 2026-08-26
---

# Phase 05 Plan 07: Watch Create/Edit Form Summary

**One modal (WatchForm) creates or edits either watch type via a Facility/Area toggle that swaps only the location picker, wired into watch-manager.tsx with a `+ Add Watch` CTA, per-row Edit control, and POST/PATCH orchestration that keeps the list in sync without a server refresh.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-26
- **Tasks:** 2 completed
- **Files modified:** 1 created, 1 modified

## Accomplishments

- `WatchForm`: native `<dialog>` mirroring the existing delete-confirm pattern exactly (`useRef` + `useEffect` calling `showModal()`/`close()`), with `onClose={onCancel}` routing Escape through the same cancel path as the Discard button
- Facility/Area toggle (D-05) swaps only the location section; `id`, check-in/check-out dates, and site-type select keep the same position in both modes
- Area mode renders `AreaTypeahead` (chip picker) directly above `AreaPreview` (live resolved-campground list) — both from plan 05-06, composed with zero adapter code since their prop shapes matched `AreaWatch.areas[]` exactly
- Client-side `validate()` mirrors `StrictWatchSchema`'s rules (non-empty id/parkName/areas, both dates present, `start < end` via plain string comparison) purely as UX; the server's `parseStrictWatch` remains the sole authority per the threat model
- `handleSubmit` builds the submitted payload exclusively from the chip array — `AreaPreview`'s resolved facility list is never read by the form and never enters the payload (T-05-29, ARCHITECTURE.md Anti-Pattern 1)
- `watch-manager.tsx`: `+ Add Watch` CTA replaces the plan-05-05 marker comment, gated on `unlocked`; a per-row `✎` Edit button opens the same modal pre-filled via `initial={editing}`
- `handleSave` POSTs to `/api/watches` on create or PATCHes `/api/watches/{encodeURIComponent(editing.id)}` on edit (the **original** id, so a rename addresses the existing resource); on success it updates the local `watches` array in place, closes the modal, and shows the `Saved — live within ~5 min` toast; on 400/409 it keeps the modal open with the server's reason displayed; on 401 it flips `unlocked` back to false, matching the existing delete flow's session-expiry handling

## Task Commits

Each task was committed atomically:

1. **Task 1: Create dashboard/app/watches/watch-form.tsx** - `514ab80` (feat)
2. **Task 2: Wire create and edit into watch-manager.tsx** - `2c52d3b` (feat)

## Files Created/Modified

- `dashboard/app/watches/watch-form.tsx` - New create/edit modal (`WatchForm`), 251 lines
- `dashboard/app/watches/watch-manager.tsx` - Extended with `formOpen`/`editing`/`formError` state, the `+ Add Watch` CTA, a per-row Edit control, `handleSave`, and the rendered `<WatchForm>` — the existing delete flow, confirm dialog, toast effect, and lock gate were left untouched

## Decisions Made

- `handleSave` is one function branching on `editing !== null` rather than two separate create/edit handlers, since the modal itself is shared.
- The PATCH URL is built from `editing.id` (captured at the moment Edit was clicked), not from the submitted `watch.id` — this is what makes an id rename land correctly against the pre-edit resource instead of a nonexistent one.
- Kept `router.refresh()` out entirely (verified via `grep -c router.refresh` returning 0) — the local list is updated in place, consistent with the documented 30s Data Cache propagation-delay rationale already in this file's header comment.

## Deviations from Plan

None — plan executed as written. Both tasks matched their action blocks and all listed acceptance criteria passed on first verification, aside from routine `npm install` (see Issues Encountered).

## Issues Encountered

- `dashboard/node_modules` was absent in this fresh worktree (gitignored, not committed). Ran `npm install` to execute `npm run typecheck` / `npm run build` / `npm test` for verification; this touched no tracked files and required no commit.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The write path (MGMT-02/MGMT-03/MGMT-05) is now complete end-to-end: create, edit, and (from plan 05-05) delete are all reachable from the dashboard UI with no hand-editing of `watches.json` required.
- No blockers for subsequent plans in this phase.

---
*Phase: 05-watch-management-write-path*
*Completed: 2026-08-26*

## Self-Check: PASSED

- FOUND: dashboard/app/watches/watch-form.tsx
- FOUND: dashboard/app/watches/watch-manager.tsx (modified)
- FOUND: 514ab80 (Task 1 commit)
- FOUND: 2c52d3b (Task 2 commit)
