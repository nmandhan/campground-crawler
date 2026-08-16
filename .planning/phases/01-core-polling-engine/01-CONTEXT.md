# Phase 1: Core Polling Engine - Context

**Gathered:** 2026-08-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Given a watch config, correctly determine which watches have new matching availability on Recreation.gov, distinguish failures from genuine non-matches, and persist dedup state durably — verifiable end-to-end via CLI with fixture/live data, no deployment required. Covers WATCH-01, WATCH-02, POLL-01, POLL-02, POLL-03, POLL-04, OPS-01.

Notification delivery (real email) and scheduled deployment are Phase 2 — out of scope here.

</domain>

<decisions>
## Implementation Decisions

### Watch Configuration
- **D-01:** Watches are defined in a checked-in `watches.json` file (not env vars), validated with zod at load time. Easy to edit/diff, matches the GitHub Actions deploy model already decided in stack research.
- **D-02:** A watch specifies a park/campground by human-readable name, not a raw facility ID. The config loader resolves the name to a Recreation.gov facility ID via RIDB at load time (and should cache/memoize this resolution, since it doesn't change run to run).

### Matching Semantics
- **D-03:** A watch's date range must be available as one continuous bookable stay (start date through end date, no gaps) — not "any single open night in the range." This matches how Recreation.gov reservations actually work (a stay is a contiguous booking).
- **D-04:** Site type is expressed as a simple enum: `any | tent | rv | group`, mapped from Recreation.gov's site-type/equipment field. No need to model the full Recreation.gov equipment taxonomy.

### Error Handling & Retry Policy
- **D-05:** The Recreation.gov API client retries failed requests up to 3 times with exponential backoff (e.g. 1s, 2s, 4s) before marking that watch's check as failed for the current cycle.
- **D-06:** A failed watch check does NOT abort the whole run. Each watch is checked independently; a bad facility ID or transient error for one watch is logged and the run continues to the next watch.
- **D-07:** Since Phase 1 has no email yet, failures surface as: (a) a structured per-watch console log line (OK / NO MATCH / FAILED: reason), and (b) inclusion in the run's returned summary object — so Phase 2 can wire this into email/alerting without changing the core pipeline's shape.

### Dedup State Schema
- **D-08:** Dedup state keys are scoped per (watchId, siteId, dateRange) — e.g. `watchId:siteId:startDate:endDate`. A new site matching, or a new date range on the same site, both count as genuinely new and get notified independently. Do NOT key at the whole-watch level (would miss subsequent distinct openings).
- **D-09:** Each state entry stores `lastNotifiedAt` (a timestamp), not just a boolean. Costs nothing extra now and means the v2 re-notify-after-cooldown feature (NOTF-04) can be added later without a state-schema migration.

### Claude's Discretion
- Exact console log line formatting/wording
- Internal module/file organization within the recommended structure from ARCHITECTURE.md research
- Specific zod schema shape for watches.json (beyond the fields named above: park name, date range, site type)
- Exact retry/backoff implementation (library vs hand-rolled) — research (STACK.md) doesn't mandate a specific retry library

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Stack & Data Source
- `.planning/research/STACK.md` — recommended stack (Node/TS/tsx, zod, RIDB + undocumented availability endpoint, GitHub Actions deployment target already decided for Phase 2), rate-limit/User-Agent guidance for the availability endpoint

### Architecture
- `.planning/research/ARCHITECTURE.md` — component breakdown (config loader, API client, matcher, state store, orchestrator), recommended project structure (`src/config/`, `src/recreation-gov/`, `src/matcher/`, `src/state/`, `run.ts`, `cli.ts`), the deployment-agnostic `run()` pattern, and anti-patterns to avoid (no relational DB, no coupling business logic to trigger mechanism, no assuming serverless has durable disk)

### Pitfalls
- `.planning/research/PITFALLS.md` — duplicate/spam email risk, check-failed vs no-match conflation, rate-limit/blocking risk on the undocumented endpoint

### Requirements
- `.planning/REQUIREMENTS.md` — WATCH-01, WATCH-02, POLL-01 through POLL-04, OPS-01 are the requirements this phase must satisfy

</canonical_refs>

<code_context>
## Existing Code Insights

Greenfield project — no existing code. ARCHITECTURE.md's recommended project structure should be followed as the starting layout:

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
│   └── fileStore.ts         # flat-file JSON implementation (Phase 1 target)
├── run.ts                    # orchestrator: the one pipeline function
└── cli.ts                    # local entrypoint: `node cli.ts` calls run()
```

`notify/email.ts` and `state/kvStore.ts` (if ever needed) are Phase 2 concerns — Phase 1 only needs the file-based state store since GitHub Actions (the decided deployment target) commits state back to the repo rather than needing a KV store.

</code_context>

<specifics>
## Specific Ideas

No specific UI/output format requirements beyond what's captured above — open to standard approaches for exact log formatting and internal code organization within the recommended structure.

</specifics>

<deferred>
## Deferred Ideas

- Re-notify after cooldown (NOTF-04) — the dedup state schema (D-09, timestamp per key) is designed to support this later without migration, but the actual cooldown logic is v1.x/v2, not Phase 1.
- Flexible/nearby-date matching (WATCH-03, v2) — not discussed, out of Phase 1 scope.
- KV-based state store (`state/kvStore.ts`) — only needed if deployment target ever changes away from GitHub Actions; not built in Phase 1.

None — discussion stayed within phase scope otherwise.

</deferred>

---

*Phase: 01-core-polling-engine*
*Context gathered: 2026-08-16*
