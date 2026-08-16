# Project Research Summary

**Project:** Campground Crawler
**Domain:** Scheduled polling + transactional email notification service (single-user Recreation.gov campsite availability watcher)
**Researched:** 2026-08-16
**Confidence:** MEDIUM-HIGH

## Executive Summary

This is a well-trodden category of tool — "poll a third-party API on a schedule, diff against previous state, notify on new matches" — exemplified by commercial products (Campnab, Campsite Notifier) and mature open-source tools (`camply`, `banool/recreation-gov-campsite-checker`, `recbot`). All of them converge on the same shape: a config-driven list of watches, an unattended scheduler, a thin API client, a pure matcher, one durable piece of state (dedup tracking), and a notification sender. Nothing about this project requires novel architecture — the job is executing the boring, well-understood pattern correctly, with special care around two things the research consistently flags as make-or-break: (1) using the right Recreation.gov endpoint, and (2) never losing dedup state between runs.

The recommended approach: TypeScript run via `tsx` on a **GitHub Actions scheduled workflow** (not Vercel Cron — Vercel's free Hobby tier caps cron at once/day, which fails the "every few minutes" requirement outright; GitHub Actions supports 5-minute granularity for free). Use the official, documented **RIDB API** only to resolve park/campground names to IDs; use the **undocumented** `www.recreation.gov/api/camps/availability/campground/{id}/month` JSON endpoint (the same one every community tool relies on) for actual live availability — RIDB does not expose this. Persist "already notified" dedup state by committing a small JSON file back to the repo after each run (zero extra infrastructure, git-history-auditable, works within GitHub Actions' free tier). Send email via **Resend** with a verified custom sending domain (SPF/DKIM) to avoid spam-folder placement, which would silently defeat the entire "fast enough to book it" value proposition.

The key risks, per the research, are not exotic: (1) conflating "API call failed" with "no availability found," which causes either silent multi-day outages or error-spam; (2) shipping without persisted dedup state, causing duplicate-email spam for every poll cycle a site stays open; (3) relying on an unofficial endpoint that could change without notice, mitigated by isolating it behind a single adapter module; and (4) over-aggressive polling triggering Recreation.gov's informal anti-bot throttling. All four are addressable with disciplined Phase 1 architecture (typed error/no-match/match state, an adapter boundary around the availability fetch, and a bounded-concurrency rate limiter) rather than needing new tooling.

## Key Findings

### Recommended Stack

Node.js 22 LTS + TypeScript 5.7+ run via `tsx` (no build step) is the right fit for a small, single-purpose script executed by GitHub Actions. `zod` should validate both the watch config and the (unofficial, drift-prone) availability API responses at runtime — this is the single highest-leverage dependency given how easily upstream API shape changes or config typos cause silent failures. Resend is the clear choice for transactional email: generous free tier (3,000/mo, 100/day — vastly more than needed), official typed SDK, and far better DX than Amazon SES or SendGrid for this scale. `p-limit` and `date-fns` are useful supporting libraries once watch count or date-range complexity grows, but not required for a minimal v1.

**Core technologies:**
- Node.js 22.x LTS: runtime for the poller script — matches GitHub Actions' default tooling, native `fetch`
- TypeScript 5.7+ + `zod`: type safety and runtime validation for config and undocumented API responses — catches drift before it causes silent 3am failures
- GitHub Actions (`schedule` trigger): free, 5-minute-granularity scheduler — the only free option that meets the "every few minutes" requirement (Vercel Hobby cron is capped at once/day)
- Resend: transactional email, verified custom domain + SPF/DKIM required for deliverability

### Expected Features

The feature set in PROJECT.md's Active requirements is confirmed by research as genuinely minimal — not scope-padded — and matches what every competitor in this space treats as non-negotiable table stakes.

**Must have (table stakes):**
- Config-driven watch definitions (park/campground, date range, site type)
- Recurring unattended polling against the real availability API
- Duplicate/spam suppression — persisted per-(watch, site, date) state, notify once per new opening
- Actionable email content — park/campground name, site number, dates, and a direct booking link
- Multi-watch support without cross-contamination (state scoped per watch)
- Graceful API error/rate-limit handling (retry/backoff) so the schedule doesn't die silently

**Should have (competitive, defer to v1.x):**
- Re-notify after a cooldown if a site remains open (first alert recipient may not have booked)
- Flexible/nearby-date matching (±1-2 days)
- Digest/batched emails when multiple sites match in one cycle

**Defer (v2+):**
- Web dashboard for managing watches (explicitly out of scope in PROJECT.md)
- Backcountry/permit watching, multi-provider support (ReserveCalifornia, Parks Canada), SMS/push, multi-user — all explicitly out of scope
- Auto-booking is a hard anti-feature (ToS violation, liability, and the well-documented "campsite bot" controversy) — notify-only is correct and should never be revisited

