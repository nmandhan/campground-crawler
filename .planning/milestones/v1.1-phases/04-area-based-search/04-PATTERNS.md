# Phase 4: Area-Based Search - Pattern Map

**Mapped:** 2026-08-25
**Files analyzed:** 8
**Analogs found:** 8 / 8 (all modifications to existing files — no net-new files in this phase)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/recreation-gov/client.ts` (add `resolveArea()` / `listAreaFacilities()`) | service | request-response | `resolveFacility()` in same file (lines 38-72) | exact — self-analog, same module |
| `src/recreation-gov/types.ts` (add `RidbRecAreaSchema`, `RidbRecAreaSearchSchema`, `RidbRecAreaFacilitiesSchema`) | model (zod schema) | transform | `RidbFacilitySchema`/`RidbFacilitySearchSchema` in same file (lines 24-35) | exact — self-analog, same module |
| `src/types.ts` (extend `Watch` to discriminated union, add `AreaWatch`, `facilityType` on `ResolvedWatch`) | model | transform | existing `Watch`/`ResolvedWatch`/`WatchOutcome` in same file | exact — self-analog, same module |
| `src/config/schema.ts` (migrate `WatchSchema` to `z.discriminatedUnion` + `z.preprocess`) | config/validation | transform | existing flat `WatchSchema` in same file (lines 8-21) | exact — self-analog, same module |
| `src/config/watches.ts` (`resolveWatches()` gains `type === 'area'` branch, shared cache/cap logic) | service | CRUD (resolve-at-poll-time) | `resolveWatches()`'s facility-resolution loop in same file (lines 62-118) | exact — self-analog, same module |
| `src/errors.ts` (add `RecAreaNotFoundError` or similar) | utility (error taxonomy) | — | `FacilityNotFoundError` in same file (lines 36-44) + `describeFailure()` (lines 52-69) | exact — self-analog, same module |
| `src/run.ts` (group-by-watch-id aggregation restructure) | controller/orchestrator | event-driven / batch | existing flat `for (const watch of resolved)` loop in same file (lines 60-87) | exact — self-analog, same module |
| `dashboard/lib/types.ts` + `dashboard/lib/schema.ts` (mirror `Watch` union, `MatchedSlot.facilityType`/tag) | model + validation (hand-mirrored, cross-project) | transform | existing hand-mirrored `Watch`/`WatchOutcome`/`MatchedSlotSchema` in same files | exact — self-analog, same module, cross-project mirroring convention |

**Note:** Every file in this phase is a *modification* to an existing module, not a new file — the closest analog for each is almost always the existing sibling function/type/schema in the very same file. This is the strongest possible match quality; the planner should treat "extend this file's existing pattern" as the default instruction for all 8 files.

## Pattern Assignments

### `src/recreation-gov/client.ts` — add `resolveArea()` (service, request-response)

**Analog:** `resolveFacility()`, same file, lines 38-72.

**Imports pattern** (lines 1-17, unchanged — new code goes in the same file, reuses same imports):
```typescript
import { retryWithBackoff } from './http.js';
import { fetchJson } from './http.js';
import { AvailabilityResponseSchema, RidbFacilitySearchSchema } from './types.js';
import type { RawAvailabilityResponse } from './types.js';
import { FacilityNotFoundError, ResponseSchemaError } from '../errors.js';
```
Add `RidbRecAreaSearchSchema`, `RidbRecAreaFacilitiesSchema` to the `./types.js` import; add the new error class (e.g. `RecAreaNotFoundError`) to the `../errors.js` import.

**Core request-response + zod-parse pattern to mirror exactly** (lines 38-72):
```typescript
export async function resolveFacility(parkName: string, opts?: ClientOptions): Promise<ResolvedFacility> {
  const url = new URL(`${RIDB_BASE}/facilities`);
  url.searchParams.set('query', parkName);
  url.searchParams.set('limit', '10');
  url.searchParams.set('sort', 'Name');

  const headers: Record<string, string> = {};
  if (opts?.ridbApiKey) {
    headers['apikey'] = opts.ridbApiKey;
  }

  const raw = await retryWithBackoff(
    () => fetchJson(url.toString(), { headers, fetchImpl: opts?.fetchImpl }),
    { sleep: opts?.sleep }
  );

  const parsed = RidbFacilitySearchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ResponseSchemaError(
      'RIDB facility search returned an unexpected shape',
      formatZodIssues(parsed.error.issues)
    );
  }

  const [first, ...rest] = parsed.data.RECDATA;
  if (!first) {
    throw new FacilityNotFoundError(`no RIDB facility matched "${parkName}"`, parkName);
  }

  return {
    facilityId: first.FacilityID,
    facilityName: first.FacilityName,
    alternatives: rest.map((r) => r.FacilityName),
  };
}
```
`resolveArea()` should follow this shape exactly for `GET /recareas?query={name}`, returning `{ recAreaId, recAreaName, alternatives }` (per RESEARCH.md Code Examples). A second function (e.g. `listAreaFacilities(recAreaId, opts)`) should follow the same `retryWithBackoff` + `fetchJson` + `safeParse`-or-throw shape for `GET /recareas/{RecAreaID}/facilities`, then apply the D-04 allowlist filter (substring match on `FacilityTypeDescription` containing `"Campground"`, `Reservable === true`) before returning.

**Error handling pattern** — same `ResponseSchemaError`/`formatZodIssues` reuse shown above; do not invent a new error-formatting helper.

**`createClient()` factory pattern** (lines 152-168) — add `resolveArea`/`listAreaFacilities` as additional bound methods, mirroring how `resolveFacility` is exposed:
```typescript
export function createClient(opts?: ClientOptions): {
  resolveFacility: (parkName: string) => Promise<ResolvedFacility>;
  fetchMonthAvailability: (facilityId: number, monthStart: string) => Promise<RawAvailabilityResponse>;
  fetchAvailabilityForRange: (facilityId: number, start: string, end: string) => Promise<RawAvailabilityResponse[]>;
} {
  return {
    resolveFacility: (parkName: string) => resolveFacility(parkName, opts),
    ...
  };
}
```

**No-artificial-delay note:** unlike `fetchAvailabilityForRange`'s `await sleep(1000)` between month fetches (lines 141-146), RIDB resolution calls (`resolveFacility`, and by extension `resolveArea`/`listAreaFacilities`) have no delay between them today — RESEARCH.md Pitfall 1 confirms this is safe at current scale (~35 calls/run). Do not add a sleep to the new resolution calls unless the plan explicitly decides otherwise.

---

### `src/recreation-gov/types.ts` — add RecArea schemas (model, transform)

**Analog:** `RidbFacilitySchema`/`RidbFacilitySearchSchema`, same file, lines 24-35.

**Pattern to mirror exactly:**
```typescript
export const RidbFacilitySchema = z.object({
  FacilityID: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  FacilityName: z.string(),
  FacilityTypeDescription: z.string().optional(),
  Reservable: z.boolean().optional(),
  Enabled: z.boolean().optional(),
});

