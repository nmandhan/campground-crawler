# Phase 1: Core Polling Engine - Pattern Map

**Mapped:** 2026-08-16
**Files analyzed:** 10
**Analogs found:** 0 / 10

## Project Status: Greenfield (No Existing Code)

This is the first phase of a brand-new project. Verified via directory listing:

```
/Users/namanshomefolder/Documents/campground-crawler
├── .claude/
├── .git/
├── .planning/     (docs only — PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md,
│                    config.json, phases/01-core-polling-engine/*, research/*)
└── CLAUDE.md
```

No `src/`, `package.json`, `tsconfig.json`, or any `.ts`/`.js` source files exist anywhere in the repo. There is nothing to search for analogs against — **every file in this phase's scope has no existing codebase analog.** This is expected and correct for Phase 1 of a greenfield project; do not fabricate analogs.

Because there are no in-repo patterns to copy, the planner should treat **RESEARCH.md's "Code Examples" and "Architecture Patterns" sections** as the primary source of concrete patterns for this phase (cited below per file). Future phases (2+) will have real analogs to map once Phase 1 code exists.

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|-----------------|----------------|
| `package.json` | config | — | none | no analog (greenfield) |
| `tsconfig.json` | config | — | none | no analog (greenfield) |
| `watches.json` (example/fixture) | config | file-I/O | none | no analog (greenfield) |
| `src/config/watches.ts` | config/service | file-I/O + request-response | none | no analog (greenfield) |
| `src/recreation-gov/client.ts` | service | request-response | none | no analog (greenfield) |
| `src/recreation-gov/types.ts` | model | transform | none | no analog (greenfield) |
| `src/recreation-gov/parse.ts` | utility | transform | none | no analog (greenfield) |
| `src/matcher/match.ts` | utility | transform | none | no analog (greenfield) |
| `src/state/store.ts` | model (interface) | CRUD | none | no analog (greenfield) |
| `src/state/fileStore.ts` | service | CRUD + file-I/O | none | no analog (greenfield) |
| `src/run.ts` | service (orchestrator) | event-driven / batch | none | no analog (greenfield) |
| `src/cli.ts` | controller (entrypoint) | request-response | none | no analog (greenfield) |

## Pattern Assignments

Since no in-repo analogs exist, each entry below cites the RESEARCH.md example to follow instead of an analog file/line-range.

### `package.json` / `tsconfig.json` (config)

**Source:** `.planning/phases/01-core-polling-engine/01-RESEARCH.md`, "Code Examples" section, "Minimal `package.json` scripts + `tsconfig.json` for a tsx-run CLI" (research lines ~317-353)

```json
{
  "type": "module",
  "scripts": {
    "start": "tsx src/cli.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "zod": "^4.4.3" },
  "devDependencies": {
    "typescript": "^7.0.2",
    "tsx": "^4.23.12",
    "@types/node": "^26.2.0"
  }
}
```
```jsonc
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

Re-verify exact version pins at implementation time (research flags npm registry moves fast — versions were current as of 2026-08-16 research date, not guaranteed current at execution time).

---

### `src/config/watches.ts` (config/service, file-I/O + request-response)

**Source:** RESEARCH.md "zod schema pattern for `watches.json`" (lines ~356-378) + "Pattern 1: RIDB name-to-facility-ID resolution" (lines ~165-196)

**Validation schema pattern:**
```typescript
import { z } from 'zod';

const SiteType = z.enum(['any', 'tent', 'rv', 'group']);

const WatchSchema = z.object({
  id: z.string().min(1),
  parkName: z.string().min(1),
  dateRange: z.object({
    start: z.string().date(),
    end: z.string().date(),
  }).refine((r) => r.start < r.end, { message: 'start must be before end' }),
  siteType: SiteType,
});

const WatchesFileSchema = z.array(WatchSchema).min(1);
export type Watch = z.infer<typeof WatchSchema>;
```

**Name-to-facility-ID resolution (memoized, RIDB `query` search):**
```typescript
const RIDB_BASE = 'https://ridb.recreation.gov/api/v1';

