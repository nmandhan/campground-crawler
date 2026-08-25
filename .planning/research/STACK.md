# Stack Research

**Domain:** Adding area-based campground search + a watch-management UI to an existing zero-database, static-JSON-in-git Node/Next.js app
**Researched:** 2026-08-25
**Confidence:** MEDIUM-HIGH (RIDB geo-search params verified via multiple independent community sources + live 401 probe confirming auth requirement; GitHub Contents API mechanics HIGH — well-documented, stable API; exact RIDB field/activity-code list is MEDIUM, not independently confirmed against a live authenticated response in this session)

## Recommended Stack

### Core Technologies — no new frameworks needed

This milestone does **not** need a new runtime, database, or hosting platform. Both requested capabilities extend the existing two projects (`src/` poller, `dashboard/` Next.js app) using their existing tech (RIDB REST API, Next.js Route Handlers, GitHub REST API). Resist the urge to add a database, ORM, or auth framework — the zero-backend architecture (D-04, D-03) still holds; it just grows one more integration point (GitHub Contents API for writes) alongside the existing one (raw.githubusercontent.com for reads).

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| RIDB Facilities API (`GET /facilities`) with `latitude`/`longitude`/`radius`/`activity`/`state` params | v1 (existing `RIDB_BASE`) | Area/region campground search | Same endpoint the poller already calls for name-based `resolveFacility` (`src/recreation-gov/client.ts`) — geo params are additive query-string filters on the identical endpoint, no new API surface, no new auth model (same `RIDB_API_KEY` already required and already wired) |
| GitHub REST Contents API (`PUT /repos/{owner}/{repo}/contents/{path}`) via plain `fetch` | GitHub REST API v3 (current, stable) | Durable write-back of `watches.json` from the dashboard | Matches the existing "raw fetch, no SDK" convention (`dashboard/lib/github.ts` already hand-rolls fetch for reads) — a single PUT with base64 content + the file's current `sha` is all that's needed; avoids pulling in an SDK for one call type |
| Next.js Route Handler (`dashboard/app/api/watches/route.ts`) | Next.js 16.3.2 (already installed) | Server-side endpoint that validates a watch, fetches current `watches.json` + its `sha` from GitHub, and PUTs the updated array | Runs server-side on Vercel, so the GitHub write token never reaches the browser — this is the one piece of server logic the dashboard doesn't have today, but it's a Route Handler, not a new backend service |
| Next.js Middleware (`dashboard/middleware.ts`) with HTTP Basic Auth backed by env vars | Next.js 16.3.2 (built-in) | Gate the new write paths so a public dashboard can't be used by strangers to rewrite your `watches.json` | Zero new dependencies, zero cost, appropriate for a single named user — see Security section below for why NextAuth/Clerk/etc. would be over-engineering here |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | `^4.4.3` (already a dependency in both `src/` and `dashboard/`) | Validate the new watch-creation payload (area params, date range, site type) server-side before writing to GitHub | Extend the existing `WatchSchema` (`src/config/schema.ts`) to accept an area descriptor instead of/alongside `facilityId` — reuse the pattern, don't invent a second validation approach |
| `react-hook-form` | `^7.71.0` | Manage the create/edit watch form (area picker, date range, site type) in the dashboard | Only if the form grows past a handful of trivial controlled inputs — a park/state select, two date inputs, and a site-type select can also just be plain controlled `useState` with no library at all; add this only if the form gets messier than that (e.g. dynamic facility-list preview, inline validation errors per field) |
| None (no map library) | — | Area selection | See "What NOT to Use" — a lat/long+radius or state/park-name picker does not need Leaflet/Mapbox/Google Maps for a single-user tool; keeps bundle small and avoids a third-party API key |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `scripts/capture-fixtures.ts` (existing) | Capture a real `GET /facilities?latitude=...&longitude=...&radius=...` response once a `RIDB_API_KEY` is available in the dev environment | The current `ridb-facilities.json` fixture is synthetic/unvalidated per `src/recreation-gov/fixtures/README.md` — re-run this script for the geo-search shape specifically before trusting field names like `FacilityLatitude`/`FacilityLongitude` in code |
| GitHub fine-grained Personal Access Token (repo-scoped) | Auth for the dashboard's write-back to `watches.json` | Create at github.com Settings → Developer settings → Fine-grained tokens; scope to this one repository only, `Contents: Read and write` + `Metadata: Read`, set an expiration and rotate it — store as a Vercel encrypted environment variable, never in the repo |

## RIDB Area/Region Search — Verified Shape

