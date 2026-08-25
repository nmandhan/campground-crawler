# Phase 1: Core Polling Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-16
**Phase:** 01-core-polling-engine
**Areas discussed:** Watch config format & fields, Matching semantics, Error handling & retry policy, Dedup state schema

---

## Watch config format & fields

| Option | Description | Selected |
|--------|-------------|----------|
| Park/campground name, resolved to facility ID | Human-readable name resolved via RIDB at config load, cached | ✓ |
| Facility ID directly | User looks up numeric facility ID themselves | |

| Option | Description | Selected |
|--------|-------------|----------|
| Checked-in watches.json | JSON file committed to repo, zod-validated | ✓ |
| Environment variable (JSON string) | Watches as JSON blob in a secret/env var | |

**User's choice:** Park/campground name resolved via RIDB + checked-in `watches.json`.
**Notes:** Matches the GitHub Actions deploy model already decided in stack research.

---

## Matching semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Any available night in range | Alert on any single open night | |
| Entire range must be available | Whole date range as one continuous stay | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Simple enum: any / tent / rv / group | Fixed set of common site-type categories | ✓ |
| "any" only for v1 | No site-type filtering at all | |

**User's choice:** Entire range must be available as a continuous stay; site type as a simple enum.

---

## Error handling & retry policy

| Option | Description | Selected |
|--------|-------------|----------|
| 3 retries, exponential backoff | 1s/2s/4s between attempts | ✓ |
| 1 retry, fixed short delay | Fail fast, rely on next poll cycle | |

| Option | Description | Selected |
|--------|-------------|----------|
| Structured console log + summary object | Per-watch status line, included in run summary | ✓ |
| Throw/exit on any failure | Whole run aborts on one watch's failure | |

**User's choice:** 3 retries with exponential backoff; failures logged per-watch and included in the run summary, without aborting the whole run.

---

## Dedup state schema

| Option | Description | Selected |
|--------|-------------|----------|
| Per (watch, site, date range) match | Precise key: watchId:siteId:startDate:endDate | ✓ |
| Per watch only | One dedup entry per whole watch | |

| Option | Description | Selected |
|--------|-------------|----------|
| Timestamp per key | Store lastNotifiedAt, supports future re-notify | ✓ |
| Boolean only | Simplest possible, no future extensibility | |

**User's choice:** Key scoped to (watch, site, date range); value is a timestamp (`lastNotifiedAt`) per key.

---

## Claude's Discretion

- Exact console log line formatting/wording
- Internal module/file organization within the recommended structure from ARCHITECTURE.md
- Specific zod schema shape for watches.json beyond the named fields
- Exact retry/backoff implementation (library vs hand-rolled)

## Deferred Ideas

- Re-notify after cooldown (NOTF-04, v1.x) — schema supports it, logic deferred
- Flexible/nearby-date matching (WATCH-03, v2)
- KV-based state store — only if deployment target ever changes from GitHub Actions