async function resolveFacilityId(parkName: string, apiKey?: string): Promise<number> {
  const url = new URL(`${RIDB_BASE}/facilities`);
  url.searchParams.set('query', parkName);
  url.searchParams.set('limit', '10');
  url.searchParams.set('sort', 'Name');

  const res = await fetch(url, { headers: apiKey ? { apikey: apiKey } : {} });
  if (!res.ok) throw new Error(`RIDB facility search failed: ${res.status}`);
  const data = await res.json();
  const match = data.RECDATA?.[0];
  if (!match) throw new Error(`No RIDB facility found for "${parkName}"`);
  return match.FacilityID as number;
}
```

**Notes for planner:** memoize per unique park name for the process lifetime (D-02); log resolved `FacilityID`/`FacilityName`/`RecAreaName` at load time so ambiguous name collisions are visible (Pitfall 3); distinguish `RECDATA: []` (config problem — fail loudly, no facility found) from non-2xx HTTP (check-failed-style problem) per Open Question 2.

---

### `src/recreation-gov/client.ts` (service, request-response)

**Source:** RESEARCH.md "Pattern 2: Undocumented availability endpoint fetch + normalize" (lines ~198-244) + "Retry/backoff helper matching D-05 exactly" (lines ~380-401)

**Fetch pattern with required headers (avoid Pitfall 2 — silent 403 from generic UA):**
```typescript
const AVAILABILITY_BASE = 'https://www.recreation.gov/api/camps/availability/campground';

async function fetchMonthAvailability(facilityId: number, monthStart: Date): Promise<RawAvailabilityResponse> {
  const startDate = monthStart.toISOString().slice(0, 8) + '01T00:00:00.000Z';
  const url = `${AVAILABILITY_BASE}/${facilityId}/month?start_date=${startDate}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Referer': 'https://www.recreation.gov/',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Availability fetch failed: ${res.status} ${res.statusText}`);
  return res.json();
}
```

**Retry/backoff helper (shared across RIDB and availability clients, D-05: 3 retries, exponential backoff 1s/2s/4s):**
```typescript
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
      const delay = baseMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
