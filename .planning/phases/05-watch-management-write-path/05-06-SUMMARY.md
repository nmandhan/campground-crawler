---
phase: 05-watch-management-write-path
plan: 06
subsystem: ui
tags: [react, next.js, debounce, typeahead, ridb]

requires:
  - phase: 05-03
    provides: "/api/ridb/recareas and /api/ridb/preview Route Handlers, previewAreas/searchRecAreas in lib/ridb.ts"
  - phase: 05-04
    provides: "dashboard/lib/copy.ts area*/preview* keys, dashboard/app/globals.css .typeahead*/.chip*/.preview* classes"
provides:
  - "dashboard/lib/debounce.ts — hand-rolled, tested trailing-edge debounce helper (no npm dependency)"
  - "AreaTypeahead component: debounced Recreation Area search with keyboard-navigable suggestions and removable chips"
  - "AreaPreview component: auto-refetching resolved-campground list keyed on serialized chip state, tagging group facilities and surfacing per-area errors/truncation"
affects: [05-07]

tech-stack:
  added: []
  patterns:
    - "Monotonic requestSeq ref guard for out-of-order fetch responses, used identically in both new client components"
    - "Debounce effect created once via useMemo, cancelled on unmount via a cleanup effect"
    - "Preview effects keyed on a stable string serialization of props (not array identity) to avoid refetching on unrelated re-renders"

key-files:
  created:
    - dashboard/lib/debounce.ts
    - dashboard/lib/debounce.test.ts
    - dashboard/app/watches/area-typeahead.tsx
    - dashboard/app/watches/area-preview.tsx
  modified: []

key-decisions:
  - "Reworded the plan's own template doc-comment in area-typeahead.tsx to say 'Recreation.gov's RIDB host' instead of the literal string 'ridb.recreation.gov', because the plan's acceptance criteria explicitly requires that literal string to appear zero times in the file — the plan's action-block example text and its own verification check were in tension."

patterns-established:
  - "Client components needing RIDB data always go through same-origin /api/ridb/* routes, never reference the upstream host name, to keep RIDB_API_KEY out of the browser bundle and satisfy the grep-based CI-style check on that constraint."

requirements-completed: [AREA-04, MGMT-05]

duration: 25min
completed: 2026-08-26
---

# Phase 05 Plan 06: Area Typeahead & Preview Summary

**Debounced Recreation Area typeahead with keyboard-navigable chip picker, plus an auto-refreshing resolved-campground preview tagging group facilities and surfacing the 20-facility cap — both built on the existing /api/ridb/recareas and /api/ridb/preview routes with no new dependency.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-26T18:20:00Z (approx, session start)
- **Completed:** 2026-08-26
- **Tasks:** 3 completed
- **Files modified:** 4 created, 0 modified

## Accomplishments
- Hand-rolled, unit-tested `debounce()` helper (trailing-edge, cancelable) with zero new npm dependencies
- `AreaTypeahead`: 300ms debounced live search against `/api/ridb/recareas`, full keyboard support (ArrowUp/ArrowDown/Enter/Escape), monotonic sequence guard against out-of-order responses, dedup'd chip accumulation carrying both `name` and `recAreaId`
- `AreaPreview`: auto-refetches the resolved campground list on every chip add/remove (keyed on a stable serialization of the chips, not array identity), tags group facilities with `[GROUP]`, renders the API-supplied truncation message and per-area errors without hiding areas that did resolve

## Task Commits

Each task was committed atomically:

1. **Task 1: Create dashboard/lib/debounce.ts — hand-rolled debounce** - `c94e497` (test)
2. **Task 2: Create dashboard/app/watches/area-typeahead.tsx** - `44b8c4e` (feat)
3. **Task 3: Create dashboard/app/watches/area-preview.tsx** - `d20a901` (feat)

**Plan metadata:** (this commit, see below)

_Note: Task 1 is a single `test` commit rather than a full TDD RED/GREEN/REFACTOR cycle — the plan specified `tdd="true"` with the full implementation and test file both given in the `<action>` block up front, so test and implementation landed together._

## Files Created/Modified
- `dashboard/lib/debounce.ts` - Trailing-edge debounce with `.cancel()`, delay-0 support
- `dashboard/lib/debounce.test.ts` - 4 tests covering coalescing, re-fire after timer, cancel, and zero-delay deferral
- `dashboard/app/watches/area-typeahead.tsx` - Debounced Recreation Area search + chip picker (`AreaTypeahead`, exports `AreaChip`)
- `dashboard/app/watches/area-preview.tsx` - Auto-refetching resolved-campground preview (`AreaPreview`)

## Decisions Made
- Kept the debounce test suite on real timers with short delays (20ms) rather than introducing fake-timer tooling, matching the plan's explicit guidance and the project's existing `node:test` harness.
- `addChip` compares only by `recAreaId` for dedup (two different areas can share a `name` in principle; `recAreaId` is the actual identity), matching the plan's action block exactly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reworded a doc comment to stop failing the plan's own acceptance criteria**
- **Found during:** Task 2 (area-typeahead.tsx)
- **Issue:** The plan's `<action>` block gives an example doc-comment that contains the literal substring `ridb.recreation.gov`, but the same task's `<acceptance_criteria>` requires `grep -c "ridb.recreation.gov" area-typeahead.tsx` to return 0. Copying the action block verbatim would fail acceptance.
- **Fix:** Reworded the comment to "never straight to Recreation.gov's RIDB host" — same meaning, no literal domain substring — and kept every other line verbatim.
- **Files modified:** dashboard/app/watches/area-typeahead.tsx
- **Verification:** `grep -c "ridb.recreation.gov" dashboard/app/watches/area-typeahead.tsx` returns 0; typecheck and build re-verified after the edit
- **Committed in:** 44b8c4e (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug/acceptance-criteria conflict)
**Impact on plan:** Cosmetic wording change only; no behavioral or scope change.

## Issues Encountered
- `dashboard/node_modules` was absent in this fresh worktree (not committed, as expected for a gitignored directory). Ran `npm install` locally to execute `npm test`/`npm run typecheck`/`npm run build` for verification; this did not touch any tracked files and required no commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `AreaTypeahead` and `AreaPreview` are fully self-contained, prop-controlled components ready to be mounted inside the create/edit watch form in plan 05-07.
- Both components' interfaces (`AreaChip` export from area-typeahead.tsx, `AreaPreview({ areas })` prop) match the `AreaWatch.areas[]` shape from `dashboard/lib/types.ts` exactly — no adapter needed when wiring into the form.
- No blockers.

---
*Phase: 05-watch-management-write-path*
*Completed: 2026-08-26*

## Self-Check: PASSED

- FOUND: dashboard/lib/debounce.ts
- FOUND: dashboard/lib/debounce.test.ts
- FOUND: dashboard/app/watches/area-typeahead.tsx
- FOUND: dashboard/app/watches/area-preview.tsx
- FOUND: c94e497 (Task 1 commit)
- FOUND: 44b8c4e (Task 2 commit)
- FOUND: d20a901 (Task 3 commit)
