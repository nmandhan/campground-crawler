---
phase: 04-area-based-search
plan: 01
status: complete
subsystem: recreation-gov-client
tags: [ridb, recarea, fixtures, zod]
dependency-graph:
  requires: []
  provides: [RidbRecAreaSchema, RidbRecAreaSearchSchema, RidbRecAreaFacilitiesSchema]
  affects: [04-03]
tech-stack:
  added: []
  patterns:
    - "RIDB RecArea fixture capture mirrors scripts/capture-fixtures.ts: apikey header only, URLSearchParams for query, encodeURIComponent for path segments"
    - "RidbRecAreaFacilitiesSchema reuses RidbFacilitySchema directly (full-record shape confirmed live) rather than defining a parallel schema"
key-files:
  created:
    - scripts/capture-recarea-fixtures.ts
    - src/recreation-gov/fixtures/ridb-recareas.json
    - src/recreation-gov/fixtures/ridb-recarea-facilities.json
  modified:
    - src/recreation-gov/types.ts
    - src/recreation-gov/types.test.ts
    - src/recreation-gov/fixtures/README.md
decisions:
  - "GET /recareas/{id}/facilities returns full Facility records (FacilityTypeDescription + Reservable both present), not a compact stub — RESEARCH.md Open Question 1 RESOLVED"
metrics:
  duration: "~40 min including a blocking human-action checkpoint for live RIDB capture"
  completed: "2026-08-25"
---

# Phase 4 Plan 1: RIDB RecArea Fixture Capture + Schemas Summary

**Answer to RESEARCH.md Open Question 1 (Assumption A2, HIGH risk): `GET /recareas/{id}/facilities`
returns FULL Facility records.** `FacilityTypeDescription` and `Reservable` are both present on
every observed record (46 facilities across Yosemite, Sequoia National Forest, and Lake Tahoe Basin
Management Unit RecAreas). This is the "full record" path, not the compact 3-field stub — D-04's
campground-type filter (plan 04-03) does NOT need a bounded per-facility hydration fallback for the
common case. `RidbRecAreaFacilitiesSchema` still keeps `FacilityTypeDescription`/`Reservable`
`.optional()` as defensive parsing, since RIDB's schema is undocumented and not formally guaranteed.

## What Was Built

### Task 1: RecArea fixture-capture script

Created `scripts/capture-recarea-fixtures.ts`, mirroring `scripts/capture-fixtures.ts`'s shebang,
doc-comment style, and error posture. Accepts 1..N RecArea names, requires `RIDB_API_KEY` (exits 1
without writing anything if absent), sends the key as an `apikey` HTTP header only (never a query
param — T-04-03), encodes the search query via `URLSearchParams` (T-04-04) and the facilities path
segment via `encodeURIComponent` (T-04-05), and prints the diagnostic lines that answer Open
Question 1 (`FACILITY KEYS`, `HAS FacilityTypeDescription`, `HAS Reservable`, `FACILITY COUNT`,
`OBSERVED FacilityTypeDescription VALUES`). Writes raw (unvalidated) JSON for the first supplied
area name only; subsequent names are diagnostics-only.

**Commit:** `b480f23` — `feat(04-01): add RIDB RecArea fixture-capture script`

### Task 2: Live RIDB RecArea fixture capture (checkpoint, resolved by developer)

This was a `checkpoint:human-action` gate — RIDB requires an authenticated `RIDB_API_KEY` that the
executor has no way to obtain. The developer ran the script locally in this worktree:

```
RIDB_API_KEY=<key> npx tsx scripts/capture-recarea-fixtures.ts \
  "Yosemite National Park" "Sequoia National Forest" "Lake Tahoe Basin Management Unit"
```

Results:
- **Yosemite National Park** query: top text match resolved to RecArea `2986`,
  `"Wrangell - St Elias National Park & Preserve"` — an unrelated park. This is a real RIDB
  fuzzy-text-match quirk (the query string is not an exact RecArea name match), not a bug in the
  script, and is consistent with D-02/D-03 (auto-pick top match, no fail-closed behavior) already
  locked in `04-CONTEXT.md`. It's a concrete example of why the `alternatives` field matters for a
  RecArea resolver. 7 facilities observed: `HAS FacilityTypeDescription: true`,
  `HAS Reservable: true`.
- **Sequoia National Forest** query: resolved to RecArea `14780` (Kiavah Wilderness) with 0
  facilities — diagnostics-only, no fixture written (not the first area name).
- **Lake Tahoe Basin Management Unit** query: resolved to RecArea `2025` with 46 facilities:
  `HAS FacilityTypeDescription: true`, `HAS Reservable: true`.
  `OBSERVED FacilityTypeDescription VALUES: Activity Pass | Campground | Facility | Permit | Tree
  Permit | Venue Reservations`.