```

**Error handling notes:** explicitly check `res.ok` and `Content-Type` before calling `res.json()` — surface "got HTML instead of JSON, likely blocked" as a distinct diagnosable error from a generic parse failure (Pitfall 2). Only HTTP-level failures (non-2xx, network error, JSON parse failure) count as "check failed" per D-07/POLL-04 — never a specific status string.

---

### `src/recreation-gov/types.ts` (model, transform)

**Source:** RESEARCH.md "Pattern 2" response shape documentation (lines ~228-243)

```typescript
// Confirmed response shape (fields per campsite entry, keyed by numeric campsite ID as object key):
// {
//   "campsites": {
//     "12345": {
//       "availabilities": { "2026-09-01T00:00:00Z": "Available", ... },
//       "campsite_type": "STANDARD NONELECTRIC" | "RV NONELECTRIC" | "GROUP STANDARD AREA NONELECTRIC" | ...,
//       "type_of_use": "Overnight" | "Day",
//       "loop": "Loop A",
//       "site": "012",
//       "min_num_people": 1,
//       "max_num_people": 8
//     }
//   }
// }
```

Define zod schemas for this shape (and the RIDB `RECDATA`/`METADATA` envelope) so both external API responses are validated at the boundary — per Security Domain V5 in RESEARCH.md, fail loudly on schema mismatch rather than optimistically accessing fields.

---

### `src/recreation-gov/parse.ts` (utility, transform)

**Source:** RESEARCH.md Pitfall 1 + Pattern 2 status vocabulary discussion (lines ~244-246, 286-291)

Status vocabulary observed: `Available`, `Reserved`, `Not Available`, `Not Reservable`, `Not Reservable Management`, `Not Available Cutoff`, `Lottery`, `NYR`, `Open`, `Closed`. **Use an allowlist, not a denylist** — only `status === 'Available'` is bookable. Normalize raw `campsites` object into `AvailabilitySlot[]` with a stable shape decoupled from upstream field-name churn.

---

### `src/matcher/match.ts` (utility, transform)

**Source:** RESEARCH.md "Pattern 3: Site-type mapping" (lines ~248-266) + D-03 contiguous-range semantics (CONTEXT.md)

```typescript
function mapSiteType(campsiteType: string): 'any' | 'tent' | 'rv' | 'group' | 'unknown' {
  const t = campsiteType.toUpperCase();
  if (t.includes('GROUP')) return 'group';
  if (t.includes('RV') || t.includes('TRAILER')) return 'rv';
  if (t.includes('TENT') || t.includes('WALK')) return 'tent';
  return 'unknown';
}
```

Pure function `(slots, watch) => MatchedSlot[]`: must check the watch's full date range is contiguously `Available` (no gaps) per D-03 — not "any single open night." No I/O; easily unit-tested with fixtures per ARCHITECTURE.md.

---

### `src/state/store.ts` + `src/state/fileStore.ts` (model/service, CRUD + file-I/O)

**Source:** CONTEXT.md D-08/D-09 (dedup key schema) + code_context recommended structure

Dedup keys scoped per `(watchId, siteId, dateRange)` — e.g. `watchId:siteId:startDate:endDate`. Each entry stores `lastNotifiedAt` timestamp (not just boolean) to support future re-notify-after-cooldown without a schema migration. `StateStore` interface: `get`/`set`/`has`; `fileStore.ts` implements it as flat-file JSON, since GitHub Actions (Phase 2's deployment target) commits state back to the repo rather than needing a KV store. No existing analog for this state-persistence shape in the repo.

---

### `src/run.ts` (orchestrator, event-driven/batch)

**Source:** ARCHITECTURE.md's `run()` pattern (referenced in CONTEXT.md canonical_refs) + RESEARCH.md System Architecture Diagram (lines ~109-143) + D-06/D-07 (per-watch isolation, structured summary)

Deployment-agnostic single pipeline function: loop over watches, each watch checked independently (try/catch isolation per watch — a bad facility ID or transient error must not abort the run per D-06). Returns a structured summary object `{ checked, matched, failed[], noMatch[] }` and emits per-watch console log lines (OK / NO MATCH / FAILED: reason) per D-07, so Phase 2 can wire email without changing this function's shape.

---

### `src/cli.ts` (controller/entrypoint, request-response)

**Source:** ARCHITECTURE.md's thin trigger-adapter pattern (CONTEXT.md canonical_refs, code_context)

Thin local entrypoint that calls `run()` — no business logic here, just wiring so the same `run()` works identically whether invoked by GitHub Actions (Phase 2) or locally via `tsx src/cli.ts`.

## Shared Patterns

### Retry/Backoff (D-05)
**Source:** RESEARCH.md "Retry/backoff helper matching D-05 exactly" (see `client.ts` section above)
**Apply to:** Both RIDB facility-resolution calls and availability-endpoint calls in `src/recreation-gov/client.ts` — single shared helper, not duplicated per call site (per RESEARCH.md "Don't Hand-Roll" table).

### External Response Validation (zod)
**Source:** RESEARCH.md Security Domain V5 + zod schema pattern
**Apply to:** `src/config/watches.ts` (watches.json), `src/recreation-gov/types.ts` (RIDB + availability responses) — validate at the boundary, fail loudly (throw) on schema mismatch, let per-watch try/catch in `run.ts` catch it.

### Per-Watch Failure Isolation (D-06)
**Source:** CONTEXT.md D-06/D-07
**Apply to:** `src/run.ts` — every watch's check wrapped independently; one watch's failure logs + is recorded in the summary but does not stop the loop.

### Structured Console Logging (D-07)
**Source:** CONTEXT.md D-07 (exact wording left to Claude's discretion)
**Apply to:** `src/run.ts` — one line per watch: OK / NO MATCH / FAILED: reason.

## No Analog Found

All files in this phase have no in-repo analog (confirmed greenfield project, no `src/` directory exists). Planner should use RESEARCH.md's Code Examples and Architecture Patterns sections (cited per-file above) as the pattern source instead.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `package.json` | config | — | No existing package.json in repo |
| `tsconfig.json` | config | — | No existing tsconfig in repo |
| `src/config/watches.ts` | config/service | file-I/O + request-response | No `src/` exists yet |
| `src/recreation-gov/client.ts` | service | request-response | No `src/` exists yet |
| `src/recreation-gov/types.ts` | model | transform | No `src/` exists yet |
| `src/recreation-gov/parse.ts` | utility | transform | No `src/` exists yet |
| `src/matcher/match.ts` | utility | transform | No `src/` exists yet |
| `src/state/store.ts` | model | CRUD | No `src/` exists yet |
| `src/state/fileStore.ts` | service | CRUD + file-I/O | No `src/` exists yet |
| `src/run.ts` | service | event-driven/batch | No `src/` exists yet |
| `src/cli.ts` | controller | request-response | No `src/` exists yet |

## Metadata

**Analog search scope:** Entire repository (`/Users/namanshomefolder/Documents/campground-crawler`) — confirmed via `ls`/`find`, only `.claude/`, `.git/`, `.planning/`, `CLAUDE.md` exist. No `src/`, `package.json`, or source files of any kind.
**Files scanned:** 0 source files (none exist)
**Pattern extraction date:** 2026-08-16