### Architecture Approach

The system is a deployment-agnostic pipeline: a single orchestrator function (`run()`) with zero knowledge of HTTP or cron, wired from Config Loader → Rec.gov API Client → Matcher (pure diff function) → State Store (the *only* stateful component) → Notification Sender. Thin adapters (a CLI entrypoint, or a scheduled-workflow step) call `run()` — this keeps the deployment decision cheap to change and makes the core logic unit-testable with fixture data, no network required.

**Major components:**
1. Config Loader — parses/validates watch definitions from env/JSON, schema-validated with zod
2. Recreation.gov API Client — isolates the RIDB (metadata) and undocumented availability endpoint behind an adapter; owns retries/backoff/rate-limiting
3. Matcher — pure function, `(availability, watchCriteria) → matchedSlots[]`, no I/O
4. Notification State Store — the single piece of durable state; tracks `(watch, site, date) → lastNotifiedAt`; must survive between runs (git-committed JSON file for the GitHub Actions deployment)
5. Notification Sender — formats and sends one batched summary email per run via Resend, never one email per matched site

### Critical Pitfalls

1. **Using RIDB when you need live availability** — RIDB only has metadata; the real per-day availability comes from an undocumented endpoint. Isolate it behind an adapter from day one so a schema change only touches one module.
2. **Conflating "check failed" with "no availability"** — these must be distinct states at the type level. Escalate to the user only after N consecutive failed *cycles* (not single requests), one incident email with cooldown, not a per-cycle alert storm.
3. **No persisted dedup state between runs** — the single most load-bearing piece of infrastructure in the system. Without it, a popular cancellation can generate 40+ duplicate emails in a few hours. Must be designed in Phase 1, not retrofitted.
4. **Serverless/scheduled-job timeout from sequential per-watch polling** — fetch concurrently with bounded concurrency, dedupe fetches by campground+month, and respect the platform's time budget as watch count grows.
5. **Emails landing in spam, silently defeating the "fast enough to book it" promise** — verify a custom sending domain with SPF/DKIM/DMARC before relying on it; email providers report "delivered" even when spam-filtered, so this failure mode is invisible without deliberate testing.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Core Polling Engine (fetch, match, dedupe state)
**Rationale:** Every downstream feature depends on this being correct — the research is unanimous that dedup state and the availability-fetch adapter are the highest-risk, most load-bearing pieces of the whole system and must not be bolted on later.
**Delivers:** Config loader + validation, Recreation.gov availability adapter (isolated from RIDB metadata calls), pure matcher, persisted dedup state store (JSON file), typed success/no-match/check-failed outcome handling, basic backoff/rate-limiting.
**Addresses:** Config-driven watches, recurring polling, dedup/spam suppression, multi-watch support, graceful error handling — all P1 table-stakes features from FEATURES.md.
**Avoids:** Pitfall 1 (wrong endpoint), Pitfall 2 (error/no-match conflation), Pitfall 3 (duplicate spam), Pitfall 5 (rate-limiting/blocking).

