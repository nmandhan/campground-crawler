---
phase: 01-core-polling-engine
plan: 02
subsystem: recreation-gov-adapter
tags: [http-client, retry-backoff, zod-validation, ridb, undocumented-api, fixtures]

# Dependency graph
requires: [01-01]
provides:
  - "Shared retry/backoff + hardened JSON fetch (src/recreation-gov/http.ts): retryWithBackoff, fetchJson, BROWSER_HEADERS"
  - "RIDB facility resolution + monthly availability client (src/recreation-gov/client.ts): resolveFacility, fetchMonthAvailability, fetchAvailabilityForRange, createClient"
  - "Raw availability JSON -> AvailabilitySlot[] normalization (src/recreation-gov/parse.ts): mapSiteType, parseAvailability, mergeSlots"
  - "Captured/hand-augmented fixtures (src/recreation-gov/fixtures/) with documented provenance, schema-validated in tests"
  - "scripts/capture-fixtures.ts for future live fixture re-capture"
affects: [01-03, 01-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Every outbound recreation.gov/ridb.recreation.gov request goes through retryWithBackoff(() => fetchJson(...)) — no bare fetch calls outside http.ts/client.ts"
    - "client.ts never reads process.env directly — ClientOptions.ridbApiKey is passed in by the caller, keeping the module trivially testable"
    - "Month-boundary math done via string slicing on YYYY-MM prefixes, never new Date() round-tripping (avoids local-timezone off-by-one-month bugs)"
    - "Availability status matching is allowlist-only (rawStatus === 'Available'), never a denylist"

key-files:
  created:
    - src/recreation-gov/http.ts
    - src/recreation-gov/http.test.ts
    - src/recreation-gov/client.ts
    - src/recreation-gov/client.test.ts
    - src/recreation-gov/parse.ts
    - src/recreation-gov/parse.test.ts
    - src/recreation-gov/fixtures/availability-month.json
    - src/recreation-gov/fixtures/ridb-facilities.json
    - src/recreation-gov/fixtures/README.md
    - scripts/capture-fixtures.ts
  modified: []

key-decisions:
  - "Live capture confirmed the undocumented availability endpoint works with browser headers (User-Agent/Referer) and no RIDB key requirement of its own — observed statuses were exactly Available/Reserved/Closed and campsite_type values STANDARD NONELECTRIC/RV NONELECTRIC/TENT ONLY NONELECTRIC for the campground/month queried (Yosemite Upper Pines, facility 232447, 2026-09), confirming RESEARCH Assumption A2 (allowlist-only Available matching)."
  - "RIDB /api/v1/facilities requires a valid RIDB_API_KEY (live unauthenticated call returned HTTP 401 'Unauthorized Access') — no key was available in this execution environment, so ridb-facilities.json remains synthetic per RESEARCH.md Pattern 1's documented RECDATA/METADATA envelope shape (Assumption A1 remains unvalidated live)."
  - "availability-month.json fixture combines one real live-captured campsite entry (id 205, verbatim field structure/values) with three hand-added synthetic entries (300 TENT fully-available run, 301 RV with a one-night gap, 402 GROUP exercising the wider status vocabulary) to give plan 01-03's matcher tests the variety the live capture window did not happen to contain — documented transparently in fixtures/README.md."
  - "Availability endpoint requires percent-encoded colons in the start_date query param (confirmed live: raw colons produce a 400 'query not encoded' error) — URLSearchParams.set() handles this correctly by default, no special-casing needed in client.ts."

requirements-completed: [POLL-02, POLL-03, POLL-04]

# Metrics
duration: 20min
completed: 2026-08-17
---

# Phase 01 Plan 02: Recreation.gov Adapter (RIDB + Availability) Summary

**Single isolated adapter module for both Recreation.gov data sources — retry/backoff with retryability classification, RIDB facility resolution, undocumented monthly-availability fetch, and allowlist-based normalization into `AvailabilitySlot[]` — validated against one live capture that confirmed the status vocabulary and header requirements empirically.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3 completed (all TDD RED/GREEN)
- **Files created:** 10

## Accomplishments

- `retryWithBackoff` implements D-05 exactly (1s/2s/4s exponential backoff) with retryability classification: `BlockedError` and non-429/5xx `HttpError`s fail fast instead of wasting 7 seconds (RESEARCH Pitfall 4)
- `fetchJson` converts non-2xx responses into `HttpError` and non-JSON/malformed-JSON responses into `BlockedError` with a diagnosable message — a WAF/CDN HTML error page never surfaces as an opaque `SyntaxError` (T-02-01, RESEARCH Pitfall 2)
- `resolveFacility` throws `FacilityNotFoundError` (never returns undefined) on zero RIDB matches and surfaces `alternatives` for ambiguous multi-match searches (RESEARCH Pitfall 3)
- `fetchAvailabilityForRange` correctly enumerates months across same-month, month-boundary, and year-boundary date ranges, fetching sequentially with ~1req/sec pacing (T-02-03)
- `parseAvailability` + `mergeSlots` produce a gapless, sorted `AvailabilitySlot[]` with allowlist-only availability (`=== 'Available'`), stitching multi-month responses without duplicate `(campsiteId, date)` pairs (D-03, POLL-02)
- One live capture against the real, undocumented availability endpoint succeeded and is documented in `fixtures/README.md` — empirically confirms RESEARCH Assumption A2

## Task Commits

Each task used TDD RED/GREEN:

1. **Task 1: Shared retry/backoff + hardened JSON fetch helper**
   - RED: `abaf6e0` (test) — 13 failing tests (http.ts didn't exist)
   - GREEN: `7c07b46` (feat) — implemented src/recreation-gov/http.ts, all 13 pass
2. **Task 2: RIDB facility resolution + availability fetch client, with captured fixtures**
   - RED: `5150c8e` (test) — 15 failing tests + fixtures (client.ts didn't exist)
   - GREEN: `9754675` (feat) — implemented src/recreation-gov/client.ts + scripts/capture-fixtures.ts, all 15 pass
3. **Task 3: Normalize raw availability responses into AvailabilitySlot[]**
   - RED: `641cd83` (test) — 19 failing tests (parse.ts didn't exist)
   - GREEN: `6f91efc` (feat) — implemented src/recreation-gov/parse.ts, all 19 pass

_TDD gate sequence verified: a `test(...)` commit precedes each `feat(...)` commit for all three tasks. No refactor commits needed._

## Files Created/Modified

- `src/recreation-gov/http.ts` — `BROWSER_HEADERS`, `retryWithBackoff`, `fetchJson`
- `src/recreation-gov/http.test.ts` — 13 tests covering retry counts, backoff timing (injected sleep), retryability classification, content-type/status handling
- `src/recreation-gov/client.ts` — `resolveFacility`, `fetchMonthAvailability`, `fetchAvailabilityForRange`, `createClient`, `RIDB_BASE`, `AVAILABILITY_BASE`
- `src/recreation-gov/client.test.ts` — 15 tests covering RIDB resolution, month normalization, month-boundary/year-boundary enumeration, fixture schema validation
- `src/recreation-gov/parse.ts` — `mapSiteType`, `parseAvailability`, `mergeSlots`
- `src/recreation-gov/parse.test.ts` — 19 tests covering site-type mapping order, allowlist behavior, sort order, real-fixture parsing, merge dedup
- `src/recreation-gov/fixtures/availability-month.json` — live-captured base (Upper Pines campsite 205) + 3 hand-augmented campsites for test variety
- `src/recreation-gov/fixtures/ridb-facilities.json` — synthetic (no RIDB_API_KEY available live)
- `src/recreation-gov/fixtures/README.md` — provenance documentation for both fixtures
- `scripts/capture-fixtures.ts` — live fixture re-capture CLI (`npx tsx scripts/capture-fixtures.ts "<parkName>" <YYYY-MM-DD>`)

## Decisions Made

See `key-decisions` in frontmatter. Summary: live capture succeeded for the availability endpoint (no auth needed, browser headers sufficient) and confirmed A2; RIDB required a key not present in this environment, so its fixture is synthetic per RESEARCH.md's documented envelope shape (A1 unvalidated); the availability fixture blends one verbatim live entry with hand-added entries for test coverage variety, transparently documented.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test assertions adjusted for zod `.default('')` fill-in on `campsite_type`**
- **Found during:** Task 2 (client.test.ts)
- **Issue:** Two tests asserted `deepEqual(result, rawInputBody)`, but `AvailabilityResponseSchema`'s `campsite_type: z.string().default('')` (from plan 01) adds a `campsite_type: ''` field to parsed campsite entries that weren't in the raw test fixture body, causing a strict deep-equal mismatch — not a bug in `client.ts`, but an incorrect test expectation that didn't account for the shared schema's default-fill behavior.
- **Fix:** Changed the two assertions to check the fields that actually came from the raw body (`availabilities`, campsite keys) rather than strict whole-object equality.
- **Files modified:** `src/recreation-gov/client.test.ts`
- **Commit:** `9754675`

**2. [Rule 1 - Bug] Removed literal `process.env` string from client.ts comments**
- **Found during:** Task 2 acceptance criteria check
- **Issue:** The plan's acceptance criteria requires `! grep -q "process.env" src/recreation-gov/client.ts` to enforce "no env reads in this module" — but the implementation's own explanatory comments mentioned `process.env.RIDB_API_KEY` in prose, which the grep can't distinguish from an actual read.
- **Fix:** Reworded comments to describe the behavior without the literal string `process.env`.
- **Files modified:** `src/recreation-gov/client.ts`
- **Commit:** `9754675`

None of the deviations required architectural changes or user input.

## Issues Encountered

- Live network access was available in this execution environment, so one real availability-endpoint call was made (Yosemite Upper Pines, facility 232447, month 2026-09) — succeeded on first try with browser headers, no blocking encountered. The live RIDB search returned `HTTP 401 {"error":"Unauthorized Access"}` since no `RIDB_API_KEY` was configured — expected per RESEARCH's noted "key only raises rate limits" claim being potentially outdated; `scripts/capture-fixtures.ts` is left in place for a future run with a real key to re-validate Assumption A1.
- The live availability endpoint additionally required the `start_date` query param's colons to be percent-encoded (confirmed via a raw-colon curl test returning `400 {"error":"query not encoded"}`) — `URLSearchParams.set()` in `client.ts` handles this correctly by default, so no code change was needed, just noted for future debugging reference.

## User Setup Required

None for this plan. A `RIDB_API_KEY` (free, register at recreation.gov/manage-account/developer-api) is recommended before plan 04's config loader is exercised against real watches, and would let `scripts/capture-fixtures.ts` re-validate the currently-synthetic `ridb-facilities.json` fixture — not a blocker for phase 1 execution, which is fixture-driven by design.

## Next Phase Readiness

- All three artifact files (`http.ts`, `client.ts`, `parse.ts`) export exactly the symbols named in the plan's `must_haves.artifacts` list
- `src/recreation-gov/` is the only part of the codebase referencing `recreation.gov`/`ridb.recreation.gov` URLs (verified: acceptance-criteria greps for no bare `fetch` calls in `client.ts` pass)
- Plan 01-03 (matcher) can import `AvailabilitySlot[]`-producing functions and the fixture file directly
- No blockers identified

---
*Phase: 01-core-polling-engine*
*Completed: 2026-08-17*

## Self-Check: PASSED

All 10 claimed files verified present on disk (http.ts, http.test.ts, client.ts, client.test.ts, parse.ts, parse.test.ts, fixtures/availability-month.json, fixtures/ridb-facilities.json, fixtures/README.md, scripts/capture-fixtures.ts). All 6 claimed commit hashes (abaf6e0, 7c07b46, 5150c8e, 9754675, 641cd83, 6f91efc) verified present in git log.