export const RidbFacilitySearchSchema = z.object({
  RECDATA: z.array(RidbFacilitySchema),
  METADATA: z.unknown().optional(),
});
```
Note the `z.union([z.number(), z.string()]).transform((v) => Number(v))` coercion pattern on ID fields — RIDB sometimes returns numeric IDs as strings; every new ID field (`RecAreaID`) should use this same coercion, not a bare `z.number()`.

Add (per RESEARCH.md Code Examples, field names unverified live — flag for a fixture-capture spike as this phase's first task):
```typescript
export const RidbRecAreaSchema = z.object({
  RecAreaID: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  RecAreaName: z.string(),
});

export const RidbRecAreaSearchSchema = z.object({
  RECDATA: z.array(RidbRecAreaSchema),
  METADATA: z.unknown().optional(),
});

// Reuses RidbFacilitySchema IF the live spike confirms /recareas/{id}/facilities
// returns full Facility records (not the compact 3-field stub — see RESEARCH.md Pitfall 2).
export const RidbRecAreaFacilitiesSchema = z.object({
  RECDATA: z.array(RidbFacilitySchema),
  METADATA: z.unknown().optional(),
});
```
Export corresponding `z.infer` types the same way `RidbFacility` is exported at the bottom of the file (line 38).

---

### `src/types.ts` — discriminated-union `Watch`, `AreaWatch`, `facilityType` (model, transform)

**Analog:** existing `Watch`/`ResolvedWatch`/`WatchOutcome` interfaces, same file.

**Existing shape to extend** (lines 11-23):
```typescript
export interface Watch {
  id: string;
  parkName: string;
  facilityId?: number;      // optional explicit override (RESEARCH Pitfall 3)
  dateRange: { start: string; end: string };  // YYYY-MM-DD
  siteType: SiteType;
}

