---
phase: 03-status-dashboard
plan: 04
subsystem: ui
tags: [nextjs, server-components, ssr, dashboard-rendering]

# Dependency graph
requires:
  - phase: 03-status-dashboard
    provides: "dashboard/lib/github.ts, schema.ts, types.ts (plan 03-02) and format.ts, derive-active-matches.ts, derive-status.ts, derive-timeline.ts (plan 03-03) — fetch/parse/derive layer this plan wires into a rendered page"
provides:
  - "dashboard/lib/copy.ts: every user-visible string as a frozen COPY constant, verbatim from 03-UI-SPEC.md"
  - "dashboard/app/globals.css: UI-SPEC design tokens (spacing/typography/color) as CSS custom properties + page classes, no CSS framework"
  - "dashboard/lib/page-data.ts: pure buildDashboardModel(raw, now) turning three FetchResults into a renderable model or a fieldless { ok: false }"
  - "dashboard/app/sections.tsx + page.tsx: the rendered dashboard — three sections, badges, empty/error states, fetched and assembled server-side"
affects: [03-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "buildDashboardModel's failure variant carries zero fields — no fetch/parse error string is ever copied onto a model destined for a public page (T-03-13)"
    - "new Date() appears exactly once in the whole dashboard, in app/page.tsx — every lib/ module remains pure with now: Date as an explicit parameter"
    - "Server Components only: zero 'use client', zero interactive hooks, zero dangerouslySetInnerHTML; every dynamic string goes through plain JSX interpolation for React's default escaping"
    - "Booking links render only when ActiveMatchRow.bookingUrl is non-null (already allowlisted upstream by safeBookingUrl); the null branch is explicit plain text, never a repaired/reconstructed anchor"

key-files:
  created:
    - dashboard/lib/copy.ts
    - dashboard/app/globals.css
    - dashboard/lib/page-data.ts
    - dashboard/lib/page-data.test.ts
    - dashboard/app/sections.tsx
  modified:
    - dashboard/app/layout.tsx
    - dashboard/app/page.tsx

key-decisions:
  - "Reworded two doc comments in sections.tsx and page.tsx that originally contained the literal substrings 'use client', 'dangerouslySetInnerHTML', and 'force-dynamic' inside prose explaining what was intentionally NOT done — these tripped the plan's own grep-based acceptance checks for absence of those patterns, the same self-conflicting-plan-text class documented in every prior 03-0x summary. Reworded to equivalent meaning without the literal substrings; no behavior change."

requirements-completed: []

# Metrics
duration: ~25min
completed: 2026-08-24
---

# Phase 03 Plan 04: Dashboard Rendering (design tokens, view-model, App Router page) Summary

**The dashboard now renders: UI-SPEC design tokens and copy constants, a pure fetch-result-to-view-model assembler, and a Next.js Server Component page that fetches watches/state/runs in parallel and renders Active Matches, Per-Watch Status, and Run Timeline sections with badge colors, allowlisted booking links, and a payload-sourced freshness label.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-24
- **Tasks:** 3 completed
- **Files modified:** 7 (5 created, 2 modified)

## Accomplishments

- `dashboard/lib/copy.ts`: every user-visible string as a frozen `COPY` constant, character-for-character from 03-UI-SPEC.md's Copywriting Contract (straight apostrophes, em dash, right arrow preserved)
- `dashboard/app/globals.css`: all seven UI-SPEC spacing tokens, exactly four type sizes/two weights, the six palette colors plus three status-badge colors, no Tailwind/shadcn/component library, system font stack only
- `dashboard/app/layout.tsx`: imports `globals.css`, sets `metadata.title` from `COPY.pageTitle`
- `dashboard/lib/page-data.ts` (`buildDashboardModel`): pure, no fetch/console/ambient clock read — any fetch or top-level parse failure across the three files collapses to a fieldless `{ ok: false }` so no diagnostic string ever reaches the rendered page (T-03-13); `dataAsOfLabel` is built from the latest run's `startedAt` via `formatAbsolute`/`formatRelativeTime`, never from the injected `now` directly — 12 passing tests covering every `<behavior>` bullet including the `!JSON.stringify(model).includes('404')` leak-prevention assertion
- `dashboard/app/sections.tsx`: `ActiveMatchesSection` (D-07), `WatchStatusSection` (D-05), `RunTimelineSection` (D-06), `StatusBadge`, `EmptyState`, `ErrorState` — all plain Server Components, all strings from `COPY`, booking links gated on `row.bookingUrl !== null` with `rel="noopener noreferrer"` (T-03-15)
- `dashboard/app/page.tsx`: three parallel `fetchJson` calls -> single `buildDashboardModel(..., new Date())` call -> renders the three sections in UI-SPEC order or `ErrorState`; no `force-dynamic` opt-out (preserves the 30s Data Cache window); `new Date()` appears exactly once in the entire dashboard
- `cd dashboard && npm run build` succeeds (static prerender, 30s revalidate); `npm run typecheck` clean; `npm test` — 68 passing tests across 6 files
- SSR smoke test on port 3999: page returns 200 with the page title; since this execution sandbox has no network access to `raw.githubusercontent.com`, all three fetches fail and the page correctly renders the `Unable to load dashboard data` error path with zero diagnostic text (`raw.githubusercontent.com`, `HTTP 4xx/5xx`, `ZodError`, stack frames) leaked into the HTML — this is the DoS/information-disclosure mitigation (T-03-13, T-03-16) proving itself under real failure conditions
- From repo root: `npm test` (161 tests) and `npx tsc --noEmit` both remain green — the poller is untouched

## Task Commits

Each task was committed atomically:

1. **Task 1: Design tokens (globals.css), page shell (layout.tsx), and the copy constants** - `5a99b92` (feat)
2. **Task 2: buildDashboardModel — pure fetch-result to view-model assembly** - `aba7a6c` (feat)
3. **Task 3: Section components and the App Router page** - `f45d9fb` (feat)

## Files Created/Modified

- `dashboard/lib/copy.ts` - `COPY` constant, every user-visible string
- `dashboard/app/globals.css` - design tokens + page/section/row/badge classes
- `dashboard/app/layout.tsx` (modified) - imports `globals.css`, `metadata.title = COPY.pageTitle`
- `dashboard/lib/page-data.ts` - `buildDashboardModel(raw, now)`, `DashboardModel`, `DashboardRaw`
- `dashboard/lib/page-data.test.ts` - 12 tests: all-ok, each fetch-failure branch, malformed-payload branch, per-entry runs.json skip, empty-state/empty-watches/empty-runs branches, `dataAsOfLabel` freshness assertion, error-leak assertion, never-throws assertion
- `dashboard/app/sections.tsx` - `ActiveMatchesSection`, `WatchStatusSection`, `RunTimelineSection`, `ErrorState` (exported), `StatusBadge`, `EmptyState` (internal)
- `dashboard/app/page.tsx` (modified) - the async `Page()` Server Component wiring `fetchJson` x3 -> `buildDashboardModel` -> the three sections or `ErrorState`

## Decisions Made

- Reworded doc comments in `sections.tsx` and `page.tsx` that contained the literal substrings `'use client'`, `dangerouslySetInnerHTML`, and `force-dynamic` inside prose explaining what those files intentionally do NOT do — these collided with the plan's own grep-based negative acceptance checks (`grep -rq "'use client'" app/` etc. expected to FAIL/find nothing). Reworded to equivalent meaning ("no client directive", "no HTML-string injection", "no dynamic-rendering opt-out") with identical behavior; this is the same self-conflicting-plan-text pattern already documented in the 03-01/03-02/03-03 summaries, so it was treated as expected and fixed inline without flagging as a deviation requiring discussion.
- No `next/font`, webfont `<link>`, Tailwind, or component library was added — `layout.tsx` and `globals.css` use only the system font stack and hand-written CSS classes, per UI-SPEC's `Tool: none` design-system row.

## Deviations from Plan

None beyond the self-conflicting doc-comment wording noted above (not tracked as a Rule 1-4 deviation — it is cosmetic wording only, does not change behavior, and matches a documented pattern from prior plans in this phase).

## Issues Encountered

None. `dashboard/node_modules` was absent in this fresh worktree as expected (gitignored); `npm ci` was run once before any test/typecheck/build command, consistent with the worktree-mode note in this plan's execution context.

## User Setup Required

None — this plan only adds/modifies TypeScript, TSX, and CSS files plus their tests; no environment variables, secrets, or external services are involved. The dashboard is not yet deployed (that is plan 03-05's scope).

## Next Phase Readiness

The dashboard renders end-to-end locally (`next build` + SSR smoke test both green) and correctly falls back to the fixed error copy when `raw.githubusercontent.com` is unreachable, which is exactly the failure mode plan 03-05's deployment step needs to tolerate gracefully during any transient GitHub outage. No blockers for 03-05 (deployment/final wiring).

---
*Phase: 03-status-dashboard*
*Completed: 2026-08-24*

## Self-Check: PASSED

All 7 tracked files (copy.ts, globals.css, page-data.ts, page-data.test.ts, sections.tsx, page.tsx, layout.tsx) verified present on disk; all 3 task commit hashes (5a99b92, aba7a6c, f45d9fb) verified present in git log.
