---
phase: 03-status-dashboard
plan: 02
subsystem: ui
tags: [nextjs, zod, typescript, dashboard, github-raw]

# Dependency graph
requires:
  - phase: 03-status-dashboard
    provides: "runs.json append-on-run design and repo layout established in 03-01/03-RESEARCH"
provides:
  - "Independent dashboard/ Next.js 16 App Router project scaffold with its own package.json/tsconfig.json/package-lock.json"
  - "dashboard/lib/types.ts: local redeclarations of Watch, MatchedSlot, WatchOutcome, RunSummary, StateEntry, StateFile, RunLogEntry"
  - "dashboard/lib/github.ts: fetchJson() against raw.githubusercontent.com with 30s revalidate, never throws"
  - "dashboard/lib/schema.ts: zod schemas + safeParse loaders (parseWatches, parseStateFile, parseRunLog) with entry-by-entry run-log validation"
affects: [03-03, 03-04, 03-05]

# Tech tracking
tech-stack:
  added: ["next@16.3.2", "react@19.2.8", "react-dom@19.2.8", "zod@^4.4.3 (dashboard-local)", "tsx (dashboard-local test runner)"]
  patterns:
    - "Two fully independent Node projects in one repo (root src/ poller, dashboard/ Next.js), no shared node_modules or tsconfig"
    - "Discriminated ParseResult<T> (ok:true/data | ok:false/error) returned from every loader instead of throwing"
    - "Compile-time _assert lines tying each zod schema to its lib/types.ts interface"
    - "Extensionless relative imports (./types, ./schema) inside dashboard/lib for tsx compatibility"

key-files:
  created:
    - dashboard/package.json
    - dashboard/package-lock.json
    - dashboard/tsconfig.json
    - dashboard/next.config.ts
    - dashboard/.gitignore
    - dashboard/app/layout.tsx
    - dashboard/app/page.tsx
    - dashboard/lib/types.ts
    - dashboard/lib/github.ts
    - dashboard/lib/schema.ts
    - dashboard/lib/schema.test.ts
  modified:
    - README.md

key-decisions:
  - "Kept next.config.ts as a bare empty NextConfig per plan spec, despite Next.js's benign workspace-root inference warning (multiple lockfiles detected) — not a build failure, out of scope to silence."
  - "Reworded two doc comments in github.ts and schema.ts (originally containing the literal substrings 'no-store' and '.parse(') because they tripped the plan's own grep-based acceptance checks while conveying the same meaning."

patterns-established:
  - "Pattern: dashboard/lib/*.ts never imports from src/ — always hand-copy shared shapes locally (RESEARCH.md Pattern 2)"
  - "Pattern: JSON loaders return ParseResult<T>, zero throw statements, so SSR pages can render a fallback instead of 500ing"

requirements-completed: []

# Metrics
duration: ~25min
completed: 2026-08-24
---

# Phase 03 Plan 02: Dashboard scaffold + data layer Summary

**Independent Next.js 16 App Router project (`dashboard/`) with zod-validated, never-throwing loaders for watches.json/state.json/runs.json fetched from raw.githubusercontent.com**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-24
- **Tasks:** 3 (Task 3 was TDD: RED then GREEN)
- **Files modified:** 12 (11 created, 1 modified)

## Accomplishments
- Stood up `dashboard/` as a fully independent Next.js 16 project — own `package.json` (no `type: module`), `tsconfig.json` (bundler resolution), `package-lock.json`, builds and typechecks in isolation from the root poller project
- `lib/types.ts` redeclares all shared shapes (`Watch`, `MatchedSlot`, `WatchOutcome`, `RunSummary`, `StateEntry`, `StateFile`, `RunLogEntry`) with zero cross-project imports
- `lib/github.ts` fetches only the three allowlisted files (`watches.json`, `state.json`, `runs.json`) from `raw.githubusercontent.com` with a 30s revalidate window, reads no env vars, and never throws
- `lib/schema.ts` validates all three files via `safeParse`, with `parseRunLog` skipping individually-malformed run entries rather than discarding the whole log; 10/10 tests pass covering every `<behavior>` bullet in the plan
- README documents the two-project repo layout and the Vercel Root Directory setting

## Task Commits

1. **Task 1: Scaffold the independent dashboard/ Next.js project** - `2199d88` (feat)
2. **Task 2: Dashboard-local type declarations and the GitHub raw fetch helper** - `b693c53` (feat)
3. **Task 3: zod schemas with safeParse-based loaders** - `2d3413e` (test, RED) → `5736b2b` (feat, GREEN)

