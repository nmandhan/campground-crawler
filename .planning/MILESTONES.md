# Milestones

## v1.0 MVP (Shipped: 2026-08-25)

**Phases completed:** 3 phases, 13 plans, 31 tasks

**Key accomplishments:**

- Greenfield TypeScript/zod project scaffold with shared domain types, typed error classes, StateStore contract, and zod schemas for watches.json + both Recreation.gov APIs — all downstream Phase 1 plans build against these contracts.
- Single isolated adapter module for both Recreation.gov data sources — retry/backoff with retryability classification, RIDB facility resolution, undocumented monthly-availability fetch, and allowlist-based normalization into `AvailabilitySlot[]` — validated against one live capture that confirmed the status vocabulary and header requirements empirically.
- Pure UTC-safe contiguous-range/site-type matcher plus an atomic JSON-file dedup state store implementing `StateStore`, both fully unit-tested with no dependency on the Recreation.gov API adapter
- Deployment-agnostic `run()` pipeline wiring config load → RIDB resolution → live availability fetch → matcher → dedup state → CLI, verified end-to-end against live Recreation.gov data
- Pure digest subject/body formatters plus an injectable, non-throwing Resend-backed `sendDigestEmail` that never leaks the API key or recipient into logs.
- `run()` gained an injectable `sendNotification` seam that fires exactly once per cycle with only post-dedup new matches, defaults to the real Resend-backed `sendDigestEmail`, and is fully failure-isolated from the watch/exit-code contract.
- GitHub Actions workflow polling every 5 minutes with a concurrency guard, conditional dedup-state commit-back, and secrets-only credential injection
- Poller now emits a per-cycle RunSummary file in CI, appended to a rolling 50-entry-capped `runs.json` committed alongside `state.json`, giving the dashboard its sole data source.
- Independent Next.js 16 App Router project (`dashboard/`) with zod-validated, never-throwing loaders for watches.json/state.json/runs.json fetched from raw.githubusercontent.com
- Four pure, fully-tested TypeScript modules turning validated watches.json/state.json/runs.json into display-ready rows for the dashboard's three sections, with zero I/O and zero ambient clock reads.
- The dashboard now renders: UI-SPEC design tokens and copy constants, a pure fetch-result-to-view-model assembler, and a Next.js Server Component page that fetches watches/state/runs in parallel and renders Active Matches, Per-Watch Status, and Run Timeline sections with badge colors, allowlisted booking links, and a payload-sourced freshness label.

### Known Gaps

- **NOTF-01, NOTF-02, NOTF-03** (email delivery): code-complete and unit-tested (`src/notify/email.ts`, wired into `run()`), but live send is unverified — Resend rejects with 422 "The domain is invalid" because the account has no `onboarding@resend.dev` shared-domain access. User declined to buy/verify a domain during this milestone. The status dashboard (Phase 3) was added as a near-term substitute so the milestone could still ship real user-facing value. Revisit once a domain is verified with Resend — the email code path needs no further changes, only live re-verification.
- **02-04** (live smoke test / deployment plan): partially complete — RIDB resolution, matching, and dedup-state commit-back were confirmed live against a real Kirk Creek opening; only the email-send leg is blocked, for the same Resend domain reason above.

---
