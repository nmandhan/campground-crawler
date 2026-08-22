# Phase 2: Notification Delivery & Deployment - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-22
**Phase:** 02-notification-delivery-deployment
**Areas discussed:** Repo visibility & secrets, Email content & batching, Poll cadence & workflow mechanics, Failure alerting

---

## Repo Visibility & Secrets

| Option | Description | Selected |
|--------|-------------|----------|
| Public repo | Unlimited free GH Actions minutes, keeps 5-min interval; config committed, secrets stay in Secrets | ✓ |
| Private repo, reduced interval | Repo stays private; poll interval drops to ~10-15 min to fit free-tier minute budget | |

**User's choice:** Public repo.
**Notes:** Resolves the STATE.md-flagged blocker in favor of the option that keeps the tighter poll cadence.

| Option | Description | Selected |
|--------|-------------|----------|
| Secrets: NOTIFY_EMAIL + RESEND_API_KEY only | watches.json stays committed (not sensitive, diffable) | ✓ |
| Secrets: also move watches.json to a secret | More setup friction, loses diffable-in-git benefit from Phase 1 D-01 | |

**User's choice:** Secrets limited to NOTIFY_EMAIL + RESEND_API_KEY.

---

## Email Content & Batching

| Option | Description | Selected |
|--------|-------------|----------|
| One digest email per run | Single email listing all new matches in that cycle, grouped by watch | ✓ |
| One email per matched site | Separate email per new match, can burst multiple at once | |

**User's choice:** One digest email per run.

| Option | Description | Selected |
|--------|-------------|----------|
| Plain text | Simple, renders everywhere, easy to test | ✓ |
| HTML | Nicer formatting, more code/testing for marginal benefit | |

**User's choice:** Plain text.

| Option | Description | Selected |
|--------|-------------|----------|
| Count + park names subject | e.g. "2 new campsites available: Yosemite, Joshua Tree" | ✓ |
| Generic fixed subject | e.g. "Campground Crawler: new availability" every time | |

**User's choice:** Count + park names.

---

## Poll Cadence & Workflow Mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| Commit + push only when state changed | Skip commit if nothing new; avoids noisy no-op commits every 5 min | ✓ |
| Commit + push every run unconditionally | Simpler step, but heavy repo history noise | |

**User's choice:** Commit + push only when state changed.

| Option | Description | Selected |
|--------|-------------|----------|
| Non-zero exit on any FAILED watch | Keeps cli.ts's existing behavior; surfaces failures as red run | ✓ |
| Always exit 0 | Workflow always green; failures only visible in logs | |

**User's choice:** Non-zero exit on any FAILED watch (already implemented in Phase 1's cli.ts — no change needed).

---

## Failure Alerting

| Option | Description | Selected |
|--------|-------------|----------|
| No email for failures — GH Actions red X + logs is enough | Keeps Phase 2 scope tight; email reserved for genuine new availability | ✓ |
| Yes — email on N consecutive failures for same watch | Adds failure-count state field + second email path | |

**User's choice:** No failure email — rely on GitHub Actions run status and its own workflow-failure notification setting.

---

## Claude's Discretion

- Exact email subject/body template wording beyond count/park-names subject and facility/site/dates/link body
- Internal module organization for email-sending code (e.g. `src/notify/email.ts`)
- Exact GitHub Actions workflow YAML structure (step names, action versions)
- Implementation mechanism for detecting "state changed" before commit (git diff vs hash comparison)

## Deferred Ideas

- Consecutive-failure-counter + dedicated failure-notification email (rejected for Phase 2, no code needed given GH's built-in notifications)
- Digest/batched email across multiple poll cycles (NOTF-04/NOTF-05, v2 — not discussed, Phase 2 digest is per-run only)
- HTML email formatting (considered and rejected in favor of plain text)
