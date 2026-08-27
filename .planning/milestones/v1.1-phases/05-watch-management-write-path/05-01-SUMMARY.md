---
phase: 05-watch-management-write-path
plan: 01
subsystem: api
tags: [zod, github-contents-api, next.js, dashboard, validation]

requires:
  - phase: 04-area-based-search
    provides: "Finalized Watch discriminated union (FacilityWatch | AreaWatch) in dashboard/lib/types.ts"
provides:
  - "StrictWatchSchema — write-path zod validation for create/edit watch payloads (.min(1) ids/names, .min(1) areas, start<end date range)"
  - "parseStrictWatch() / assertUniqueId() helpers for Route Handlers"
  - "github-write.ts — getWatchesFile/putWatchesFile/commitWatches over the GitHub Contents API with sha-based optimistic concurrency and a bounded (2-attempt) 409 retry"
affects: [05-02, 05-03, 05-04, 05-05]

tech-stack:
  added: [server-only@0.0.1]
  patterns:
    - "Strict write-path schemas hand-duplicated (not imported) from src/config/schema.ts, mirroring the existing loose-read/strict-write split convention"
    - "Non-throwing discriminated-union results ({ ok: true } | { ok: false; error }) for all new lib/ modules, consistent with lib/github.ts"
    - "fetchImpl injection for unit-testing network-calling lib modules without a real network"

key-files:
  created:
    - dashboard/lib/github-write.ts
    - dashboard/lib/github-write.test.ts
  modified:
    - dashboard/lib/schema.ts
    - dashboard/lib/schema.test.ts
    - dashboard/package.json
    - dashboard/package-lock.json

key-decisions:
  - "Added --conditions=react-server to dashboard's npm test script so server-only resolves to its no-op empty.js under plain `node --test`, matching the export condition Next.js's bundler sets — without this, importing 'server-only' throws immediately outside a Next.js build and no lib test could ever import github-write.ts"
  - "Hardcoded the full GitHub Contents API URL as a single string literal (not built from interpolated OWNER_REPO/WATCHES_PATH constants) so grep-based acceptance checks and threat-model auditing can find the literal path directly — same allowlist reasoning as github.ts's DataFile type"

patterns-established:
  - "commitWatches() bounded 2-attempt retry loop: re-fetch sha, re-apply mutate(), never force-write a stale array"

requirements-completed: [MGMT-02, MGMT-03, MGMT-04]

duration: 35min
completed: 2026-08-26
---

# Phase 05 Plan 01: Write-Path Primitives (StrictWatchSchema + github-write.ts) Summary

**Strict zod validation for create/edit watch payloads plus a GitHub Contents API write module (GET-sha → mutate → PUT, one bounded 409 retry), both fully unit-tested with an injected fetch.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-08-26T (see PLAN_START_TIME)
- **Completed:** 2026-08-26
- **Tasks:** 2
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- `StrictWatchSchema` (facility + area discriminated union) enforces `.min(1)` on id/parkName/areas and a `start < end` date-range refine — a UI-created watch can never produce a `watches.json` the poller's own `WatchesFileSchema` would reject
- `parseStrictWatch()` and `assertUniqueId()` give Route Handlers (plan 05-03) the exact two primitives they need for validation + duplicate-id checking
- `github-write.ts` implements `getWatchesFile`/`putWatchesFile`/`commitWatches` against the real GitHub Contents API shape (base64 content decode, sha-based optimistic concurrency), never throws across its public API, and is bounded to exactly 2 attempts on repeated 409s
- Both modules are fully unit-tested (113 passing tests total) via hand-rolled injected `fetchImpl` stubs — no real network calls in the test suite

## Task Commits

Each task followed RED → GREEN (TDD):

1. **Task 1: Add StrictWatchSchema to dashboard/lib/schema.ts**
   - `351f8a1` test(05-01): add failing tests for StrictWatchSchema and assertUniqueId
   - `0470bb3` feat(05-01): add StrictWatchSchema write-path validation and assertUniqueId
2. **Task 2: Create dashboard/lib/github-write.ts**
   - `f6a7ea3` test(05-01): add failing tests for github-write GET-sha/PUT/409-retry
   - `4d2cb48` feat(05-01): add github-write.ts GET-sha/PUT/409-retry module (also adds `server-only` dependency and the test-infra fix below)

## Files Created/Modified
- `dashboard/lib/schema.ts` - Added `StrictFacilityWatchSchema`/`StrictAreaWatchSchema`/`StrictWatchSchema`/`parseStrictWatch`/`assertUniqueId`; existing loose schemas untouched
- `dashboard/lib/schema.test.ts` - New `describe('StrictWatchSchema', ...)` and `describe('assertUniqueId', ...)` blocks, one `it()` per behavior bullet
- `dashboard/lib/github-write.ts` - New module: `getWatchesFile`, `putWatchesFile`, `commitWatches`, `WriteOptions`/`WatchesMutator` types
- `dashboard/lib/github-write.test.ts` - New test suite covering every behavior bullet (200/404/non-array/network-error on GET; 200/409/403/body-shape on PUT; retry/repeated-409/mutate-short-circuit on commitWatches)
- `dashboard/package.json` - Added `server-only` dependency; test script gained `--conditions=react-server`
- `dashboard/package-lock.json` - Lockfile update for `server-only` and initial `npm install` of pre-existing dependencies (no `node_modules` existed in the worktree)

