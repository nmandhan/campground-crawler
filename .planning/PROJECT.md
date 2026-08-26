# Campground Crawler

## What This Is

A single-user campsite availability watcher for Recreation.gov. It periodically checks a configured list of watches (park/campground, date range, site type) against Recreation.gov's live availability. The intended delivery mechanism is email, sent as soon as a matching campsite opens up; that path is code-complete but currently blocked on a Resend domain-verification step the user has deferred. In the meantime, a public status dashboard shows the same poll results and per-watch state, so the user can check availability without waiting for email.

## Core Value

When a watched campsite becomes available on Recreation.gov, the user gets an email fast enough to actually book it before someone else does. (Currently delivered via a status dashboard the user checks manually, until email is unblocked — see Active Requirements.)

## Current Milestone: v1.1 Area Search

**Goal:** Let the user search a broad geographic area for available campsites, instead of having to pre-identify one specific campground, and manage watches through the dashboard UI instead of hand-editing `watches.json`.

**Target features:**
- Area/region-based campground search — query multiple campgrounds within a region via RIDB, not one pinned facility ID
- Web UI on the dashboard to create/edit/delete watches (area, dates, site type)
- Existing polling/matching/dedup/email pipeline extended to handle area-based watches (multiple campgrounds per watch)

## Requirements

### Validated

Validated in Phase 1 (Core Polling Engine), live-verified against Recreation.gov:

- [x] User can define one or more "watches" via a config file/env vars, each specifying a park/campground, date range, and site type
- [x] System checks Recreation.gov availability for all configured watches on a recurring schedule (every few minutes) — `--loop --interval N` (N ≥ 60s)
- [x] System avoids duplicate/spammy alerts for the same still-open availability — durable dedup state proven end-to-end (new match → persisted → suppressed on next run)

Validated in Phase 2 (Notification Delivery & Deployment), live-verified via GitHub Actions:

- [x] System runs unattended on a schedule without the user manually triggering checks — GitHub Actions `schedule` trigger (5-min cron), dedup-state commit-back confirmed working end to end against a real Kirk Creek opening

Validated in Phase 3 (Status Dashboard), live-verified on Vercel:

- [x] A hosted status page shows recent poll results and per-watch state as a near-term substitute for the (currently blocked) email path — live at https://dashboard-drab-seven-94.vercel.app, confirmed rendering real data end-to-end including a live poll cycle appearing within its cache window

Validated in Phase 4 (Area-Based Search), live-verified against Recreation.gov RIDB API:

- [x] User can search a general area/region for available campsites, not just one pre-identified campground — `type: "area"` watches resolve via RIDB's RecArea entity, filtered to reservable campgrounds (visitor centers/boat ramps/day-use excluded), capped at 20 shared facilities per watch, aggregated into one outcome per watch with per-campground attribution in match output; live-verified end-to-end (`resolveArea`/`listAreaFacilities` against real Sequoia/Sierra National Forest data, correct truncation, correct dedup/aggregation)

### Active

- [ ] User receives an email when a watch finds a newly available matching site (Phase 2 — blocked on Resend domain verification; user declined to buy a domain, dashboard added as a near-term substitute)
- [ ] User can create/edit/delete watches through the dashboard UI, including picking an area and dates (v1.1)

### Out of Scope

- Multi-user support / accounts / login — this is a single-user personal tool for v1
- Automated booking/reservation of the campsite — out of scope, notification only (booking sites generally prohibit bots completing checkout, and this reduces liability/complexity)
- SMS/push notifications — email only for v1
- Support for booking sites other than Recreation.gov — ReserveCalifornia and others deferred

## Context

- Target site: Recreation.gov, which has a public API for campsite/facility availability (recreation.gov API, not to be confused with reserving via automated checkout).
- User wants to track federal campgrounds (National Parks, Forests, etc.).
- **Shipped as of v1.0 (2026-08-25):** ~2,189 LOC TypeScript across two independent projects in one repo — `src/` (Node 22/tsx poller, no build step, deployment-agnostic `run()` core) and `dashboard/` (Next.js 16 App Router, deployed to Vercel). The poller runs on a GitHub Actions 5-minute cron against a public repo, committing dedup state (`state.json`) and a capped run-history log (`runs.json`) back to `main` every cycle. The dashboard reads those files at request time from raw.githubusercontent.com and is live at https://dashboard-drab-seven-94.vercel.app.
- **Known tech debt (see `.planning/milestones/v1.0-phases/03-status-dashboard/03-REVIEW.md`):** a dormant edge case where a watch id containing `:` would silently drop from the dashboard; a mixed-precision ISO-timestamp comparison that could pick the wrong "latest run" on a rare collision; the poller's real crash-error message doesn't reach the committed run history (a generic placeholder is used instead); some validation/formatting logic is duplicated between `src/` and `dashboard/` (two independent npm projects by design, per D-04) with no shared-source mechanism to keep them in sync.

## Constraints

- **Notification channel**: Email only — via a transactional email service (e.g. Resend/SendGrid) — no SMS/push infra for v1. (Temporarily supplemented by a public, no-auth status dashboard as a stand-in until email is unblocked.)
- **Data source**: Must use Recreation.gov's official/public API rather than scraping HTML, to avoid fragility and ToS issues, if such an API adequately covers the need.
- **Scope**: Single user, no auth system — credentials/config live in environment variables, not a database-backed multi-tenant model.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Notify only, don't auto-book | Avoids bot-checkout complexity/ToS risk on Recreation.gov; user still has to act fast but stays in control | ✓ Good — held throughout v1.0, no pressure to revisit |
| Config-file-driven watches, no UI | Single user doesn't need a management UI for v1; faster to ship | ✓ Good — `watches.json` + zod validation worked cleanly through all 3 phases |
| Email-only alerts | Simplest reliable channel; SMS/push deferred | ⚠️ Revisit — Resend requires a verified domain the user hasn't set up; email is code-complete but never live-verified. Dashboard added as an interim substitute (see below) |
| Deployment target deferred to research | Want research to weigh Vercel cron vs. simple scheduled script before committing | ✓ Good — GitHub Actions cron chosen (free, no infra to manage); Vercel later reused for the dashboard, not the poller |
| Public repo + GitHub Secrets (Phase 2) | GitHub Actions minute budget is tight on private repos at 5-min cadence; public repo makes `contents: write` free and unlimited | ✓ Good — confirmed working live; no sensitive data in `watches.json`/`state.json`/`runs.json` |
| Add a status dashboard instead of buying a Resend domain (Phase 3) | User declined to buy a domain; a hosted dashboard reading the same public JSON files delivers real user-facing value without new infra cost | ✓ Good — live-verified end-to-end, confirmed showing a real poll cycle within its cache window |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-26 — Phase 4 (Area-Based Search) complete*
