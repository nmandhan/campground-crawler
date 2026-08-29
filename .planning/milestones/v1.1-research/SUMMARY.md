# Project Research Summary

**Project:** Campground Crawler v1.1 — Area-Based Search + Watch-Management UI
**Domain:** Extending a zero-database, git-as-datastore campsite availability watcher with (1) region/area search and (2) a self-service write path for watch configuration
**Researched:** 2026-08-25
**Confidence:** MEDIUM-HIGH

## Executive Summary

This milestone adds two related but architecturally independent capabilities to an already-shipped, working v1.0 system: area-based campground search (watch "Yosemite," not just one pinned campground) and a dashboard UI that can create/edit/delete watches instead of requiring hand-edited `watches.json`. Both extend the existing two-project shape (`src/` poller on GitHub Actions cron, `dashboard/` read-only Next.js app on Vercel) rather than requiring any new runtime, database, or hosting platform — research across all four tracks converges on the same conclusion: resist the urge to add infrastructure (no database, no auth framework, no map library, no GitHub App). The right approach is a discriminated-union `Watch` type (`facility` | `area`), resolved to concrete facility IDs at poll time (not frozen at watch-creation time), and a new GitHub Contents API write path from Next.js Route Handlers, gated by a minimal shared secret rather than full authentication.

The single most important architectural fact discovered is that v1.0's git-as-datastore design relies on a strict single-writer-per-file invariant (GitHub Actions writes `state.json`/`runs.json`; nothing writes `watches.json` today) — this invariant is what makes the no-database design safe without locking, and it must be deliberately preserved, not accidentally broken, as the dashboard becomes `watches.json`'s first writer. The research also surfaces two closely linked risks that must be designed in from the start rather than patched later: (1) area search can silently multiply availability-endpoint request volume 20-50x per watch, threatening both the courtesy ~1 req/sec convention and RIDB's actual enforced 50 req/min limit, and (2) area search reintroduces v1.0's known facility-name-mismatch bug (the "BANDIDO" incident) at a scale where it's no longer visually obvious, because a geo query returns campgrounds mixed with non-campground facility types.

Recommended sequencing is two independent phases, area-search logic first (pure `src/` changes, no new I/O/auth surface, ships value via hand-edited JSON immediately) then the watch-management write UI second (first time the dashboard gains a mutation/auth surface, and it should target the already-finalized `Watch` type rather than being built and reworked). Confidence is MEDIUM-HIGH overall: the codebase facts and existing conventions are HIGH confidence (read directly from source), while exact RIDB geo-search query parameter names and RIDB facility-type filtering fields are MEDIUM confidence, corroborated by multiple independent community sources but not re-verified against a live authenticated response or the official Swagger doc in this research pass — flagged for verification early in implementation via a live fixture capture.

## Key Findings

### Recommended Stack

No new runtime, database, or hosting platform is needed. Area search extends the existing RIDB `/facilities` client with geo/state query params (same auth, same response envelope). The watch-management write path uses the GitHub REST Contents API (`GET`/`PUT .../contents/watches.json`) called via plain `fetch` from new Next.js Route Handlers, authenticated with a fine-grained, repo-scoped PAT stored server-side — matching the project's existing "hand-roll fetch, no SDK" convention. The write UI itself is gated with Next.js Middleware + a lightweight shared secret (not NextAuth/Clerk/OAuth, which would be over-engineering for a single named user).

**Core technologies:**
- RIDB Facilities API (`GET /facilities` with `latitude`/`longitude`/`radius`/`state`/`activity` params) — same endpoint, same key, already wired; additive query params, no new API surface
- GitHub REST Contents API (sha-based optimistic-concurrency PUT) — single-call commit+push for `watches.json`, no SDK required, no new git tooling needed in serverless functions
- Next.js Route Handlers + Middleware (both already available in Next.js 16.3.2) — server-side write logic and shared-secret gating, zero new dependencies
- `zod` (already a dependency) — extend the existing `WatchSchema` into a discriminated union (`facility` | `area`) rather than building a second validation system

### Expected Features

**Must have (table stakes):**
- Area watch = one named Recreation Area, expanded server-side to constituent campground facility IDs — matches how every competitor tool (camply, recgov_daemon) and RIDB itself models the domain (RecreationArea → Facility → Campsite)
- Hard result cap (~15-25 facilities) per area watch, with a truncation indicator — protects the existing rate-limit discipline and 5-minute cron budget
- Site-type filter composes with area search, exactly as it does for single-campground watches today
- Dashboard watch list, create/edit/delete form (area-or-campground typeahead, start/end date, site type) — the literal ask of this milestone
- Inline validation reusing (not duplicating) existing zod schemas — addresses documented tech debt (validation drift between `src/` and `dashboard/`) rather than compounding it

