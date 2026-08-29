# Architecture Research

**Domain:** Extending a two-project, git-as-datastore campsite watcher with (1) area-based search and (2) a watch-management write path
**Researched:** 2026-08-25
**Confidence:** MEDIUM-HIGH (codebase facts HIGH — read directly from source; RIDB geo-search params and GitHub Contents API behavior MEDIUM — corroborated by WebSearch/training data, not re-verified against live official docs in this pass)

## Current System (baseline, as shipped in v1.0)

```
┌────────────────────────────── src/ (poller, Node 22/tsx, GitHub Actions cron) ─────────────────┐
│                                                                                                   │
│  watches.json ──► config/watches.ts ──► recreation-gov/client.ts ──► matcher/match.ts            │
│  (1 facilityId    loadWatches()          resolveFacility()            matchWatch()               │
│   per watch)      resolveWatches()       fetchAvailabilityForRange()                              │
│                        │                                                    │                     │
│                        ▼                                                    ▼                     │
│                  ResolvedWatch[]  ─────────────────────────►  run.ts orchestrator                 │
│                  (1:1 with Watch)                              for (watch of resolved) { ... }    │
│                                                                      │              │               │
│                                                          state/store.ts      notify/email.ts       │
│                                                          (dedup, state.json)  (Resend, unverified)  │
│                                                                                                     │
│  GitHub Actions commits state.json + runs.json back to main every 5 min. Never touches watches.json│
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
                                          │  raw.githubusercontent.com (public, unauthenticated, 30s cache)
                                          ▼
┌────────────────────────────── dashboard/ (Next.js 16, Vercel, READ-ONLY) ──────────────────────┐
│  lib/github.ts fetchJson() ──► lib/schema.ts (hand-duplicated zod) ──► lib/derive-*.ts ──► page.tsx │
│  No API routes. No auth. No write capability today.                                                │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Load-bearing invariant to preserve:** every committed file has exactly one writer today — GitHub Actions writes `state.json`/`runs.json`, nothing writes `watches.json` (it's hand-edited). This single-writer-per-file property is what makes the "no database, git as datastore" architecture safe without locking. Both new features must respect it.

## Feature 1: Area-Based Search

### Integration point: resolve-time expansion in the poller, not precomputed in watches.json

**Recommendation:** expand an area watch into multiple facility IDs **at poll time**, inside `src/config/watches.ts`'s existing resolve step — not by baking a frozen facility-ID list into `watches.json` when the watch is created.

**Why resolve-time, not precompute-time:**
- The whole point of area search is "surface campgrounds I didn't know to look for." A frozen list baked in at watch-creation time goes stale the moment a new campground/facility is added to RIDB within that radius — defeating the feature's purpose.
- The codebase already has this exact pattern: `resolveWatches()` in `src/config/watches.ts` resolves `parkName → facilityId` via RIDB on every run, memoized per unique name within that run via a `Map` cache (`src/config/watches.ts:68-90`). Area resolution is the same shape of work — `area criteria → facilityId[]` — reusing the identical resolve/cache/error-isolation scaffolding.
- RIDB itself (the `/facilities` search endpoint) is not the rate-limited resource — the project's documented ~1 req/sec discipline applies to the **undocumented monthly-availability endpoint**, not RIDB. Calling RIDB once per area watch per 5-minute cycle is cheap and well within RIDB's own budget.
- It keeps `watches.json` simple (an area watch stores *criteria*, e.g. state + centerpoint + radius — not a facility list), which also simplifies the write-path UI: the UI never needs to call RIDB itself to "resolve" anything before saving.

**Rejected alternative:** resolve-and-freeze in the UI at watch-creation time, storing `facilityIds: number[]` directly in `watches.json`. Simpler for the poller (no new RIDB call type) but goes stale, and duplicates RIDB-search logic into the dashboard's write path for no real benefit — the poller already has a working, tested, rate-limited RIDB client.

### New vs. modified (Feature 1)

| File | New / Modified | Change |
|------|-----------------|--------|
| `src/types.ts` | **Modified** | `Watch` becomes a discriminated union: `FacilityWatch` (today's shape, `type: 'facility'`) \| `AreaWatch` (`type: 'area'`, carries `stateCode?`, `latitude?`, `longitude?`, `radiusMiles?`, `maxFacilities` cap). `ResolvedWatch` stays per-facility (one entry = one facility), but multiple `ResolvedWatch` entries can now share the same `id` when they came from one `AreaWatch`. |
| `src/config/schema.ts` | **Modified** | `WatchSchema` becomes `z.discriminatedUnion('type', [FacilityWatchSchema, AreaWatchSchema])`. Add a `z.preprocess` step that injects `type: 'facility'` on any watch object missing a `type` field, so every existing hand-written `watches.json` entry keeps validating without a manual migration. |
| `src/recreation-gov/client.ts` | **New function** | `resolveArea(criteria, opts): Promise<ResolvedFacility[]>` alongside the existing `resolveFacility()`. Reuses `RIDB_BASE`, `retryWithBackoff`, `fetchJson`, and (likely) the *same* `RidbFacilitySearchSchema` response shape — `/facilities` returns the same record shape regardless of whether you query by `query=`, or by `state=`/`latitude=`/`longitude=`/`radius=`. Cap results (`limit`, and a hard `maxFacilities` app-level cap — see Pitfalls) to bound fan-out. |
| `src/errors.ts` | **New (small)** | An `AreaNotFoundError` (or reuse the `FacilityNotFoundError` pattern) for a zero-result area query, following the existing `describeFailure()`-driven error taxonomy. |
| `src/config/watches.ts` | **Modified** | `resolveWatches()` gains an `if (watch.type === 'area')` branch calling `resolveArea()`, cache-keyed by a normalized area-criteria string (mirrors the existing `parkName.trim().toLowerCase()` cache key), producing N `ResolvedWatch` entries (one per matched facility, all sharing the parent `watch.id`). A facility watch still produces exactly 1. |
| `src/run.ts` | **Modified — the one real structural change** | Today's loop assumes 1 `ResolvedWatch` → 1 `WatchOutcome` (`src/run.ts:60-87`). It must change to **group `resolved` by `watch.id`** (`Map<string, ResolvedWatch[]>`), fetch + match each facility in the group, then aggregate all facilities' matches into a **single** `WatchOutcome` per watch id (union of `newMatches`/`suppressed` across facilities). Dedup keys (`dedupKey(watchId, campsiteId, startDate, endDate)`) already stay unique across facilities because `campsiteId` differs, so `state/store.ts` needs no change. |
| `dashboard/lib/types.ts`, `dashboard/lib/schema.ts` | **Modified** | Mirror the same `Watch` discriminated union on the dashboard side, per the existing (locked, v1.0 D-04-adjacent) convention of hand-duplicated, non-imported schemas between `src/` and `dashboard/`. Needed regardless of whether the write-path UI ships yet, so the dashboard can *display* area watches without crashing on an unrecognized shape. |
| `.github/workflows/poll.yml` | **Unmodified** | No new permission, no new trigger — the workflow already just runs `npm start`, which now internally does more RIDB calls. |

### Data flow (area watch, one poll cycle)

```
watches.json: { id: "tahoe-area", type: "area", stateCode: "CA",
                latitude: 39.0, longitude: -120.0, radiusMiles: 25,
                dateRange: {...}, siteType: "tent" }
        │
        ▼
