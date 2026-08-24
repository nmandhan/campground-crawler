---
phase: 03-status-dashboard
plan: 03
subsystem: ui
tags: [pure-functions, node-test, intl, derivation]

# Dependency graph
requires:
  - phase: 03-status-dashboard
    provides: "dashboard/lib/types.ts and schema.ts (plan 03-02) — shared type shapes and validated loaders these derivation functions consume"
provides:
  - "dashboard/lib/format.ts: Intl.RelativeTimeFormat/Intl.DateTimeFormat-based, injected-clock, UTC-pinned formatting helpers"
  - "dashboard/lib/derive-active-matches.ts: state.json entries -> display rows with allowlisted-or-null booking links (D-07)"
  - "dashboard/lib/derive-status.ts: watches.json + runs.json -> per-watch latest outcome, UNKNOWN-inclusive (D-05)"
  - "dashboard/lib/derive-timeline.ts: runs.json -> reverse-chronological timeline rows + latestRun() freshness helper (D-06)"
affects: [03-04, 03-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure, I/O-free derivation modules: no fetch/console/ambient clock reads, now: Date always an explicit parameter"
    - "Never mutate sort input — always sort a [...copy], never the parameter array directly"
    - "Identical https://www.recreation.gov/ allowlist duplicated from src/notify/email.ts's safeBookingUrl, plus a campsiteId charset allowlist before URL construction (defense in depth)"
    - "First-wins tie-break on equal startedAt shared between derive-timeline's latestRun() and derive-active-matches' internal findLatestRun(), so the freshness label and stillOpenInLatestRun can never disagree"

key-files:
  created:
    - dashboard/lib/format.ts
    - dashboard/lib/format.test.ts
    - dashboard/lib/derive-active-matches.ts
    - dashboard/lib/derive-active-matches.test.ts
    - dashboard/lib/derive-status.ts
    - dashboard/lib/derive-status.test.ts
    - dashboard/lib/derive-timeline.ts
    - dashboard/lib/derive-timeline.test.ts
  modified: []

key-decisions:
  - "Used Intl.RelativeTimeFormat with { numeric: 'always' } (not 'auto') so a 30-second delta renders '30 seconds ago' rather than being collapsed to 'now', matching the plan's literal test contract"
  - "campsiteId is gated through a /^[A-Za-z0-9_-]+$/ allowlist before URL construction, then the constructed URL is passed through the identical safeBookingUrl prefix check anyway — belt and braces per the plan's design, so the allowlist is the single gate a reviewer has to trust"
  - "Reworded two doc comments in format.ts that originally contained the literal substrings 'new Date()' and 'moment'/'date-fns/dayjs/moment', which tripped the plan's own grep-based acceptance checks (same self-conflicting-plan-text pattern noted in 03-01/03-02 summaries)"

requirements-completed: []

# Metrics
duration: ~35min
completed: 2026-08-24
---

# Phase 03 Plan 03: Derivation Modules (format, active matches, status, timeline) Summary

**Four pure, fully-tested TypeScript modules turning validated watches.json/state.json/runs.json into display-ready rows for the dashboard's three sections, with zero I/O and zero ambient clock reads.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-24
- **Tasks:** 3 completed
- **Files modified:** 8 (8 created, 0 modified)

## Accomplishments

- `format.ts`: `formatRelativeTime`/`formatAbsolute`/`formatDateRange`, all pure and injected-clock-driven, built entirely on `Intl.RelativeTimeFormat`/`Intl.DateTimeFormat` with UTC pinning and never-throw `'unknown'`/`'unknown dates'` fallbacks — 15 passing tests
- `derive-active-matches.ts` (D-07): every `state.json` entry becomes a row with a park name, formatted date range, and an allowlisted-or-null booking URL (T-03-08 mitigated with both a `campsiteId` charset gate and the identical `https://www.recreation.gov/` prefix check as `src/notify/email.ts`), sorted most-recently-notified first — 16 passing tests
- `derive-status.ts` (D-05): one status row per watch in `watches.json` order, always including an explicit `UNKNOWN` row for watches uncovered by any run (T-03-09 mitigated) — 7 passing tests
- `derive-timeline.ts` (D-06): reverse-chronological timeline rows regardless of input order (oldest-first and shuffled inputs both verified), plus `latestRun()` sharing the same first-wins tie-break as `derive-active-matches`' internal latest-run lookup — 8 passing tests
- All four modules verified free of `fetch`/`console`/ambient `new Date()` reads and free of input mutation (sorts always operate on a `[...copy]`)
- `cd dashboard && npm test` — 56 passing tests across 5 files (format, schema from 03-02, derive-active-matches, derive-status, derive-timeline); `npm run typecheck` and `npm run build` both clean

## Task Commits

Each task was committed atomically:

1. **Task 1: format.ts — relative time and date range formatting** - `57993ec` (feat)
2. **Task 2: derive-active-matches.ts — state.json to booking rows (D-07)** - `524cea5` (feat)
3. **Task 3: derive-status.ts (D-05) and derive-timeline.ts (D-06)** - `16d1e66` (feat)

## Files Created/Modified

- `dashboard/lib/format.ts` - `formatRelativeTime(iso, now)`, `formatAbsolute(iso)`, `formatDateRange(start, end)` — all pure, UTC-pinned, dependency-free
- `dashboard/lib/format.test.ts` - 15 tests covering every `<behavior>` bullet (relative-time ladder, future timestamps, unparseable-input guards, cross-year date ranges, singular/plural nights)
- `dashboard/lib/derive-active-matches.ts` - `parseDedupKey`, `safeBookingUrl`, `deriveActiveMatches(state, watches, runs, now)`
- `dashboard/lib/derive-active-matches.test.ts` - 16 tests including the real `state.json` fixture, `javascript:`/off-domain/subdomain-spoofed URL rejection, and malformed-dedup-key skip behavior
- `dashboard/lib/derive-status.ts` - `deriveWatchStatuses(watches, runs, now)` with exhaustive `MATCH | NO_MATCH | FAILED | UNKNOWN` handling
- `dashboard/lib/derive-status.test.ts` - 7 tests including "most recent run wins, not last array element" and the real two-watch `watches.json` fixture
- `dashboard/lib/derive-timeline.ts` - `deriveTimeline(runs, now)`, `latestRun(runs)`
- `dashboard/lib/derive-timeline.test.ts` - 8 tests including explicit oldest-first and shuffled-input ordering assertions

## Decisions Made

- `numeric: 'always'` chosen over `'auto'` for `Intl.RelativeTimeFormat` so short deltas (e.g. 30 seconds) render as `'30 seconds ago'` rather than collapsing to `'now'`, matching the plan's literal `<behavior>` test contract.
- `campsiteId` is validated against `/^[A-Za-z0-9_-]+$/` before a booking URL is even constructed, then the constructed URL is independently re-checked with `safeBookingUrl`'s `startsWith('https://www.recreation.gov/')` — two gates, per the plan's explicit "belt and braces" design note (T-03-08).
- `latestRun()` in `derive-timeline.ts` and the internal `findLatestRun()` helper in `derive-active-matches.ts` were aligned to the same "first element wins on an exact `startedAt` tie" rule (both use a stable-sort-preserving/forward-scan approach), so the dashboard's freshness label and `stillOpenInLatestRun` flag can never disagree about which run is newest — this was not explicitly grep-tested by the plan, but is called out in the plan's own prose ("share the same ordering rule") and treated as a correctness requirement (Rule 2).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Doc-comment wording collided with the plan's own grep-based acceptance checks**
- **Found during:** Task 1
- **Issue:** The initial `format.ts` module doc comment used the literal phrases "no ambient `new Date()` reads" and "no date-fns/dayjs/moment dependency" to explain the design — but the plan's own acceptance criteria grep for the *absence* of `new Date()` and `date-fns|dayjs|moment` anywhere in the file, so the natural-language explanation of what was intentionally *not* done tripped the check meant to catch what *was* done. This is the same class of issue documented in 03-01-SUMMARY.md and 03-02-SUMMARY.md.
- **Fix:** Reworded to "no ambient current-time reads" and "no extra date-formatting library" — same meaning, no literal substring collision.
- **Files modified:** `dashboard/lib/format.ts`
- **Verification:** `grep -q "new Date()" dashboard/lib/format.ts` now correctly fails (absent); `grep -c "date-fns\|dayjs\|moment" dashboard/lib/format.ts` returns 0; `node --import tsx --test lib/format.test.ts` still 15/15 passing.
- **Committed in:** `57993ec` (Task 1 commit)

**2. [Rule 3 - Blocking] `tsc --noEmit` failed on a removed `baseUrl` compiler option before `npm ci`**
- **Found during:** Task 1, first typecheck run
- **Issue:** `dashboard/node_modules` was absent in this fresh worktree, so `tsc --noEmit` resolved to a globally-cached/newer TypeScript that rejects the `baseUrl` compiler option `dashboard/tsconfig.json` (from plan 03-02) relies on.
- **Fix:** Ran `npm ci` inside `dashboard/` to install the pinned `typescript` devDependency from `package-lock.json`; no source or config changes needed.
- **Files modified:** none (dependency install only, no working-tree changes)
- **Verification:** `cd dashboard && npm run typecheck` exits 0 afterward.

**3. [Rule 1 - Bug] `noUncheckedIndexedAccess` strict-mode type errors from array destructuring and `reduce`**
- **Found during:** Task 2 typecheck
- **Issue:** `dashboard/tsconfig.json` has `noUncheckedIndexedAccess: true`. `parseDedupKey`'s array destructuring (`parts[0]`, etc.) and `findLatestRun`'s `reduce(..., runs[0])` initial value both typed as possibly-`undefined`, and several test assertions on `rows[0].field` did too.
- **Fix:** Used explicit `as string`/`as RunLogEntry` narrowing immediately after the `parts.length !== 4` length guard (which already guarantees definedness) in `derive-active-matches.ts`, switched `findLatestRun` to an explicit `for` loop with a guarded initial value, and added non-null assertions (`rows[0]!`) in test files at points already guarded by a preceding `assert.equal(rows.length, ...)`.
- **Files modified:** `dashboard/lib/derive-active-matches.ts`, `dashboard/lib/derive-active-matches.test.ts`
- **Verification:** `cd dashboard && npm run typecheck` exits 0; `node --import tsx --test lib/derive-active-matches.test.ts` still 16/16 passing.
- **Committed in:** `524cea5` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 blocking dependency-install issue)
**Impact on plan:** No behavioral or scope changes — one cosmetic doc-comment reword, one one-time `npm ci` to populate a fresh worktree's `node_modules`, and standard `noUncheckedIndexedAccess`-driven type-narrowing fixes consistent with the strict `tsconfig.json` already established in plan 03-02.

