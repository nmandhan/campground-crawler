# Phase 2: Notification Delivery & Deployment - Context

**Gathered:** 2026-08-22
**Status:** Ready for planning

<domain>
## Phase Boundary

The proven Phase 1 polling engine runs unattended in production and emails the user, with credentials handled securely, whenever a watch finds a genuinely new opening. Covers NOTF-01, NOTF-02, NOTF-03 (NOTF-03/dedup suppression logic already implemented in Phase 1 — this phase only wires real email onto the existing `newMatches` output), OPS-02, OPS-03.

Digest/batched email across poll cycles beyond a single run (NOTF-05) and re-notify-after-cooldown (NOTF-04) are v2 — out of scope here.

</domain>

<decisions>
## Implementation Decisions

### Repo Visibility & Secrets
- **D-01:** Repo is public. This gives unlimited free GitHub Actions minutes, so the 5-minute poll cadence from Phase 1 (`MIN_INTERVAL_SECONDS = 60`, effectively used at 300s per `cli.ts`) does not need to be throttled to stay in a private-repo minute budget.
- **D-02:** `watches.json` stays committed in the repo (unchanged from Phase 1 D-01) — park names/dates/site types are not sensitive and benefit from being diffable/auditable in git history.
- **D-03:** Only `NOTIFY_EMAIL` and `RESEND_API_KEY` go in GitHub encrypted Secrets. No other config moves to secrets — resolves the STATE.md-flagged blocker in favor of the simpler split.

### Email Content & Batching
- **D-04:** One digest email per poll cycle, not one email per matched site. If a run's `newMatches` (from `RunSummary`) is non-empty, send a single email listing every new match, grouped by watch/park. Avoids inbox flooding when multiple sites open in the same cycle; still arrives within that same cycle so latency is unaffected.
- **D-05:** Plain text email body, not HTML. Booking link is a plain URL. Simpler to generate and test; no material benefit from HTML for a single-recipient alert.
- **D-06:** Subject line includes match count + distinct park/campground names, e.g. `"2 new campsites available: Yosemite, Joshua Tree"` — scannable in an inbox/notification preview without opening the email.
- **D-07:** Email body per match should include (per existing `MatchedSlot` fields): facility name, site label, date range, and `bookingUrl`. No new data needs to be captured beyond what Phase 1's `MatchedSlot` already carries (NOTF-02 satisfied directly from existing types).

### Poll Cadence & Workflow Mechanics
- **D-08:** GitHub Actions `schedule` trigger at 5-minute cadence (`cron: '*/5 * * * *'`), consistent with the public-repo decision (D-01) and Phase 1's CLI default interval.
- **D-09:** The workflow commits and pushes the updated dedup state file only when it changed (i.e., skip commit/push if `git diff --quiet` on the state file, or equivalent check) — avoids a no-op commit every 5 minutes when nothing new was found.
- **D-10:** A `concurrency` group (e.g. `group: poller, cancel-in-progress: false`) guards the workflow so overlapping runs can't race and corrupt the state file (per STACK.md recommendation, already anticipated in Phase 1's persistence design).
- **D-11:** The workflow keeps `cli.ts`'s existing exit-code behavior: non-zero exit when `summary.failed.length > 0`, so a FAILED watch shows as a red/failed run in the GitHub Actions tab. No workflow-level change needed beyond not swallowing the exit code.

### Failure Alerting
- **D-12:** No separate email path for watch failures. GitHub Actions' own red-X run status plus console/log output (Phase 1 D-07) is sufficient visibility for v1. The user can optionally enable GitHub's own "notify on workflow failure" repo setting outside of this codebase — no code change needed for that. A consecutive-failure-counter + dedicated failure-email path is explicitly deferred (not part of Phase 2 scope).