config/watches.ts: resolveWatches()
        │  branch on type === 'area'
        ▼
recreation-gov/client.ts: resolveArea() ──► RIDB GET /facilities?state=CA&latitude=...&longitude=...&radius=25
        │  (cached once per unique area-criteria per run)
        ▼
ResolvedWatch[] = [ {id:"tahoe-area", facilityId: 111, ...}, {id:"tahoe-area", facilityId: 222, ...}, ... up to maxFacilities ]
        │
        ▼
run.ts: group by id → fetch availability per facility (existing 1 req/sec pacing, now ALSO paced between facilities)
        │
        ▼
one aggregated WatchOutcome{ watchId: "tahoe-area", status: 'MATCH', newMatches: [...across all facilities...] }
```

### Pitfall to flag for the roadmap: unbounded fan-out vs. the 5-minute cadence

An area watch with a generous radius could resolve to dozens of facilities. Each facility fetch already costs ~1 RIDB-availability call per month in range, paced at ~1 req/sec. With N facilities × M months, one area watch alone could take tens of seconds to minutes — and with the existing loop being sequential across *all* watches in a run, several area watches (or one large one) risks a run that doesn't finish comfortably inside the 5-minute cron cadence, or that hammers the undocumented endpoint harder than the project's stated politeness norm.

**Mitigation to design into the schema, not bolt on later:** enforce a hard `maxFacilities` cap (schema-level `.max()`, e.g. 15–20) on any area watch, and treat it as a first-class validation rule alongside the existing dateRange/siteType checks — this is a phase-1 (area-logic) concern, not a UI concern, since a hand-written `watches.json` entry needs the same protection as a UI-created one.

## Feature 2: Watch-Management Write Path

### Integration point: GitHub Contents API from new Next.js Route Handlers, not workflow_dispatch

**Recommendation:** add server-side Route Handlers in `dashboard/app/api/watches/` that write `watches.json` directly via GitHub's REST **Contents API** (`GET`/`PUT /repos/{owner}/{repo}/contents/watches.json`), authenticated with a fine-grained GitHub PAT (repo-scoped, `contents:write` only) stored as a **server-only** Vercel environment variable.

**Why Contents API over `workflow_dispatch`:**
- `workflow_dispatch` triggers a full Actions job (checkout, `npm ci`, run) — 30–60+ seconds of latency for what should feel like an instant CRUD save. `workflow_dispatch` inputs are also string-only and capped at 10, awkward for a structured watch object (would need to serialize the whole watch as one JSON-string input), and the UI would need to poll the run's status to know if the save actually succeeded — much more moving parts for no benefit.
- The Contents API is literally designed for exactly this: read-a-file, get its `sha`, `PUT` an updated version with that `sha` for optimistic concurrency, done — one HTTP round trip, synchronous success/failure back to the UI.
- No new git tooling needed in the serverless function (no `isomorphic-git`, no shelling out to `git` — Vercel functions don't reliably have a writable git working tree anyway).

**Why this doesn't collide with the poller:** the poller only ever *reads* `watches.json` (via `actions/checkout` at job start) and only ever *writes* `state.json`/`runs.json`. The dashboard's write path only ever writes `watches.json`. Each committed file keeps exactly one writer — the invariant from v1.0 holds. A dashboard-created watch is picked up automatically on the *next* 5-minute cron tick, with no need to trigger the poller — `actions/checkout` always pulls current `main` HEAD.

### New vs. modified (Feature 2)

| File | New / Modified | Change |
|------|-----------------|--------|
| `dashboard/lib/github-write.ts` | **New** | Server-only module: `getWatchesFile()` (GET Contents API, returns content + `sha`), `putWatchesFile(newWatches, sha, message)` (PUT with base64-encoded content). Retries once on `409` (sha mismatch) by re-fetching and re-applying the edit — the only realistic concurrent-write scenario is two near-simultaneous dashboard saves. |
| `dashboard/app/api/watches/route.ts` | **New** | `GET` (list, or dashboard can keep using the existing raw.githubusercontent read path for display) and `POST` (create) handlers. |
| `dashboard/app/api/watches/[id]/route.ts` | **New** | `PATCH` (edit) and `DELETE` handlers. |
| `dashboard/lib/schema.ts` | **Modified** | The write path must validate with the *stricter* rules that today only live in `src/config/schema.ts` (`.min(1)`, unique-id refine) — a write API can't ship a watches.json the poller will reject. This is additive to the existing hand-duplicated-schema convention (still no shared import between `src/` and `dashboard/`), not a break from it. |
| Mutation auth | **New, small** | A lightweight shared-secret check (e.g. a passphrase header compared against a server-only env var) gating only the `POST`/`PATCH`/`DELETE` routes — reads stay public/no-auth as today (v1.0 D-04). This is a genuine, narrow revision of D-04's threat model: v1.0 had *no mutation surface at all*, so "no auth" was low-risk; adding CRUD on the one file that drives the entire poller without any gate would let anyone with the URL corrupt or empty out `watches.json`. A full account system is overkill for a single-user tool — a shared secret is the minimum viable gate consistent with the project's existing "single user, no database-backed multi-tenant model" constraint. |
| `dashboard/app/watches/` (or similar) | **New** | The actual form UI: create/edit/delete, including an area-vs-facility watch type toggle once Feature 1 ships. |
| `.github/workflows/poll.yml` | **Unmodified** | No changes — it already treats `watches.json` as an input it only reads. |

### Data flow (UI-created watch reaching the poller)

```
User fills form in dashboard/app/watches/ ──► POST /api/watches (with shared-secret header)
        │
        ▼