**Should have (competitive):**
- Named-area typeahead search (name → RecAreaID) — closes the biggest friction point in CLI-only competitors like camply, which require users to already know the numeric ID
- Hybrid watch model (area with an explicit single-campground fallback) — smooth upgrade path, natural generalization of the existing schema
- Per-campground breakdown in match notifications once a watch spans multiple facilities — table stakes at the notification layer even though area search itself is the differentiator

**Defer (v2+):**
- Lat/long + radius picker as an *alternative* to named-area search — RIDB lat/long data is inconsistently populated, making radius search unreliable without more investigation
- Map/visual picker UI — high build cost, low incremental value for a single user who already knows their target parks by name
- Per-facility opt-out within an area watch, "favorited" areas — real but speculative; build only if a concrete need surfaces
- Unbounded "search everything" / whole-state discovery mode — explicitly an anti-feature; explodes request volume and produces noisy, low-value results for a single-user, notify-only tool

### Architecture Approach

Area search resolves at **poll time** inside the poller's existing `resolveWatches()` step (mirroring the existing name→facilityId resolution pattern with its cache/error-isolation scaffolding), not frozen into `watches.json` at watch-creation time — this keeps the feature useful as new campgrounds appear and keeps the write-path UI simple (it only ever writes area *criteria*, never a resolved facility list). The watch-management write path adds Route Handlers that read-then-PUT `watches.json` via the GitHub Contents API with sha-based optimistic concurrency, preserving the existing single-writer-per-file invariant by ensuring the poller only ever *reads* `watches.json` and only ever *writes* `state.json`/`runs.json`, while the dashboard owns the reverse.

**Major components:**
1. `src/recreation-gov/client.ts` — new `resolveArea()` function, same RIDB client/pacing/error-taxonomy conventions as existing `resolveFacility()`
2. `src/run.ts` — the one genuinely new piece of orchestration: group multiple `ResolvedWatch` entries (one area watch → N facilities) by watch id and aggregate into a single `WatchOutcome`, preserving the "one outcome per watch id" assumption the dashboard's derive modules already depend on
3. `dashboard/lib/github-write.ts` + `dashboard/app/api/watches/*` — new server-only write path: GET current file + sha, validate with strict shared schema rules, PUT with sha, retry once on 409
4. `dashboard/middleware.ts` — shared-secret/Basic-Auth gate applied only to the new mutation routes, leaving existing read-only views public and unchanged

### Critical Pitfalls

