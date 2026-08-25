# Campground Crawler

## What This Is

A single-user campsite availability watcher for Recreation.gov. It periodically checks a configured list of watches (park/campground, date range, site type) against Recreation.gov's live availability, and emails the user as soon as a matching campsite opens up — so they don't have to manually refresh the booking site.

## Core Value

When a watched campsite becomes available on Recreation.gov, the user gets an email fast enough to actually book it before someone else does.

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

### Active

- [ ] User receives an email when a watch finds a newly available matching site (Phase 2 — blocked on Resend domain verification; user declined to buy a domain, dashboard added as a near-term substitute)

### Out of Scope

- Multi-user support / accounts / login — this is a single-user personal tool for v1
- Web UI for managing watches — config file/env vars are sufficient for v1
- Automated booking/reservation of the campsite — out of scope, notification only (booking sites generally prohibit bots completing checkout, and this reduces liability/complexity)
- SMS/push notifications — email only for v1
- Support for booking sites other than Recreation.gov — ReserveCalifornia and others deferred

## Context

- Target site: Recreation.gov, which has a public API for campsite/facility availability (recreation.gov API, not to be confused with reserving via automated checkout).
- User wants to track federal campgrounds (National Parks, Forests, etc.).
- Deployment target intentionally left open — research phase should recommend between a lightweight Vercel/Next.js + cron approach and a simple self-hosted/scheduled script, based on what fits a periodic-polling + email-sending workload best.

## Constraints

- **Notification channel**: Email only — via a transactional email service (e.g. Resend/SendGrid) — no SMS/push infra for v1.
- **Data source**: Must use Recreation.gov's official/public API rather than scraping HTML, to avoid fragility and ToS issues, if such an API adequately covers the need.
- **Scope**: Single user, no auth system — credentials/config live in environment variables, not a database-backed multi-tenant model.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Notify only, don't auto-book | Avoids bot-checkout complexity/ToS risk on Recreation.gov; user still has to act fast but stays in control | — Pending |
| Config-file-driven watches, no UI | Single user doesn't need a management UI for v1; faster to ship | — Pending |
| Email-only alerts | Simplest reliable channel; SMS/push deferred | — Pending |
| Deployment target deferred to research | Want research to weigh Vercel cron vs. simple scheduled script before committing | — Pending |

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
*Last updated: 2026-08-25 after Phase 3 (Status Dashboard) completion*
