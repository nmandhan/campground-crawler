---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Discovery & Polish
status: in_progress
stopped_at: Roadmap created (Phases 6-10), ready to plan Phase 6
last_updated: "2026-08-29T00:00:00.000Z"
last_activity: 2026-08-29
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-27)

**Core value:** When a watched campsite becomes available on Recreation.gov, the user gets an email fast enough to actually book it before someone else does. (Currently delivered via a status dashboard until email is unblocked.)
**Current focus:** Phase 6 — Tech Debt & Route-Coverage Hardening

## Current Position

Phase: 6 of 10 (Tech Debt & Route-Coverage Hardening)
Plan: — (not yet planned)
Status: Ready to plan
Last activity: 2026-08-29 — v1.2 roadmap created (Phases 6-10), 18/18 requirements mapped

Carried-forward context (see PROJECT.md Context/Constraints and MILESTONES.md Known Gaps for detail):

- Poller live in production: GitHub Actions 5-min cron, public repo, secrets provisioned, dedup/match/commit-back
  confirmed live against a real Kirk Creek opening, and again live-verified after v1.1's area-watch changes.

- Email send blocked on Resend 422 "The domain is invalid" — account has no onboarding@resend.dev shared-domain
  access. User declined to buy a domain again this milestone (NOTF-01/02/03 deferred to v2, no new code expected).

- Status dashboard live at https://dashboard-drab-seven-94.vercel.app, with a full shared-secret-gated write path
  (create/edit/delete watches, area typeahead + preview) — live-verified end-to-end.

- Roadmap order for v1.2, per research: Phase 6 (tech debt, incl. auth-gate route-coverage check) lands first so
  it protects the new Phase 7-9 routes from day one; Phase 7 (RIDB data layer) validates rate-limit/coordinate
  assumptions against live data before UI is built on top; Phase 8 (discovery search UI) before Phase 9 (map)
  keeps the write-path blast radius small first; Phase 10 (redesign) last so new screens are styled once.

Progress: [░░░░░░░░░░] 0% (v1.2 Discovery & Polish milestone just started)

## Performance Metrics

**Velocity:**

- Total plans completed: 19 (prior milestones)
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 03 | 5 | - | - |
| 04 | 6 | - | - |
| 5 | 8 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Full decision log is in PROJECT.md Key Decisions table. v1.2-specific decisions from research (see .planning/research/SUMMARY.md):

- Map library: MapLibre GL (raw `maplibre-gl`, no `react-map-gl` wrapper) over Leaflet — GPU-rendered tiles fit the "genuinely polished" bar, built-in clustering avoids a second dependency.
- Discovery page gated behind the existing shared-secret session (DISC-04) — consistent with the write-path auth boundary, protects the shared RIDB rate budget from anonymous traffic.

### Roadmap Evolution

v1.0 roadmap archived to `.planning/milestones/v1.0-ROADMAP.md`. v1.1 roadmap archived to `.planning/milestones/v1.1-ROADMAP.md`. v1.2 roadmap created 2026-08-29: Phase 6 (Tech Debt & Route-Coverage Hardening), Phase 7 (RIDB Discovery Data Layer), Phase 8 (Discovery Search UI + Watch This), Phase 9 (Map View), Phase 10 (Visual Redesign) — 18/18 v1.2 requirements mapped, no orphans.

### Pending Todos

None yet.

### Blockers/Concerns

- **Email delivery unverified live:** NOTF-01/02/03 remain code-complete but blocked on Resend domain verification. Deferred again this milestone; revisit only if the user gets a domain. See MILESTONES.md Known Gaps.
- **RIDB rate limit and coordinate field shape are MEDIUM-confidence, unverified against live data** — flagged for confirmation during Phase 7 implementation before finalizing the request-budget guard and coordinate-validation thresholds.
- **OpenFreeMap tile-source has no SLA** — worth a quick uptime/terms check before Phase 9; MapTiler's free tier is the documented fallback.

## Deferred Items

Items acknowledged and carried forward from v1.1 milestone close, now scheduled into v1.2 Phase 6 (see `.planning/milestones/v1.1-phases/05-watch-management-write-path/05-REVIEW.md` for full detail):

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| tech-debt | Editing a facility watch drops its `facilityId` override | Scheduled (Phase 6 / TECH-01) | 2026-08-27 (v1.1 close) |
| tech-debt | Area-watch save has no cap while its preview caps at 10 | Scheduled (Phase 6 / TECH-02) | 2026-08-27 (v1.1 close) |
| tech-debt | `getWatchesFile()` skips zod validation (violates CLAUDE.md's own rule) | Scheduled (Phase 6 / TECH-03) | 2026-08-27 (v1.1 close) |
| tech-debt | Rapid chip clicks in area typeahead can silently drop a mutation | Scheduled (Phase 6 / TECH-04) | 2026-08-27 (v1.1 close) |
| tech-debt | `previewAreas()` resolves areas sequentially, not in parallel | Scheduled (Phase 6 / TECH-05) | 2026-08-27 (v1.1 close) |
| tech-debt | Auth gate (`proxy.ts`) is an allowlist with no automated route-coverage check | Scheduled (Phase 6 / TECH-06) | 2026-08-27 (v1.1 close) |
| tech-debt | `requireSession()` copy-pasted across 4 route files | Scheduled (Phase 6 / TECH-07) | 2026-08-27 (v1.1 close) |

## Session Continuity

Last session: v1.2 roadmap creation
Stopped at: ROADMAP.md, STATE.md, and REQUIREMENTS.md traceability written for Phases 6-10
Resume file: .planning/ROADMAP.md
