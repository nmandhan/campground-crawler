---
phase: 02-notification-delivery-deployment
plan: 01
subsystem: notifications
tags: [resend, email, node-test, digest]

requires: []
provides:
  - "buildSubject/buildBody pure formatters over MatchedSlot[] for digest emails"
  - "sendDigestEmail: injectable, non-throwing Resend delivery function"
  - "resend@^6.22.0 dependency"
affects: [02-02-run-wiring]

tech-stack:
  added: [resend@^6.22.0]
  patterns: ["injectable sendImpl for network calls (mirrors recreation-gov client pattern)", "module-private sanitize()/safeBookingUrl() guards on untrusted upstream fields before interpolation into user-facing text"]

key-files:
  created: [src/notify/email.ts, src/notify/email.test.ts]
  modified: [package.json, package-lock.json]

key-decisions:
  - "Resend client constructed lazily inside the default sendImpl arrow, never at module scope, so importing email.ts with no API key set is harmless"
  - "sanitize() collapses CR/LF/tab and truncates at 200 chars on every upstream-derived field before it reaches subject or body, closing header-injection and body-forgery threats (T-02-02)"
  - "safeBookingUrl() allowlists only https://www.recreation.gov/ URLs; anything else renders '(booking link unavailable)' instead of an attacker-controlled link (T-02-03)"

patterns-established:
  - "Notification module owns all env var reads for its own credentials (RESEND_API_KEY/NOTIFY_EMAIL/NOTIFY_FROM) — no other module may read them"
  - "Failure-tolerant network wrapper: catch + logger.error + return, never throw, to preserve the run() failure-isolation boundary (D-11/D-12)"

requirements-completed: [NOTF-01, NOTF-02]

duration: 25min
completed: 2026-08-23
---

# Phase 02 Plan 01: Notification Digest Formatting and Delivery Summary

**Pure digest subject/body formatters plus an injectable, non-throwing Resend-backed `sendDigestEmail` that never leaks the API key or recipient into logs.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-23T20:59:00Z (approx, worktree base checkout)
- **Completed:** 2026-08-23T21:25:28Z
- **Tasks:** 2 completed
- **Files modified:** 4 (package.json, package-lock.json, src/notify/email.ts, src/notify/email.test.ts)

## Accomplishments
- `buildSubject`/`buildBody` produce the exact digest formats specified (D-04/D-05/D-06/D-07), deduping park names and grouping matches by watch+facility
- CR/LF/tab injection from untrusted Recreation.gov fields is neutralized before reaching the subject or body (T-02-02)
- `bookingUrl` is allowlisted to `https://www.recreation.gov/` to prevent link spoofing (T-02-03)
- `sendDigestEmail` resolves (never throws/rejects) on every failure mode: Resend API error, thrown network error, missing `RESEND_API_KEY`, missing `NOTIFY_EMAIL` — preserving the run() failure-isolation boundary
- No code path interpolates the API key or recipient into any log line (T-02-01), verified by a dedicated leak-assertion test

## Task Commits

Each task followed RED → GREEN TDD:

1. **Task 1: Add resend dependency and pure digest formatters**
   - `7416d35` test(02-01): add failing tests for email digest formatters (RED)
   - `4976917` feat(02-01): implement digest subject/body formatters (GREEN)
2. **Task 2: sendDigestEmail — injectable Resend call that never throws and never leaks the key**
   - `72d98bd` test(02-01): add failing tests for sendDigestEmail (RED)
   - `d5185d7` feat(02-01): implement sendDigestEmail with injectable Resend call (GREEN)

_Note: dependency install (`npm install resend@^6.22.0`) landed in the Task 1 RED commit alongside the test file, since `package.json`/`package-lock.json` are Task 1 outputs._

## Files Created/Modified
- `src/notify/email.ts` (137 lines) - `buildSubject`, `buildBody`, `sanitize`, `safeBookingUrl`, `DEFAULT_FROM`, `sendDigestEmail`, and supporting types (`EmailLogger`, `EmailPayload`, `SendResult`, `SendDigestOptions`)
- `src/notify/email.test.ts` (201 lines) - 19 passing `node:test` cases covering formatter behavior, injection resistance, and every `sendDigestEmail` failure/success path, including a leak-assertion test
- `package.json` / `package-lock.json` - added `resend@^6.22.0` dependency (exact spec match, `zod` untouched)

## Decisions Made
- Followed the plan's exact contracts for `buildSubject`/`buildBody`/`sendDigestEmail` — no deviation from the specified shapes, sanitization rules, or error-handling order.
- Fixed two TypeScript strict-null-check errors in the test file (`lines[0]` under `noUncheckedIndexedAccess`) by using optional chaining (`lines[0]?.includes(...)`) rather than non-null assertions, keeping the test file free of `!` assertions.

## Deviations from Plan

None - plan executed exactly as written. The two optional-chaining fixes in the test file are TDD implementation detail (Rule 1 - trivial bug/lint fix to satisfy `npm run typecheck`), not a change to the specified behavior or contracts.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required for this plan. `RESEND_API_KEY`/`NOTIFY_EMAIL` wiring and the Resend account setup are deferred to a later plan in this phase (per the plan's threat model T-02-05, which assigns the restricted-key setup checkpoint to plan 02-04).

## Next Phase Readiness

`src/notify/email.ts` is ready for plan 02-02 to import `sendDigestEmail` and wire it into `run()` against `RunSummary.newMatches`, without touching `src/run.ts` or `src/types.ts` (verified untouched — `git diff --stat` empty for both). No blockers.

---
*Phase: 02-notification-delivery-deployment*
*Completed: 2026-08-23*

## Self-Check: PASSED

All created files verified present on disk; all 4 task commits (7416d35, 4976917, 72d98bd, d5185d7) verified in git log.
