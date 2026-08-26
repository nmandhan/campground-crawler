---
phase: 05-watch-management-write-path
plan: 02
subsystem: api
tags: [ridb, next.js, zod, node-test, session-cookie, dashboard]

# Dependency graph
requires:
  - phase: 04-area-based-search
    provides: "Watch discriminated union (FacilityWatch/AreaWatch), AreaFacility shape, AREA_FACILITY_CAP semantics in src/config/watches.ts"
provides:
  - "dashboard/lib/ridb.ts: searchRecAreas (AREA-04 typeahead), listAreaFacilities, previewAreas (MGMT-05 campground preview) — all read-only, server-only, never throw"
  - "dashboard/lib/session.ts: SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, sessionCookieOptions(), hasValidSession() fail-closed compare (MGMT-06)"
  - ".env.example documents GITHUB_WRITE_TOKEN, DASHBOARD_PASSPHRASE, and dashboard-side RIDB_API_KEY usage"
affects: [05-03-proxy-and-route-handlers, 05-04-watch-form-ui, 05-05-write-endpoints]

# Tech tracking
tech-stack:
  added: [server-only@0.0.1 (dashboard devDependency)]
  patterns:
    - "Hand-duplicated poller logic in dashboard/lib/, never imported across the src/ <-> dashboard/ boundary"
    - "Never-throws discriminated FetchResult-style return ({ ok: true, ... } | { ok: false, error })"
    - "Per-area promise cache in previewAreas() to dedupe RIDB calls for repeated chips"

key-files:
  created:
    - dashboard/lib/ridb.ts
    - dashboard/lib/ridb.test.ts
    - dashboard/lib/session.ts
    - dashboard/lib/session.test.ts
  modified:
    - .env.example
    - dashboard/package.json
    - dashboard/package-lock.json

key-decisions:
  - "Installed server-only as a real dashboard devDependency and added --conditions=react-server to the dashboard test script, because server-only's package.json only no-ops under the react-server export condition (which Next's bundler sets automatically but a bare `node --test` run does not) — without this flag, importing ridb.ts under node:test throws immediately."
  - "Test file uses node:test's test() (matching the existing dashboard/lib/derive-status.test.ts convention) rather than it(), diverging from the plan's literal grep 'it(' acceptance-criteria wording, which was inconsistent with its own read_first pointer to the project's actual test style."

requirements-completed: [AREA-04, MGMT-05, MGMT-06]

# Metrics
duration: 45min
completed: 2026-08-26
---

# Phase 5 Plan 2: Dashboard RIDB Client + Session Contract Summary

**Read-only dashboard RIDB client (searchRecAreas/listAreaFacilities/previewAreas) mirroring the poller's classification rules exactly, plus a fail-closed shared-secret session-cookie contract — both fully unit-tested with injected fetch, no network access.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-08-26T18:XX (see first task commit)
- **Completed:** 2026-08-26T18:25:47Z
- **Tasks:** 3/3
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments
- `searchRecAreas()` gives AREA-04's core mechanic: find a Recreation Area by name, no numeric id required from the caller, name-only (no `RecAreaState` — verified against RIDB's OpenAPI model per RESEARCH.md)
- `previewAreas()` gives MGMT-05: a deduped, RIDB-ordered, 20-capped campground preview across multiple area chips, with per-area error isolation and `{ requested, kept }` truncation reporting, mirroring `src/config/watches.ts`'s aggregation semantics exactly
- `hasValidSession()` gives MGMT-06's write gate: fails closed when `DASHBOARD_PASSPHRASE` is unset/empty, constant-time-ish compare otherwise
- All three new dashboard env vars documented in `.env.example`: `GITHUB_WRITE_TOKEN`, `RIDB_API_KEY` (dashboard usage note), `DASHBOARD_PASSPHRASE`
- 116/116 dashboard tests pass (28 new: 19 ridb + 9 session)

## Task Commits

1. **Task 1: Create dashboard/lib/ridb.ts — area search + facility listing + classification** - `ffa313f` (feat)
2. **Task 2: Add previewAreas() multi-area aggregation + full ridb test suite** - `7df8cc1` (feat)
3. **Task 3: Create dashboard/lib/session.ts (cookie contract) and document the new env vars** - `63e8ba3` (feat)

_No TDD RED/GREEN split was performed per-commit; each task's implementation and its full test coverage were committed together (this plan's tdd="true" tasks were executed with tests written and passing alongside the implementation, not as a strictly separate failing-test commit)._

## Files Created/Modified
- `dashboard/lib/ridb.ts` - server-only RIDB client: searchRecAreas, listAreaFacilities, previewAreas, AREA_FACILITY_CAP, classifyFacility (hand-duplicated from src/recreation-gov/client.ts)
- `dashboard/lib/ridb.test.ts` - 19 tests covering search/list/preview behaviors via a hand-rolled fetchImpl stub
- `dashboard/lib/session.ts` - SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, sessionCookieOptions(), hasValidSession()
- `dashboard/lib/session.test.ts` - 9 tests, one per behavior bullet
- `.env.example` - documents GITHUB_WRITE_TOKEN, DASHBOARD_PASSPHRASE, and dashboard's use of RIDB_API_KEY
- `dashboard/package.json` - added `server-only` devDependency; test script now runs with `--conditions=react-server`
- `dashboard/package-lock.json` - lockfile update for the new devDependency