export interface ResolvedWatch extends Watch {
  facilityId: number;
  facilityName: string;
}
```
Rename this to `FacilityWatch` (add `type: 'facility'` literal), add `AreaWatch` (`type: 'area'`, `areas: Array<{ name: string; recAreaId?: number }>`), and `export type Watch = FacilityWatch | AreaWatch;` — exact shape given in RESEARCH.md Code Examples section. `ResolvedWatch` stays per-facility but gains `facilityType: 'standard' | 'group'` (D-05); it is no longer safe to `extends Watch` directly since `Watch` is now a union — model it as its own flat interface instead (mirroring how `MatchedSlot` below is already a flat, non-`extends` interface).

**`MatchedSlot`/`WatchOutcome` — attribution already present, no new field needed for AREA-05** (lines 46-62): `MatchedSlot` already carries `facilityId`/`facilityName` per match — this is the existing pattern that makes per-campground attribution "free" when aggregating an area watch's matches. `WatchOutcome`'s three-variant discriminated union (lines 59-62) is the pattern to extend if truncation metadata (D-08) is added as a new optional field — mirror the existing flat-object-per-variant style, do not introduce a class hierarchy.

---

### `src/config/schema.ts` — discriminated-union migration (config/validation, transform)

**Analog:** existing flat `WatchSchema`, same file, lines 8-21.

**Current pattern (to be split into two variants + preprocess):**
```typescript
export const WatchSchema = z.object({
  id: z.string().min(1),
  parkName: z.string().min(1),
  facilityId: z.number().int().positive().optional(), // explicit override, RESEARCH Pitfall 3
  dateRange: z
    .object({
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
    })
    .refine((r) => r.start < r.end, {
      message: 'dateRange.start must be before dateRange.end (end is the exclusive checkout date)',
    }),
  siteType: SiteTypeSchema,
});
```
Migration target (from RESEARCH.md Code Examples, already validated against this exact file's conventions):
```typescript
const FacilityWatchSchema = z.object({
  type: z.literal('facility'),
  id: z.string().min(1),
  parkName: z.string().min(1),
  facilityId: z.number().int().positive().optional(),
  dateRange: DateRangeSchema, // extract the existing dateRange object+refine into a shared const
  siteType: SiteTypeSchema,
});

const AreaWatchSchema = z.object({
  type: z.literal('area'),
  id: z.string().min(1),
  areas: z.array(z.object({
    name: z.string().min(1),
    recAreaId: z.number().int().positive().optional(),
  })).min(1),
  dateRange: DateRangeSchema,
  siteType: SiteTypeSchema,
});

