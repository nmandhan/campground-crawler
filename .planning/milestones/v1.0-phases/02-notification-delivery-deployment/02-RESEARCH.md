# Phase 2: Notification Delivery & Deployment - Research

**Researched:** 2026-08-22
**Domain:** Transactional email delivery (Resend) + GitHub Actions scheduled workflow deployment, wired onto an already-complete Phase 1 polling pipeline
**Confidence:** HIGH

## Summary

Phase 2 is almost entirely an integration task, not a design task. Phase 1 already built and live-verified the full polling pipeline — `run()` in `src/run.ts` returns a `RunSummary` whose `newMatches: MatchedSlot[]` field is exactly the data Phase 2 needs to email, `MatchedSlot` already carries every field NOTF-02 requires (`facilityName`, `siteLabel`, `startDate`, `endDate`, `bookingUrl`), and dedup suppression (NOTF-03) is already implemented and tested in `src/state/fileStore.ts` / `src/state/store.ts`. Phase 2's actual new work is: (1) add a `src/notify/email.ts` module that formats one digest email per run and sends it via Resend, wired into `run()` as a new optional `RunDeps.sendNotification` dependency following the existing DI pattern; (2) add a `.github/workflows/` scheduled workflow that runs `npm start` (or `tsx src/cli.ts`) every 5 minutes, commits `state.json` back to the repo only when it changed, and uses a `concurrency` guard; (3) move `RESEND_API_KEY` and `NOTIFY_EMAIL` into GitHub encrypted Secrets (OPS-03).

All CONTEXT.md decisions (D-01 through D-12) are locked and this research does not revisit them — it verifies the concrete APIs/config needed to implement them: current Resend SDK usage/error shape, GitHub Actions workflow syntax for scheduled cron + commit-back + concurrency, and the exact seam in `run.ts`/`types.ts` the email step attaches to.

**Primary recommendation:** Add `src/notify/email.ts` exporting a `sendNotification(newMatches: MatchedSlot[]): Promise<void>` (or similar) built on `resend.emails.send()`, inject it into `run()` as `deps.sendNotification` (default: real Resend call) so it stays unit-testable exactly like `loadResolved`/`fetchRange`/`store`, call it once per run after matches are computed (not per-match), and add a `.github/workflows/poll.yml` with `on.schedule: cron: '*/5 * * * *'`, `concurrency: { group: poller, cancel-in-progress: false }`, and a conditional `git commit`/`push` step guarded by `git diff --quiet -- state.json`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Email formatting (subject/body) | Application logic (`src/notify/email.ts`) | — | Pure function of `MatchedSlot[]`, no I/O — same "pure/isolated module" pattern as `matcher/` per ARCHITECTURE.md |
| Email delivery (SMTP/API call) | External service (Resend API) | Application logic (thin wrapper) | Resend SDK owns the actual network call; app code only builds the payload and handles the `{data,error}` response |
| Scheduling/trigger | CI/CD platform (GitHub Actions `schedule`) | — | Confirmed in STACK.md — no in-app scheduler needed, matches "deployment-agnostic `run()` + thin trigger adapter" pattern already used for `cli.ts` |
| Credential storage | CI/CD platform (GitHub encrypted Secrets) | — | Never the app/repo — OPS-03 requirement, D-03 scopes it to exactly `RESEND_API_KEY` + `NOTIFY_EMAIL` |
| State persistence across runs | Git repo (committed `state.json`) | CI/CD workflow (commit/push step) | Already built in Phase 1 (`FileStateStore`); Phase 2 only adds the workflow-level commit-back step, no store code changes |
| Dedup suppression logic | Application logic (`src/state/`) | — | Fully implemented in Phase 1, NOT part of Phase 2's new work — verify only, don't rebuild |

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

**Repo Visibility & Secrets**
- D-01: Repo is public → unlimited free GitHub Actions minutes at the existing 5-min cadence (`MIN_INTERVAL_SECONDS = 60` in `cli.ts`, effectively 300s).
- D-02: `watches.json` stays committed in the repo (unchanged from Phase 1).
- D-03: Only `NOTIFY_EMAIL` and `RESEND_API_KEY` go in GitHub encrypted Secrets. No other config moves to secrets.

**Email Content & Batching**
- D-04: One digest email per poll cycle, not one email per matched site. If `RunSummary.newMatches` is non-empty, send a single email listing every new match, grouped by watch/park.
- D-05: Plain text email body, not HTML. Booking link is a plain URL.
- D-06: Subject line includes match count + distinct park/campground names, e.g. `"2 new campsites available: Yosemite, Joshua Tree"`.
- D-07: Email body per match includes (from existing `MatchedSlot` fields): facility name, site label, date range, and `bookingUrl`. No new data capture needed.

