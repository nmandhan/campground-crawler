---
phase: 04-area-based-search
plan: 01
status: paused-at-checkpoint
subsystem: recreation-gov-client
tags: [ridb, recarea, fixtures, zod, checkpoint]
dependency-graph:
  requires: []
  provides: []
  affects: [04-03]
tech-stack:
  added: []
  patterns:
    - "RIDB RecArea fixture capture mirrors scripts/capture-fixtures.ts: apikey header only, URLSearchParams for query, encodeURIComponent for path segments"
key-files:
  created:
    - scripts/capture-recarea-fixtures.ts
  modified: []
decisions: []
metrics:
  duration: partial (Task 1 of 3 complete; Task 2 blocking checkpoint reached)
  completed: null
---

# Phase 4 Plan 1: RIDB RecArea Fixture Capture + Schemas Summary

**STATUS: PAUSED AT BLOCKING CHECKPOINT (Task 2 of 3).** Task 1 is complete and committed.
Task 2 requires a live `RIDB_API_KEY` that is not available in this execution environment — it is
a `checkpoint:human-action` gate that a human must run locally and paste output back from (or
explicitly decline with "no key"). Task 3 (RecArea zod schemas + tests) has NOT been executed and
depends on Task 2's outcome (fixture shape / dual-shape schema decision).

**This plan does not yet answer** whether `GET /recareas/{id}/facilities` returns full Facility
records or a compact stub — that is the open question Task 2/3 will resolve.

## What Was Completed

### Task 1: RecArea fixture-capture script (DONE, committed b480f23)

Created `scripts/capture-recarea-fixtures.ts`, mirroring `scripts/capture-fixtures.ts`'s shebang,
doc-comment, and error posture:

- Accepts 1..N RecArea names via `process.argv.slice(2)`; prints usage and exits 1 on zero args.
- Requires `RIDB_API_KEY`; exits 1 with a clear message and writes nothing if absent.
- Builds `GET /recareas?query=` via `URLSearchParams` (never string-concatenated), sends `apikey`
  as an HTTP header only (never a query param — verified via `grep -c "searchParams.set('apikey'"`
  returning 0).
- Resolves the RecArea id from `RecAreaID`/`RecAreaId`/`recAreaId` (whichever key is present) and
  logs `SEARCH KEYS (...)`.
- Builds `GET /recareas/{id}/facilities` with the id run through `encodeURIComponent(String(...))`
  before path interpolation (path-traversal mitigation, T-04-05).
- Prints the exact diagnostic lines the plan requires: `FACILITY KEYS`, `HAS
  FacilityTypeDescription`, `HAS Reservable`, `FACILITY COUNT`, `OBSERVED FacilityTypeDescription
  VALUES`.
- Writes raw (unvalidated — intentional, this script's purpose is capturing the raw shape) JSON to
  `src/recreation-gov/fixtures/ridb-recareas.json` and `ridb-recarea-facilities.json` for the FIRST
  supplied area name only; subsequent names are diagnostics-only and never overwrite the fixtures.
- Sleeps 1000ms between area names to respect RIDB's rate budget.

Verification run:
- `npx tsc --noEmit` — exits 0, no errors.
- All Task 1 acceptance-criteria greps pass (`recareas`, `encodeURIComponent`,
  `searchParams.set('query'`, `HAS FacilityTypeDescription`, `OBSERVED FacilityTypeDescription
  VALUES`, `apikey` present, zero `searchParams.set('apikey'` occurrences).

**Commit:** `b480f23` — `feat(04-01): add RIDB RecArea fixture-capture script`

## Checkpoint Reached: Task 2 (blocking, human-action)

**Type:** human-action
**Why it cannot be automated:** RIDB requires an authenticated `RIDB_API_KEY`, which this execution
environment does not have access to. This is an authentication gate, not a bug or missing feature.

### how-to-verify (present to the user verbatim)

RIDB requires an authenticated key and Claude has no way to obtain one. Run this yourself:

1. Get your key from https://ridb.recreation.gov/profile (Recreation.gov account -> Profile -> API Key).
   It is already stored as this repo's `RIDB_API_KEY` GitHub Actions secret.
2. From the repo root run:
   `RIDB_API_KEY=<your-key> npx tsx scripts/capture-recarea-fixtures.ts "Yosemite National Park" "Sequoia National Forest" "Lake Tahoe Basin Management Unit"`
3. Paste the script's full stdout back into this session. The load-bearing lines are:
   `FACILITY KEYS (...)`, `HAS FacilityTypeDescription: true|false`,
   `HAS Reservable: true|false`, `FACILITY COUNT: N`, and
   `OBSERVED FacilityTypeDescription VALUES: ...`
4. Confirm `src/recreation-gov/fixtures/ridb-recareas.json` and
   `src/recreation-gov/fixtures/ridb-recarea-facilities.json` now exist.

If you cannot supply a key: reply `no key` — Task 3 will then ship dual-shape schemas that
tolerate BOTH the full-record and compact-stub responses, and the fixtures will be marked
synthetic (the same fallback posture `ridb-facilities.json` already documents).

**Resume signal:** Paste the script output, or type "no key" to take the dual-shape fallback path.

## Remaining Work (Task 3, not started)

Once Task 2's outcome is known, Task 3 will:
- Append `RidbRecAreaSchema`, `RidbRecAreaSearchSchema`, `RidbRecAreaFacilitiesSchema`, and their
  inferred types to `src/recreation-gov/types.ts`.
- Add `describe('RidbRecAreaSearchSchema')` / `describe('RidbRecAreaFacilitiesSchema')` test blocks
  to `src/recreation-gov/types.test.ts` covering the fixture-parse, ID-coercion, empty-results,
  compact-stub, and ID-less-facility-rejection cases from the plan's `<behavior>` section.
- Add provenance sections to `src/recreation-gov/fixtures/README.md` for both new fixtures, stating
  the RESOLVED/UNRESOLVED answer to RESEARCH.md Open Question 1.

## Deviations from Plan

None — Task 1 executed exactly as written.

## Self-Check

- FOUND: scripts/capture-recarea-fixtures.ts
- FOUND: commit b480f23 (`git log --oneline --all | grep b480f23`)

## Self-Check: PASSED
