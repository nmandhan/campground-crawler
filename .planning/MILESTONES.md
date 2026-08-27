# Milestones

## v1.1 Area Search (Shipped: 2026-08-27)

**Phases completed:** 2 phases (Phase 4: Area-Based Search, Phase 5: Watch-Management Write Path), 14 plans, 32 tasks
**Timeline:** 2026-08-25 → 2026-08-27 (2 days)
**Git range:** `b480f23` (feat(04-01)) → `c406ad8` (docs(phase-5)) — 147 commits, 100 files changed, +14,341/-232 lines
**Requirements:** 11/11 v1.1 requirements delivered (AREA-01..05, MGMT-01..06)

**Key accomplishments:**

- Area-based watches — a single watch can now target one or more named Recreation Areas (park/forest), resolved to real campgrounds at poll time via RIDB's RecArea entity, instead of requiring one pre-identified campground per watch.
- Per-campground match attribution and group-vs-standard campground tagging — a matched area watch names the exact campground that opened (with a `[GROUP]` tag where relevant), not just the area name, avoiding the v1.0-class "wrong match" failure at region scale.
- A shared 20-facility cap across all areas in a watch, with truncation surfaced in both match output and run history, protecting the RIDB rate budget as area watches scale.
- Full dashboard write path — create, edit, and delete watches through the UI without hand-editing `watches.json`, gated behind a shared-secret session cookie while existing read-only views stay public and unauthenticated.
- Recreation Area typeahead (debounced, name-based search) with a live, auto-refreshing preview of which actual campgrounds an area watch resolves to before it's saved.
- Full end-to-end live verification against production: real watches created/edited/deleted through the deployed dashboard, landing as real commits via a dedicated GitHub PAT, with the poller successfully resolving and checking them on real GitHub Actions infrastructure. Live testing caught and fixed a Next.js 16 auth-gate landmine (`middleware.ts`→`proxy.ts` silent rename trap), a RIDB search-ranking bug, a passphrase-provisioning bug, and a critical process gap (two phases' work had never been pushed to GitHub).

### Known Tech Debt (non-blocking, see `05-REVIEW.md`)

- Editing a facility watch through the dashboard silently drops its `facilityId` override (no user-visible signal)
- An area watch can be saved with more Recreation Areas than its own live preview ever validates (cap mismatch between typeahead/preview/save schema)
- `getWatchesFile()` doesn't validate fetched `watches.json` with zod, unlike every other API-response path in this phase
- Rapid double-clicks in the area typeahead can silently drop a chip add/remove (React state race)
- `previewAreas()` resolves areas sequentially instead of in parallel (latency, not correctness)
- The auth gate (`proxy.ts`) is an inclusion allowlist with no automated check tying new routes to protection
- `requireSession()` is copy-pasted into four route files instead of being a shared export

---

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