**Plan metadata:** committed alongside this summary.

## Files Created/Modified
- `dashboard/package.json` - Independent Next.js project manifest, no `type: module`, pinned `next@16.3.2`/`react@19.2.8`
- `dashboard/tsconfig.json` - Next.js-native TS config (bundler resolution, `@/*` alias)
- `dashboard/next.config.ts` - Empty `NextConfig`
- `dashboard/.gitignore` - Excludes `node_modules/`, `.next/`, `.vercel/`, build artifacts
- `dashboard/app/layout.tsx`, `dashboard/app/page.tsx` - Placeholder App Router files (plan 03-04 replaces both)
- `dashboard/lib/types.ts` - Local redeclarations of the poller's shared types
- `dashboard/lib/github.ts` - `fetchJson()`, `RAW_BASE`, `DataFile` allowlist type
- `dashboard/lib/schema.ts` - zod schemas + `parseWatches`/`parseStateFile`/`parseRunLog`
- `dashboard/lib/schema.test.ts` - 10 tests covering the full `<behavior>` spec
- `README.md` - Added "Repo layout (two projects)" section

## Decisions Made
- Followed the plan's exact pinned dependency versions (`next@16.3.2`, `react@19.2.8`, `zod@^4.4.3`) — all verified present on the npm registry before install.
- `typescript: "^5.9.0"` resolves to `5.9.3` on the registry (no exact `5.9.0` release exists, but the caret range is satisfiable) — installed without incident, no version bump needed.
- Left `next.config.ts` as the plan's literal empty-config snippet; Next.js's "multiple lockfiles / inferred workspace root" build warning is cosmetic (two independent projects sharing a parent directory is expected here) and does not affect the build, so it was not suppressed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Doc-comment wording tripped the plan's own acceptance-check greps**
- **Found during:** Task 2 and Task 3
- **Issue:** The plan's own action snippets included explanatory comments containing the literal substrings `no-store` (in `github.ts`, explaining what NOT to do) and `.parse()` (in `schema.ts`, explaining to prefer `safeParse`). The plan's acceptance criteria grep for the *absence* of these exact substrings anywhere in the file, so the recommended comment text as-written would fail its own verification.
- **Fix:** Reworded both comments to convey the same meaning without the literal trigger substrings (e.g. "Do NOT disable the fetch cache here" instead of "Do NOT replace with cache: 'no-store'"; "the non-throwing safeParse variant... never the throwing one" instead of naming `.parse()` directly). No behavior change — `next: { revalidate: 30 }` and `.safeParse()` usage are unchanged.
- **Files modified:** `dashboard/lib/github.ts`, `dashboard/lib/schema.ts`, `dashboard/lib/types.ts` (same issue with `src/types.ts` mentioned in a doc comment)
- **Verification:** All acceptance-criteria grep checks and `npm run typecheck` pass after the edits; test suite still green.
- **Committed in:** `b693c53` (Task 2), `5736b2b` (Task 3)

---

**Total deviations:** 1 auto-fixed (1 bug — self-conflicting plan text)
**Impact on plan:** Purely cosmetic wording fix to satisfy the plan's own automated checks; no change to runtime behavior, types, or test coverage.

## Issues Encountered
None beyond the doc-comment wording conflict documented above.

## User Setup Required

None - no external service configuration required. `dashboard/` builds and tests entirely locally; Vercel project creation/Root Directory setup is deferred to a later plan in this phase.

## Next Phase Readiness
- `dashboard/lib/types.ts`, `lib/github.ts`, and `lib/schema.ts` are ready for plan 03-03/03-04 to consume in Server Components — `fetchJson()` + `parseWatches`/`parseStateFile`/`parseRunLog` compose directly into typed, safe page data.
- No blockers. Root project (`src/`, `package.json`, `tsconfig.json`) verified byte-unaffected: `npm ci && npm test && npx tsc --noEmit` all pass (155/155 tests), and `npm ls next` at the root confirms `next` is not installed there.

---
*Phase: 03-status-dashboard*
*Completed: 2026-08-24*

## Self-Check: PASSED

All 12 created/modified files verified present on disk; all 4 task commits (2199d88, b693c53, 2d3413e, 5736b2b) verified present in git log.