Route handler validates with dashboard/lib/schema.ts (strict, min(1)/unique-id rules)
        │
        ▼
github-write.ts: GET current watches.json + sha ──► append new watch ──► PUT with sha
        │
        ▼
Commit lands on main (author: the dashboard's PAT identity, distinct from github-actions[bot])
        │
        ▼
Next GitHub Actions cron tick (≤5 min later): actions/checkout pulls main HEAD ──► new watch is live
```

No direct coupling between the dashboard write and the poller process — consistent with "the poller depends on nothing from the dashboard" today. The only shared surface is the git repo itself.

## Build Order

The two features are genuinely independent and should ship as **separate phases**, in this order:

### Phase A: Area-based search (poller-side, pure logic/data)

Build first because:
1. **No new I/O or auth surface** — it's a type-system, schema, and orchestration change inside `src/`, exercised by the same kind of unit tests already present (`schema.test.ts`, `watches.test.ts`, `run.test.ts`). Lower risk, faster to verify in isolation.
2. **Ships value immediately without the UI** — exactly like v1.0's single-facility watches worked for months via hand-edited `watches.json` before any dashboard existed, a user can hand-write an `AreaWatch` entry in `watches.json` the moment this phase lands and get area-search value today.
3. **Finalizes the `Watch` discriminated-union contract that the write-path UI must target.** Building the UI second means its form/validation code is written once against the *final* shape, instead of being built against the old single-facility shape and then reworked when area support lands.

### Phase B: Watch-management write path (dashboard-side, new I/O + auth surface)

Build second because:
1. It's a materially different kind of risk than Phase A — first time the dashboard becomes a mutation surface, first time it needs a secret/credential, first external write path into the git repo other than the CI bot.
2. Sequencing after Phase A means the CRUD form targets the discriminated union once (facility-or-area) rather than shipping a facility-only form and reworking it later to add an area variant.
3. It's the more product-visible, "does the whole loop work end-to-end" feature (user creates a watch in the browser, sees a real match appear later) — natural to verify last, against a poller that already fully understands both watch types.

**Do not build them concurrently in one phase** — the write-path UI has a hard dependency on Phase A's finalized `Watch` type; Phase A has zero dependency on Phase B. Splitting them lets Phase A land, get used via hand-edited JSON, and get validated live (the same pattern v1.0 used for every earlier phase) before the higher-risk auth/write surface is added on top.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Precomputing area→facility expansion in the write path

**What people might do:** have the dashboard's "create area watch" form call RIDB itself, resolve the area to a facility list, and write that frozen list into `watches.json`.
**Why it's wrong:** stale results (new campgrounds never surface), duplicates RIDB search logic into a second codebase (`dashboard/`) that has no existing RIDB client at all today, and couples Phase B to Phase A's RIDB logic instead of just its type shapes.
**Instead:** the write path only ever writes area *criteria*; expansion stays entirely inside the poller's resolve step, done fresh every cycle.

### Anti-Pattern 2: Letting an area watch silently break the 1-outcome-per-watch assumption

**What people might do:** leave `run.ts`'s loop as-is and let an area watch produce multiple `WatchOutcome` entries with the same `watchId` in `runs.json`.
**Why it's wrong:** the dashboard's derive modules (`derive-status.ts`, `derive-active-matches.ts`, `derive-timeline.ts`) and the state store's dedup logic were built assuming one outcome per watch id per run; duplicate-keyed outcomes would silently corrupt "per-watch status" derivation on the dashboard (echoing the exact class of dormant bug already logged in the v1.0 retro — a watch id collision silently dropping/misrendering data).
**Instead:** aggregate inside `run.ts` before ever constructing `WatchOutcome[]` — one array entry per watch id, always, regardless of how many facilities it expanded to.

### Anti-Pattern 3: Treating "no auth" as still true for the write path

**What people might do:** ship the new `/api/watches` routes with the same "public, no login" posture as the existing read path, reasoning that D-04 already settled this.
**Why it's wrong:** D-04 was scoped to a read-only dashboard where the worst case of no auth is someone viewing your camping plans. A public, unauthenticated write endpoint on the one file that drives the entire poller is a fundamentally different risk (anyone can corrupt or empty `watches.json`, silently breaking the user's own notifications).
**Instead:** keep reads public (no change), gate only the mutation routes with a minimal shared-secret check — proportionate to "single user, no database-backed multi-tenant model," not a full account system.

## Integration Points Summary

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| RIDB `/facilities` (geo/area search) | New `resolveArea()` in `src/recreation-gov/client.ts`, same `RIDB_BASE`, likely same response schema as name search | MEDIUM confidence on exact query params (`state`, `latitude`, `longitude`, `radius`, `limit`/`offset` — corroborated by WebSearch, not re-verified against a live official docs page in this pass); confirm exact param names against `ridb.recreation.gov/docs` (OpenAPI/Swagger) before implementation |
| GitHub Contents API (`PUT /repos/.../contents/watches.json`) | New `dashboard/lib/github-write.ts`, server-only, fine-grained PAT with `contents:write` | Standard read-sha/write-with-sha optimistic concurrency; handle 409 with one retry |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `src/` poller ↔ `dashboard/` (today, unchanged) | Shared git repo files only (`watches.json`, `state.json`, `runs.json`), no direct calls, no shared imports | Preserve — this is the core architectural decoupling that lets each project deploy independently |
| `src/config/watches.ts` ↔ `src/recreation-gov/client.ts` | Direct function call (`resolveArea`), same pattern as existing `resolveFacility` | New function, existing call shape |
| `src/run.ts` ↔ grouped `ResolvedWatch[]` | In-process aggregation by watch id | The one place genuinely new orchestration logic is required |
| `dashboard/app/api/watches/*` ↔ GitHub Contents API | Server-side HTTPS call, PAT in server env var, never exposed to the client bundle | New surface; keep the PAT out of any client component or `next: {revalidate}` fetch that could leak into RSC payload |

## Sources

- Direct reads of `src/types.ts`, `src/config/schema.ts`, `src/config/watches.ts`, `src/run.ts`, `src/recreation-gov/client.ts`, `dashboard/lib/github.ts`, `dashboard/lib/schema.ts`, `.github/workflows/poll.yml` — HIGH confidence, ground truth for "what exists today."
- `.planning/PROJECT.md` — milestone goal, constraints, key decisions (D-04 public/no-auth dashboard), known v1.0 tech debt (watch-id-with-`:` dropping silently, mixed-precision timestamp comparison) used to inform Anti-Pattern 2.
- WebSearch on RIDB `/facilities` geo-search parameters (state/latitude/longitude/radius, limit/offset pagination) — MEDIUM confidence, not cross-checked against a live fetch of `ridb.recreation.gov/docs` in this pass (WebFetch on that URL returned only a marketing shell, no OpenAPI content). **Verify exact param names during Phase A implementation, not before.**
- GitHub REST Contents API behavior (sha-based optimistic concurrency for file writes) — MEDIUM confidence, based on well-established, stable GitHub API design; recommend a quick live smoke test against a scratch file early in Phase B rather than re-deriving from docs.

---
*Architecture research for: area-based search + watch-management UI integration, Campground Crawler v1.1*
*Researched: 2026-08-25*