### Phase 2: Notification Delivery & Deployment
**Rationale:** Once matching and dedup are proven correct locally (testable via CLI with fixture data, no deployment needed), wire up the actual email channel and unattended scheduling — the two things that turn a script into a running service.
**Delivers:** Resend integration with verified sending domain (SPF/DKIM), batched summary email formatting (park/campground, site #, dates, direct booking link), GitHub Actions scheduled workflow with secrets, concurrency guard, and git-committed state persistence.
**Uses:** Resend SDK, GitHub Actions `schedule` trigger and encrypted Secrets, `zod` for config validation.
**Implements:** Notification Sender component, Trigger/Scheduler adapter (thin wrapper around `run()`).

### Phase 3: Hardening & Observability
**Rationale:** With the core loop live, the remaining risks are operational — silent failures, rate-limit exposure at higher watch counts, and confirming deliverability in practice rather than just in test.
**Delivers:** Consecutive-failure escalation logic (single incident email with cooldown, not per-cycle alerts), heartbeat/status signal so the user can confirm the tool is still running, load-tested bounded-concurrency fetch queue, confirmed inbox-not-spam delivery on the real destination account, secrets-hygiene audit.
**Addresses:** Remaining P1 requirement (graceful API error handling under real conditions) plus the pitfalls that only surface under sustained/production use.

### Phase Ordering Rationale

- Dedup/state-tracking must exist before any real polling runs, or the very first live deployment risks spamming the user — this is why it's bundled into Phase 1 rather than treated as a "nice to have added later."
- Email/deployment is deliberately Phase 2, not Phase 1, because the matching/dedup logic is fully testable via CLI + fixtures without needing real infrastructure — this lets the riskiest logic get validated cheaply before committing to a deployment target.
- Hardening (failure-cycle escalation, heartbeat, deliverability confirmation) is Phase 3 because these are the pitfalls that only manifest under sustained real-world operation (spam-folder drift, rate-limit patterns at scale, silent multi-day outages) — they can't be fully verified in Phase 1/2 dev cycles and shouldn't block initial launch, but must not be skipped before calling v1 "done."

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (Recreation.gov API Client):** The availability endpoint is undocumented and MEDIUM confidence — implementation details (exact response shape, current rate-limit behavior, User-Agent requirements) should be re-verified against a live request or the community reference implementations (`camply`, `banool/recreation-gov-campsite-checker`) at planning time, not assumed from this summary alone.

Phases with standard patterns (skip research-phase):
- **Phase 2 (Notification Delivery & Deployment):** Resend integration and GitHub Actions scheduled workflows are both HIGH-confidence, officially documented, and widely used — standard setup, no additional research needed.
- **Phase 3 (Hardening):** The state-machine and backoff patterns described in PITFALLS.md are well-established software patterns (not domain-specific); implementation is straightforward engineering rather than needing new research.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Deployment/scheduling and email choices are HIGH confidence (official docs); the core data-source endpoint is MEDIUM because it's undocumented by nature |
| Features | MEDIUM | Commercial competitor internals (Campnab dedup/poll logic) are inferred from marketing/FAQ copy, not source code; open-source tool behavior is more directly verifiable but still not fully documented |
| Architecture | MEDIUM-HIGH | Component/data-flow pattern verified against multiple independent real-world implementations (camply, banool/checker, a first-hand blog account); deployment-specific limits verified against current vendor docs |
| Pitfalls | MEDIUM | RIDB metadata rate limits are HIGH confidence (official); the undocumented availability endpoint's actual rate-limit/ToS behavior is MEDIUM (community-sourced, no official doc exists) |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- The undocumented availability endpoint's exact rate-limit thresholds and response-shape stability are unknowable from official sources — mitigate by isolating it behind a single adapter module (per Pitfall 1) so future breakage is a one-file fix, and by building in conservative default throttling from day one rather than tuning up from an aggressive default.
- Commercial competitors' (Campnab, etc.) actual dedup/re-notify implementation details are inferred from marketing copy, not verified — this project's dedup design (per-watch/site/date state with `lastNotifiedAt`) is independently well-reasoned from first principles and corroborated by the architecture research, so this gap doesn't block roadmap decisions, but exact "industry standard" cooldown windows (if ever added as a v1.x feature) should be treated as a design choice, not a researched fact.
- GitHub Actions' private-repo free-tier minute budget (2,000 min/month) is tight at a 5-minute polling cadence (~2,600-5,200 min/month estimated) — this needs an explicit decision during roadmap/planning: either make the repo public (config lives in Secrets, not the repo, so this is low-risk) or poll every 10-15 minutes instead of 5 on a private repo. Flag for Phase 1/2 planning.

## Sources

### Primary (HIGH confidence)
- Vercel Cron Jobs official docs (`vercel.com/docs/cron-jobs`, `vercel.com/docs/limits`) — Hobby once/day cap, Pro per-minute cadence
- Resend npm package page and resend.com/changelog — current major version, free-tier limits
- Troubleshooting Vercel Cron Jobs | Vercel Knowledge Base — fire-and-forget behavior, timing imprecision
- RIDB API (`ridb.recreation.gov`) — official documented metadata API, optional API key only raises rate limits

### Secondary (MEDIUM confidence)
- GitHub — `juftin/camply`, `banool/recreation-gov-campsite-checker` — corroborate the undocumented availability endpoint pattern and fetch→match→notify architecture across multiple independent implementations
- Jacob Bokor — "Building a Campsite Availability notification service" — first-hand account confirming component breakdown and that state-management/dedup was the most effort-intensive part
- Campnab FAQ, Outdoorithm, Happiest Outdoors — commercial competitor feature/pricing patterns (vendor-published, not independently verified)
- SendGrid/Resend deliverability comparison articles — ~17% transactional spam-folder rate stat, domain-auth guidance

### Tertiary (LOW confidence)
- Backpacking Light forum thread — community anecdote on recreation.gov's native alert limitations
- KQED "bots stealing campsites" article, hereandthere.club — supports anti-auto-booking rationale, not a technical source
- recbot.site vendor page — single-source positioning reference

---
*Research completed: 2026-08-16*
*Ready for roadmap: yes*