### Claude's Discretion
- Exact email subject/body template wording beyond what D-06/D-07 specify
- Internal module organization for the email-sending code (e.g. `src/notify/email.ts`) within the existing `src/` structure
- Exact GitHub Actions workflow YAML structure (step names, checkout/setup-node versions) as long as it satisfies D-08 through D-11
- Whether the state-changed check in D-09 is implemented via `git diff --quiet`, a computed hash comparison, or another equivalent mechanism

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Stack & Deployment
- `.planning/research/STACK.md` — GitHub Actions vs. Vercel Cron comparison (already decided: GitHub Actions), Resend email setup basics, commit-state-back persistence pattern, public vs. private repo minute-budget math (directly informs D-01/D-08)

### Architecture
- `.planning/research/ARCHITECTURE.md` — the deployment-agnostic `run()` pattern that Phase 2 must attach email delivery to without changing its shape

### Pitfalls
- `.planning/research/PITFALLS.md` — duplicate/spam email risk (informs D-04's digest-not-per-site decision), rate-limit/blocking risk on the undocumented endpoint (still relevant at the same 5-min cadence)

### Requirements
- `.planning/REQUIREMENTS.md` — NOTF-01, NOTF-02, NOTF-03, OPS-02, OPS-03 are the requirements this phase must satisfy

### Prior Phase Context
- `.planning/phases/01-core-polling-engine/01-CONTEXT.md` — D-07 (per-watch console log line + summary object) is exactly the seam Phase 2 wires email onto; D-08/D-09 dedup state schema already supports this without migration

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/run.ts` — `run()` orchestrator already returns `RunSummary.newMatches: MatchedSlot[]` (see [types.ts:64-73](src/types.ts:64)) — Phase 2's email step is a consumer of this field, added after `await store.save()` in `run.ts` (or via a `RunDeps`-injected notifier, consistent with the existing dependency-injection pattern used for `loadResolved`/`fetchRange`/`store`/`logger`).
- `src/types.ts` — `MatchedSlot` already has every field the email needs (`facilityName`, `siteLabel`, `startDate`, `endDate`, `bookingUrl`) — no new normalized types required for NOTF-02.
- `src/cli.ts` — exit-code behavior (`summary.failed.length === 0 ? 0 : 1`) already implements D-11; no change needed there for the GH Actions red-X behavior.

### Established Patterns
- `run.ts` takes an optional `RunDeps` bag with injectable dependencies (`loadResolved`, `fetchRange`, `store`, `logger`, `now`) — a `sendNotification`/`notifier` dependency should follow the same pattern for testability (mirrors Phase 1's approach, keeps `run()` deployment-agnostic).
- `src/errors.ts` has `describeFailure(err)` for turning caught errors into readable strings — reuse for any Resend API error handling rather than inventing a new error-formatting path.

### Integration Points
- New code likely lives in `src/notify/email.ts` (per Phase 1's `code_context` in [01-CONTEXT.md:84](.planning/phases/01-core-polling-engine/01-CONTEXT.md:84), which already anticipated this file), wired into `run.ts` after matches are computed and before/alongside `store.save()`.
- New top-level `.github/workflows/` directory needed for the GitHub Actions scheduled workflow — doesn't exist yet.
- `package.json` needs `resend` added to `dependencies` (not yet present — currently only `zod`).

</code_context>

<specifics>
## Specific Ideas

No specific visual/copy requirements beyond D-06/D-07 (subject includes count + park names, body includes facility name/site/dates/booking link). Open to standard approaches for exact wording, per Claude's Discretion.

</specifics>

<deferred>
## Deferred Ideas

- Consecutive-failure-counter + dedicated failure-notification email — considered under "Failure Alerting" and explicitly rejected for Phase 2 scope (D-12). GitHub's built-in workflow-failure notifications cover this need without new code.
- Digest/batched email across multiple poll cycles (NOTF-04/NOTF-05, v2) — not discussed further; Phase 2's digest (D-04) is scoped to a single run/cycle, not a time-windowed batch.
- HTML email formatting — considered and rejected in favor of plain text (D-05); could be revisited post-v1 if desired.

None else — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-notification-delivery-deployment*
*Context gathered: 2026-08-22*
