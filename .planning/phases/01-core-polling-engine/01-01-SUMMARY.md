---
phase: 01-core-polling-engine
plan: 01
subsystem: infra
tags: [typescript, zod, tsx, node-test-runner, scaffolding, types, error-handling]

# Dependency graph
requires: []
provides:
  - Runnable `npm test` / `npm run typecheck` project scaffold (Node 22.x+/TS 7.x/tsx, ESM, strict tsconfig)
  - Shared domain types (`src/types.ts`): Watch, ResolvedWatch, AvailabilitySlot, MatchedSlot, WatchOutcome, RunSummary
  - Typed error classes + `describeFailure` (`src/errors.ts`) for POLL-04 check-failed vs no-match distinction
  - `StateStore` interface + `dedupKey` builder (`src/state/store.ts`) implementing D-08/D-09 dedup key scheme
  - zod schema for `watches.json` (`src/config/schema.ts`) with uniqueness/date-order/enum validation
  - zod schemas for RIDB facility search and Recreation.gov availability responses (`src/recreation-gov/types.ts`)
  - `watches.example.json` — committed, schema-validated example config
affects: [01-02, 01-03, 01-04]

# Tech tracking
tech-stack:
  added: [zod@4.4.3, typescript@7.0.2, tsx@4.23.12, "@types/node@26.2.0"]
  patterns:
    - "All relative imports in src/ use the .js extension (module: NodeNext + type: module requirement)"
    - "node --import tsx --test \"src/**/*.test.ts\" is the working npm test invocation (no fallback needed)"
    - "Status vocabulary from the availability endpoint is validated as z.string() (never z.enum) so new upstream statuses degrade to non-match instead of crashing"
    - "Compile-time type-assertion pattern (const _assert: Watch = {} as z.infer<typeof WatchSchema>) keeps zod schemas from silently drifting from src/types.ts"

key-files:
  created:
    - package.json
    - tsconfig.json
    - .gitignore
    - src/smoke.test.ts
    - src/types.ts
    - src/errors.ts
    - src/state/store.ts
    - src/state/store.test.ts
    - src/config/schema.ts
    - src/config/schema.test.ts
    - src/recreation-gov/types.ts
    - src/recreation-gov/types.test.ts
    - watches.example.json
  modified: []

key-decisions:
  - "Resolved dependency versions matched RESEARCH.md predictions exactly: zod@4.4.3, typescript@7.0.2, tsx@4.23.12, @types/node@26.2.0 — no version drift to reconcile"
  - "npm test script node --import tsx --test worked on first try (Node v25.9.0) — no fallback to tsx --test or --experimental-strip-types needed"
  - "RidbFacilitySearchSchema includes an optional METADATA: z.unknown() passthrough field since the interface spec only required RECDATA to be typed, and real RIDB responses include a METADATA envelope"

patterns-established:
  - "TDD RED/GREEN cycle per task: write test file importing not-yet-existing modules, confirm test run fails (RED commit), then implement to green (GREEN commit)"
  - ".js import extension convention for all src/ relative imports (NodeNext module resolution)"

requirements-completed: [WATCH-01, POLL-02, POLL-04, OPS-01]

# Metrics
duration: 5min
completed: 2026-08-16
---

# Phase 01 Plan 01: Project Scaffold & Shared Contracts Summary

**Greenfield TypeScript/zod project scaffold with shared domain types, typed error classes, StateStore contract, and zod schemas for watches.json + both Recreation.gov APIs — all downstream Phase 1 plans build against these contracts.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-08-17T00:15:00Z (approx, first commit 2026-08-16T18:16:15-06:00)
- **Completed:** 2026-08-17T00:18:36Z
- **Tasks:** 3 completed
- **Files modified:** 13 created

## Accomplishments
- Runnable `npm test` (23 passing assertions) and `npm run typecheck` (exits 0) from a fresh greenfield repo
- Shared domain contracts (`src/types.ts`, `src/errors.ts`, `src/state/store.ts`) that plans 02/03/04 import verbatim — no drift risk since these are the single source of truth
- zod validation at both trust boundaries per the threat model: `watches.json` (user-authored) and Recreation.gov/RIDB API responses (third-party, undocumented)
- `describeFailure` never throws and never leaks headers/apikey values (T-01-02 mitigation verified in tests)

## Task Commits