export const WatchSchema = z.preprocess(
  (val) => {
    if (val && typeof val === 'object' && !('type' in val)) {
      return { ...val, type: 'facility' };
    }
    return val;
  },
  z.discriminatedUnion('type', [FacilityWatchSchema, AreaWatchSchema])
);
```
**Compile-time drift-check pattern to preserve** (lines 30-33): keep the `const _assert: Watch = {} as z.infer<typeof WatchSchema>; void _assert;` line — this is the established convention tying `schema.ts` to `types.ts`, do not drop it during the migration.

**`WatchesFileSchema`'s unique-id refine (lines 23-28) is unaffected** — operates on `.id`, shared by both variants, no change needed.

---

### `src/config/watches.ts` — `resolveWatches()` area branch + shared cache/cap (service, CRUD/resolve-at-poll-time)

**Analog:** existing facility-resolution loop, same file, lines 62-118.

**Per-run cache pattern to extend (lines 68, 85-91):**
```typescript
const cache = new Map<string, Promise<ResolvedFacility>>();
// ...
const cacheKey = watch.parkName.trim().toLowerCase();
let pending = cache.get(cacheKey);
if (!pending) {
  pending = resolve(watch.parkName, opts);
  cache.set(cacheKey, pending);
}
const facility = await pending;
```
For area watches: a sibling `Map<string, Promise<ResolvedFacility[]>>` (or a shared cache keyed by a tagged union of park/area names) keyed by `area.name.trim().toLowerCase()` or `area.recAreaId` if the override is set — caches the *resolved+filtered facility list*, not just the RecArea match (RESEARCH.md Pattern 2).

**Explicit-override escape hatch (lines 76-83) — pattern D-02 extends:**
```typescript
if (watch.facilityId !== undefined) {
  resolved.push({
    ...watch,
    facilityId: watch.facilityId,
    facilityName: watch.parkName,
  });
  continue;
}
```
For `AreaWatch.areas[].recAreaId`: only the *name-search* half should be skippable this way — the `/recareas/{id}/facilities` expansion still must run (unlike this facility override, which skips resolution entirely). Do not copy this pattern verbatim; adapt per RESEARCH.md Pattern 3's explicit note.

**Per-watch failure isolation (lines 74, 112-114) — preserve exactly:**
```typescript
for (const watch of watches) {
  try {
    // ... resolution ...
  } catch (err) {
    failures.push({ watchId: watch.id, reason: describeFailure(err) });
  }
}
```
This "a watch that fails to resolve never aborts the run for the others" convention (module doc comment, line 3) must be preserved for area watches too — one bad area name should produce a `FAILED` outcome for that watch id, not crash `resolveWatches()`.

**Logging pattern (lines 93-105)** — mirror the `loggedNames` dedup-logging convention (log once per unique resolved name, warn about `alternatives` if present) for area resolution logging.

**20-facility cap + truncation (D-07/D-08/D-09/D-10) — no existing analog in this file; new logic.** Apply after concatenating all areas' filtered facility lists for one watch (in area-list order per D-10), before pushing to `resolved`. Keep RIDB's returned order (D-09) — no sort step.

---

### `src/errors.ts` — new `RecAreaNotFoundError` (utility, error taxonomy)

**Analog:** `FacilityNotFoundError`, same file, lines 36-44, and its `describeFailure()` branch, lines 62-64.

```typescript
export class FacilityNotFoundError extends Error {
  constructor(
    message: string,
    readonly parkName: string
  ) {
    super(message);
    this.name = 'FacilityNotFoundError';
  }
}
```
```typescript
if (err instanceof FacilityNotFoundError) {
  return `no Recreation.gov facility found for "${err.parkName}"`;
}
```
Add `RecAreaNotFoundError` (or similar name, per CONTEXT.md's "Claude's discretion" on exact naming) following this exact class shape, plus a matching branch in `describeFailure()`. **Security constraint to preserve:** `describeFailure()`'s doc comment (lines 46-51) — "MUST NOT include HTTP request headers or an `apikey` value in its output" — applies identically to the new error's message.

---

### `src/run.ts` — group-by-watch-id aggregation (controller/orchestrator, batch)

**Analog:** existing flat resolution loop, same file, lines 60-87.

**Current 1:1 loop (the structural piece being replaced):**
```typescript
for (const watch of resolved) {
  try {
    const responses = await fetchRange(watch.facilityId, watch.dateRange.start, watch.dateRange.end);
    const slots = mergeSlots(...responses.map(parseAvailability));
    const matches = matchWatch(slots, watch);

    if (matches.length === 0) {
      outcomes.push({ watchId: watch.id, status: 'NO_MATCH' });
      continue;
    }

    const newMatches: MatchedSlot[] = [];
    const suppressed: MatchedSlot[] = [];
    for (const match of matches) {
      const key = dedupKey(match.watchId, match.campsiteId, match.startDate, match.endDate);
      if (store.has(key)) {
        suppressed.push(match);
      } else {
        store.markNotified(key, now());
        newMatches.push(match);
      }
    }

    outcomes.push({ watchId: watch.id, status: 'MATCH', newMatches, suppressed });
  } catch (err) {
    outcomes.push({ watchId: watch.id, status: 'FAILED', reason: describeFailure(err) });
  }
}
```
RESEARCH.md's Pattern 4 gives the exact group-then-aggregate restructure to apply (group `resolved` by `watch.id` into `Map<string, ResolvedWatch[]>` first, then iterate groups, accumulating `allMatches` across every facility in the group before doing the existing dedup-split + `outcomes.push`). Preserve the exact dedup-key call (`dedupKey(match.watchId, match.campsiteId, match.startDate, match.endDate)`, line 74) unchanged — `campsiteId` is already globally unique across facilities, confirmed safe by RESEARCH.md.

**Failure isolation — open design choice, not locked:** today's `try/catch` wraps one facility's fetch+match per watch (1:1). RESEARCH.md Open Question 3 recommends extending isolation one level deeper (one flaky facility doesn't hide matches from the rest of the area watch) but flags this as **not decided** — planner should confirm this explicitly rather than silently copying the current "whole watch fails together" semantics onto a per-facility loop.

**Logging block (lines 91-104)** — the per-outcome `logger.info`/`logger.error` formatting loop is unaffected structurally but its `resolved.find((w) => w.id === outcome.watchId)` lookup (line 98, used for night-count in `NO_MATCH` logging) will need adjustment since multiple `ResolvedWatch` entries can now share one `watchId` — use `.find()`'s first match (any facility's `dateRange` is the same across the group) or pull `dateRange` from the group directly.

**`checked: resolved.length + failures.length` (line 130)** — this count will now over-count for area watches (N facilities per watch, not 1). Flag for planner: decide whether `checked` should count watches or facilities: existing dashboard consumers may assume "checked" ~ "number of watches attempted."

---

### `dashboard/lib/types.ts` + `dashboard/lib/schema.ts` — mirror discriminated union (model + validation, transform)

**Analog:** existing hand-mirrored `Watch`, `MatchedSlot`, `WatchOutcomeSchema`, same files.

**Mirroring convention to preserve (module doc comment, `dashboard/lib/types.ts` lines 1-13):**
```
/** Local redeclarations of the poller's shared shapes.
 *  Hand-copied from the poller's `types.ts` ... this dashboard is a fully
 *  independent Next.js project ... and must never import across the `src/`
 *  <-> `dashboard/` boundary. If those source files change, these declarations
 *  must be updated together, by hand.
 */
