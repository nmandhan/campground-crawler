# Phase 3: Status Dashboard - Context

**Gathered:** 2026-08-23
**Status:** Ready for planning

<domain>
## Phase Boundary

A hosted status page shows recent poll results and watch state, giving visibility into the poller without requiring email — a near-term substitute until a domain is verified with Resend for real alert delivery. No requirement IDs are formally mapped yet (roadmap lists "TBD (to be broken down in planning)"); this phase is scoped by the ROADMAP.md Phase 3 goal, not REQUIREMENTS.md.

Real email delivery (blocked on Resend domain verification, Phase 2 plan 02-04) is explicitly NOT re-attempted here. This phase is read-only visibility, not a config-management UI (REQUIREMENTS.md's "Web dashboard for managing watches" remains out of scope — this dashboard displays state, it does not let the user edit watches).

</domain>

<decisions>
## Implementation Decisions

### Run History Data
- **D-01:** The GitHub Actions workflow (`.github/workflows/poll.yml`) is extended to append each cycle's run outcome to a rolling run-history log file (e.g. `runs.json`), committed back to the repo alongside `state.json`. Each entry captures at minimum: timestamp, per-watch outcome (MATCH/NO_MATCH/FAILED + reason), and counts — sourced from the existing `RunSummary` shape already returned by `run()` (`src/types.ts`).
- **D-02:** The run-history log is capped at the last 50 entries (~4 hours at the current 5-minute cadence). Oldest entries are dropped as new ones are appended, so the committed file doesn't grow unbounded over months of polling.

### Data Access
- **D-03:** The dashboard is server-rendered and fetches `watches.json`, `state.json`, and the new `runs.json` directly from GitHub (raw content or Contents API) at request time — no build-time baking, no Vercel/GitHub Actions integration needed. Always reflects the latest committed state; page-load latency from the extra fetches is acceptable for a single-user, low-traffic tool.

### Access Control
- **D-04:** The dashboard page is public with no authentication. The repo (including `watches.json` and now `runs.json`) is already public per Phase 2 D-01 — the dashboard doesn't increase exposure. No login, token, or shared-secret gate.

### Dashboard Content
- **D-05:** Per-watch current status: park name, date range, site type, and most recent outcome (MATCH / NO_MATCH / FAILED + reason) with a timestamp, derived from `watches.json` + the latest matching entries in `runs.json`.
- **D-06:** Recent run timeline: a chronological feed of the last N poll cycles across all watches (from `runs.json`) — when they ran, what happened, any failures.
- **D-07:** Currently-active matches section: sites currently matched-and-dedup'd (from `state.json`'s entries) shown with booking links, so the user can see "here's what's open right now" at a glance without email.

### Framework
- **D-08:** Built as a Next.js App Router project deployed on Vercel. A server component (or route handler) does the GitHub fetches and renders the page server-side per request. This is the first frontend/framework code in the repo — the existing `src/` CLI/poller code is untouched; the dashboard lives in its own project structure (e.g. a `dashboard/` or `web/` subdirectory, or a separate Next.js app — left to research/planning to determine the cleanest layout for a single-repo, two-deployable-artifact setup).

### Claude's Discretion
- Exact `runs.json` schema/field names beyond "timestamp + per-watch outcome + counts, sourced from RunSummary" (D-01)
- Exact page layout, styling, and component structure within Next.js App Router
- Whether the dashboard lives in a subdirectory of the existing repo or requires restructuring (e.g. moving `src/` under a `poller/` subfolder) — research should recommend based on Vercel's monorepo/root-directory support
- GitHub raw-file fetch mechanism (raw.githubusercontent.com vs. Contents API vs. authenticated API call) and any caching/revalidation strategy within the "request time" constraint of D-03
- Exact wording/formatting of timestamps, relative time display ("5 minutes ago" vs. ISO), and empty-state copy when no watches have matched yet

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & Requirements
- `.planning/PROJECT.md` — core value, deployment constraints, out-of-scope items (notably: no web UI for *managing* watches — this dashboard is read-only)
- `.planning/REQUIREMENTS.md` — confirms no REQ-IDs are yet mapped to Phase 3; "Web dashboard for managing watches" listed as out-of-scope (distinct from this read-only status page)
- `.planning/ROADMAP.md` — Phase 3 goal statement (the only source of this phase's scope, since requirements are TBD)

### Prior Phase Context
- `.planning/phases/01-core-polling-engine/01-CONTEXT.md` — `RunSummary`/`MatchedSlot` shapes (D-08/D-09 there) that D-01 here builds `runs.json` from
- `.planning/phases/02-notification-delivery-deployment/02-CONTEXT.md` — D-01 (public repo), D-08–D-11 (workflow cadence/commit-back mechanics) that `runs.json`'s commit-back step must follow the same pattern as `state.json`'s

### Existing Code (read directly, not summarized)
- `src/types.ts` — `RunSummary`, `WatchOutcome`, `MatchedSlot` — the exact shapes `runs.json` entries are sourced from
- `.github/workflows/poll.yml` — existing commit-back-if-changed pattern for `state.json`; `runs.json`'s append+commit step should follow the same convention (skip commit if unchanged, `[skip ci]` commit message, same git identity)
- `state.json` (repo root) — current dedup-state shape (`entries: { "watchId:campsiteId:startDate:endDate": { lastNotifiedAt } }`) that D-07's "currently-active matches" section reads
- `.planning/STATE.md` — records the "dashboard-first pivot" decision and why (email blocked on Resend domain verification)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/types.ts` — `RunSummary` (checked/outcomes/newMatches/failed/noMatch) is the exact source shape for each `runs.json` entry; no new normalized types needed for the workflow side.
- `.github/workflows/poll.yml` — the "commit only if changed" + `[skip ci]` + bot-identity commit pattern for `state.json` should be copied verbatim for `runs.json`.

### Established Patterns
- The project persists state as committed JSON files (not a database) per `.planning/research/ARCHITECTURE.md`'s deployment-agnostic design — `runs.json` continues this pattern rather than introducing a new persistence mechanism.
- `src/run.ts`'s `RunDeps` dependency-injection pattern (established in Phase 1, extended in Phase 2 for `sendNotification`) is the likely seam for appending to `runs.json` after a cycle completes, if that logic lives inside `run()` rather than purely in the workflow YAML — left to planning to decide.

### Integration Points
- New Next.js project needs to live somewhere in (or alongside) this repo — no existing frontend/web directory exists yet. This is a new integration point, not an extension of `src/`.
- The GitHub Actions workflow (`.github/workflows/poll.yml`) needs a new step to write/append/cap `runs.json`, following the existing `state.json` commit-back step's structure.

</code_context>

<specifics>
## Specific Ideas

No specific visual/branding requirements were discussed — open to standard, functional dashboard presentation. The three content sections (per-watch status, run timeline, active matches) are the locked scope; visual design is Claude's discretion.

</specifics>

<deferred>
## Deferred Ideas

- Watch-management UI (editing `watches.json` from the browser) — explicitly out of scope per REQUIREMENTS.md; this phase is read-only.
- Auth/access gating beyond "public, no auth" (D-04) — could be revisited if the user later wants the dashboard private, but not needed now since the repo itself is already public.
- Re-attempting real email delivery via Resend domain verification — remains blocked/deferred from Phase 2 plan 02-04; this phase does not touch that path.

None else — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-status-dashboard*
*Context gathered: 2026-08-23*
