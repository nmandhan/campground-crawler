# Architecture Research

**Domain:** Single-user scheduled-polling notification system (campsite availability watcher)
**Researched:** 2026-08-16
**Confidence:** MEDIUM-HIGH (component/data-flow pattern verified against multiple real-world implementations; deployment-specific limits verified against current vendor docs)

## Standard Architecture

This class of system — "poll an external API on a schedule, diff against previous state, notify on new matches" — is extremely well-trodden (uptime monitors, price trackers, job-listing watchers, campsite finders like `camply`, `banool/recreation-gov-campsite-checker`, and Jacob Bokor's campsite monitor all converge on the same shape). The architecture is intentionally boring: a pipeline of pure-ish functions wired together by a thin scheduler, with exactly one piece of durable state.

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          TRIGGER LAYER                               │
│  ┌───────────────────┐        ┌────────────────────────────────┐    │
│  │ Vercel Cron Route  │  OR    │ Scheduled script (cron/systemd  │    │
│  │ (GET /api/run)     │        │ timer / GitHub Actions schedule)│    │
│  └─────────┬──────────┘        └───────────────┬──────────────---┘   │
│            └──────────────────┬─────────────────┘                    │
├─────────────────────────────  ┴──────────────────────────────────────┤
│                        ORCHESTRATOR (run())                          │
│   1 entrypoint fn, deployment-agnostic, no knowledge of cron/HTTP    │
├────────────────────────────────────────────────────────────────────┤
│  ┌────────────┐  ┌──────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │Config Loader│ │ Rec.gov API  │  │  Matcher   │  │ Notification │  │
│  │ (watches)   │→│   Client     │→│  (diff vs  │→│    Sender    │  │
│  │            │  │ (fetch+parse)│  │  criteria) │  │  (Resend)   │  │
│  └────────────┘  └──────────────┘  └─────┬──────┘  └──────▲──────┘  │
│                                            │                │        │
│                                    ┌───────▼────────────────┴─────┐  │
│                                    │   Notification State Store   │  │
│                                    │  (dedupe: what's already      │  │
│                                    │   been alerted on)            │  │
│                                    └────────────────┬───────────┘   │
├─────────────────────────────────────────────────────┴───────────────┤
│                          PERSISTENCE LAYER                           │
│  ┌────────────────┐   OR   ┌───────────────────────────────────┐   │
│  │ Flat JSON file  │        │ KV store (Vercel KV / Upstash     │   │
│  │ (script deploy) │        │ Redis) — required for serverless  │   │
│  └────────────────┘        └───────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|-------------------------|
| **Config Loader** | Parse watch definitions (park/facility ID, date range, site type, notify cadence) from env var JSON or a checked-in `watches.json`/`.yaml`. Validate shape. | Small schema-validated loader (zod/valibot). No DB — this is static, user-edited config, re-read every run. |
| **Recreation.gov API Client** | Fetch availability for a facility/month from Recreation.gov; fetch facility metadata (name, campsite list) from RIDB if needed for readable emails. Handle retries/backoff, rate limiting, and response parsing into a normalized shape. | Thin `fetch` wrapper module. No official availability endpoint exists — see Pitfalls; uses the same undocumented `www.recreation.gov/api/camps/availability/campground/{id}/month` endpoint that `camply` and other OSS tools rely on. |
| **Matcher / Diff Engine** | For each watch, filter the fetched availability down to sites matching site-type + date-range criteria. Pure function: `(availability, watchCriteria) → matchedSlots[]`. | Pure TS function, easily unit-testable with fixture JSON, no I/O. |
| **Notification State Store** | The *only* piece of real persistent state in the system. Tracks which (watch, site, date) combinations have already triggered an email, so re-running the poll doesn't re-notify on a still-open site. Also can hold last-run timestamp / last-error for debugging. | Flat JSON file (script deploy) or KV/Redis hash (serverless deploy) — see dedicated section below. Never a relational DB. |
| **Notification Sender** | Format and send the alert email (one email per run summarizing all new matches, not one per site, to avoid inbox spam). | Resend or SendGrid transactional API call. Stateless — takes matched+deduped results, returns success/failure. |
| **Orchestrator (`run()`)** | Wires the above together: load config → fetch → match → dedupe against state → send email for new matches → persist updated state → log outcome. The one function that knows the full pipeline. | Single exported async function, callable from a CLI script, a Vercel route handler, or a GitHub Actions step — deployment-agnostic by design. |
| **Trigger/Scheduler** | Invokes `run()` on a schedule. This is the *only* part that differs between deployment targets. | Vercel Cron (`vercel.json` `crons` entry hitting a route that calls `run()`) OR a plain scheduled script (cron/systemd timer/GitHub Actions `schedule:`) that calls `run()` directly. |

## Recommended Project Structure

```
src/
├── config/
│   └── watches.ts          # load + validate watch definitions (schema)
├── recreation-gov/
│   ├── client.ts            # fetch wrapper: availability + facility lookup
│   ├── types.ts             # normalized types for availability responses
│   └── parse.ts             # raw API response → normalized AvailabilitySlot[]
├── matcher/
│   └── match.ts             # pure fn: (slots, watch) → MatchedSlot[]
├── state/
│   ├── store.ts             # StateStore interface (get/set/has "already notified")
│   ├── fileStore.ts         # flat-file JSON implementation
│   └── kvStore.ts           # Vercel KV / Upstash implementation
├── notify/
│   └── email.ts             # format + send via Resend
├── run.ts                    # orchestrator: the one pipeline function
├── cli.ts                    # local entrypoint: `node cli.ts` calls run()
└── api/
    └── run-route.ts          # Vercel route handler: calls run(), used by vercel.json cron
```

### Structure Rationale

- **`recreation-gov/`, `matcher/`, `notify/` are pure/isolated:** each can be unit-tested with fixture data and no network/deployment concerns — this is what makes the build order below viable (test real logic before deployment is decided).
- **`state/store.ts` as an interface:** decouples "how deduping works" from "where dedupe data lives," so the deployment-target decision (Vercel vs script) only changes one file, not the pipeline.
- **`run.ts` has zero knowledge of HTTP or cron:** it's a plain async function. `cli.ts` and `api/run-route.ts` are both ~5-line adapters that call it. This is what makes the architecture "work reasonably under either" deployment target, per the project's open deployment question.

## Architectural Patterns

### Pattern 1: Deployment-agnostic orchestrator with thin trigger adapters

**What:** The entire business pipeline lives in one function (`run()`) that takes no framework-specific arguments and returns a result/log object. Both the Vercel route and the CLI/cron script are trivial wrappers around it.
**When to use:** Any time the deployment target is undecided or may change — exactly this project's situation.
**Trade-offs:** Slight indirection cost; large win in that you can prototype and fully test the system locally via CLI before ever touching Vercel config, and switch deployment later with near-zero rework.

**Example:**
```typescript
// run.ts
export async function run(): Promise<RunResult> {
  const watches = await loadWatches();
  const results: MatchedSlot[] = [];
  for (const watch of watches) {
    const availability = await fetchAvailability(watch.facilityId, watch.dateRange);
    const matched = matchAvailability(availability, watch);
    const fresh = await filterUnnotified(matched, watch.id, stateStore);
    results.push(...fresh);
  }
  if (results.length > 0) {
    await sendAlertEmail(results);
    await stateStore.markNotified(results);
  }
  return { checkedAt: new Date(), matches: results.length };
}

// cli.ts
run().then(console.log);

// api/run-route.ts (Vercel)
export async function GET() { return Response.json(await run()); }
```

### Pattern 2: Storage-backend interface for the single stateful component

**What:** Everything is stateless except the notification dedupe store. Define a minimal interface (`hasNotified(key)`, `markNotified(keys)`) and swap implementations by deployment target.
**When to use:** Whenever persistence needs differ by environment (ephemeral serverless vs. long-lived process/VM) but the access pattern is trivially simple (small key set, no queries beyond point lookups).
**Trade-offs:** Adds one abstraction layer; avoids coupling the whole app to a database choice made for infra reasons rather than data-model reasons.

```typescript
interface StateStore {
  hasNotified(key: string): Promise<boolean>;
  markNotified(keys: string[]): Promise<void>;
}
```

### Pattern 3: Snapshot-diff (not raw-response storage)

**What:** Store only the *normalized, minimal* dedupe key (e.g. `${watchId}:${siteId}:${date}` → timestamp last notified), not full raw API responses. The previous full availability snapshot doesn't need to persist — each run re-fetches fresh and compares against the small "already notified" set, not against a full previous snapshot.
**When to use:** Whenever the source of truth (Recreation.gov) is cheap to re-query in full each run, which it is here (a handful of watches, a few API calls per run).
**Trade-offs:** Simpler and smaller state than a full diff-of-snapshots approach; the tradeoff is you can't answer "what changed since last time" for anything except your own watch criteria — which is all this project needs.

## Data Flow

### Request Flow ("cron fires" → "email sent")

```
[Cron/scheduler fires]
    ↓
[Trigger adapter invokes run()]
    ↓
[Config Loader reads watches.json / env]
    ↓ (per watch, loop)
[Rec.gov API Client fetches month availability for facility]
    ↓
[Parser normalizes raw response → AvailabilitySlot[]]
    ↓
[Matcher filters slots by site-type + date-range criteria → MatchedSlot[]]
    ↓
[State Store checked: which matched slots are NOT already notified?]
    ↓ (only if new matches exist)
[Notification Sender formats + sends one summary email via Resend]
    ↓
[State Store updated: mark these (watch,site,date) as notified]
    ↓
[Orchestrator logs run result (checked N watches, M new matches, errors)]
```

### Key Data Flows

1. **Poll cycle:** Config → API → Matcher → Dedupe check → (conditionally) Email → State update. This entire cycle is idempotent-safe: running it twice in a row with no new availability produces zero emails and zero state changes.
2. **Dedupe/re-notify cadence:** The state store's dedupe key should include enough granularity to support "don't re-notify for a still-open site" while still allowing a sane re-notify cadence if desired later (e.g. re-alert after 24h if still open) — store `lastNotifiedAt` per key, not just a boolean, so this policy can be added without a schema change.
3. **Per-watch failure isolation:** Each watch's fetch/match should be wrapped so one facility's API error (bad facility ID, transient 5xx) doesn't abort the whole run — log and continue to the next watch, then report failures in the run log/email footer if desired.

## Scaling Considerations

This system is explicitly single-user and low-volume; "scaling" here means *number of watches* and *poll frequency*, not concurrent users.

| Scale | Architecture Adjustments |
|-------|---------------------------|
| 1-10 watches, poll every 5-15 min | Everything above as-is. Flat file or single KV namespace is plenty. |
| 10-50 watches, poll every 1-5 min | Watch for Recreation.gov rate limiting / IP throttling — add jitter and stagger requests rather than firing all watches in parallel. Still no DB needed. |
| Hypothetical multi-user future | Out of scope per PROJECT.md, but if ever revisited: this is the point a real DB (per-user watches, per-user state) would become justified — not before. |

### Scaling Priorities

1. **First bottleneck:** Recreation.gov rate limiting/soft-blocking if polling too many facilities too frequently from one IP — mitigate with backoff, jitter, and a reasonable minimum interval (this is an unofficial endpoint; be a polite client — see Pitfalls research).
2. **Second bottleneck (unlikely to be hit):** State store write volume — even at 50 watches × several sites × daily granularity, this is a few hundred keys at most, trivially within flat-file or free-tier KV limits.

## Anti-Patterns

### Anti-Pattern 1: Reaching for a relational database "to be safe"

**What people do:** Spin up Postgres/SQLite with a `watches`, `notifications`, `runs` schema for a system with one user and a handful of config entries.
**Why it's wrong:** Adds migration tooling, connection management, and (on serverless) a hosted-DB dependency/cost for a workload that's fundamentally a few key-value lookups. Pure overhead for this project's scale.
**Instead:** Config in a checked-in file or env var (read-only at runtime, edited by hand); dedupe state in a flat JSON file (script deploy) or a KV store (serverless deploy, chosen for the *persistence-across-invocations* problem, not for query power).

### Anti-Pattern 2: Coupling business logic to the trigger mechanism

**What people do:** Write the whole pipeline directly inside a Vercel API route handler (or directly inside a `cron` shell script), so it can only run under that one mechanism.
**Why it's wrong:** Makes the deployment-target decision (still open per PROJECT.md) expensive to change later, and makes local testing awkward (have to spin up a dev server to test business logic).
**Instead:** Keep `run()` deployment-agnostic (Pattern 1); trigger adapters are thin.

### Anti-Pattern 3: Assuming serverless functions have durable local disk

**What people do:** Write dedupe state to a JSON file on disk inside a Vercel serverless/edge function, expecting it to persist between invocations.
**Why it's wrong:** Serverless compute (Vercel Functions) is stateless between invocations; any filesystem writes (even to `/tmp`) are not guaranteed to persist to the next cron run, and often won't. This would silently break deduping (repeat-spam emails) rather than erroring loudly.
**Instead:** If deploying to Vercel, dedupe state must live in an external store (Vercel KV/Upstash Redis, or a hosted file like Vercel Blob/S3, or a hosted SQLite like Turso). If deploying as a plain script on a persistent host (VM, Raspberry Pi, always-on container) or via GitHub Actions with the state file committed back to the repo each run, a flat file is fine.

### Anti-Pattern 4: One email per matched site

**What people do:** Send a separate email for every new matching site/date found in a run.
**Why it's wrong:** A single popular campground opening up can produce many matches at once; this floods the inbox and undermines the "fast, actionable signal" goal.
**Instead:** Batch all new matches from a single run into one summary email.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|----------------------|-------|
| Recreation.gov availability (unofficial) | Direct `fetch` to `www.recreation.gov/api/camps/availability/campground/{facilityId}/month?start_date=...` | Not part of the official RIDB API; undocumented and could change without notice. This is the endpoint community tools (`camply`, `banool/recreation-gov-campsite-checker`) actually use for availability, since RIDB itself only exposes facility/campsite *metadata*, not live availability (verified via RIDB docs — availability requires auth and isn't part of RIDB proper). Flag for PITFALLS research: stability/ToS risk. |
| RIDB API (`ridb.recreation.gov/api/v1`) | Optional, for facility/campsite metadata (names, IDs, site attributes) to make emails human-readable and to resolve a park name → facility ID at config time. Free, no key required for basic use; optional key raises rate limits. | Read-only, low-volume — can even be a one-time/manual lookup rather than a per-run call. |
| Resend (or SendGrid) | Server-side SDK/HTTP call from the orchestrator after matches are found. | Single recipient (the user), so no template/audience management needed — a simple formatted HTML/text email is sufficient. |
| Vercel Cron (if chosen) | `vercel.json` `crons` array pointing at a route that calls `run()`. | Hobby plan cron jobs are capped at once/day with only hour-level timing precision — **not sufficient** for "every few minutes" polling per PROJECT.md's requirement; would require Vercel Pro (or an external cron pinger hitting the route on a tighter schedule) for real minute-level polling. This materially affects the deployment-target decision and should be resolved before/at the roadmap stage. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|----------------|-------|
| Orchestrator ↔ Rec.gov Client | Direct function call, async | Client owns retry/backoff; orchestrator just awaits normalized data or a per-watch error. |
| Orchestrator ↔ State Store | Direct function call via `StateStore` interface | Only place the storage-backend decision leaks into the pipeline; everything else is storage-agnostic. |
| Orchestrator ↔ Notification Sender | Direct function call, takes deduped matches, returns success/fail | No retry-loop needed at this scale — a failed email can just be logged and picked up next run (the match will still be "unnotified" in state). |

## Sources

- [RIDB CampsitesApi docs (ships/ridb mirror)](https://github.com/ships/ridb/blob/master/docs/CampsitesApi.md) — confirms RIDB does not expose live availability, only facility/campsite metadata (MEDIUM confidence — community mirror, not the primary ridb.recreation.gov docs, but consistent across multiple sources).
- [juftin/camply on GitHub](https://github.com/juftin/camply) — production example of the same fetch→match→notify architecture, supporting the unofficial availability endpoint and multiple notification channels (HIGH confidence — actively maintained real-world tool).
- [banool/recreation-gov-campsite-checker on GitHub](https://github.com/banool/recreation-gov-campsite-checker) — another independent implementation of the same pattern, corroborating the unofficial `api/camps/availability/campground/{id}/month` endpoint (MEDIUM-HIGH confidence).
- [Jacob Bokor — "Building a Campsite Availability notification service"](https://jacobbokor.com/posts/campsite-monitor/) — first-hand account confirming config/fetch/compare/notify component breakdown and that state-management/dedup was the most effort-intensive part (MEDIUM confidence, single blog source, but corroborates the architecture independently arrived at from other tools).
- [Vercel — "Cron jobs now support 100 per project on every plan" changelog](https://vercel.com/changelog/cron-jobs-now-support-100-per-project-on-every-plan) and [Vercel Cron Jobs usage & pricing docs](https://vercel.com/docs/cron-jobs/usage-and-pricing) — HIGH confidence, official source, confirms Hobby-plan cron jobs are capped at once-daily execution with hour-level precision, which conflicts with this project's "every few minutes" requirement if Vercel Hobby is chosen without a workaround.
- [Recreation Information Database API overview (publicapi.dev)](https://publicapi.dev/recreation-information-database-api) — MEDIUM confidence, third-party API directory, corroborates RIDB base URL and no-key-required basic access.

---
*Architecture research for: single-user scheduled-polling notification system (Recreation.gov campsite watcher)*
*Researched: 2026-08-16*
