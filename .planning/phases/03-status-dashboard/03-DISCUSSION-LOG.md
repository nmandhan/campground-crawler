# Phase 3: Status Dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-23
**Phase:** 03-status-dashboard
**Areas discussed:** Run history data, Data access, Access control, Dashboard content, Framework, Log retention

---

## Run History Data

| Option | Description | Selected |
|--------|-------------|----------|
| Rolling run history | Workflow appends each cycle's RunSummary to a rolling log file (e.g. last 50 runs), committed alongside state.json | ✓ |
| Current state only | Dashboard just reads state.json + watches.json; no history of individual poll cycles | |
| Read GitHub Actions run history via API | Dashboard calls GitHub's Actions API at request time to list recent workflow runs | |

**User's choice:** Rolling run history (recommended)
**Notes:** Currently only state.json (dedup keys) is committed back — no run log exists yet. This requires a new workflow step.

---

## Data Access

| Option | Description | Selected |
|--------|-------------|----------|
| Fetch raw files at request time | Dashboard's server-side code fetches raw.githubusercontent.com (or Contents API) on every page load | ✓ |
| Redeploy on push (static) | Vercel auto-redeploys when the workflow pushes state.json, baking data into a static build | |

**User's choice:** Fetch raw files at request time (recommended)
**Notes:** Always current, zero extra infra, no deploy-on-push wiring needed.

---

## Access Control

| Option | Description | Selected |
|--------|-------------|----------|
| Public, no auth | Same exposure level as the already-public repo | ✓ |
| Simple shared-secret gate | Basic password/token check before showing the page | |

**User's choice:** Public, no auth (recommended)
**Notes:** Repo (including watches.json) is already public per Phase 2 D-01.

---

## Dashboard Content

| Option | Description | Selected |
|--------|-------------|----------|
| Per-watch current status | Park name, date range, site type, most recent outcome + timestamp | ✓ |
| Recent run timeline | Chronological feed of last N poll cycles across all watches | ✓ |
| Currently-active matches | Highlighted section of matched-and-dedup'd sites with booking links | ✓ |

**User's choice:** All three (multiSelect)
**Notes:** Full picture — per-watch status, history, and actionable current matches.

---

## Framework

| Option | Description | Selected |
|--------|-------------|----------|
| Next.js App Router | Server component fetches GitHub raw files and renders server-side | ✓ |
| Single Vercel serverless/edge function | Lightweight API route returning server-rendered HTML directly, no React | |

**User's choice:** Next.js App Router (recommended)
**Notes:** Standard Vercel-native choice; room to grow if the dashboard gets richer later.

---

## Log Retention

| Option | Description | Selected |
|--------|-------------|----------|
| Last 50 runs | ~4 hours of history at 5-min cadence | ✓ |
| Last 200 runs | ~16 hours of history at 5-min cadence | |

**User's choice:** Last 50 runs (recommended)
**Notes:** Enough to see recent activity/failures without unbounded file growth.

---

## Claude's Discretion

- Exact `runs.json` schema/field names
- Exact page layout, styling, component structure
- Whether the dashboard lives in a subdirectory of the existing repo or requires restructuring
- GitHub raw-file fetch mechanism and caching/revalidation strategy
- Timestamp/relative-time formatting and empty-state copy

## Deferred Ideas

- Watch-management UI (editing watches.json from the browser) — explicitly out of scope per REQUIREMENTS.md
- Auth/access gating beyond "public, no auth" — could be revisited later
- Re-attempting real email delivery via Resend domain verification — remains a Phase 2 blocker, not touched here