**Poll Cadence & Workflow Mechanics**
- D-08: GitHub Actions `schedule` trigger at 5-minute cadence (`cron: '*/5 * * * *'`).
- D-09: The workflow commits/pushes the updated dedup state file only when it changed (e.g. `git diff --quiet` check) — avoid no-op commits every 5 min.
- D-10: A `concurrency` group (e.g. `group: poller, cancel-in-progress: false`) guards the workflow against overlapping runs corrupting state.
- D-11: The workflow keeps `cli.ts`'s existing exit-code behavior (non-zero exit when `summary.failed.length > 0`) — no workflow-level change needed beyond not swallowing the exit code.

**Failure Alerting**
- D-12: No separate email path for watch failures. GitHub Actions' own red-X run status + console/log output is sufficient for v1. Consecutive-failure-counter + dedicated failure-email path explicitly deferred.

### Claude's Discretion
- Exact email subject/body template wording beyond what D-06/D-07 specify.
- Internal module organization for the email-sending code (e.g. `src/notify/email.ts`) within the existing `src/` structure.
- Exact GitHub Actions workflow YAML structure (step names, checkout/setup-node versions) as long as it satisfies D-08 through D-11.
- Whether the state-changed check in D-09 is implemented via `git diff --quiet`, a computed hash comparison, or another equivalent mechanism.

### Deferred Ideas (OUT OF SCOPE)
- Consecutive-failure-counter + dedicated failure-notification email — rejected for Phase 2 scope (D-12).
- Digest/batched email across multiple poll cycles (NOTF-04/NOTF-05, v2) — Phase 2's digest (D-04) is scoped to a single run/cycle only.
- HTML email formatting — rejected in favor of plain text (D-05).

</user_constraints>

## Phase Requirements

<phase_requirements>

| ID | Description | Research Support |
|----|-------------|------------------|
| NOTF-01 | User receives an email when a watch finds a newly available matching site | `resend.emails.send()` API confirmed (Code Examples below); wiring point is `RunSummary.newMatches` in `run.ts`, already populated by Phase 1 |
| NOTF-02 | Email content includes campground/park name, site number, date(s), direct booking link | `MatchedSlot` already has `facilityName`, `siteLabel`, `startDate`/`endDate`, `bookingUrl` (types.ts:56-66) — no new normalization needed |
| NOTF-03 | Suppress duplicate/repeat alerts (notify once per new-availability transition) | Already implemented in Phase 1 (`FileStateStore.has()`/`markNotified()`, `dedupKey()`); Phase 2 only needs to email from `newMatches` (post-dedup), never from `suppressed` |
| OPS-02 | System runs unattended on a schedule without manual triggering | GitHub Actions `on.schedule` cron syntax verified (Code Examples below), 5-min minimum interval confirmed in STACK.md |
| OPS-03 | API keys and email credentials stored as secrets, not committed | GitHub encrypted Secrets mechanism (`${{ secrets.X }}` injected as env vars) — standard, verified pattern in Code Examples below |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `resend` | 6.22.0 [VERIFIED: npm registry, `npm view resend version`, published 2026-08-21] | Transactional email SDK | Already the project's chosen provider (CLAUDE.md, STACK.md); official typed Node SDK, no SMTP infra |

### Supporting
No new supporting libraries needed. `zod` (already a dependency) is sufficient for validating `NOTIFY_EMAIL`/`RESEND_API_KEY` presence at startup if desired — not required by any locked decision, Claude's discretion.

### Alternatives Considered
None — Resend and GitHub Actions are locked decisions from CONTEXT.md/STACK.md, not open questions for this research pass.

**Installation:**
```bash
npm install resend
```

**Version verification:** `npm view resend version` → `6.22.0`, last published 2026-08-21 [VERIFIED: npm registry]. Current at time of research; the project's existing `resend` reference in STACK.md (`6.x`, e.g. `6.20.0`) is consistent with this — no breaking major-version change to account for.

## Architecture Patterns

### System Architecture Diagram