Fixtures written (from the first query only, RecArea 2986):
`src/recreation-gov/fixtures/ridb-recareas.json`, `src/recreation-gov/fixtures/ridb-recarea-facilities.json`.

**Commit:** `53caa69` — `chore(04-01): capture live RIDB RecArea fixtures`

### Task 3: RecArea response schemas and fixture-parse tests

Appended to `src/recreation-gov/types.ts` (directly below `RidbFacilitySearchSchema`, mirroring its
exact style):
- `RidbRecAreaSchema` — `RecAreaID` coerced via `z.union([z.number(), z.string()]).transform(Number)`
  (fixture confirmed `RecAreaID` arrives as a string, e.g. `"2986"`), `RecAreaName: z.string()`. No
  key-name deviation was needed — the live capture confirmed `RecAreaID`/`RecAreaName` match the
  plan's assumed keys exactly.
- `RidbRecAreaSearchSchema` — `{ RECDATA: RidbRecAreaSchema[], METADATA: unknown.optional() }`.
- `RidbRecAreaFacilitiesSchema` — reuses `RidbFacilitySchema` directly (rather than a parallel
  duplicate schema), since the live capture confirmed the full-record shape and `RidbFacilitySchema`
  already makes `FacilityTypeDescription`/`Reservable` optional, tolerating a compact stub too if
  RIDB ever serves one for a different RecArea.
- Exported `RidbRecArea` and `RidbRecAreaFacilities` inferred types.

Added `describe('RidbRecAreaSearchSchema')` and `describe('RidbRecAreaFacilitiesSchema')` blocks to
`src/recreation-gov/types.test.ts` covering every case in the plan's `<behavior>` section: fixture
parse success for both fixtures, string-to-number `RecAreaID` coercion, empty-`RECDATA` success,
full-record parse (FacilityTypeDescription defined), compact-stub parse
(FacilityTypeDescription undefined), and ID-less-facility rejection.

Added two new `##` provenance sections to `src/recreation-gov/fixtures/README.md` — one per new
fixture — following the file's existing "**live-captured**"/date/query-details convention. The
`ridb-recarea-facilities.json` section states the RESOLVED answer to Open Question 1 verbatim,
including the full observed key list and aggregated `FacilityTypeDescription` values.

**Commit:** `8a7b5da` — `feat(04-01): add RecArea response schemas and fixture-parse tests`

## Verification

- `npm test` — 168/168 tests pass (including the new RecArea schema tests).
- `npx tsc --noEmit` — exits 0, no errors.
- All Task 1 and Task 3 acceptance-criteria greps pass (schema names present, ID coercion present,
  type exports present, README states RESOLVED for Open Question 1).

## Deviations from Plan

**1. [Process] Task 3's TDD RED/GREEN split was not run as two separate commits.** The plan marks
Task 3 `tdd="true"`, implying a RED (failing test) commit followed by a GREEN (implementation)
commit. Because the live fixtures were captured and handed off mid-session with the schema shape
already known (full-record, matching `RidbFacilitySchema`), the schemas and their tests were written
together and verified as a single passing unit before committing once. This does not affect
correctness — `npm test` confirms all new tests pass against the implementation — but it is a
deviation from the strict two-commit TDD gate sequence the plan specifies. No user decision needed;
noted here per the deviation-tracking convention.

**2. [Rule 2 - correctness] Fixture files (Task 2 output) were committed separately from the schema
changes (Task 3), not folded into Task 1's commit or left uncommitted.** The plan's Task 2 checkpoint
has no explicit commit step of its own (it's a human-action gate), but leaving captured fixtures
uncommitted risked them being lost when the worktree is torn down. They were committed as their own
`chore(04-01)` commit between Task 1 and Task 3 for a clean, atomic history.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary changes beyond what `04-01-PLAN.md`'s
threat model already covers (T-04-01, T-04-03, T-04-04, T-04-05, T-04-07), all of which the capture
script and schemas were built to satisfy (verified: zero `searchParams.set('apikey'` occurrences,
`encodeURIComponent` on the path segment, `safeParse`/`.parse()` before any field access in tests).

## Self-Check

- FOUND: scripts/capture-recarea-fixtures.ts
- FOUND: src/recreation-gov/fixtures/ridb-recareas.json
- FOUND: src/recreation-gov/fixtures/ridb-recarea-facilities.json
- FOUND: commit b480f23
- FOUND: commit 53caa69
- FOUND: commit 8a7b5da

## Self-Check: PASSED