Each task was committed atomically (Task 2 and Task 3 used TDD RED/GREEN):

1. **Task 1: Scaffold the Node/TypeScript project and prove the test runner works** - `046cc46` (feat)
2. **Task 2: Define shared domain types, error classes, and the StateStore contract**
   - RED: `933d2eb` (test) - failing tests for dedupKey/describeFailure (store.ts, errors.ts didn't exist)
   - GREEN: `78d2f3f` (feat) - implemented src/types.ts, src/errors.ts, src/state/store.ts
3. **Task 3: Define zod schemas for watches.json and both Recreation.gov API responses**
   - RED: `f797d35` (test) - failing tests for schema.ts/types.ts (didn't exist)
   - GREEN: `7d8265f` (feat) - implemented src/config/schema.ts, src/recreation-gov/types.ts, watches.example.json

_TDD gate sequence verified: test commit precedes each feat commit for both TDD tasks. No refactor commits needed — GREEN implementations were already clean on first pass._

## Files Created/Modified
- `package.json` - project manifest, ESM, npm test/typecheck scripts
- `tsconfig.json` - strict/NodeNext/noUncheckedIndexedAccess config
- `.gitignore` - node_modules/dist/.env/state.json
- `src/smoke.test.ts` - proves the TS test runner executes end to end
- `src/types.ts` - Watch, ResolvedWatch, AvailabilitySlot, MatchedSlot, WatchOutcome, RunSummary, buildBookingUrl
- `src/errors.ts` - HttpError, BlockedError, ResponseSchemaError, FacilityNotFoundError, describeFailure
- `src/state/store.ts` - StateStore interface, StateEntry, StateFile, dedupKey
- `src/state/store.test.ts` - 6 tests covering dedupKey uniqueness and describeFailure behavior
- `src/config/schema.ts` - WatchSchema, WatchesFileSchema (min 1, unique ids, date format/order validation)
- `src/config/schema.test.ts` - 9 tests including watches.example.json validation against the schema
- `src/recreation-gov/types.ts` - AvailabilityResponseSchema, RidbFacilitySearchSchema, AVAILABLE_STATUS
- `src/recreation-gov/types.test.ts` - 7 tests covering permissive/allowlist schema behavior
- `watches.example.json` - 2-watch example config, schema-validated

## Decisions Made
- Dependency versions resolved exactly as RESEARCH.md predicted (zod@4.4.3, typescript@7.0.2, tsx@4.23.12, @types/node@26.2.0) — no fallback/adjustment needed
- `node --import tsx --test "src/**/*.test.ts"` worked without needing the documented fallback chain (tsx --test / --experimental-strip-types)
- Added `METADATA: z.unknown().optional()` to `RidbFacilitySearchSchema` beyond the plan's literal interface spec, since real RIDB responses include this envelope field and the schema should not reject it (permissive-by-default posture matches the plan's stated intent for "unknown extra fields don't cause failure")

## Deviations from Plan

None - plan executed exactly as written. The one addition (METADATA optional field on RidbFacilitySearchSchema) is consistent with the plan's own stated zod posture ("Zod objects are non-strict by default... do not add .strict()") and required no interface renegotiation.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. No API keys were needed for this plan (schema/type definitions only, no live network calls).

## Next Phase Readiness
- All five shared contract files (`src/types.ts`, `src/errors.ts`, `src/state/store.ts`, `src/config/schema.ts`, `src/recreation-gov/types.ts`) exist and export exactly the symbols named in the plan's `<interfaces>` block
- Plans 02 (RIDB/availability client + matcher), 03 (file-based StateStore + orchestrator), and 04 (CLI) can import these contracts directly with `.js`-suffixed relative imports
- No blockers identified

---
*Phase: 01-core-polling-engine*
*Completed: 2026-08-16*

## Self-Check: PASSED

All 14 claimed files verified present on disk (package.json, tsconfig.json, .gitignore, src/smoke.test.ts, src/types.ts, src/errors.ts, src/state/store.ts, src/state/store.test.ts, src/config/schema.ts, src/config/schema.test.ts, src/recreation-gov/types.ts, src/recreation-gov/types.test.ts, watches.example.json, this SUMMARY.md). All 5 claimed commit hashes (046cc46, 933d2eb, 78d2f3f, f797d35, 7d8265f) verified present in git log.