```
[GitHub Actions schedule trigger, cron: */5 * * * *]
        |
        v
[Workflow job: checkout -> setup-node -> npm ci]
        |
        v
[npm start  ==  tsx src/cli.ts  ->  run()]
        |
        v
   run() orchestrator (unchanged shape, src/run.ts)
        |
   [existing Phase 1 pipeline: config -> fetch -> match -> dedup]
        |
        v
   RunSummary { newMatches: MatchedSlot[], failed, noMatch, ... }
        |
        +--> if newMatches.length > 0:
        |        v
        |    [NEW: notify/email.ts -> resend.emails.send()]
        |        v
        |    Resend API -> user's inbox (NOTIFY_EMAIL)
        |
        +--> [existing: store.save() -> state.json written locally]
        |
        v
[Workflow: git diff --quiet state.json?]
        |
   no change -> skip commit          changed -> git commit + push state.json
        |                                   |
        v                                   v
   [job exits with cli.ts's exit code: 0 if no FAILED outcomes, 1 otherwise]
        |
        v
   [GitHub Actions run shows green/red accordingly (OPS-02/D-11 visibility)]
```

### Recommended Project Structure
```
src/
├── notify/
│   └── email.ts        # NEW: format digest text + call resend.emails.send()
├── run.ts               # MODIFIED: add optional sendNotification dep, call after matches computed
├── types.ts              # UNCHANGED: MatchedSlot already has all needed fields
.github/
└── workflows/
    └── poll.yml          # NEW: schedule trigger, concurrency guard, commit-back step
```

### Pattern 1: Injectable notifier following the existing `RunDeps` DI pattern

**What:** `run.ts` already takes an optional `RunDeps` bag (`loadResolved`, `fetchRange`, `store`, `logger`, `now`) with real implementations as defaults. Add `sendNotification` the same way so the email step is unit-testable without a real Resend call, mirroring the exact pattern the codebase already established in Phase 1.
**When to use:** Any time new I/O is added to `run()`.
**Example:**
```typescript
// run.ts — extend RunDeps (pattern already established, not new to this codebase)
export interface RunDeps {
  loadResolved?: () => Promise<ResolveResult>;
  fetchRange?: (...) => Promise<RawAvailabilityResponse[]>;
  store?: StateStore;
  logger?: RunLogger;
  now?: () => Date;
  sendNotification?: (matches: MatchedSlot[]) => Promise<void>; // NEW
}

export async function run(deps?: RunDeps): Promise<RunSummary> {
  const sendNotification = deps?.sendNotification ?? sendDigestEmail; // from notify/email.ts
  // ... existing pipeline unchanged ...
  if (newMatches.length > 0) {
    await sendNotification(newMatches);
  }
  // ... existing return unchanged ...
}
```
Source: pattern directly extrapolated from existing `src/run.ts` structure (read in this session) — [VERIFIED: codebase].

### Pattern 2: Resend send + explicit error check (SDK does not throw)

**What:** `resend.emails.send()` returns `{ data, error }` — it does NOT throw on API-level failures (invalid key, rate limit, etc.). Must explicitly check `error`.
**When to use:** Every call site.
**Example:**
```typescript
// Source: https://resend.com/docs/send-with-nodejs (fetched 2026-08-22)
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const { data, error } = await resend.emails.send({
  from: 'Campground Crawler <onboarding@resend.dev>', // see Pitfall below re: production domain
  to: [process.env.NOTIFY_EMAIL!],
  subject: '2 new campsites available: Yosemite, Joshua Tree',
  text: 'Yosemite — Site 012, 2026-09-01 to 2026-09-03\nhttps://www.recreation.gov/camping/campsites/12345\n\n...',
});

if (error) {
  // per describeFailure() convention already in src/errors.ts — log, don't throw/crash the run
  console.error(`email send failed: ${error.name}: ${error.message}`);
  return;
}
```
Success shape: `{ data: { id: '49a3999c-...' }, error: null }`.
Error shape: `{ data: null, error: { message: string, name: string } }`.
[CITED: resend.com/docs/send-with-nodejs, fetched 2026-08-22]

### Pattern 3: GitHub Actions scheduled workflow with concurrency guard + conditional commit-back

