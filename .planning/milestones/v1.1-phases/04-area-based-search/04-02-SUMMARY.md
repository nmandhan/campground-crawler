---
phase: 04-area-based-search
plan: 02
subsystem: config-types
tags: [types, zod, watches-schema, discriminated-union]
requires: []
provides:
  - "Watch discriminated union (FacilityWatch | AreaWatch) in src/types.ts"
  - "WatchSchema backward-compatible zod migration in src/config/schema.ts"
  - "ResolvedWatch.facilityType, MatchedSlot.facilityType, WatchOutcome.truncated/facilityFailures"
affects:
  - src/config/watches.ts (Watch/ResolvedWatch consumer — type errors expected, fixed in 04-05/04-06)
  - src/run.ts (WatchOutcome consumer — type errors expected, fixed in 04-05/04-06)
  - src/matcher/match.ts (MatchedSlot producer — type errors expected, fixed in 04-05/04-06)
tech-stack:
  added: []
  patterns:
    - "z.preprocess + z.discriminatedUnion for backward-compatible zod schema migration"
key-files:
  created: []
  modified:
    - src/types.ts
    - src/config/schema.ts
    - src/config/schema.test.ts
    - watches.example.json
decisions:
  - "ResolvedWatch is now flat (no `extends Watch`) since Watch became a union — confirmed safe by grep: only id/dateRange/siteType/facilityId/facilityName were ever read off it"
  - "truncated and facilityFailures are optional on ALL THREE WatchOutcome variants (not just MATCH) because truncation/per-facility failure can occur alongside a NO_MATCH cycle too"
metrics:
  duration: "~15 minutes"
  completed: 2026-08-25
---

# Phase 4 Plan 2: Watch Discriminated Union Summary

Turned `Watch` into a `FacilityWatch | AreaWatch` discriminated union across `src/types.ts` and the
`watches.json` zod schema (`src/config/schema.ts`), with a `z.preprocess` migration step so existing
hand-written `watches.json` entries with no `type` field keep loading as `facility` watches unchanged.

## What Was Built

**Task 1 — `src/types.ts`:**
- `FacilityWatch` (`type: 'facility'`) — the v1.0 single-campground shape, unchanged fields otherwise.
- `AreaWatch` (`type: 'area'`) — `areas: Array<{ name: string; recAreaId?: number }>` plus shared
  `id`/`dateRange`/`siteType`.
- `Watch = FacilityWatch | AreaWatch`.
- `ResolvedWatch` is now flat (no `extends Watch`): `{ id, facilityId, facilityName, facilityType,
  dateRange, siteType }`. `facilityType: 'standard' | 'group'` is the new D-05 field.
- `MatchedSlot` gained `facilityType: 'standard' | 'group'`, placed directly after `facilityName`.
- `WatchOutcome`'s three variants (`MATCH`/`NO_MATCH`/`FAILED`) each gained two new **optional**
  fields: `truncated?: TruncationInfo` and `facilityFailures?: FacilityFailure[]`.
- New exported interfaces: `TruncationInfo { requested: number; kept: number }` and
  `FacilityFailure { facilityId: number; facilityName: string; reason: string }`.

**Task 2 — `src/config/schema.ts`:**
- Extracted `DateRangeSchema` as a shared module-level const (regex + refine message preserved
  character-for-character).
- Added exported `FacilityWatchSchema` and `AreaWatchSchema` (the latter with `.min(1, 'an area watch
  must list at least one area')` on `areas`, and `recAreaId: z.number().int().positive().optional()`).
- `WatchSchema` is now `z.preprocess(...)` wrapping `z.discriminatedUnion('type', [FacilityWatchSchema,
  AreaWatchSchema])`. The preprocess step only injects `type: 'facility'` when the input is a
  non-null, non-array object lacking a `type` key — hostile arrays/primitives fall through to the
  union and get rejected rather than silently coerced.