```
When `src/types.ts`'s `Watch` becomes a discriminated union (`FacilityWatch | AreaWatch`) and `ResolvedWatch`/`MatchedSlot` gain `facilityType`, hand-copy the identical shapes into `dashboard/lib/types.ts` — do not import from `src/`.

**`dashboard/lib/schema.ts`'s existing discriminated-union pattern to mirror for `WatchOutcomeSchema`** (lines 55-64) — this file *already* has a `z.discriminatedUnion('status', [...])` for `WatchOutcome`; the same technique should be applied for the mirrored `WatchSchema`:
```typescript
export const WatchOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ watchId: z.string(), status: z.literal('MATCH'), newMatches: z.array(MatchedSlotSchema), suppressed: z.array(MatchedSlotSchema) }),
  z.object({ watchId: z.string(), status: z.literal('NO_MATCH') }),
  z.object({ watchId: z.string(), status: z.literal('FAILED'), reason: z.string() }),
]);
```
**Compile-time `_assert` drift-check convention (repeated per schema, e.g. lines 36-37, 52-53, 66-67)** — preserve one `_assert*` line per new/modified schema:
```typescript
const _assertWatch: Watch = {} as z.infer<typeof WatchSchema>;
void _assertWatch;
```
**Note on `.min(1)`/unique-id refine (comment at line 32-33):** the dashboard's mirrored `WatchesSchema` deliberately omits the poller's `.min(1)` and unique-id `.refine()` — "the dashboard is a read-only viewer and must display whatever is committed, not gate-keep it." Preserve this asymmetry; do not add strict validation to the dashboard mirror that the poller's schema has but the dashboard intentionally lacks.

**No dashboard UI rendering component exists yet for `MatchedSlot`/`WatchOutcome` display** (`grep` for `newMatches`/`MatchedSlot` under `dashboard/app` returned no results) — D-05/D-06's standard-vs-group tag has no existing render-layer analog to copy from; this confirms CONTEXT.md's framing that the dashboard *write-path UI* (including match-list rendering) is Phase 5's job, and this phase's dashboard touch is limited to `lib/types.ts`/`lib/schema.ts` type mirroring only.

---

## Shared Patterns

### Zod safeParse-before-field-access (every new RIDB response)
**Source:** `src/recreation-gov/client.ts` lines 54-60, 97-103; module doc comment lines 1-11.
**Apply to:** `resolveArea()`, `listAreaFacilities()` in `client.ts`; new schemas in `types.ts`.
```typescript
const parsed = RidbFacilitySearchSchema.safeParse(raw);
if (!parsed.success) {
  throw new ResponseSchemaError(
    'RIDB facility search returned an unexpected shape',
    formatZodIssues(parsed.error.issues)
  );
}
```

### Per-watch/per-resource failure isolation (never abort the whole run)
**Source:** `src/config/watches.ts` lines 74, 112-114 (`resolveWatches()`); `src/run.ts` lines 60-61, 84-86 (main loop).
**Apply to:** area resolution (one bad area name → `FAILED` for that watch only) and, per RESEARCH.md Open Question 3, potentially per-facility failure within an aggregated area watch in `run.ts`.
```typescript
try {
  // ... resolve or fetch+match ...
} catch (err) {
  failures.push({ watchId: watch.id, reason: describeFailure(err) }); // or outcomes.push({...status:'FAILED'...})
}
```

### Explicit-override escape hatch for a bad auto-match
**Source:** `src/config/watches.ts` lines 76-83 (`watch.facilityId`); `src/config/schema.ts` line 11.
**Apply to:** `AreaWatch.areas[].recAreaId` override (D-02) — same "trust the user's explicit ID over RIDB search" philosophy, though the mechanics differ (only skips name-search, not full resolution — see `resolveArea` pattern notes above).

### Never leak `apikey` in error messages
**Source:** `src/errors.ts` lines 46-51 (`describeFailure()` doc comment); enforced by `client.ts`'s header-only auth (line 44-47, never a query param).
**Apply to:** any new `RecAreaNotFoundError`/`ResponseSchemaError` message text.

### Hand-mirrored types/schemas across the `src/` <-> `dashboard/` boundary
**Source:** `dashboard/lib/types.ts` lines 1-13, `dashboard/lib/schema.ts` lines 1-8 (module doc comments).
**Apply to:** every `src/types.ts`/`src/config/schema.ts` change in this phase must be hand-copied into `dashboard/lib/types.ts`/`dashboard/lib/schema.ts` — no import across the boundary, ever.

### Compile-time drift-check assertions
**Source:** `src/config/schema.ts` lines 30-33; `dashboard/lib/schema.ts` lines 36-37, 52-53, 66-67, 79-80, 89-90, 97-98.
**Apply to:** every new/modified zod schema on both sides gets a matching `const _assertX: X = {} as z.infer<typeof XSchema>; void _assertX;` line.

## No Analog Found

None — every file in this phase's scope is a modification to an existing module with a directly adjacent same-file pattern to mirror (see table above). The one genuinely novel piece of logic with **no existing analog anywhere in the codebase** is the 20-facility cap + truncation bookkeeping (D-07/D-08/D-09/D-10) inside `src/config/watches.ts` — flagged above under that file's Pattern Assignment rather than in this table, since it still belongs in an existing (modified) file, just without a same-file precedent to copy.

## Metadata

**Analog search scope:** `src/recreation-gov/`, `src/config/`, `src/`, `dashboard/lib/` (all files explicitly named in CONTEXT.md's canonical_refs and RESEARCH.md's Recommended Project Structure)
**Files scanned:** `src/recreation-gov/client.ts`, `src/recreation-gov/types.ts`, `src/types.ts`, `src/config/schema.ts`, `src/config/watches.ts`, `src/errors.ts`, `src/run.ts`, `dashboard/lib/types.ts`, `dashboard/lib/schema.ts` (9 files read in full — all ≤ 170 lines, single-pass reads, no re-reads)
**Pattern extraction date:** 2026-08-25