**What:** Standard pattern for stateful scheduled jobs on GitHub Actions — matches STACK.md's recommendation exactly.
**When to use:** This phase's `.github/workflows/poll.yml`.
**Example:**
```yaml
# Source: GitHub Actions docs (schedule/concurrency syntax) — standard, stable syntax
# https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule
# https://docs.github.com/en/actions/using-jobs/using-concurrency
name: Poll campsite availability

on:
  schedule:
    - cron: '*/5 * * * *'
  workflow_dispatch: {}  # allows manual trigger for testing, no functional change

concurrency:
  group: poller
  cancel-in-progress: false

permissions:
  contents: write  # required to git push state.json back

jobs:
  poll:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
      - run: npm ci
      - name: Run poller
        id: run
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          NOTIFY_EMAIL: ${{ secrets.NOTIFY_EMAIL }}
        run: npm start
      - name: Commit state if changed
        if: always()
        run: |
          if ! git diff --quiet -- state.json; then
            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git add state.json
            git commit -m "chore: update dedup state [skip ci]"
            git push
          else
            echo "no state change, skipping commit"
          fi
```
Notes on this example:
- `permissions: contents: write` is required for the built-in `GITHUB_TOKEN` to push — STACK.md mentions "using the built-in `GITHUB_TOKEN`" but does not spell out the `permissions` block; this is a common gap that causes a silent 403 on push if omitted. [VERIFIED: standard GitHub Actions behavior — default `GITHUB_TOKEN` permissions on public repos are read-only for `contents` unless explicitly elevated or the repo/org default is changed]
- `if: always()` on the commit step ensures state is still committed even if `npm start` exits non-zero (D-11 preserves the failing exit code for the job overall via the `run` step's own exit code, which GitHub Actions surfaces regardless of later steps unless a later step also fails) — worth flagging as a discretionary design point for the planner: use `if: always()` moved to check the run step specifically, or accept that job-level status is driven by the first failing step. [ASSUMED — see Assumptions Log A1]
- `[skip ci]` in the commit message prevents the commit-back push from (harmlessly, since this workflow is schedule/dispatch-triggered, not push-triggered) triggering itself — defensive, not strictly required given this workflow has no `on: push` trigger. [ASSUMED — see Assumptions Log A2]
- `actions/checkout@v7` / `actions/setup-node@v7` are current majors as of mid-2026 (GitHub Actions runners moved to require Node 24 for JS actions by June 2026, driving v6→v7 upgrades). [CITED: web search of GitHub Actions changelog discussions, MEDIUM confidence — verify exact latest tag at plan/execution time via `gh api repos/actions/checkout/releases/latest` since this moves faster than most research caching windows]

### Anti-Patterns to Avoid
- **Sending one email per matched site (Anti-Pattern 4 in ARCHITECTURE.md):** Explicitly rejected by D-04. Batch all `newMatches` from one run into one email.
- **Committing state unconditionally every run:** Creates a commit every 5 minutes even when nothing changed — explicitly rejected by D-09. Always gate on a diff/hash check.
- **Assuming `resend.emails.send()` throws on failure:** It returns `{ error }` instead — an un-checked `error` field means a silently-dropped notification with no error surfaced anywhere (violates NOTF-01's implicit reliability bar). Always check and log.
- **Coupling the email step to the trigger/workflow instead of `run()`:** Per ARCHITECTURE.md Anti-Pattern 2 — the email send belongs inside `run()` (via the `RunDeps.sendNotification` seam), not bolted onto the GitHub Actions YAML or `cli.ts`, so `run()` stays deployment-agnostic and locally testable via CLI without needing real GH Actions infrastructure.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email delivery (SMTP, retries, deliverability) | Custom SMTP client / Nodemailer against personal Gmail | `resend` SDK (already chosen) | PITFALLS.md Pitfall 6 — personal SMTP is rate-limited and prone to spam-flagging; Resend's typed SDK + domain auth is the standard approach and already installed-adjacent (`resend@6.22.0` verified available) |
| Cron scheduling / job runner | Custom `setInterval` loop kept alive on some server | GitHub Actions `schedule` trigger (already decided, D-08) | Zero infra to manage; `cli.ts`'s own `--loop` mode exists for local dev only, not for production scheduling |
| Cross-run state persistence | New KV/Redis/DB integration | Existing `FileStateStore` + git commit-back (already built in Phase 1) | Explicitly out of scope per `fileStore.ts` comment: "do not add a KV implementation, that is explicitly deferred" |
| Dedup/suppression logic | New dedup logic in the email module | Existing `dedupKey()` / `store.has()` / `markNotified()` in `src/state/store.ts` | Already correct and tested; Phase 2 must consume `RunSummary.newMatches` (post-dedup), never re-derive suppression itself |

**Key insight:** There is very little "new" logic to hand-roll in this phase at all — the risk is re-implementing something Phase 1 already solved (dedup, error classification, exit codes) rather than reaching for an unnecessary library.

## Common Pitfalls

### Pitfall 1: Sending from Resend's `onboarding@resend.dev` test domain in the actual production workflow
**What goes wrong:** `onboarding@resend.dev` works for testing but Resend's own docs state it's "for testing only" — deliverability/reputation for a long-running unattended tool should use a verified custom domain (SPF/DKIM/DMARC), per PITFALLS.md Pitfall 6 (~17% of transactional email has been reported landing in spam even when the provider reports "delivered").
**Why it happens:** The test domain requires zero setup and "just works" in a first manual test, so it's easy to ship without ever verifying a real domain.
**How to avoid:** If the user owns a domain, verify it with Resend (DNS SPF/DKIM records) before relying on this for the "book it before someone else does" use case. If no domain is available, using `onboarding@resend.dev` is an acceptable v1 shortcut but should be flagged as a known deliverability risk, not silently treated as production-ready.
**Warning signs:** Test alert lands in Spam/Promotions rather than Primary inbox.
**Note:** CONTEXT.md doesn't lock a `from` domain decision — this is within Claude's Discretion but should be raised explicitly to the user if no verified domain exists, since it affects the core value prop (fast, reliable delivery).

### Pitfall 2: `GITHUB_TOKEN` lacking `contents: write` permission, causing the state commit-back push to fail silently
**What goes wrong:** Default `GITHUB_TOKEN` permissions can be read-only depending on repo/org settings; a `git push` step failing with a 403 doesn't always surface as loudly as a code error, and combined with D-11's "keep existing exit code behavior," a push failure could be missed if not checked explicitly.
**Why it happens:** GitHub changed default `GITHUB_TOKEN` permissions to be more restrictive by default over the past few years; older tutorials assume write access that isn't guaranteed.
**How to avoid:** Explicitly set `permissions: contents: write` at the workflow or job level (see Code Examples). Verify the commit-back step's exit code causes job failure if the push fails (don't silently swallow with `|| true`).
**Warning signs:** `state.json` never updates in the repo despite the workflow showing green; workflow logs show a `remote: Permission to ... denied` or `403` on the push step.

### Pitfall 3: Overlapping runs corrupting `state.json` despite the `concurrency` guard being misconfigured
**What goes wrong:** `cancel-in-progress: false` (per D-10) means a new run queues rather than cancels the old one — correct for this use case (don't want to interrupt a mid-flight email send) — but if someone flips this to `true` "to keep things snappy," a queued state-write mid-git-commit could be cancelled mid-push, corrupting `state.json` or leaving an inconsistent commit.
**Why it happens:** `cancel-in-progress: true` is the more commonly copy-pasted default in GitHub Actions tutorials (used for CI-on-push scenarios), so it's an easy accidental substitution.
**How to avoid:** Keep `cancel-in-progress: false` exactly as D-10 specifies; do not "optimize" this later without re-reading why it was chosen.
**Warning signs:** `state.json` fails to parse as valid JSON in a subsequent run (mid-write cancellation), or `FileStateStore.load()` logs the "state file was unreadable... starting from empty state" warning unexpectedly.

### Pitfall 4: Treating a Resend `error` response the same as an uncaught exception, breaking D-11's exit-code contract
**What goes wrong:** If the email step throws or is left unguarded and a `resend.emails.send()` call returns `{ error }` (not a thrown exception), naively propagating that as a fatal error could change `cli.ts`'s exit-code semantics (currently driven by `summary.failed.length`, which tracks *watch* failures, not notification failures) in a way CONTEXT.md doesn't ask for — D-11 explicitly says "no workflow-level change needed beyond not swallowing the exit code" for watch failures, and D-12 explicitly says no separate failure-email path exists for Phase 2. A failed notification send should be logged (visible in the Actions log / red-X if it does affect exit code) but must not be conflated with a watch's poll failure in `RunSummary.failed`.
**Why it happens:** It's tempting to reuse the exact same `describeFailure()`/exit-code path for "email failed to send" since it's adjacent code, without deciding explicitly whether that should trip the job's exit code.
**How to avoid:** Decide explicitly (planner's call, within Claude's Discretion) whether a failed `resend.emails.send()` should (a) be silently logged only, (b) cause a non-zero exit distinct from watch failures, or (c) be added to `RunSummary` as its own field. CONTEXT.md doesn't specify this — flag as an open question for the planner rather than assuming.
**Warning signs:** A watch was healthy (matched, no failures) but the job still shows red because of an unrelated Resend outage, confusing "polling is broken" with "email delivery is broken."

## Code Examples

### Formatting the digest body from `MatchedSlot[]` (per D-04/D-06/D-07)
```typescript
// src/notify/email.ts — illustrative, not prescriptive of exact wording (Claude's Discretion)
import type { MatchedSlot } from '../types.js';

export function buildSubject(matches: MatchedSlot[]): string {
  const parks = [...new Set(matches.map((m) => m.facilityName))];
  return `${matches.length} new campsite${matches.length === 1 ? '' : 's'} available: ${parks.join(', ')}`;
}

export function buildBody(matches: MatchedSlot[]): string {
  return matches
    .map((m) => `${m.facilityName} — Site ${m.siteLabel}, ${m.startDate} to ${m.endDate}\n${m.bookingUrl}`)
    .join('\n\n');
}
```
This is a direct, mechanical consequence of D-06/D-07 and the existing `MatchedSlot` shape — no research risk here, included for planner convenience.

### Sending via Resend
```typescript
// Source: https://resend.com/docs/send-with-nodejs (fetched 2026-08-22), adapted to project conventions
import { Resend } from 'resend';
import type { MatchedSlot } from '../types.js';
import { buildSubject, buildBody } from './email.js'; // if split into separate fns

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendDigestEmail(matches: MatchedSlot[]): Promise<void> {
  if (matches.length === 0) return;

  const { error } = await resend.emails.send({
    from: process.env.NOTIFY_FROM ?? 'Campground Crawler <onboarding@resend.dev>',
    to: [process.env.NOTIFY_EMAIL!],
    subject: buildSubject(matches),
    text: buildBody(matches),
  });

  if (error) {
    console.error(`email send failed: ${error.name}: ${error.message}`);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| n/a — no prior Phase 2 implementation exists | This is greenfield within the project | — | — |

No "old vs. new approach" shift applies here — Phase 1 is complete and Phase 2 is its first extension. The one external-ecosystem note: `actions/checkout` and `actions/setup-node` have both moved to major version 7 as GitHub Actions runners require Node 24 for JS-based actions starting mid-2026 [CITED: web search, MEDIUM confidence — verify exact current tag at execution time rather than trusting this research snapshot, since action versions update frequently].

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | GitHub Actions job-level status/exit-code interaction with a later `if: always()` commit step behaves as described (job fails if the `run` step fails, regardless of later steps' success) | Architecture Patterns, Pattern 3 | If wrong, D-11's exit-code visibility could be masked by a later successful step — planner should verify this against a real GitHub Actions run early (Wave 0 / smoke-test the workflow) rather than trust this claim blindly |
| A2 | `[skip ci]` is worth including defensively even though this workflow has no `on: push` trigger that could self-loop | Architecture Patterns, Pattern 3 | Low risk if wrong — at worst a harmless no-op; safe to drop if the planner prefers a cleaner commit message |
| A3 | `permissions: contents: write` is required (not already granted by default) for this specific public repo | Common Pitfalls, Pitfall 2 | If the repo/org already grants write by default, this line is a harmless no-op; if omitted and actually required, the push silently fails — safer to include explicitly either way, so risk is low |

**If this table is empty:** N/A — see entries above. All three are low-to-moderate risk operational details, not risks to the core design (which is fully specified by CONTEXT.md's locked decisions).

## Open Questions

1. **Should a failed `resend.emails.send()` call affect the job's exit code / GitHub Actions red-X status?**
   - What we know: D-11 locks the exit-code contract to `summary.failed.length > 0` (watch/poll failures only). D-12 explicitly says no dedicated failure-email path exists.
   - What's unclear: CONTEXT.md doesn't say whether a notification-send failure should be silent-log-only or somehow surfaced as a job failure (distinct from a watch failure).
   - Recommendation: Default to silent-log-only (matches D-12's "no separate failure path" spirit) unless the planner/user wants stronger visibility; this is a small, low-risk decision the planner can make directly without re-opening discuss-phase.

2. **Does the user have a domain to verify with Resend, or should v1 ship on `onboarding@resend.dev`?**
   - What we know: PITFALLS.md flags spam-folder risk from unverified/shared sending domains as directly undermining the "fast enough to book it" value prop.
   - What's unclear: Not addressed in CONTEXT.md D-01 through D-12; likely wasn't discussed because it's an account-setup step outside the codebase, not a code architecture decision.
   - Recommendation: Planner should include a task/step for the user to verify a domain with Resend if they have one, but should not block the phase on it — `onboarding@resend.dev` is an acceptable v1 fallback per Resend's own docs, with the caveat documented above.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Node.js | Local dev / GitHub Actions runner | Yes (local) | v25.9.0 local [VERIFIED]; GitHub Actions workflow should pin `node-version: '22'` per STACK.md, independent of local version | n/a |
| npm | Package install | Yes (local) | 11.12.1 [VERIFIED] | n/a |
| git | State commit-back | Yes (local) | 2.50.1 [VERIFIED] | n/a |
| `resend` npm package | Email delivery (NOTF-01) | Not yet installed — `package.json` currently only lists `zod` [VERIFIED: package.json read] | 6.22.0 on npm registry [VERIFIED] | None needed — trivial `npm install resend` |
| Resend account + API key | Email delivery (NOTF-01, OPS-03) | Unknown — outside this session's ability to verify; must be confirmed with the user before/during planning | — | Blocks NOTF-01 entirely if the user has no Resend account yet — planner should flag as a setup prerequisite, not assume it exists |
| GitHub repo Secrets configured (`RESEND_API_KEY`, `NOTIFY_EMAIL`) | OPS-03, workflow execution | Unknown — not verifiable from this local session (requires GitHub repo settings access) | — | Planner should include an explicit task/step instructing the user to add these two secrets via repo Settings before the workflow can succeed |
| `.github/workflows/` directory | OPS-02 | Does not exist yet [VERIFIED: `ls .github` — no such directory] | — | This phase creates it — expected, not a blocker |

**Missing dependencies with no fallback:**
- Resend account/API key and configured GitHub Secrets — these are account-setup steps outside the codebase that the planner must surface as explicit tasks/prerequisites, not assume are already done.

**Missing dependencies with fallback:**
- `resend` npm package — trivially installed, no risk.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`), invoked via `node --import tsx --test "src/**/*.test.ts"` [VERIFIED: package.json `test` script] |
| Config file | none — plain `node:test` + `tsx` loader, no separate config file |
| Quick run command | `npm test -- src/notify/email.test.ts` (once created) or `node --import tsx --test src/notify/email.test.ts` |
| Full suite command | `npm test` |

Existing test files follow a consistent pattern: `assert/strict`, `mkdtemp`/`rm` for filesystem isolation (see `run.test.ts`, `watches.test.ts`), and hand-rolled fakes (e.g. `MemoryStateStore`, `recordingLogger()`) rather than a mocking library — Phase 2 tests should follow this same convention for consistency (e.g. a fake `sendNotification` recording calls, no real Resend network calls in tests).

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| NOTF-01 | `run()` calls `sendNotification` exactly once when `newMatches` is non-empty | unit | `node --import tsx --test src/run.test.ts` | ❌ Wave 0 — extend existing `run.test.ts` or add `src/notify/email.test.ts` |
| NOTF-01 | `run()` does NOT call `sendNotification` when `newMatches` is empty | unit | `node --import tsx --test src/run.test.ts` | ❌ Wave 0 |
| NOTF-02 | Email subject includes match count + distinct park names (D-06); body includes facility name/site/dates/bookingUrl per match (D-07) | unit | `node --import tsx --test src/notify/email.test.ts` | ❌ Wave 0 — new file for `buildSubject`/`buildBody` pure functions |
| NOTF-03 | Only `newMatches` (post-dedup) are ever passed to the email step, never `suppressed` | unit | `node --import tsx --test src/run.test.ts` | Partial — dedup itself already tested in `run.test.ts`/`fileStore.test.ts`; add assertion that `sendNotification` receives exactly the `newMatches` set |
| OPS-02 | Workflow YAML has valid schedule/concurrency syntax | manual / CI validation | GitHub Actions will reject invalid YAML on push — no local unit test for workflow files in this stack | n/a — manual-only, justified: no YAML-schema test harness exists in this repo and adding one is disproportionate for a single workflow file |
| OPS-03 | Secrets never appear in committed files or logs | manual / grep audit | `git log --all -p | grep -i 'RESEND_API_KEY\|re_'` (should return nothing) plus confirm `.env` remains gitignored (already true per `.gitignore` read this session) | n/a — manual-only, justified: secret-scanning is a repo-hygiene check, not a runtime behavior to unit test |

### Sampling Rate
- **Per task commit:** `node --import tsx --test src/notify/email.test.ts` (or `src/run.test.ts` if extending it)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`; additionally, a live smoke test is warranted for this phase specifically — trigger the workflow manually (`workflow_dispatch`) once against a real (or deliberately-forced) match to confirm an actual email arrives in the inbox, since no unit test can verify real Resend deliverability.

### Wave 0 Gaps
- [ ] `src/notify/email.test.ts` — unit tests for `buildSubject`/`buildBody` covering NOTF-02 (D-06/D-07 content requirements)
- [ ] Extend `src/run.test.ts` (or add fixtures) — assert `sendNotification` is called with exactly `newMatches`, exactly once, only when non-empty
- [ ] No new test framework/config needed — existing `node:test` + `tsx` setup fully covers this phase's testable surface

*(Manual-only items — GitHub Actions workflow YAML validity and end-to-end email deliverability — are explicitly out of scope for automated tests per the table above; the planner should still include an explicit manual verification step in the phase's success-criteria checklist.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | No | Single-user tool, no login/session surface added by this phase |
| V3 Session Management | No | N/A |
| V4 Access Control | No | N/A — no multi-tenant/access-control surface |
| V5 Input Validation | Marginal | `NOTIFY_EMAIL` should be a plausible email string; existing `zod` dependency could validate at startup, but this is a low-risk internal config value (not user-facing input) — Claude's Discretion, not a hard requirement |
| V6 Cryptography | No | No new crypto surface; TLS to Resend's API is handled by the SDK's underlying `fetch`, not app code |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Secret leakage via committed `.env` or logged HTTP headers | Information Disclosure | `.gitignore` already covers `.env` [VERIFIED: `.gitignore` read this session — contains `.env`]; `src/errors.ts`'s `describeFailure()` already has an explicit "MUST NOT include HTTP request headers or an apikey value" contract (existing Phase 1 convention) — the new Resend error-logging code (Pitfall 4 above) must follow the same convention: log `error.name`/`error.message` only, never log the full request payload or `RESEND_API_KEY` |
| Secret leakage via GitHub Actions workflow logs | Information Disclosure | GitHub Actions automatically redacts registered secret values from logs when injected via `${{ secrets.X }}` → `env:` — standard platform behavior, not something the app needs to implement, but the workflow must inject secrets via `env:`/`secrets:` context, never hardcode or echo them in a `run:` step [VERIFIED: standard, well-documented GitHub Actions behavior] |
| Overly-broad Resend API key permissions | Elevation of Privilege (blast radius on compromise) | Per PITFALLS.md Pitfall 7 — scope the Resend API key to send-only permissions if the Resend dashboard supports restricted keys, rather than using a full-access key; this is an account-configuration step, not code, so the planner should note it as a setup task rather than a code task |
| `GITHUB_TOKEN` over-permissioned at workflow level | Elevation of Privilege | Grant only `permissions: contents: write` (needed for the state commit-back), not blanket `permissions: write-all` — principle of least privilege for the auto-generated token |

## Sources

### Primary (HIGH confidence)
- `src/run.ts`, `src/types.ts`, `src/errors.ts`, `src/cli.ts`, `src/state/store.ts`, `src/state/fileStore.ts`, `src/run.test.ts`, `package.json`, `.gitignore` — all read directly in this session [VERIFIED: codebase]
- `npm view resend version` / `npm view resend time.modified` — confirms `resend@6.22.0`, published 2026-08-21 [VERIFIED: npm registry]
- `.planning/phases/02-notification-delivery-deployment/02-CONTEXT.md` — locked decisions D-01 through D-12 [VERIFIED: read this session]
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md` — requirement definitions and phase status [VERIFIED: read this session]

### Secondary (MEDIUM confidence)
- https://resend.com/docs/send-with-nodejs — fetched via WebFetch this session; code example, error/response shape, `onboarding@resend.dev` testing-only guidance [CITED]
- `.planning/research/STACK.md`, `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md` — prior project research (2026-08-16), read this session, treated as MEDIUM-HIGH per their own stated confidence levels [CITED: internal project research]

### Tertiary (LOW confidence)
- WebSearch on `actions/checkout`/`actions/setup-node` current major versions — indicates v7 is current as of mid-2026 driven by Node 24 runner requirements, but not confirmed against the GitHub Marketplace directly in this session; planner/executor should re-verify the exact tag at execution time (e.g. `gh api repos/actions/checkout/releases/latest`) rather than hardcode `@v7` from this research alone [LOW-MEDIUM confidence, flagged for validation]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Resend version verified directly against npm registry this session; GitHub Actions is a locked, previously-researched decision
- Architecture: HIGH — the integration seam (`RunDeps`, `RunSummary.newMatches`, `MatchedSlot`) was read directly from the existing, live codebase, not inferred
- Pitfalls: MEDIUM-HIGH — mostly grounded in prior project PITFALLS.md research plus direct reading of GitHub Actions' well-documented `GITHUB_TOKEN`/`concurrency` semantics; the exact `actions/checkout@v7` tag is the one LOW-confidence detail, clearly flagged

**Research date:** 2026-08-22
**Valid until:** ~30 days for the architecture/pitfalls findings (stable); ~7 days for the exact `actions/checkout`/`actions/setup-node` version pins specifically, since those move faster than the rest of this research — re-verify at execution time.