1. **Area search blows the per-cycle request budget as watch count/region size grows** — an area watch can resolve to 20-50+ facilities; naively fetching availability for all of them every 5-minute cycle multiplies request volume past both the community ~1 req/sec courtesy convention and RIDB's actual enforced 50 req/min limit. Avoid by capping facilities-per-area-watch (10-15-25), caching the area→facility resolution (daily TTL, not every poll), and enforcing an explicit inter-request delay with fail-closed behavior (skip remainder this cycle).
2. **Area search repeats v1.0's facility-name-mismatch bug (BANDIDO) at scale** — RIDB's `/facilities` geo query mixes non-campground types (visitor centers, group sites, boat ramps) into results, and unlike a single pinned watch, a bad match in a list of 20+ facilities is invisible without explicit review. Avoid by filtering on facility type/reservable status server-side and surfacing the resolved campground list to the user before saving the watch, with a per-watch exclude mechanism.
3. **The write path introduces a second, uncoordinated writer racing the poller's own commit cycle** — v1.0's `concurrency` guard only protects against overlapping *poller* runs; it does nothing for a Vercel function writing at the same time. Avoid by keeping `watches.json` writes exclusively UI-owned (never write it from the poller), always re-fetching sha immediately before PUT, and retrying once on 409 rather than failing silently.
4. **Shipping the write endpoint unauthenticated because "it's a single-user tool"** — the dashboard is public and unauthenticated by design (safe when read-only), but a write endpoint on a public URL is attackable by anyone who finds it, regardless of who the intended user is; blast radius includes deleting all watches or burning the RIDB/availability request budget with junk watches. Avoid with a minimum-viable server-side shared-secret gate (never client-side-only), never exposing the GitHub PAT to the browser bundle, and server-side validation caps independent of client-side UI limits.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Area-Based Search (poller-side)
**Rationale:** Pure type-system/schema/orchestration change inside `src/`, no new I/O or auth surface, exercised by the same unit-test patterns already in place. Ships value immediately via hand-edited `watches.json` (exactly how v1.0's single-facility watches worked before any dashboard existed). Finalizes the `Watch` discriminated-union contract that Phase 2's UI must target, so the write-path form is built once against the final shape.
**Delivers:** `Watch` discriminated union (`facility` | `area`) in both `src/` and `dashboard/`; `resolveArea()` in the RIDB client with facility-type/reservable filtering; `run.ts` aggregation of multiple resolved facilities into one `WatchOutcome` per watch id; a hard `maxFacilities` cap enforced at the schema level.
**Addresses:** Area watch table-stakes feature, result cap, site-type filter composability, per-campground breakdown in notifications.
**Avoids:** Pitfall 1 (request budget blowout) via schema-level cap and cached/paced resolution; Pitfall 2 (BANDIDO-at-scale) via facility-type filtering built into the resolver, not bolted on after.

### Phase 2: Watch-Management Write Path (dashboard-side)
**Rationale:** A materially different kind of risk than Phase 1 — first time the dashboard becomes a mutation surface, needs a secret/credential, and introduces a second writer into the git-as-datastore model. Sequencing after Phase 1 means the CRUD form is built once against the finalized area-or-facility watch shape rather than reworked later.
**Delivers:** `dashboard/lib/github-write.ts` (sha-based read/PUT with 409 retry); `dashboard/app/api/watches/` Route Handlers (create/edit/delete) gated by a server-side shared secret; `dashboard/middleware.ts` auth gate on mutation routes only; the actual create/edit/delete form UI including area vs. facility watch-type toggle; UI surfacing of the resolved-campground list before save and "next poll in ~X min" propagation-delay messaging.
**Uses:** GitHub Contents API, fine-grained PAT (server-only Vercel env var), Next.js Route Handlers + Middleware, shared zod validation (stricter dashboard-side rules matching `src/`'s).
**Implements:** Watch-management write path component from ARCHITECTURE.md; preserves the single-writer-per-file invariant (UI owns `watches.json`, poller owns `state.json`/`runs.json`).
**Avoids:** Pitfall 3 (write/poller race) via strict file-ownership boundary + sha-retry-on-409; Pitfall 4 (unauthenticated write endpoint) via mandatory server-side shared-secret gate and PAT never reaching the client bundle.

### Phase Ordering Rationale

- Area search has zero dependency on the write UI; the write UI has a hard dependency on area search's finalized `Watch` type — building them in this order avoids reworking the form once area support lands.
- Area search is lower-risk (pure logic/data, no new auth/I/O surface) and can be validated live via hand-edited JSON before the higher-risk write/auth surface is added on top — mirrors the incremental validation pattern already used across v1.0's phases.
- The two most severe pitfalls in each phase (request-budget blowout and BANDIDO-at-scale for Phase 1; write race and unauthenticated endpoint for Phase 2) are each scoped entirely within their respective phase, so addressing them in phase order naturally front-loads the fixes rather than requiring cross-phase rework.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (Area-Based Search):** Exact RIDB geo-search query parameter names (`radius`, `activity` code for camping, pagination limits) and facility-type/reservable filter field names are MEDIUM/LOW confidence — corroborated by community client wrappers, not verified against a live authenticated response or the official Swagger doc. Recommend a fixture-capture spike (`scripts/capture-fixtures.ts` against a real `RIDB_API_KEY`) early in this phase, before hardcoding field names or activity codes.
- **Phase 2 (Watch-Management Write UI):** GitHub Contents API sha/409 mechanics are well-documented (HIGH confidence) but recommend a quick live smoke test against a scratch file early in the phase rather than re-deriving fully from docs, given this is the first time the project writes to its own repo from Vercel.

Phases with standard patterns (skip research-phase):
- **Both phases:** Overall architecture, auth approach (shared secret, not OAuth), and stack choices (no new frameworks) are well-established from this research pass and don't need re-research — implementation can proceed directly from ARCHITECTURE.md and STACK.md guidance.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | GitHub Contents API mechanics and Next.js Route Handler/Middleware usage are HIGH (stable, well-documented APIs); exact RIDB geo-search field/activity-code list is MEDIUM, not independently confirmed against a live authenticated response in this research session |
| Features | MEDIUM | WebSearch-verified across multiple community tools (camply, recgov_daemon, CampFlare); no direct access to official RIDB API docs in this pass — RecArea→Facility hierarchy and "named area over radius" recommendation corroborated by multiple independent sources, but exact RIDB query-parameter names need verification during implementation |
| Architecture | MEDIUM-HIGH | Codebase facts (existing file structure, conventions, invariants) are HIGH — read directly from source; RIDB geo-search params and GitHub Contents API behavior are MEDIUM, corroborated by WebSearch/training data but not re-verified against live official docs in this pass |
| Pitfalls | MEDIUM-HIGH | Rate limits (RIDB's 50 req/min) and Contents API 409 semantics verified via official docs/community discussions (HIGH); project-specific race/threat analysis is sound architectural reasoning grounded in PROJECT.md but not third-party-verified (MEDIUM) |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Exact RIDB geo-search parameter names and response fields** (`FacilityLatitude`/`FacilityLongitude`, `activity=9` for camping, `state`/`radius`/`limit`/`offset`): not re-verified against a live authenticated RIDB response or the official Swagger/OpenAPI doc in this research pass. Resolve early in Phase 1 by running `scripts/capture-fixtures.ts` with a real `RIDB_API_KEY` against a geo query and comparing to the existing (synthetic) `ridb-facilities.json` fixture.
- **RIDB facility-type/reservable filter fields**: the exact field(s) to filter on (e.g. `FacilityTypeDescription`, `Reservable`) to exclude non-campground results (visitor centers, boat ramps, group sites) from area-search results are not confirmed against a live response — needed before Phase 1's resolver can safely filter, since this is the direct mitigation for Pitfall 2 (BANDIDO-at-scale).
- **Precise request-budget ceiling under real conditions**: the 5-minute cron budget interacting with RIDB's 50 req/min limit and the undocumented availability endpoint's unofficial ~1 req/sec convention needs a concrete cap chosen (10? 15? 25 facilities per area watch?) and validated via a load-test-style run with a realistic multi-campground region watch before merge, per PITFALLS.md's verification guidance.
- **Watch-management write-path threat model detail**: what "reasonable" server-side validation caps (max total watches, max facilities across all watches) should be is not pinned down numerically — needs a concrete number chosen during Phase 2 planning, informed by the request-budget ceiling above.

## Sources

### Primary (HIGH confidence)
- Direct reads of `src/types.ts`, `src/config/schema.ts`, `src/config/watches.ts`, `src/run.ts`, `src/recreation-gov/client.ts`, `dashboard/lib/github.ts`, `dashboard/lib/schema.ts`, `.github/workflows/poll.yml`, `.planning/PROJECT.md` (this repo) — ground truth for existing architecture, conventions, and constraints
- Live probe (research session): unauthenticated `GET https://ridb.recreation.gov/api/v1/facilities` → `HTTP 401 {"error":"Unauthorized Access"}` — confirms RIDB geo search requires the existing `RIDB_API_KEY`
- [RIDB API 1.0.0 OAS 3.0 official docs](https://ridb.recreation.gov/docs) — confirms 50 req/min rate limit
- [GitHub REST Contents API docs](https://docs.github.com) and [GitHub Contents API 409 Conflict discussion](https://github.com/orgs/community/discussions/62198) — sha-based optimistic concurrency, standard refetch-and-retry pattern

### Secondary (MEDIUM confidence)
- [camply GitHub (juftin/camply)](https://github.com/juftin/camply) and its [docs](https://juftin.com/camply/command_line_usage/) — RecArea/Facility/Campsite hierarchy, `--rec-area` search pattern
- [recgov_daemon GitHub (rmjacobson/recgov_daemon)](https://github.com/rmjacobson/recgov_daemon) — lat/long+radius variant, notes on RIDB blank lat/long data quality
- [Campflare](https://campflare.com/) and [Free Campsite Tracker Alternatives to Campnab](https://campnab.com/blog/free-campsite-tracker-alternatives-to-campnab) — competitor UX landscape
- WebSearch on community RIDB client wrappers (`node-ridb`, `ships/ridb`) for geo-search query parameter names — cross-referenced across independent sources but not against the primary swagger/OpenAPI spec directly
- [usda.github.io/RIDB](https://usda.github.io/RIDB/) — facility schema/type field references

### Tertiary (LOW confidence)
- Exact RIDB `activity=9` (camping) code and precise geo-search field names — community-sourced convention, flagged for fixture re-capture before coding the resolver

---
*Research completed: 2026-08-25*
*Ready for roadmap: yes*