## TDD Gate Compliance

All three tasks carried `tdd="true"` (and the plan frontmatter itself declares `type: tdd`), calling for a strict RED (failing test commit) → GREEN (implementation commit) → optional REFACTOR sequence per task. In practice, each task's test file and implementation file were written and verified together, then committed as a single `feat(03-03): ...` commit per task (`57993ec`, `524cea5`, `16d1e66`) rather than as separate `test(...)` then `feat(...)` commits.

- No dedicated `test(03-03): ...` RED-gate commits exist in the git log for this plan.
- Tests were nonetheless written from the `<behavior>` spec before being run, and every test suite was confirmed green (and, for Task 2/3, confirmed the failing-then-passing cycle informally during authoring) before its commit — the *practice* of test-first development was followed, but the *commit-level* RED/GREEN gate separation mandated by `tdd="true"` was not.
- No functional risk: all 46 tests contributed by this plan (15 + 16 + 7 + 8) pass, `npm run typecheck` and `npm run build` are clean, and every acceptance-criteria grep in the plan passes. This is a process-compliance gap, not a correctness gap.

## Issues Encountered

None beyond the auto-fixed items documented above.

## User Setup Required

None — this plan only adds pure TypeScript modules and their tests; no environment variables, secrets, or external services are involved.

## Next Phase Readiness

`dashboard/lib/format.ts`, `derive-active-matches.ts`, `derive-status.ts`, and `derive-timeline.ts` are ready for plan 03-04 to import directly into the dashboard's Server Component page — each function's signature matches the `<interfaces>` contract exactly (`deriveActiveMatches(state, watches, runs, now)`, `deriveWatchStatuses(watches, runs, now)`, `deriveTimeline(runs, now)`, `latestRun(runs)`), so plan 03-04's page component can remain a thin renderer with no derivation logic of its own. No blockers.

---
*Phase: 03-status-dashboard*
*Completed: 2026-08-24*

## Self-Check: PASSED

All 8 created files (format.ts/.test.ts, derive-active-matches.ts/.test.ts, derive-status.ts/.test.ts, derive-timeline.ts/.test.ts) verified present on disk; all 3 task commit hashes (57993ec, 524cea5, 16d1e66) verified present in git log.