The RIDB Facilities endpoint (`GET https://ridb.recreation.gov/api/v1/facilities`) the poller already calls for name resolution supports geo-filtering as additional query params on the same endpoint (confirmed via multiple independent community client wrappers, e.g. `node-ridb`, and cross-referenced against the official recreation.gov developer docs description):

```
GET /api/v1/facilities
  ?latitude=36.5054
  &longitude=-118.5658
  &radius=50          # miles
  &activity=9          # 9 = Camping (community-documented; verify against GET /activities)
  &state=CA             # optional, alternative/additional filter
  &query=...             # optional free-text, same param the poller already uses
  &limit=50
  &offset=0
```

- **Auth:** confirmed live in this session — an unauthenticated `GET /facilities` request returns `HTTP 401 {"error":"Unauthorized Access"}`. The project already requires `RIDB_API_KEY` for name-based resolution (`.env.example`), so this is not a new constraint — geo search rides the same key.
- **Response envelope:** same `{ RECDATA: [...], METADATA: {...} }` shape the poller's `RidbFacilitySearchSchema` already parses — geo search returns `Facility` objects, so extending `types.ts`'s existing schema (rather than writing a new one) should work, but re-verify `FacilityLatitude`/`FacilityLongitude`/`FacilityID`/`FacilityName` fields are present in a live geo response before shipping (MEDIUM confidence — the base facility shape is validated in production today, but the append-on geo query hasn't been fixture-captured).
- **Activity codes:** `GET /activities` (undocumented in depth here, MEDIUM confidence) lists activity codes; camping is commonly `9` per community tooling. Recommend calling `GET /activities?query=camping` once with a real key and hardcoding the confirmed ID as a constant, rather than making it a runtime lookup.
- **Multiple results → multiple facility IDs:** an area watch will resolve to N facility IDs instead of 1. This is the core integration point into the existing pipeline — `fetchAvailabilityForRange` already takes a single `facilityId`; an area watch needs to loop it across N facilities, respecting the same ~1 req/sec pacing (now more important with more facilities per watch — budget accordingly against the 5-minute cron window: N facilities × M months × 1 req/sec must comfortably fit inside 300s, per watch, times however many watches run per cycle).

## Writing `watches.json` Back to GitHub — No Database Needed

**Recommendation: GitHub REST Contents API via a Next.js Route Handler + fine-grained PAT.** Do not add Vercel KV, Vercel Postgres, or any database for this. Rationale:

1. **The poller only ever reads `watches.json` from a committed file in the repo it checks out** (`src/config/watches.ts` loads it from the working directory GitHub Actions already checked out). If the dashboard wrote to a separate store (KV/Postgres), you'd need to either (a) sync that store back into the repo before every poll run — extra moving parts and a new failure mode — or (b) change the poller to fetch config from a different source at runtime, which is a bigger, riskier change to a component that's currently validated and stable. Writing directly to the same file via the same repo keeps the poller's read path completely untouched.
2. **The Contents API write is a two-call, no-SDK operation:**
   - `GET /repos/{owner}/{repo}/contents/watches.json` → returns current content + `sha`
   - `PUT /repos/{owner}/{repo}/contents/watches.json` with `{ message, content: base64(newJson), sha, branch: "main" }` → commits and pushes in one call
   This matches the project's existing "hand-roll fetch, no SDK" convention in `dashboard/lib/github.ts` (which explicitly reads raw content instead of pulling in `@octokit/rest` for reads) — do the same for writes. Only reach for `@octokit/rest` (`^22.0.1`) if you want built-in retry/pagination/typed responses and are fine with the extra dependency; it is not required for a single-file PUT.
3. **Concurrency is safe as currently designed:** the poller (GitHub Actions, `[skip ci]` commit) writes `state.json`/`runs.json`; the dashboard would write `watches.json`. Different files, so there's no merge conflict at the git level — GitHub's Contents API performs a tree-level merge server-side keyed on the target file's own `sha`, not the branch HEAD, so a poller commit landing between the dashboard's GET and PUT does not cause the dashboard's write to fail. No optimistic-locking retry loop is strictly required, but returning a clear "someone else edited watches.json, reload and retry" error on a `409`/sha-mismatch response is good practice and cheap to add.
4. **No workflow-trigger loop risk:** `poll.yml` only triggers on `schedule`/`workflow_dispatch`, not on `push`, so a dashboard-driven commit to `watches.json` will not recursively trigger anything.

### Auth token choice: fine-grained PAT, not a GitHub App

| Option | Verdict | Why |
|--------|---------|-----|
| **Fine-grained PAT**, scoped to this one repo, `Contents: read/write` + `Metadata: read` | **Recommended** | Single user, single repo, no installation flow, no webhook handling, no private-key management — a fine-grained PAT is the minimum-ceremony option that still follows least-privilege (repo-scoped, not account-wide like a classic PAT). Set an expiration and put a calendar reminder to rotate it; GitHub caps fine-grained PATs at 50 per account, irrelevant here. |
| GitHub App (installation token) | Overkill | Built for multi-repo/multi-org automation or public integrations distributed to other users' repos — none of which applies to a single-user personal tool committing to its own repo. Adds installation/private-key/JWT-signing complexity with no corresponding benefit here. |
| `GITHUB_TOKEN` (Actions-native) | Not usable | Only exists inside a GitHub Actions run; the dashboard runs on Vercel, a separate execution context with no access to that token. |

Store the PAT as a Vercel encrypted environment variable (e.g. `GITHUB_WRITE_TOKEN`), read only inside the Route Handler (server-side), and never expose it to a Client Component — mirror the "never read a credential in a module that could leak it" discipline already established in `src/recreation-gov/client.ts`'s doc comment.

### Auth for the write UI itself: gate it, don't leave it open

The dashboard is currently public and read-only by design (D-03/D-04 — no auth needed because it can't mutate anything). Adding a write path changes that risk profile: **anyone who finds the dashboard URL could otherwise rewrite your `watches.json`** (spam it, point it at unrelated campgrounds, or wipe it) using your repo-write credential on your behalf if the endpoint isn't gated.

**Recommendation: Next.js Middleware with HTTP Basic Auth backed by two env vars** (`DASHBOARD_USER`, `DASHBOARD_PASSWORD`), applied to the watch-management page and its API routes only (leave the existing read-only status views public, unchanged). This is standard, built into Next.js (no dependency), costs nothing, and matches the "single named user, not a multi-tenant product" scope explicitly stated in `.planning/PROJECT.md` ("no auth system — credentials/config live in environment variables").

**What NOT to reach for:** NextAuth.js/Auth.js, Clerk, or any OAuth-based auth provider. Those solve session management, multiple identity providers, and multi-user account systems — none of which this project has or needs (see PROJECT.md "Out of Scope: Multi-user support / accounts / login"). They'd add a database or JWT-session layer and a new class of config (callback URLs, provider secrets) to protect a form only one person will ever use.

If Basic Auth's plaintext-over-the-wire nature (mitigated only by HTTPS, which Vercel provides by default) is a concern, a slightly stronger alternative with the same "no new dependency" property is a signed cookie set by a simple password-check Route Handler (`Set-Cookie` with an HMAC'd value, checked in `middleware.ts`) — worth it only if Basic Auth's UX (browser-native prompt, no logout) becomes annoying in practice.

## Installation

```bash
# dashboard/ — no new runtime dependency required for the GitHub write path
# (plain fetch + Buffer.from(...).toString('base64') covers it)

# Optional, only if you want SDK ergonomics over raw fetch for GitHub writes:
npm install @octokit/rest

# Optional, only if the watch-creation form outgrows plain useState:
npm install react-hook-form

# No new dependency needed for area search — extends existing src/recreation-gov/client.ts
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| GitHub Contents API write-back (same repo, same file) | Vercel KV / Vercel Postgres as the watch store | Only if you're willing to also change the poller to read watches from that store instead of the checked-out repo file — a bigger architectural change than this milestone needs, and it reintroduces the "who's the source of truth" question the current design deliberately avoids |
| Plain `fetch` to GitHub Contents API | `@octokit/rest` | If you want typed responses, built-in retry/backoff, or plan to add more GitHub operations later (e.g. reading commit history in the UI) — the marginal dependency cost is low, but it's not needed for one PUT call |
| Next.js Middleware + Basic Auth | Auth.js / Clerk / a real login system | If this ever becomes multi-user (explicitly out of scope per PROJECT.md) or you want passwordless/2FA — not justified for a single named user today |
| Lat/long+radius or state/park-name text picker (no map) | `react-leaflet` / Mapbox GL / Google Maps JS API | If area selection needs visual "draw a circle on a map" UX rather than typing a place name or coordinates — adds a mapping API key, CSS/tile-loading complexity, and bundle weight; only justified if usability testing shows the text/coordinate picker is confusing for this user |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| Vercel KV/Postgres/any database for watch storage | Reintroduces a second source of truth the poller doesn't read from; the poller only reads the repo's checked-out `watches.json` | GitHub Contents API write-back to the same file the poller already reads |
| A GitHub App with an installation flow | Solves multi-repo/multi-tenant distribution problems this single-user, single-repo tool doesn't have | A repo-scoped fine-grained PAT |
| NextAuth.js/Clerk/OAuth providers | Built for multi-user session/identity management; adds a database or JWT layer for a problem (one person, one password) that doesn't need it | Next.js Middleware + HTTP Basic Auth via env vars |
| A JS mapping library (Leaflet/Mapbox/Google Maps) for area selection | New third-party API key/cost/bundle weight for a capability (pick a park or region) that a text search or lat/long input already covers via RIDB's own `query`/`state`/`latitude`/`longitude` params | RIDB's own text/geo query params, surfaced as plain form inputs |
| Classic (non-fine-grained) GitHub PAT | Account-wide scope (every repo you own) for a single-repo write need — violates least privilege | Fine-grained PAT scoped to this one repository |

## Stack Patterns by Variant

**If the RIDB geo response omits lat/long on some facilities (known RIDB data-quality gap per community sources):**
- Filter out facilities missing `FacilityLatitude`/`FacilityLongitude` from the area-search result set before presenting them in the UI, and log/skip them the same defensive way `resolveFacility` already handles a missing `first` result (`FacilityNotFoundError`)
- Because an area watch may still legitimately resolve to a facility list where a few entries have incomplete metadata but valid availability data — don't let one bad record fail the whole watch

**If the number of facilities in a matched area is large (e.g. "all campgrounds in Yosemite" could be dozens):**
- Cap the facility count per area watch (e.g. top N by name-match relevance or by proximity) to keep the ~1 req/sec pacing from blowing the 5-minute cron budget — surface the cap in the UI ("showing closest 10 campgrounds") rather than silently truncating server-side only in the poller

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| Next.js 16.3.2 | Route Handlers + Middleware (both built-in, no version bump needed) | Already installed in `dashboard/package.json`; no upgrade required for this milestone |
| `zod@^4.4.3` | Existing `WatchSchema` in `src/config/schema.ts` | Extend, don't replace — add an area-descriptor variant (e.g. `area: { latitude, longitude, radiusMiles }` or `area: { parkName }`) as an alternative to today's single optional `facilityId`, keeping `facilityId` as a still-valid escape hatch for pinned watches |
| `RIDB_API_KEY` (existing secret) | Both name-based `resolveFacility` and new geo search | Same key, same header (`apikey`), no new secret to provision — geo search is additive to the existing RIDB integration, not a new one |
| GitHub fine-grained PAT | GitHub Actions' `GITHUB_TOKEN` used by `poll.yml` | Two separate credentials for two separate write paths (Actions writes `state.json`/`runs.json` via its ephemeral `GITHUB_TOKEN`; Vercel writes `watches.json` via the new long-lived PAT) — do not try to share one token across both, they have different lifetimes and threat models |

## Sources

- Live probe (this session): unauthenticated `GET https://ridb.recreation.gov/api/v1/facilities?...` → `HTTP 401 {"error":"Unauthorized Access"}` — confirms RIDB geo search requires the same `RIDB_API_KEY` already used by the poller
- `src/recreation-gov/client.ts`, `src/recreation-gov/fixtures/README.md`, `.env.example` (this repo) — confirms existing RIDB integration shape, existing auth requirement, and the fact that the facilities-search fixture is synthetic/unvalidated
- `dashboard/lib/github.ts` (this repo) — confirms the existing "raw fetch, allowlisted files, no SDK" convention this research extends to writes
- `.github/workflows/poll.yml` (this repo) — confirms the `schedule`/`workflow_dispatch`-only trigger (no push-loop risk) and the existing commit-back pattern for state files
- WebSearch, multiple community RIDB client wrappers (`node-ridb`, `ships/ridb`) — MEDIUM confidence, cross-referenced across independent sources — for `latitude`/`longitude`/`radius`/`activity` query param names and the `activity=9` camping code (not independently re-verified against a live authenticated response in this session; flagged for fixture re-capture)
- GitHub Docs (fine-grained PAT permission model, least-privilege guidance) — HIGH confidence, official source pattern well-established
- GitHub REST API Contents endpoint (`PUT /repos/{owner}/{repo}/contents/{path}`) — HIGH confidence, stable, long-documented GitHub REST API behavior (base64 content + sha-based update, single-call commit+push)
- `npm view` (this session): `@octokit/rest@22.0.1`, `octokit@5.0.5`, `next-auth@4.24.15` (latest), `next-auth@5.0.0-beta.32` (beta) — current versions noted for the "alternatives considered" table, not required by the primary recommendation

---
*Stack research for: area-based campground search + watch-management UI on an existing zero-database static-JSON-in-git architecture*
*Researched: 2026-08-25*