## Decisions Made
- Installed `server-only` as a real dependency (plan anticipated this for `npm run typecheck`, but it also affects `npm test` runtime — see Deviations)
- Ran `npm install` in `dashboard/` at the start of this plan: no `node_modules` existed anywhere in this fresh worktree, which is a prerequisite for any `npm test`/`npm run typecheck` command to run at all

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `dashboard/node_modules` did not exist in this worktree**
- **Found during:** Task 1, first `npm run typecheck` attempt
- **Issue:** Neither `dashboard/node_modules` nor root `node_modules` existed in this fresh git worktree, so every `npm test`/`npm run typecheck` command would fail immediately
- **Fix:** Ran `npm install` in `dashboard/`
- **Files modified:** none tracked (node_modules is gitignored)
- **Verification:** `npm run typecheck` and `npm test` both ran afterward
- **Committed in:** N/A (no file changes to commit)

**2. [Rule 3 - Blocking] `import 'server-only'` throws under a bare `node --test` run**
- **Found during:** Task 2, running the new ridb test suite
- **Issue:** The `server-only` npm package's `package.json` only maps to a no-op `empty.js` under the `react-server` export condition, which Next.js's bundler sets automatically at build/dev time. A bare `node --import tsx --test` invocation (the dashboard's actual test runner, per its own `npm test` script) does not set that condition, so requiring `ridb.ts` — which now imports `'server-only'` — threw `"This module cannot be imported from a Client Component module"` and crashed the entire test file, taking down the whole `npm test` run (89 tests reported, 1 "test" = the whole file failing).
- **Fix:** Added `server-only` to `dashboard/package.json` devDependencies (`npm install server-only`) and appended `--conditions=react-server` to the `test` script in `dashboard/package.json`, matching how Next.js itself resolves this package during real server-side execution.
- **Files modified:** `dashboard/package.json`, `dashboard/package-lock.json`
- **Verification:** `cd dashboard && npm test` now reports 116/116 passing (was hard-crashing before the fix)
- **Committed in:** `7df8cc1` (Task 2 commit)

**3. [Rule 1 - Out-of-scope pre-existing bug, documented not fixed] `npm run typecheck` fails on 4 files unrelated to this plan**
- **Found during:** Task 1, first `npm run typecheck` run
- **Issue:** `lib/derive-status.test.ts`, `lib/derive-timeline.test.ts`, `lib/page-data.test.ts`, and `lib/schema.test.ts` all fail to typecheck with `Property 'facilityType' is missing in type ... but required in type 'MatchedSlot'`. This predates this plan — introduced in Phase 4 commits `7051d27` and `dcd5291`, which added a required `facilityType` field to `MatchedSlot` without updating several pre-existing test fixtures.
- **Fix:** Not applied — per the executor's scope-boundary rule, this is a pre-existing failure in files this plan never touches. `dashboard/lib/ridb.ts` and `dashboard/lib/session.ts` (this plan's own files) typecheck cleanly with zero errors attributable to them.
- **Files modified:** none (documented only)
- **Verification:** `npm run typecheck 2>&1 | grep -i "ridb\|session"` returns nothing
- **Committed in:** N/A — logged to `.planning/phases/05-watch-management-write-path/deferred-items.md` (committed in `ffa313f`)

---

**Total deviations:** 3 (2 auto-fixed blocking issues, 1 documented-but-deferred pre-existing bug)
**Impact on plan:** All fixes were necessary to get `npm test`/`npm run typecheck` runnable at all in this fresh worktree, or to make the plan's own `import 'server-only'` requirement actually testable. No scope creep — the pre-existing Phase 4 typecheck bug was explicitly left untouched and documented for a future plan to pick up.

## Issues Encountered
See Deviations above — both blocking issues were resolved without ambiguity (missing `node_modules`, and `server-only`'s conditional-exports behavior under a bare test runner).

## User Setup Required

None for this plan specifically — this plan only builds the read-only client and session primitives. The `user_setup` block in `05-02-PLAN.md` frontmatter describes `GITHUB_WRITE_TOKEN`, `RIDB_API_KEY`, and `DASHBOARD_PASSPHRASE` Vercel configuration, but those are needed once the Route Handlers/UI that consume this module (a later plan in this phase) are deployed — no code in this plan reads a live Vercel environment yet, and `.env.example` now documents all three for when that setup happens.

## Next Phase Readiness

- `dashboard/lib/ridb.ts` and `dashboard/lib/session.ts` are ready to be imported by upcoming Route Handlers (typeahead endpoint, campground-preview endpoint, unlock/auth endpoint, and `proxy.ts`)
- `previewAreas()`'s `PreviewArea`/`PreviewAreaError`/`PreviewResult` types and `AreaFacility` are the exact shapes the watch-management UI's area chip picker will consume
- No blockers for the next plan in this phase (proxy/Route Handlers), which depends on `hasValidSession()` and `SESSION_COOKIE` matching exactly between `proxy.ts` and every mutating handler

---
*Phase: 05-watch-management-write-path*
*Completed: 2026-08-26*

## Self-Check: PASSED

- FOUND: dashboard/lib/ridb.ts
- FOUND: dashboard/lib/ridb.test.ts
- FOUND: dashboard/lib/session.ts
- FOUND: dashboard/lib/session.test.ts
- FOUND: .env.example
- FOUND: .planning/phases/05-watch-management-write-path/deferred-items.md
- FOUND commit ffa313f
- FOUND commit 7df8cc1
- FOUND commit 63e8ba3
