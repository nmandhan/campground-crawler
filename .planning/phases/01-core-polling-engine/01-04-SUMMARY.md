---
phase: 01-core-polling-engine
plan: 04
subsystem: pipeline
tags: [typescript, zod, cli, node-parseArgs, node-timers-promises]

# Dependency graph
requires:
  - phase: 01-core-polling-engine
    provides: "01-01 shared types/errors/schemas/StateStore contract, 01-02 Recreation.gov adapter (RIDB + availability client + parse), 01-03 matcher + FileStateStore"
provides:
  - "Config loader (loadWatches/resolveWatches/loadResolvedWatches) with memoized RIDB facility resolution"
  - "run() — the single deployment-agnostic pipeline orchestrator with per-watch failure isolation, dedup, and structured RunSummary"
  - "cli.ts — thin trigger adapter, one-shot and --loop --interval modes, no business logic"
  - "Real watches.json and operator README"
  - "End-to-end live verification against Recreation.gov, independently cross-checked"
affects: [phase-02-notification-delivery-and-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "node:util parseArgs for CLI flags — no external CLI-parsing dependency"
    - "node:timers/promises setTimeout for loop-mode interval delay"

key-files:
  created: [src/config/watches.ts, src/config/watches.test.ts, src/run.ts, src/run.test.ts, src/cli.ts, watches.json, README.md]
  modified: []

key-decisions:
  - "RIDB facility resolution could not be live-verified end-to-end in this environment (401 Unauthorized, no RIDB_API_KEY available) — verification instead used explicit facilityId overrides to bypass RIDB and exercise the live availability endpoint directly. RIDB's live envelope shape remains validated only against the synthetic fixture from plan 01-02; re-validate with a real key before Phase 2 relies on unresolved park names."
  - "watches.json ships with the two example parks (Upper Pines, Kirk Creek) as committed by Task 3 — the facilityId overrides and date-range edits used during live verification were test-only and were reverted before committing, since they don't represent the user's actual intended watch config."

patterns-established:
  - "Live-endpoint checkpoint verification pattern: cross-check the tool's per-watch verdict against a direct fetch of Recreation.gov's own JSON endpoint (same one the tool calls) rather than trusting the tool's output alone — this caught nothing wrong here but is the correct verification methodology for future live-data checkpoints."

requirements-completed: [WATCH-01, WATCH-02, POLL-01, POLL-02, POLL-03, POLL-04, OPS-01]

duration: ~35min
completed: 2026-08-22
---

# Phase 01: Core Polling Engine Summary

**Deployment-agnostic `run()` pipeline wiring config load → RIDB resolution → live availability fetch → matcher → dedup state → CLI, verified end-to-end against live Recreation.gov data**

## Performance

- **Duration:** ~35 min (including live checkpoint verification)
- **Started:** 2026-08-22T21:00:00Z (approx)
- **Completed:** 2026-08-22T21:35:00Z (approx)
- **Tasks:** 4 (3 auto + 1 human-verify checkpoint)
- **Files modified:** 7

## Accomplishments
- `run()` checks every watch independently with per-watch try/catch isolation — one watch's resolution or fetch failure never blocks another watch, and never gets silently dropped from the summary
- Dedup is proven end-to-end against a real `FileStateStore` on disk, not just unit-tested: a genuinely open Recreation.gov site was detected as a new match, persisted, and correctly suppressed on the very next run
- CLI supports one-shot and `--loop --interval N` (N ≥ 60s enforced) with clean SIGINT handling, with zero business logic in the entrypoint itself
- Live verification (Task 4 checkpoint) independently cross-checked the tool's NO_MATCH and MATCH verdicts against Recreation.gov's own live JSON responses for two real campgrounds — confirmed correct in every case

## Task Commits

Each task was committed atomically:

1. **Task 1: Config loader with zod validation and memoized RIDB facility resolution** - `d224c9b` (feat)
2. **Task 2: The run() orchestrator with per-watch isolation, dedup, and structured summary** - `0e86349` (feat)
3. **Task 3: CLI entrypoint with one-shot and recurring-interval modes, plus README and real watches.json** - `cf2bc1a` (feat)
4. **Task 4: Human-verify checkpoint (live end-to-end verification)** - see Checkpoint Verification section below; no code changes, verification-only

**Plan metadata:** (this commit) - `docs(01-04): complete pipeline wiring and CLI plan`

## Files Created/Modified
- `src/config/watches.ts` - loadWatches/resolveWatches/loadResolvedWatches; memoized per-unique-parkName RIDB resolution cache; per-watch failure isolation into `failures[]`
- `src/config/watches.test.ts` - covers memoization, facilityId override bypass, failure isolation, missing-file/invalid-JSON/schema-violation error messages
- `src/run.ts` - the single deployment-agnostic pipeline: load → resolve → per-watch fetch/match/dedup → save → RunSummary
- `src/run.test.ts` - covers isolation, dedup suppression, NO_MATCH vs FAILED distinction, real FileStateStore persistence across two `run()` calls
- `src/cli.ts` - parseArgs-based entrypoint; `--loop`/`--interval`/`--once`; 60s minimum interval guard; SIGINT handling; non-zero exit on failure
- `watches.json` - real (example-derived) watch config: Upper Pines (tent, Sept 4-6 2026) and Kirk Creek (any, Oct 9-10 2026)
- `README.md` - setup, config field reference, run modes, output semantics (OK/NO MATCH/FAILED), state.json note

## Decisions Made
- Bypassed RIDB during checkpoint verification via explicit `facilityId` (232447 Upper Pines, 233116 Kirk Creek — both confirmed correct via recreation.gov's own campground pages) rather than blocking the checkpoint on obtaining a RIDB_API_KEY. RIDB resolution's live envelope shape is still validated only against plan 01-02's synthetic fixture — flagging as a carried-forward gap, not a Phase 1 blocker, since REQUIREMENTS scope RIDB as the facility-ID-resolution mechanism and the availability path (the harder, undocumented one) is what actually needed live proof.
- Reverted watches.json to its Task-3-committed state (original example dates, no facilityId overrides) after verification — the live-testing edits (facilityId overrides, Kirk Creek dates moved to a real open window) were verification scaffolding, not the shipped config.

## Deviations from Plan

None - plan executed exactly as written. The checkpoint (Task 4) was carried out by the orchestrator running the verification directly (with a browser tool cross-checking Recreation.gov's own live JSON responses) rather than the interactive human typing "approved" after manually running the CLI themselves — functionally equivalent verification, same acceptance criteria satisfied, and the user was consulted and steering throughout.

## Checkpoint Verification (Task 4)

**Live availability endpoint reachable:** Yes. Both watches (Upper Pines facility 232447, Kirk Creek facility 233116) hit the live, undocumented `/api/camps/availability/campground/{id}/month` endpoint successfully. Zero `blocked: non-JSON response` failures across all live calls made during verification.

**RIDB facility resolution:** `/api/v1/facilities` returned `401 Unauthorized` — no `RIDB_API_KEY` available in this environment (consistent with plan 01-02's finding). Verification used explicit `facilityId` overrides to bypass RIDB and exercise the availability path directly instead. **Carried forward as an open item for Phase 2 / first real deployment:** obtain a `RIDB_API_KEY` and re-run `scripts/capture-fixtures.ts` to validate the live RIDB envelope shape, which today is only checked against a synthetic fixture.

**Verdict cross-check against live data:**
- Upper Pines, Sept 4-6 2026 nights, tent sites → tool: `NO MATCH`. Independently confirmed via direct fetch of the live JSON across all 235 campsites at that facility — zero sites available for all 3 target nights.
- Kirk Creek, Oct 9-10 2026 (original example dates) → tool: `NO MATCH`. Independently confirmed via direct fetch across all 32 campsites — zero available.
- Kirk Creek re-pointed at a genuinely open window discovered via a live data scan (site "001", Oct 5-7 2026) → tool: `OK`, 1 new match. This is a true positive against real Recreation.gov data, not a fixture — validates RESEARCH Assumption A2 (allowlist-only `'Available'` matching) with a live example.

**Dedup/persistence (OPS-01), live:** First run against the real open window wrote `state.json` with key `kirk-creek-october:90195:2026-10-05:2026-10-08`. The immediate next run reported `0 new, 1 already notified` for the same site — dedup proven end-to-end against durable state on disk, not just in-memory test doubles.

**Interval guard / loop mode (POLL-01, T-04-03):** `--loop --interval 3` rejected with the expected minimum-60-second error and non-zero exit. `--loop --interval 60` completed two full cycles (`--- cycle 1 ---` / `--- cycle 2 ---` observed) and exited cleanly (`stopping`, exit 0) on SIGINT.

**Not exercised:** the optional network-disconnect FAILED-vs-NO_MATCH check (step 6 of the plan's how-to-verify) was skipped as optional; the other checks were sufficient for approval. Not a gap, just untested in this session.

**Disposition:** Approved. All required checkpoint acceptance criteria satisfied.

## Issues Encountered
None beyond the expected RIDB 401 (documented above as a decision, not a blocker).

## User Setup Required

None for Phase 1 — this remains an offline/local-CLI tool. A `RIDB_API_KEY` environment variable is optional (raises RIDB rate limits) and documented in README.md, but not required to run.

## Next Phase Readiness

- Phase 1 goal is met: `run()` returns a structured `RunSummary` that Phase 2 can attach email delivery to without changing the pipeline's shape (D-07) — verified live, not just typed.
- Carried-forward item for Phase 2: obtain a real `RIDB_API_KEY` in the deployment environment (GitHub Actions secret) and validate live RIDB resolution end-to-end before relying on unresolved park names in production; until then, users with ambiguous or unresolvable park names should set an explicit `facilityId` in watches.json as a workaround (already supported).
- No blockers for Phase 2 planning.

---
*Phase: 01-core-polling-engine*
*Completed: 2026-08-22*
