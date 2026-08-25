# Requirements: Campground Crawler

**Defined:** 2026-08-16
**Core Value:** When a watched campsite becomes available on Recreation.gov, the user gets an email fast enough to actually book it before someone else does.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Watch Configuration

- [x] **WATCH-01**: User can define one or more watches via config file/env vars, each specifying a park/campground, date range, and site type
- [x] **WATCH-02**: Multiple concurrent watches are supported without cross-contamination (one watch's alert state never suppresses another watch's legitimate match)

### Availability Polling

- [x] **POLL-01**: System checks Recreation.gov live availability for all configured watches on a recurring, unattended schedule (target: every few minutes)
- [x] **POLL-02**: System resolves campground/facility metadata via the RIDB API and live per-day availability via Recreation.gov's availability endpoint
- [x] **POLL-03**: System handles API errors and rate limits gracefully (retry/backoff) without crashing the schedule or going silently dark
- [x] **POLL-04**: System distinguishes "checked, no match" from "check failed" so failures don't get mistaken for absence of availability (and vice versa)

### Notifications

- [ ] **NOTF-01**: User receives an email when a watch finds a newly available matching site
- [ ] **NOTF-02**: Email content includes campground/park name, specific site number, date(s), and a direct booking link to the site on Recreation.gov
- [ ] **NOTF-03**: System suppresses duplicate/repeat alerts for a site that's still open from a prior notification (notify once per new-availability transition, per watch/site/date)

### Reliability & Operations

- [x] **OPS-01**: Dedup/notification state persists durably between scheduled runs (survives ephemeral execution environments)
- [x] **OPS-02**: System runs unattended on a schedule without the user manually triggering checks
- [x] **OPS-03**: API keys and email service credentials are stored as secrets, not committed to the repo

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Notification Enhancements

- **NOTF-04**: Re-notify after a cooldown window if a matched site remains open (in case the first alert wasn't acted on fast enough)
- **NOTF-05**: Digest/batched email when multiple sites match within the same poll cycle (avoid inbox flooding)

### Watch Enhancements

- **WATCH-03**: Flexible/nearby-date matching (±1-2 days around a preferred date)
- **WATCH-04**: Faster poll interval tier for specific high-value watches

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Auto-booking / automated checkout | Violates Recreation.gov's ToS, carries account-ban and liability risk (the well-documented "campsite bot" controversy) — notify-only by design |
| Multi-user accounts / login / billing | Single-user personal tool; auth/tenancy/billing is out-of-proportion scope increase |
| Web dashboard for managing watches | Config file/env vars are sufficient for a single user in v1; revisit if config management becomes the actual bottleneck |
| SMS/push notifications | Email is sufficient per stated constraint; adds a paid provider and phone-number handling for marginal benefit at v1 |
| Multi-provider support (ReserveCalifornia, Parks Canada, state parks, etc.) | Different API/data shape per provider; Recreation.gov only for v1 |
| Backcountry/wilderness permit watching | Different Recreation.gov API surface than campsite availability; not requested for v1 |
| Scraping Recreation.gov HTML | Fragile to markup changes, more likely to trip anti-bot defenses; use the JSON availability API instead |
| Polling faster than a reasonable throttled interval (sub-minute, no backoff) | Risks IP/API-key blocking; industry norm (even commercial tools) is minutes, not seconds |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| WATCH-01 | Phase 1 | Complete |
| WATCH-02 | Phase 1 | Complete |
| POLL-01 | Phase 1 | Complete |
| POLL-02 | Phase 1 | Complete |
| POLL-03 | Phase 1 | Complete |
| POLL-04 | Phase 1 | Complete |
| NOTF-01 | Phase 2 | Blocked (Resend domain verification) |
| NOTF-02 | Phase 2 | Blocked (Resend domain verification) |
| NOTF-03 | Phase 2 | Blocked (Resend domain verification) |
| OPS-01 | Phase 1 | Complete |
| OPS-02 | Phase 2 | Complete |
| OPS-03 | Phase 2 | Complete |

**Coverage:**
- v1 requirements: 12 total
- Mapped to phases: 12 (Phase 1: 7, Phase 2: 5)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-16*
*Last updated: 2026-08-16 after roadmap creation (ROADMAP.md)*