## Decisions Made
- **`--conditions=react-server` on the test script** (Rule 3 - blocking issue): the plan's action block mandates `import 'server-only'` in `github-write.ts`. `server-only`'s package.json maps the `"react-server"` export condition to a no-op `empty.js` and the default condition to a throwing `index.js`. Next.js's webpack config sets `"react-server"` for server bundles, but plain `node --test` doesn't — so importing `github-write.ts` under the bare test runner threw immediately, and no test in `github-write.test.ts` could run. Added `--conditions=react-server` to `dashboard/package.json`'s `test` script to restore the plan's explicit requirement that "every new lib module must be testable without a Next.js runtime."
- **Hardcoded literal Contents API URL**: the plan's acceptance criteria grep for the literal string `api.github.com/repos/nmandhan/campground-crawler/contents`; using interpolated constants (`OWNER_REPO`/`WATCHES_PATH`) would have produced the same runtime URL but failed the literal-string grep, so the URL is a single string literal instead, with a comment tying it to threat T-05-01 (must never become a general-purpose write proxy).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `npm install` required — no `node_modules` in the fresh worktree**
- **Found during:** Task 1 setup, before writing any test
- **Issue:** The worktree had no `node_modules` directory at all; `npm test`/`npm run typecheck` could not run
- **Fix:** Ran `npm install` in `dashboard/`
- **Files modified:** `dashboard/package-lock.json` (dependency tree materialized, no version changes)
- **Verification:** `npm test` and `npm run typecheck` both run afterward
- **Committed in:** not separately committed (node_modules is gitignored; package-lock.json diff from this step was a no-op once `server-only` was also added)

**2. [Rule 3 - Blocking] `server-only` package missing from dependencies**
- **Found during:** Task 2, writing `github-write.ts`'s `import 'server-only'` per the plan's exact action block
- **Issue:** `server-only` was not declared in `dashboard/package.json` and was not in `node_modules`
- **Fix:** `npm install server-only` (adds it as a direct dependency, matching how the plan's code sample imports it)
- **Files modified:** `dashboard/package.json`, `dashboard/package-lock.json`
- **Verification:** Import resolves; see deviation 3 below for the follow-on test-runner fix
- **Committed in:** `4d2cb48` (Task 2 commit)

**3. [Rule 3 - Blocking] `server-only` throws under plain `node --test`, breaking the whole test suite**
- **Found during:** Task 2, first `npm test` run after implementing `github-write.ts`
- **Issue:** `server-only`'s default (non-`react-server`) export is `index.js`, which unconditionally throws `"This module cannot be imported from a Client Component module."` — this fires for any consumer that isn't resolved under Next.js's bundler `react-server` condition, including Node's built-in test runner
- **Fix:** Added `--conditions=react-server` to the `test` script in `dashboard/package.json`, so `server-only` resolves to its intentional no-op `empty.js` under `npm test`, exactly mirroring the condition Next.js sets for server-only code at build time
- **Files modified:** `dashboard/package.json`
- **Verification:** `npm test` → 113/113 passing, including all `github-write.test.ts` cases
- **Committed in:** `4d2cb48` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 3 - blocking test/build infrastructure issues)
**Impact on plan:** All three were prerequisites for running the plan's own mandated `<verify>` commands (`npm test`, `npm run typecheck`) — no scope creep into application logic. The plan's code samples (schema.ts additions, github-write.ts) were implemented exactly as specified.

## Issues Encountered
- Pre-existing `npm run typecheck` failures unrelated to this plan (missing `facilityType` field on `MatchedSlot` literals in `lib/derive-status.test.ts`, `lib/derive-timeline.test.ts`, `lib/page-data.test.ts`, and the pre-existing `validRun` fixture in `lib/schema.test.ts`) were confirmed present before my changes (verified via `git stash`) and are out of scope per the scope-boundary rule. Logged to `.planning/phases/05-watch-management-write-path/deferred-items.md` rather than fixed.

## User Setup Required

None in this plan — `GITHUB_WRITE_TOKEN` is read by `github-write.ts` but not yet wired to any Route Handler or live call site (that's plan 05-03). The `user_setup` block in this plan's frontmatter documents the eventual PAT/Vercel env var steps for when the Route Handlers land.

## Next Phase Readiness
- `StrictWatchSchema`/`parseStrictWatch`/`assertUniqueId` and `getWatchesFile`/`putWatchesFile`/`commitWatches` are ready for plan 05-03's Route Handlers (`POST /api/watches`, `PATCH /api/watches/[id]`, `DELETE /api/watches/[id]`) to compose directly
- No blockers. `.env.example` documentation for `GITHUB_WRITE_TOKEN`/`RIDB_API_KEY`/`DASHBOARD_PASSPHRASE` is explicitly deferred to plan 05-02 per this plan's action block (avoids file contention between wave-1 plans)

---
*Phase: 05-watch-management-write-path*
*Completed: 2026-08-26*

## Self-Check: PASSED

- FOUND: dashboard/lib/github-write.ts
- FOUND: dashboard/lib/github-write.test.ts
- FOUND commit: 351f8a1
- FOUND commit: 0470bb3
- FOUND commit: f6a7ea3
- FOUND commit: 4d2cb48
