---
phase: 03-status-dashboard
status: issues-found
reviewed_at: 2026-08-25T01:30:00.000Z
findings_count: 8
---

# Phase 03 Code Review

Diff reviewed: `f308535...HEAD` (36 files, +4454/-5), covering plans 03-01 through 03-05.

## Findings

### 1. [correctness · CONFIRMED] Commit-skip guard defeated by unconditional runs.json append
**File:** `.github/workflows/poll.yml:47`

The new "Append run to history log" step runs unconditionally every cycle (`if: always()`) and
always writes a fresh timestamped entry into `runs.json`, so the downstream "commit only if
state.json/runs.json changed" guard can no longer be satisfied — every 5-minute cron cycle now
commits and pushes to `main`, even when nothing else changed.

Because `runs.json`'s `startedAt`/`finishedAt` timestamps differ every run, `git status
--porcelain -- state.json runs.json` is never empty, so the "No state changes — skipping commit"
branch is now dead code. This produces ~288 commits/day to the default branch indefinitely — a
real behavior change from the original "commit only when something actually changed" design
intent.

### 2. [correctness · CONFIRMED] Watch id with a colon silently vanishes from Active Matches
**File:** `dashboard/lib/derive-active-matches.ts:22`

`parseDedupKey` requires exactly 4 colon-separated segments, but `Watch.id`
(`src/config/schema.ts:9`, `z.string().min(1)`) has no restriction on colons. A watch id
containing `:` produces a 5-segment dedup key that `parseDedupKey` rejects and silently drops
(`if (!parsed) continue;` in `deriveActiveMatches`) — no error surfaced anywhere, even though
`state.json` still has the entry. Not currently triggered (live watch ids contain no colons), but
the mechanism is live.

### 3. [correctness · PLAUSIBLE] Mixed-precision ISO timestamps break string-sorted order
**File:** `dashboard/lib/derive-timeline.ts:25`

Run ordering is computed with plain string comparison (`a.startedAt > b.startedAt`) across
`derive-timeline.ts`, `derive-status.ts`, and `derive-active-matches.ts`. `src/run.ts` always
produces millisecond-precision timestamps (`Date.toISOString()`), but the new `poll.yml`
crash-fallback synthesizes second-precision timestamps (`date -u +%Y-%m-%dT%H:%M:%SZ`). Since `.`
(0x2E) sorts before `Z` (0x5A), a no-millisecond timestamp can lexicographically outrank a
millisecond timestamp at the same or later instant, which can pick the wrong "latest run" if a
crash entry and a real entry land in the same whole second.

### 4. [correctness · CONFIRMED] runOnce() drops the real crash reason on a fatal error
**File:** `src/cli.ts:34`

`runOnce()` has no try/catch around `await run()`. When `run()` throws, `writeRunSummaryFile` is
never reached and the real exception message is discarded — the workflow's crash-fallback then
substitutes a generic placeholder reason ("poller exited without producing a run summary")
instead of the actual error, losing the one piece of information that would explain what broke.

### 5. [reuse · CONFIRMED] Booking-URL allowlist duplicated with no shared source
**File:** `dashboard/lib/derive-active-matches.ts:32`

`safeBookingUrl` (the `https://www.recreation.gov/` allowlist check, threat T-03-08) is
copy-pasted byte-for-byte from `src/notify/email.ts:25-27`, tied together only by a code comment.
A future change to the allowlist in one place has no mechanism forcing the other to follow —
risking either broken booking links or a reopened link-spoofing hole.

### 6. [reuse · CONFIRMED] UTC date parsing reimplemented instead of shared
**File:** `dashboard/lib/format.ts:78`

`parseDateOnlyUTC` reimplements UTC-safe `YYYY-MM-DD` parsing that already exists as the pattern
used in `src/matcher/dates.ts` for the poller's matcher-critical date-range logic, as an
independent, unlinked copy. A correctness fix to the matcher's date handling has no path to
propagate to the dashboard's copy.

### 7. [efficiency · CONFIRMED] Same runs array re-sorted three times per page render
**File:** `dashboard/lib/derive-status.ts:33`

`buildDashboardModel` triggers three independent O(n log n) sorts of the same `runs` array
(in `derive-status.ts`, `derive-timeline.ts`, and a separate linear max-scan in
`derive-active-matches.ts`) plus an O(watches × runs × outcomes) nested scan, instead of sorting
once and reusing the result. Low absolute cost given the 50-entry cap, but the three independent
sorts have inconsistent tie-breaking, which combined with finding 3 can make "latest run" diverge
between sections on the same page.

### 8. [correctness · PLAUSIBLE] Booking-link allowlist narrower than upstream producer
**File:** `dashboard/lib/derive-active-matches.ts:42`

`buildBookingUrl` gates `campsiteId` through `CAMPSITE_ID_ALLOWLIST` (`/^[A-Za-z0-9_-]+$/`), but
the actual producer of `campsiteId` values (`src/types.ts`, fed by Recreation.gov's live API
response) performs no such validation. If Recreation.gov ever returns an ID outside that charset,
the dashboard would silently render the active match with `bookingUrl: null` — a silent UX
regression rather than a crash.

## Recommendation

Findings 1, 2, and 4 are real behavior defects worth fixing before or shortly after this phase is
marked complete — particularly finding 1, which changes the repo's commit cadence from
event-driven to constant. None are launch-blocking for the dashboard's core value (a hosted
status page), and the dashboard itself is live and verified end-to-end (see 03-05-SUMMARY.md).

Run `/gsd-code-review-fix 03` to address these, or triage manually.
