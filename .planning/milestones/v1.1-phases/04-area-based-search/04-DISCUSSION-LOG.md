# Phase 4: Area-Based Search - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-25
**Phase:** 04-area-based-search
**Areas discussed:** Area resolution method, Facility type filtering strictness, Facility cap & truncation, Multi-area watch cap semantics

---

## Area Resolution Method

| Option | Description | Selected |
|--------|-------------|----------|
| RecArea entity | Query `/recareas?query=name` → `RecAreaID` → `/recareas/{id}/facilities`. Matches RIDB's actual data model and the "named area" requirement wording. | ✓ |
| Geo radius (lat/long + miles) | `/facilities?latitude=&longitude=&radius=`, as ARCHITECTURE.md originally proposed. | |
| Both, area type decides | Support both subtypes in the schema. | |

**User's choice:** RecArea entity.
**Notes:** This directly contradicted the research doc's (ARCHITECTURE.md) primary recommendation of lat/long+radius search — flagged during analysis because REQUIREMENTS.md already deferred lat/long+radius to v2 as AREA-06 (RIDB lat/long data flagged unreliable), which corroborates the RecArea approach.

**Follow-up — ambiguous match handling:**

| Option | Description | Selected |
|--------|-------------|----------|
| Same pattern as facilities | Auto-pick top match, record alternatives, allow explicit `recAreaId` override — mirrors existing `Watch.facilityId` pattern. | ✓ |
| Fail closed on ambiguity | Treat multiple close-scoring matches as unresolved/error, force explicit ID. | |

**User's choice:** Same pattern as facilities.

---

## Facility Type Filtering Strictness

| Option | Description | Selected |
|--------|-------------|----------|
| Standard + group campgrounds | Include both; exclude non-campground types (visitor centers, boat ramps, day-use, ranger stations); reservable-only. | ✓ (with addition) |
| Standard campgrounds only | Same exclusions, plus exclude group campgrounds entirely. | |

**User's choice:** Standard + group campgrounds — "but I want to clearly identify if it is a standard or group site; I will likely mostly be using sites for 1-2 tents, so group campgrounds will be a rare occurrence."
**Notes:** User's primary use case is 1-2 tent sites; a group-campground match must be clearly tagged so it isn't confused with a real small-site opening.

**Follow-up — where the type tag surfaces:**

| Option | Description | Selected |
|--------|-------------|----------|
| Match output only | Notification/dashboard shows matched campground + standard-vs-group tag. Full resolved list not shown anywhere yet (that's Phase 5 MGMT-05). | ✓ |
| Match output + run history | Same, plus full resolved facility list (with tags) logged to `runs.json` every cycle. | |

**User's choice:** Match output only.

---

## Facility Cap & Truncation

**Cap size:**

| Option | Description | Selected |
|--------|-------------|----------|
| 20 | Middle of the 15-25 requirement range. | ✓ |
| 15 | Conservative end. | |
| 25 | Generous end. | |

**User's choice:** 20.

**Truncation UX:**

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard + run history | Visible truncation indicator in match output/dashboard, plus logged in `runs.json`. Satisfies roadmap success criterion #3. | ✓ |
| Silent log only | Recorded in `runs.json`/logs only, no user-facing indicator. | |

**User's choice:** Dashboard + run history.

**Drop order when over cap:**

| Option | Description | Selected |
|--------|-------------|----------|
| RIDB's returned order | Keep first N in API response order, drop the rest. No extra sorting logic. | ✓ |
| Alphabetical by name | Sort before capping for stable/predictable inclusion. | |

**User's choice:** RIDB's returned order.

---

## Multi-Area Watch Cap Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Shared across the whole watch | Total across all areas in one watch caps at 20 — matches AREA-02's "combined facility count" wording. | ✓ |
| Per-area cap | Each area gets its own 20-facility allowance (up to 60 for a 3-area watch). | |

**User's choice:** Shared across the whole watch.

---

## Claude's Discretion

- Exact resolver code structure, cache-key normalization for multi-area watches, `run.ts` aggregation mechanics (architecture direction already specified in ARCHITECTURE.md, only the RecArea-vs-geo swap changes).
- Order in which multiple areas within one watch are resolved/capped when the shared cap is hit.
- Exact error-type naming and new zod schema field names for the `AreaWatch` variant.

## Deferred Ideas

None — discussion stayed within phase scope.
