# Phase 1: Core Polling Engine - Research

**Researched:** 2026-08-16
**Domain:** Recreation.gov API integration (RIDB facility search + undocumented availability endpoint), TypeScript/tsx CLI scaffolding, retry/backoff for an unofficial API
**Confidence:** MEDIUM-HIGH (scaffolding and RIDB metadata API: HIGH; undocumented availability endpoint field names and status vocabulary: MEDIUM — corroborated by multiple independent open-source implementations, no official docs exist by nature of the endpoint)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Watches are defined in a checked-in `watches.json` file (not env vars), validated with zod at load time. Easy to edit/diff, matches the GitHub Actions deploy model already decided in stack research.
- **D-02:** A watch specifies a park/campground by human-readable name, not a raw facility ID. The config loader resolves the name to a Recreation.gov facility ID via RIDB at load time (and should cache/memoize this resolution, since it doesn't change run to run).
- **D-03:** A watch's date range must be available as one continuous bookable stay (start date through end date, no gaps) — not "any single open night in the range." This matches how Recreation.gov reservations actually work (a stay is a contiguous booking).
- **D-04:** Site type is expressed as a simple enum: `any | tent | rv | group`, mapped from Recreation.gov's site-type/equipment field. No need to model the full Recreation.gov equipment taxonomy.
- **D-05:** The Recreation.gov API client retries failed requests up to 3 times with exponential backoff (e.g. 1s, 2s, 4s) before marking that watch's check as failed for the current cycle.
- **D-06:** A failed watch check does NOT abort the whole run. Each watch is checked independently; a bad facility ID or transient error for one watch is logged and the run continues to the next watch.
- **D-07:** Since Phase 1 has no email yet, failures surface as: (a) a structured per-watch console log line (OK / NO MATCH / FAILED: reason), and (b) inclusion in the run's returned summary object — so Phase 2 can wire this into email/alerting without changing the core pipeline's shape.
- **D-08:** Dedup state keys are scoped per (watchId, siteId, dateRange) — e.g. `watchId:siteId:startDate:endDate`. A new site matching, or a new date range on the same site, both count as genuinely new and get notified independently. Do NOT key at the whole-watch level.
- **D-09:** Each state entry stores `lastNotifiedAt` (a timestamp), not just a boolean. Costs nothing extra now and means the v2 re-notify-after-cooldown feature (NOTF-04) can be added later without a state-schema migration.

### Claude's Discretion

- Exact console log line formatting/wording
- Internal module/file organization within the recommended structure from ARCHITECTURE.md research
- Specific zod schema shape for `watches.json` (beyond the fields named above: park name, date range, site type)
- Exact retry/backoff implementation (library vs hand-rolled) — research (STACK.md) doesn't mandate a specific retry library

### Deferred Ideas (OUT OF SCOPE)

- Re-notify after cooldown (NOTF-04) — dedup state schema (D-09) supports this later, actual logic is v1.x/v2, not Phase 1.
- Flexible/nearby-date matching (WATCH-03, v2) — not Phase 1 scope.
- KV-based state store (`state/kvStore.ts`) — only needed if deployment target ever changes away from GitHub Actions; not built in Phase 1.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WATCH-01 | User can define one or more watches via config file/env vars, each specifying a park/campground, date range, and site type | `watches.json` zod schema pattern (Code Examples); RIDB facility-search resolution flow |
| WATCH-02 | Multiple concurrent watches are supported without cross-contamination | Per-watch dedup key design (`watchId:siteId:startDate:endDate`, already locked D-08); per-watch failure isolation pattern (Pitfall 2 in Common Pitfalls) |
| POLL-01 | System checks Recreation.gov live availability for all configured watches on a recurring schedule | Orchestrator `run()` pattern from ARCHITECTURE.md (unchanged by this research); CLI verifies this without deployment |
| POLL-02 | System resolves campground/facility metadata via RIDB and live per-day availability via Recreation.gov's availability endpoint | RIDB Facility Resolution section + Undocumented Availability Endpoint section (exact shapes below) |
| POLL-03 | System handles API errors and rate limits gracefully (retry/backoff) without crashing the schedule or going silently dark | Retry/Backoff Implementation Notes + Common Pitfalls (429/403 handling, generic-UA blocking) |
| POLL-04 | System distinguishes "checked, no match" from "check failed" | Common Pitfalls #2 (status vocabulary is NOT an error signal; HTTP-level failures are) |
| OPS-01 | Dedup/notification state persists durably between scheduled runs | State store zod/file pattern in Code Examples (file-based `fileStore.ts`, from project ARCHITECTURE.md, not re-litigated here) |

</phase_requirements>

## Summary

Phase 1 needs two concrete integration points nailed down beyond the project-level research: (1) how to resolve a human-typed park/campground name to a numeric Recreation.gov facility ID via the **RIDB** API, and (2) the exact response shape of the **undocumented** `GET /api/camps/availability/campground/{id}/month` endpoint that returns real per-day, per-site availability. Neither is officially documented for the specific fields needed (RIDB's public docs mirror doesn't show a full-text `query` param; the availability endpoint has no docs at all), so this research relied on reading the source of `juftin/camply` — a actively-maintained, widely-used open-source Recreation.gov client — as a corroborating reference implementation, since it independently arrived at the same endpoints/fields that the project-level STACK.md research already identified.

Key findings: RIDB supports full-text search via `?query=<name>` against `/api/v1/recareas` (recreation areas) and `/api/v1/facilities`, returning `FacilityID`/`FacilityName`/`RecAreaName` fields — good enough to build a name→ID resolver, though fuzzy-matching quality (multiple campgrounds sharing similar names) should be treated as a UX edge case, not a solved problem. The availability endpoint returns `{ campsites: { [campsiteId]: { availabilities: { [isoDate]: statusString }, campsite_type, site, loop, type_of_use, min_num_people, max_num_people } } }` — the status vocabulary includes `"Available"`, `"Reserved"`, `"Not Available"`, `"Not Reservable"`, `"Not Reservable Management"`, `"Not Available Cutoff"`, `"Lottery"`, `"NYR"`, `"Open"`, `"Closed"`; only `"Available"` should be treated as bookable (community implementations vary on this — see Common Pitfalls #2). Site-type mapping to the locked `any|tent|rv|group` enum is best done off `campsite_type` (e.g. contains `"GROUP"`) plus `permitted_equipment[].EquipmentName` (e.g. contains `"RV"`/`"Tent"`), not off `type_of_use` (which encodes overnight/day-use, not equipment).

For scaffolding: `zod@4.4.3`, `typescript@7.0.2`, `tsx@4.23.12`, `@types/node@26.2.0` are current-as-of-this-research versions (verified via `npm view`, differs from project-level STACK.md's slightly older pinned versions — re-verify at implementation time since npm registry moves fast). A minimal `tsconfig.json` + `package.json` scripts setup for a tsx-run CLI is standard and shown below.

**Primary recommendation:** Isolate both RIDB and the availability endpoint behind a single `src/recreation-gov/client.ts` adapter (per ARCHITECTURE.md's already-decided pattern), model the availability response with the field names below, treat only HTTP-level failures (non-2xx, network error, JSON parse failure) as "check failed" — never treat any specific status string as an error — and send a realistic browser `User-Agent` header on every request to the availability endpoint (generic Node/fetch UAs are the most common cause of silent 403s per community reports).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Watch config parsing/validation | Backend (script) | — | Local file read + zod parse, no client/server split in this CLI-only tool |
| Park name → facility ID resolution (RIDB) | Backend (script) | — | One-time, memoized lookup at config-load time; pure I/O adapter |
| Live availability fetch (undocumented endpoint) | Backend (script) | — | Adapter module, isolated per Pitfall #1 from project research |
| Matching (date-range + site-type filter) | Backend (script) | — | Pure function, no I/O, easily unit-tested with fixtures |
| Dedup state read/write | Backend (script) | Storage (flat file) | File-based `StateStore` implementation per ARCHITECTURE.md; this phase only needs the file backend |
| Run orchestration + CLI entrypoint | Backend (script) | — | `run.ts` + `cli.ts`, deployment-agnostic per ARCHITECTURE.md Pattern 1 |

*(No browser, SSR, or CDN tiers — this is a single-process Node CLI tool with no UI in Phase 1.)*

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `typescript` | `7.0.2` (verified via `npm view typescript version`, 2026-08-16) | Type safety for config, API responses | Matches project STACK.md recommendation (5.7+); registry has since moved to a 7.x major — verify no breaking build-config changes apply to this project's minimal `tsc --noEmit` usage before locking the exact pin in the plan |
| `tsx` | `4.23.12` (verified via `npm view tsx version`) | Run `.ts` files directly, no build step | Confirmed current; matches STACK.md's `4.x` recommendation |
| `zod` | `4.4.3` (verified via `npm view zod version`) | Runtime validation of `watches.json` and both RIDB/availability API responses | STACK.md recommended `3.x/4.x`; 4.x is now current — Zod 4's API is mostly backward compatible with 3.x for basic schemas (object/string/enum/array) but has some import-path and error-format changes; use the `zod` (not `zod/v3`) entrypoint and its current docs when writing schemas |
| `@types/node` | `26.2.0` (verified via `npm view @types/node version`) | Type defs for Node 22/24 runtime (`fetch`, `process.env`, etc.) | Matches the Node LTS target from project STACK.md |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None required beyond core | — | Retry/backoff is small enough to hand-roll (see Code Examples) — CONTEXT.md explicitly leaves this to discretion and doesn't mandate a library | Only reach for `p-retry`/`p-limit` (already suggested in project STACK.md) if the watch count grows past what a simple sequential loop with manual backoff can handle cleanly — not needed for a Phase-1-scale (few watches) CLI |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled retry/backoff (`for` loop + `setTimeout`) | `p-retry` npm package | `p-retry` is ~2KB and battle-tested, but for exactly-3-retries-fixed-backoff (D-05) a ~15-line hand-rolled helper is equally correct and has zero dependency surface to reason about; either is acceptable per CONTEXT.md's discretion note |
| RIDB `query` full-text search | Manually maintained facility-ID lookup table | Query search is dynamic (works for any park name the user types) vs. a static table needing manual upkeep per watch — query search is clearly better for this project's "user edits watches.json with a park name" UX (D-02) |

**Installation:**
```bash
npm install zod
npm install -D typescript tsx @types/node
```

**Version verification performed:** `npm view typescript version` → `7.0.2`; `npm view tsx version` → `4.23.12`; `npm view zod version` → `4.4.3`; `npm view @types/node version` → `26.2.0`. All checked 2026-08-16. `[VERIFIED: npm registry]`

## Architecture Patterns

### System Architecture Diagram

```
watches.json ──► Config Loader ──(park name)──► RIDB /recareas?query= ──► facility ID
                       │                              (memoized per run)
                       ▼
                 loop over watches
                       │
                       ▼
        Rec.gov Client: GET /api/camps/availability/campground/{id}/month
                (retry x3, exp backoff, per-watch try/catch isolation)
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
      HTTP/network error   200 OK + JSON body
      → mark watch FAILED  → Parser normalizes → AvailabilitySlot[]
             │                   │
             │                   ▼
             │            Matcher: filter by site-type enum +
             │            contiguous date-range-fully-available
             │                   │
             │            ┌──────┴───────┐
             │            ▼              ▼
             │       no slots match   slots match
             │       → watch NO_MATCH  → dedup check against
             │                            StateStore(watchId,siteId,dateRange)
             │                              │           │
             │                         already        new match
             │                         notified        → include in
             │                         → skip            summary,
             │                                            markNotified()
             ▼                              ▼               │
        Run Summary Object  ◄───────────────┴───────────────┘
    { checked, matched, failed[], noMatch[] } ──► console log lines (OK/NO MATCH/FAILED)
```

### Recommended Project Structure

(Unchanged from project-level ARCHITECTURE.md — confirmed still correct for this phase's scope, no additions needed):
```
src/
├── config/
│   └── watches.ts          # load watches.json, zod-validate, resolve names→facilityId via RIDB (memoized)
├── recreation-gov/
│   ├── client.ts            # fetch wrapper: RIDB facility search + availability month fetch, retry/backoff
│   ├── types.ts             # zod schemas + inferred types for both RIDB and availability responses
│   └── parse.ts             # raw availability JSON → normalized AvailabilitySlot[]
├── matcher/
│   └── match.ts             # pure fn: (slots, watch) → MatchedSlot[] (contiguous-range + site-type logic)
├── state/
│   ├── store.ts             # StateStore interface
│   └── fileStore.ts         # flat-file JSON implementation
├── run.ts                    # orchestrator
└── cli.ts                    # local entrypoint
```

### Pattern 1: RIDB name-to-facility-ID resolution

**What:** Full-text search RIDB's `recareas` (and/or `facilities`) endpoint with a `query` parameter, take the best match, cache the resulting `FacilityID` for the process lifetime (D-02: "doesn't change run to run").
**When to use:** At config-load time, once per unique park name in `watches.json`, before the polling loop starts.
**Example:**
```typescript
// Source: pattern corroborated by juftin/camply (camply/providers/recreation_dot_gov/recdotgov_provider.py,
// find_recreation_areas() and RIDBConfig — https://github.com/juftin/camply) — MEDIUM confidence,
// RIDB's own docs mirror (ships/ridb) does not document the `query` param but camply's production
// implementation uses it successfully against the live API.
const RIDB_BASE = 'https://ridb.recreation.gov/api/v1';

async function resolveFacilityId(parkName: string, apiKey?: string): Promise<number> {
  const url = new URL(`${RIDB_BASE}/facilities`);
  url.searchParams.set('query', parkName);
  url.searchParams.set('limit', '10');
  url.searchParams.set('sort', 'Name');

  const res = await fetch(url, {
    headers: apiKey ? { apikey: apiKey } : {},
  });
  if (!res.ok) throw new Error(`RIDB facility search failed: ${res.status}`);
  const data = await res.json();
  // RIDB facilities response: { RECDATA: FacilityResponse[], METADATA: {...} }
  const match = data.RECDATA?.[0];
  if (!match) throw new Error(`No RIDB facility found for "${parkName}"`);
  return match.FacilityID as number;
}
```
**Response fields confirmed (via camply's Pydantic models mirroring the live API):** `FacilityID: int`, `FacilityName: str`, `FacilityTypeDescription: str`, `Enabled: bool`, `Reservable: bool`. `[CITED: juftin/camply source — camply/containers/api_responses.py]`

**Caveat `[ASSUMED]`:** The exact wrapper key (`RECDATA`/`METADATA`) for the `/facilities` search response is standard RIDB envelope shape used across all RIDB list endpoints per multiple community wrappers, but was not independently re-verified against a live API call in this research pass (no network access to ridb.recreation.gov during research). Verify with one live/fixture call during implementation — flagged in Assumptions Log.

### Pattern 2: Undocumented availability endpoint fetch + normalize

**What:** Fetch a calendar month of per-site availability, normalize into `AvailabilitySlot[]` with a stable shape the matcher can consume regardless of upstream field-name churn.
**When to use:** Once per watch per calendar month the watch's date range spans (a watch crossing a month boundary needs 2 fetches).
**Example:**
```typescript
// Source: field names and endpoint shape corroborated by juftin/camply
// (camply/providers/recreation_dot_gov/recdotgov_camps.py::make_recdotgov_availability_request,
// camply/containers/api_responses.py::CampsiteAvailabilityResponse) and
// banool/recreation-gov-campsite-checker (clients/recreation_client.py) — MEDIUM confidence,
// two independent open-source implementations agree on this shape.

const AVAILABILITY_BASE = 'https://www.recreation.gov/api/camps/availability/campground';

async function fetchMonthAvailability(facilityId: number, monthStart: Date): Promise<RawAvailabilityResponse> {
  const startDate = monthStart.toISOString().slice(0, 8) + '01T00:00:00.000Z'; // YYYY-MM-01T00:00:00.000Z
  const url = `${AVAILABILITY_BASE}/${facilityId}/month?start_date=${startDate}`;

  const res = await fetch(url, {
    headers: {
      // Realistic browser UA — generic Node/fetch UAs are the most commonly reported 403 cause
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Referer': 'https://www.recreation.gov/',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Availability fetch failed: ${res.status} ${res.statusText}`);
  return res.json();
}

// Confirmed response shape (fields per campsite entry, keyed by numeric campsite ID as object key):
// {
//   "campsites": {
//     "12345": {
//       "availabilities": { "2026-09-01T00:00:00Z": "Available", "2026-09-02T00:00:00Z": "Reserved", ... },
//       "campsite_type": "STANDARD NONELECTRIC" | "RV NONELECTRIC" | "GROUP STANDARD AREA NONELECTRIC" | ...,
//       "type_of_use": "Overnight" | "Day",
//       "loop": "Loop A",
//       "site": "012",
//       "min_num_people": 1,
//       "max_num_people": 8
//     },
//     ...
//   }
// }
```
**Status vocabulary observed across implementations:** `"Available"` (bookable), `"Reserved"`, `"Not Available"`, `"Not Reservable"`, `"Not Reservable Management"`, `"Not Available Cutoff"`, `"Lottery"`, `"NYR"` (not yet released), `"Open"`, `"Closed"`. `[CITED: juftin/camply — camply/config/api_config.py CAMPSITE_UNAVAILABLE_STRINGS constant]`

**Caveat `[ASSUMED]` / worth flagging to the planner:** camply's own `CAMPSITE_UNAVAILABLE_STRINGS` list includes `"Open"` as *unavailable*, which is counterintuitive — this may reflect a quirk specific to certain park types (e.g. first-come-first-served loops using "Open" to mean "not reservable online," not "bookable"). For this project's matching logic (D-03, "must be one continuous bookable stay"), the safest interpretation is an **allowlist**, not a denylist: treat only the literal string `"Available"` as bookable, everything else as not-bookable. This avoids depending on a possibly-incomplete "unavailable strings" enumeration. Flagged as MEDIUM confidence — validate against a handful of live fixture responses during Phase 1 implementation before finalizing the matcher's status check.

### Pattern 3: Site-type mapping to the `any | tent | rv | group` enum

**What:** Map Recreation.gov's `campsite_type` string (and optionally `permitted_equipment[].EquipmentName`) to the project's simplified enum.
**When to use:** In the matcher, filtering slots against a watch's configured `siteType`.
**Example:**
```typescript
// [ASSUMED] — pattern is a reasonable heuristic derived from observed campsite_type
// values across community tools and Recreation.gov's public Federal Camping Data Standard
// terminology, NOT an exhaustive verified enum (Recreation.gov does not publish one).
// Verify against live/fixture data for the specific parks in the user's actual watches.json.
function mapSiteType(campsiteType: string): 'any' | 'tent' | 'rv' | 'group' | 'unknown' {
  const t = campsiteType.toUpperCase();
  if (t.includes('GROUP')) return 'group';
  if (t.includes('RV') || t.includes('TRAILER')) return 'rv';
  if (t.includes('TENT') || t.includes('WALK')) return 'tent';
  return 'unknown'; // e.g. cabin, yurt, boat-in — treat as non-match unless watch.siteType === 'any'
}
```
Equipment-based cross-check (`permitted_equipment[].EquipmentName` values observed: `Tent`, `RV`, `Trailer`, `Pickup Camper`, `Pop up`, `Caravan/Camper Van`, `Fifth Wheel`, `Vehicle` — `[CITED: Federal Camping Data Standard, recreation.gov campsite pages via WebSearch]`) is a secondary signal if `campsite_type` string matching proves unreliable in practice.

### Anti-Patterns to Avoid

- **Treating any non-"Available" status as an error:** The endpoint returning `"Reserved"` or `"Not Available"` is a successful, valid check — not a failure. Only HTTP-level failures (non-2xx, timeout, malformed JSON) are "check failed" per D-07/POLL-04.
- **Skipping the `User-Agent`/`Referer` headers:** Requests with generic Node/fetch default UAs are the most commonly reported cause of silent 403s against this specific undocumented endpoint (multiple community sources).
- **Re-implementing the full Recreation.gov equipment taxonomy:** D-04 explicitly says not to — map to the 4-value enum only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config/API response shape validation | Manual `if (typeof x === 'string')` checks scattered through the codebase | `zod` schemas in `recreation-gov/types.ts` and `config/watches.ts` | Centralizes validation, gives you parse errors with paths, and doubles as the TypeScript type source via `z.infer<>` — exactly the "silent failure mode" STACK.md flags as the top risk for this project |
| Date-range/month-boundary math (does a watch's range span 2 calendar months?) | Manual date-string slicing/comparison | Native `Date`/`Intl` methods, or `date-fns` if the logic gets unwieldy (already suggested, optional, in STACK.md) | Off-by-one month-boundary bugs are a classic source of "watch silently checks the wrong month" failures |
| Retry/backoff timing math | Ad-hoc `Math.random()` jitter reinvented per call site | One small shared `retryWithBackoff(fn, { retries: 3, baseMs: 1000 })` helper used by both RIDB and availability clients | D-05 requires consistent 3-retry exponential backoff — a single shared helper keeps this policy in one place instead of duplicated/drifting across two API clients |

**Key insight:** The two things worth NOT hand-rolling here are validation (zod) and having exactly one retry helper — everything else (the actual HTTP calls, the matcher, the state store) is intentionally simple, dependency-light code per the project's "boring architecture" philosophy from ARCHITECTURE.md.

## Common Pitfalls

### Pitfall 1: Misreading the availability status vocabulary (see Pattern 2 above)

**What goes wrong:** Using a denylist (`CAMPSITE_UNAVAILABLE_STRINGS`-style) that may be incomplete or include counterintuitive values (e.g. `"Open"` appearing as "unavailable" in one reference implementation) leads to false-positive matches — notifying on a site that isn't actually bookable.
**Why it happens:** No official enum exists; every open-source implementation had to reverse-engineer this from live traffic, and their lists may have drifted or been written for different park types.
**How to avoid:** Use an allowlist — only `status === 'Available'` counts as bookable for D-03's "contiguous fully-available range" check. Validate against a handful of real fixture responses (capture a few live API responses to `.planning/phases/01-core-polling-engine/fixtures/` or similar during implementation) before trusting the matcher's output.
**Warning signs:** A watch reports a match but the site is actually reserved when checked manually on recreation.gov.

### Pitfall 2: Generic HTTP client User-Agent causing silent 403s

**What goes wrong:** Node's default `fetch` User-Agent (or no UA at all) gets blocked or redirected by Recreation.gov's edge/WAF, and the response may come back as an HTML error page instead of JSON — which, if not explicitly checked, throws an unhelpful "JSON parse error" that's hard to distinguish from a genuine outage.
**Why it happens:** It's easy to forget headers when prototyping against `fetch(url)` directly.
**How to avoid:** Always send a realistic browser `User-Agent` and a `Referer: https://www.recreation.gov/` header (per Pattern 2 above and multiple community implementations). Explicitly check `res.ok` and `Content-Type` before calling `res.json()`, and surface a clear "got HTML instead of JSON — likely blocked" error message distinct from a generic parse failure, so this failure mode is diagnosable from logs (ties into D-07's structured failure reporting).
**Warning signs:** Errors mentioning "Unexpected token < in JSON" in logs.

### Pitfall 3: RIDB search returning multiple/ambiguous matches for a park name

**What goes wrong:** A `query` search for a common name (e.g. "Pine Grove") can return several unrelated facilities across different states/agencies; auto-selecting the first result may silently resolve to the wrong campground.
**Why it happens:** RIDB indexes facilities from NPS, USFS, BLM, USACE, BOR, and FWS — name collisions across agencies/states are common.
**How to avoid:** Log the resolved `FacilityID`/`FacilityName`/`RecAreaName` at config-load time so the user can sanity-check it against what they typed; consider requiring the config schema to allow an optional explicit `facilityId` override (not required by CONTEXT.md, but cheap defensive design) for cases where name resolution picks the wrong result. At minimum, fail loudly (not silently) if RIDB search returns zero results — don't fall through to "watch matches nothing" silently.
**Warning signs:** A watch runs successfully every cycle but never matches even during periods of known availability at the intended park.

### Pitfall 4: Retrying non-retryable failures (bad facility ID, 4xx client errors) as if they were transient

**What goes wrong:** D-05's 3-retry exponential backoff is meant for transient failures (timeouts, 5xx, rate limits). Blindly retrying a 404 (invalid facility ID) 3 times just wastes 7 seconds (1s+2s+4s) per cycle before correctly failing — not incorrect, but wasteful and can make failure-cause harder to read in logs if not distinguished.
**Why it happens:** A single generic retry wrapper around all HTTP calls doesn't distinguish error classes.
**How to avoid:** Not a hard requirement from CONTEXT.md (D-05 doesn't mandate this distinction), but worth the planner considering: optionally skip retries for 4xx (except 429, which IS retryable) and only retry on network errors/5xx/429. Simpler alternative (fully compliant with D-05 as literally stated): retry all failures uniformly 3x — acceptable for Phase 1 given low watch counts and infrequent bad-config errors.

## Code Examples

### Minimal `package.json` scripts + `tsconfig.json` for a tsx-run CLI

```json
// package.json (relevant excerpt)
{
  "type": "module",
  "scripts": {
    "start": "tsx src/cli.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "typescript": "^7.0.2",
    "tsx": "^4.23.12",
    "@types/node": "^26.2.0"
  }
}
```
```jsonc
// tsconfig.json — standard for a tsx-executed, ESM, Node-target script project
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src"]
}
```
`[ASSUMED]` — this is standard, widely-used TypeScript/tsx/ESM project scaffolding based on training knowledge, not verified against a specific official "tsx starter" doc in this research pass (tsx itself has no opinion on tsconfig beyond needing valid TS syntax). `noUncheckedIndexedAccess: true` is specifically valuable here because both the RIDB and availability responses are keyed objects (`campsites[id]`, `RECDATA[0]`) where TypeScript would otherwise silently allow undefined access.

### zod schema pattern for `watches.json`

```typescript
// Source: standard zod v4 patterns — [CITED: zod is core to the already-locked stack per STACK.md/CONTEXT.md D-01]
import { z } from 'zod';

const SiteType = z.enum(['any', 'tent', 'rv', 'group']);

const WatchSchema = z.object({
  id: z.string().min(1),          // stable identifier for dedup keys (D-08)
  parkName: z.string().min(1),     // resolved to facilityId at load time (D-02)
  dateRange: z.object({
    start: z.string().date(),      // YYYY-MM-DD
    end: z.string().date(),
  }).refine((r) => r.start < r.end, { message: 'start must be before end' }),
  siteType: SiteType,
});

const WatchesFileSchema = z.array(WatchSchema).min(1);

export type Watch = z.infer<typeof WatchSchema>;
```
`zod().date()` string-format validators and `.refine()` are current zod v4 API — `[CITED: zod is the already-decided validation library per project STACK.md]`. Exact schema shape beyond the named fields is Claude's discretion per CONTEXT.md.

### Retry/backoff helper matching D-05 exactly

```typescript
// [ASSUMED] — hand-rolled implementation; CONTEXT.md explicitly leaves library-vs-hand-rolled to discretion
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  { retries = 3, baseMs = 1000 }: { retries?: number; baseMs?: number } = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      const delay = baseMs * 2 ** attempt; // 1s, 2s, 4s
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| RIDB API key required for all requests | RIDB basic facility metadata lookups work without a key (key only raises rate limits) | Confirmed still true per project STACK.md — no change found in this research pass | Simplifies Phase 1 setup — no RIDB key needed to get started, though registering one (free) is cheap insurance against rate limits if watch count grows |

**Deprecated/outdated:** None identified specific to this phase's scope beyond what project-level research already flagged (the availability endpoint itself is inherently "unofficial" and could change at any time — not a deprecation, an ongoing risk, already captured in project PITFALLS.md Pitfall 1).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | RIDB `/facilities` search response envelope is `{ RECDATA: [...], METADATA: {...} }` | Pattern 1 (RIDB resolution) | Low — easily discovered/fixed on first live test call; parser would need a one-line field-path adjustment |
| A2 | The `"Open"` status quirk in camply's unavailable-strings list reflects park-type-specific semantics, not a bug; allowlist (`=== 'Available'`) is the safer matching strategy | Pattern 2 (availability endpoint) | Medium — if `"Available"` is not actually the sole bookable status for all park types the user watches, some real openings could be missed (false negative) rather than false-positive spammed; validate against real fixture data for the user's actual watched parks early in implementation |
| A3 | `campsite_type` string-matching heuristic (`GROUP`/`RV`/`TENT`) correctly maps to the D-04 enum for the specific campgrounds in the user's `watches.json` | Pattern 3 (site-type mapping) | Medium — misclassified site types could cause a tent-only watch to match an RV site or vice versa; no official enum exists, so this needs empirical validation against real facility data during implementation, not just code review |
| A4 | `tsconfig.json` shown (NodeNext/ES2023/strict) is a reasonable default for a tsx-executed ESM script project | Code Examples (scaffolding) | Low — worst case is a config tweak needed once `tsx src/cli.ts` is first run; not a design-level risk |
| A5 | `noUncheckedIndexedAccess: true` doesn't conflict with anything else in the (not-yet-written) codebase | Code Examples (scaffolding) | Low — purely a compiler strictness flag; can be relaxed if it proves too noisy |

## Open Questions

1. **Does the availability endpoint reliably return one calendar month of data per call, and does a watch spanning a month boundary need to merge two responses?**
   - What we know: The endpoint is explicitly a `/month` endpoint keyed by `start_date` (first of month) — project STACK.md already flags this ("watches spanning month boundaries need 2+ fetches").
   - What's unclear: Exact boundary behavior (does it return a few days of the adjacent month for context, or strictly the requested month only?) — not verified against a live response in this pass.
   - Recommendation: Confirm with one live fixture call during implementation; the matcher should be written to correctly stitch two months' `AvailabilitySlot[]` together regardless, since D-03's "contiguous range" check needs unbroken day-by-day data across the boundary.

2. **What does RIDB return for a park name with zero matches, vs. a network/auth error — same shape or different?**
   - What we know: A successful search with no results likely returns `RECDATA: []` per standard RIDB envelope pattern (assumption A1).
   - What's unclear: Not independently verified in this pass.
   - Recommendation: Handle both `RECDATA: []` (throw "no facility found" — a config problem) and non-2xx HTTP (throw "RIDB request failed" — a check-failed-style problem) as distinct, clearly-logged error paths in the config loader.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Not independently verified in this research session (no shell Node check performed) | — target 22.x/24.x LTS per STACK.md | If unavailable locally, install via nvm/official installer before Phase 1 execution begins — this is a hard requirement, no fallback |
| npm registry access | Installing zod/typescript/tsx/@types/node | ✓ (used `npm view` successfully during this research session) | — | — |
| RIDB API (`ridb.recreation.gov`) | POLL-02 facility resolution | Not independently verified in this research session (no live network fetch attempted — see Assumptions Log A1) | — | Verify with a live/fixture call as the first implementation task; if unreachable in the dev environment, use captured fixture JSON for CLI-based testing (already the phase's stated verification approach: "verifiable end-to-end via CLI with fixture/live data") |
| Recreation.gov availability endpoint (`www.recreation.gov`) | POLL-02 live availability | Not independently verified in this research session | — | Same as above — fixture-based testing is explicitly in scope per the phase description, so this is not a blocker |

**Missing dependencies with no fallback:** None — Node.js/npm are standard developer-machine prerequisites already implied by the entire project's stack choice.

**Missing dependencies with fallback:** Live RIDB/Recreation.gov API reachability — the phase description itself explicitly allows fixture-based CLI verification as an alternative to live calls, so this is a non-blocking risk, not a gap requiring remediation before planning.

## Security Domain

> `security_enforcement` absent from `.planning/config.json` → treated as enabled per default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | Single-user local/CI tool, no login surface in this phase |
| V3 Session Management | No | No sessions — stateless CLI invocations |
| V4 Access Control | No | No multi-tenant/multi-user access boundaries in scope |
| V5 Input Validation | Yes | `zod` schemas for `watches.json` (user-authored, could be malformed) and for both RIDB/availability API responses (third-party, could change shape unexpectedly) — already the locked approach (D-01, STACK.md) |
| V6 Cryptography | No | No secrets/crypto operations in Phase 1 scope (RIDB API key, if used, is a plain bearer-style header per `apikey` param, not a crypto operation the app performs) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Malformed/unexpected upstream API response shape (RIDB or availability endpoint changes without notice) crashing the process or producing silently-wrong matches | Tampering (of trust in third-party data) | zod-validate all external responses at the boundary (`recreation-gov/types.ts`); fail loudly (throw, caught by per-watch isolation) on schema mismatch rather than optimistically accessing fields |
| `watches.json` containing unexpected/malicious content if ever sourced from an untrusted contributor (e.g. shared repo) | Tampering | zod validation at load time already covers structural safety; this is a config file the user edits themselves in Phase 1's single-user model, so this is a defense-in-depth measure, not a primary threat given the trust model |
| Logging full API responses/headers on error (could leak an RIDB API key if one is used and logged via request headers) | Information Disclosure | Per project PITFALLS.md Pitfall 7 (Phase 0/1 concern) — redact `Authorization`/`apikey` headers before logging; this applies directly to the RIDB client built in this phase |

## Sources

### Primary (HIGH confidence)
- `npm view typescript/tsx/zod/@types/node version` — direct npm registry queries performed 2026-08-16, confirms current versions (`typescript@7.0.2`, `tsx@4.23.12`, `zod@4.4.3`, `@types/node@26.2.0`). `[VERIFIED: npm registry]`

### Secondary (MEDIUM confidence)
- [juftin/camply source (GitHub)](https://github.com/juftin/camply) — read `camply/providers/recreation_dot_gov/recdotgov_provider.py`, `recdotgov_camps.py`, `camply/config/api_config.py`, and `camply/containers/api_responses.py` directly — actively-maintained, widely-used open-source Recreation.gov client; confirms RIDB `query` search param usage, availability endpoint URL/params/headers, response field names, and status vocabulary. `[CITED: juftin/camply source]`
- [banool/recreation-gov-campsite-checker (GitHub)](https://github.com/banool/recreation-gov-campsite-checker) — confirmed via WebFetch: availability endpoint URL pattern, `campsite_id`/`campsite_type`/`availabilities` field names, User-Agent requirement. `[CITED]`
- [Federal Camping Data Standard PDFs (ridb.recreation.gov)](https://ridb.recreation.gov/shared/pdf/Federal_Camping_Data_Standard_2.1_12232024.pdf) and community campsite listing pages — corroborate equipment-type vocabulary (Tent, RV, Trailer, Fifth Wheel, etc.) via WebSearch summary, not directly fetched in full. `[CITED, partial]`

### Tertiary (LOW confidence)
- `ships/ridb` GitHub docs mirror (`FacilitiesApi.md`) — explicitly does NOT document the `query` full-text search parameter that camply's live implementation uses; treated as an incomplete/outdated documentation mirror, not authoritative. Flagged as a gap, not relied upon for the `query` param claim (relied on camply's source instead).
- Recreation.gov `campsite_type` enum values beyond what was directly observed in camply's model comments — not independently enumerated from an authoritative source; Pattern 3's mapping is explicitly marked `[ASSUMED]`.

## Metadata

**Confidence breakdown:**
- Standard stack (TS/tsx/zod scaffolding): HIGH — versions verified directly via npm registry, patterns are widely-established
- RIDB facility resolution: MEDIUM — endpoint/param confirmed via one strong reference implementation (camply), not independently re-verified with a live call in this session
- Availability endpoint shape: MEDIUM — confirmed via two independent reference implementations (camply, banool/recreation-gov-campsite-checker), but the endpoint is inherently undocumented/unofficial by nature and status-vocabulary interpretation (Pitfall 1/A2) needs empirical validation during implementation
- Site-type mapping (D-04 enum): LOW-MEDIUM — no official enum exists; heuristic derived from observed values, explicitly flagged for validation against the user's actual watched parks

**Research date:** 2026-08-16
**Valid until:** ~30 days for the scaffolding/versions (fast-moving npm ecosystem); the undocumented availability endpoint should be treated as "verify at implementation time, re-verify if behavior seems off" indefinitely, since it can change without notice at any time (no deprecation schedule exists for an unofficial endpoint)

---
*Phase research for: 01-core-polling-engine*
*Researched: 2026-08-16*
