# Roadmap: Campground Crawler

## Overview

Campground Crawler ships in two coherent phases. Phase 1 builds and proves the core polling/matching engine entirely offline — config-driven watches, the RIDB + live-availability adapter, a pure matcher, typed success/no-match/check-failed outcomes, and durable dedup state — all testable via CLI against fixtures with no live deployment required. Phase 2 wires that proven engine into the real world: it sends actual emails via Resend, deploys the poller to run unattended on a schedule (GitHub Actions), and locks down credentials as secrets. By the end of Phase 2 the full loop is live: watch config in, Recreation.gov polled every few minutes, and an email lands in the user's inbox the moment a matching site opens — without duplicate spam and without the user touching anything.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Core Polling Engine** - Config-driven watches, live Recreation.gov matching, and durable dedup state, fully testable offline via CLI + fixtures
- [ ] **Phase 2: Notification Delivery & Deployment** - Real email alerts and unattended scheduled deployment with secured credentials

## Phase Details

### Phase 1: Core Polling Engine
**Goal**: Given a watch config, the system correctly determines which watches have new matching availability on Recreation.gov, distinguishes failures from genuine non-matches, and persists dedup state durably — verifiable end-to-end via CLI with fixture/live data, no deployment required.
**Depends on**: Nothing (first phase)
**Requirements**: WATCH-01, WATCH-02, POLL-01, POLL-02, POLL-03, POLL-04, OPS-01
**Success Criteria** (what must be TRUE):
  1. Running the poller against a real watch config (park/campground, date range, site type) returns matching sites from Recreation.gov's live availability endpoint, using the RIDB API to resolve the campground/facility ID first.
  2. Two or more concurrent watches in the config produce independent match results — one watch's dedup/alert state never suppresses another watch's legitimate match.
  3. The poller can execute on a recurring interval unattended (e.g. a local scheduler loop or repeated invocation) without manual triggering, checking all configured watches each cycle.
  4. When Recreation.gov's API errors or rate-limits a request, the poller retries with backoff and records the cycle as "check failed" rather than crashing or silently reporting no availability.
  5. Dedup/notification state is written to durable storage (e.g. a JSON file) after each run and correctly reloaded on the next run, so a restart doesn't lose track of what's already been seen.
**Plans**: 4 plans (3 waves)
- [x] 01-01-PLAN.md — Project scaffold + shared contracts (types, errors, zod schemas, StateStore interface)
- [x] 01-02-PLAN.md — Recreation.gov adapter: RIDB resolution, availability fetch, retry/backoff, normalization
- [x] 01-03-PLAN.md — Contiguous-range matcher + durable file-backed dedup state store
- [x] 01-04-PLAN.md — Config loader, run() orchestrator, CLI (one-shot + --loop), end-to-end verification

### Phase 2: Notification Delivery & Deployment
**Goal**: The proven polling engine runs unattended in production and emails the user, with credentials handled securely, whenever a watch finds a genuinely new opening.
**Depends on**: Phase 1
**Requirements**: NOTF-01, NOTF-02, NOTF-03, OPS-02, OPS-03
**Success Criteria** (what must be TRUE):
  1. When a watch finds a newly available matching site, the user receives an email within one poll cycle of the site becoming available.
  2. The email includes the campground/park name, specific site number, date(s), and a direct Recreation.gov booking link for that site.
  3. If the same site remains open across multiple poll cycles, the user receives only one notification for that new-availability transition — no repeat/spam alerts.
  4. The system runs on a hosted schedule (e.g. GitHub Actions cron) without the user manually invoking it, and keeps polling across scheduled runs indefinitely.
  5. API keys and email service credentials are stored as encrypted secrets in the deployment platform, never committed to the repo.
**Plans**: 4 plans (3 waves)
- [ ] 02-01-PLAN.md — Notification module: resend dependency, digest subject/body formatters, injectable sendDigestEmail
- [ ] 02-02-PLAN.md — Wire RunDeps.sendNotification into run(), one digest per cycle over post-dedup newMatches
- [ ] 02-03-PLAN.md — Scheduled GitHub Actions workflow, un-ignored + seeded state.json commit-back, env/secrets docs
- [ ] 02-04-PLAN.md — Secret audit, Resend/GitHub secret provisioning, live smoke test (checkpoints)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core Polling Engine | 4/4 | Complete | 2026-08-22 |
| 2. Notification Delivery & Deployment | 0/4 | Planned | - |