- `WatchesFileSchema` untouched (operates on `.id`, shared by both variants).
- `_assert: Watch = {} as z.infer<typeof WatchSchema>` drift-check line preserved verbatim.
- `watches.example.json` now documents all three example watches: two `type: "facility"` (the
  original two, now explicitly typed) and one new `type: "area"` (`sierra-forests`, two areas, one
  with an explicit `recAreaId`).
- `schema.test.ts` gained 8 new test cases covering: type-less migration, explicit `type: 'facility'`
  with `facilityId` override, valid area watch, empty `areas` rejection (checks the exact message),
  blank area name rejection, negative `recAreaId` rejection, area-watch date-order rejection (checks
  the exclusive-checkout message), and duplicate ids across mixed facility/area variants.

## Verification

- `npx tsc --noEmit`: zero errors in `src/types.ts` and `src/config/schema.ts`. Errors remain (as
  expected per plan) in `src/config/watches.ts`, `src/run.ts`, `src/matcher/match.ts`,
  `src/config/watches.test.ts`, `src/matcher/match.test.ts`, `src/notify/email.test.ts`,
  `src/run.test.ts`, and `src/runSummaryFile.test.ts` — these are fixed by plans 04-05 and 04-06 which
  wire the new fields into the resolver/matcher/notifier.
- `npm test`: 169/169 passing, including all new `schema.test.ts` cases.
- All grep-based acceptance criteria from the plan verified directly (union export, literal type
  tags, `areas` shape, `facilityType` present on both `ResolvedWatch` and `MatchedSlot`,
  `TruncationInfo`/`FacilityFailure` exported, flat `ResolvedWatch`, preprocess guard, area-watch
  min-length message, `_assert` line, `watches.json must contain at least one watch` message
  preserved, `"type": "area"` present in the example file).

## Exact Field Names for Downstream Plans (04-04, 04-05, 04-06)

```typescript
// src/types.ts
export interface FacilityWatch {
  type: 'facility';
  id: string;
  parkName: string;
  facilityId?: number;
  dateRange: { start: string; end: string };
  siteType: SiteType;
}

export interface AreaWatch {
  type: 'area';
  id: string;
  areas: Array<{ name: string; recAreaId?: number }>;
  dateRange: { start: string; end: string };
  siteType: SiteType;
}

export type Watch = FacilityWatch | AreaWatch;

export interface ResolvedWatch {
  id: string;
  facilityId: number;
  facilityName: string;
  facilityType: 'standard' | 'group';
  dateRange: { start: string; end: string };
  siteType: SiteType;
}

export interface TruncationInfo {
  requested: number;
  kept: number;
}

export interface FacilityFailure {
  facilityId: number;
  facilityName: string;
  reason: string;
}

// WatchOutcome: 'truncated?: TruncationInfo' and 'facilityFailures?: FacilityFailure[]'
// are present (optional) on ALL THREE of MATCH / NO_MATCH / FAILED.

// MatchedSlot gained: facilityType: 'standard' | 'group' (after facilityName)
```

```typescript
// src/config/schema.ts — exported schema symbols downstream plans can import
export const FacilityWatchSchema = z.object({ ... }); // type: z.literal('facility')
export const AreaWatchSchema = z.object({ ... });      // type: z.literal('area')
export const WatchSchema = z.preprocess(..., z.discriminatedUnion('type', [FacilityWatchSchema, AreaWatchSchema]));
```

## Deviations from Plan

None — plan executed exactly as written. Both tasks matched their `<action>` blocks verbatim
(the plan supplied exact code); the only judgment calls were in the new test case bodies for Task 2,
which follow the existing `node:test` style in `schema.test.ts`.

## Self-Check: PASSED

- FOUND: src/types.ts
- FOUND: src/config/schema.ts
- FOUND: src/config/schema.test.ts
- FOUND: watches.example.json
- FOUND commit: 429c861 (feat(04-02): extend src/types.ts to the Watch discriminated union)
- FOUND commit: caf821a (feat(04-02): migrate WatchSchema to a preprocessed discriminated union)
