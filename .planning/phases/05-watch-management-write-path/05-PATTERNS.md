# Phase 5: Watch-Management Write Path - Pattern Map

**Mapped:** 2026-08-26
**Files analyzed:** 16 (new + modified)
**Analogs found:** 14 / 16

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `dashboard/lib/github-write.ts` | service | request-response (GET-sha/PUT + 409-retry) | `dashboard/lib/github.ts` | role-match (read-only analog, house style) |
| `dashboard/lib/ridb.ts` | service | request-response (external API proxy) | `src/recreation-gov/client.ts` + `src/recreation-gov/types.ts` | exact (pattern to hand-duplicate) |
| `dashboard/lib/session.ts` | utility | request-response (cookie sign/verify) | none in codebase | no analog — see below |
| `dashboard/lib/schema.ts` (MODIFIED — add strict write schema) | model/validation | CRUD | `src/config/schema.ts` (strict) vs. existing `dashboard/lib/schema.ts` (loose) | exact |
| `dashboard/app/api/session/route.ts` | controller/route | request-response | none (first Route Handler in dashboard) | role-match via RESEARCH.md Pattern 2 code example |
| `dashboard/app/api/watches/route.ts` | controller/route | CRUD (create) | `dashboard/lib/github-write.ts` (its own new service) + `dashboard/lib/schema.ts` strict schema | role-match (compose from two new modules) |
| `dashboard/app/api/watches/[id]/route.ts` | controller/route | CRUD (edit/delete) | same as above | role-match |
| `dashboard/app/api/ridb/recareas/route.ts` | controller/route | request-response (proxy) | `dashboard/lib/ridb.ts`'s `searchRecAreas` | exact |
| `dashboard/app/api/ridb/recareas/[id]/facilities/route.ts` | controller/route | request-response (proxy) | `dashboard/lib/ridb.ts`'s `listAreaFacilities` | exact |
| `dashboard/proxy.ts` | middleware | request-response (gate) | none in codebase (net-new concept) | no analog — RESEARCH.md Pattern 2 code example is the source |
| `dashboard/app/page.tsx` (MODIFIED) | component (Server Component) | request-response | itself (unchanged parts) + `dashboard/app/sections.tsx` | exact (extend, don't replace) |
| `dashboard/app/watches/watch-manager.tsx` | component (Client) | CRUD orchestration | `dashboard/app/sections.tsx` (presentational style) — but this one needs `'use client'` + state, no existing analog | partial |
| `dashboard/app/watches/watch-form.tsx` | component (Client) | CRUD (create/edit form) | none — net-new interactive surface | no analog |
| `dashboard/app/watches/area-typeahead.tsx` | component (Client) | streaming/debounced request-response | none — net-new | no analog |
| `dashboard/app/watches/area-preview.tsx` | component (Client) | request-response (auto-fetch) | none — net-new, but consumes same `AreaFacility`-shaped data as `derive-active-matches.ts`'s `[GROUP]` tag convention | partial |
| `dashboard/app/watches/unlock-prompt.tsx` | component (Client) | request-response (form POST) | none — net-new | no analog |
| `dashboard/lib/copy.ts` (MODIFIED — add new COPY keys) | config/constants | — | itself, existing file | exact |
| `dashboard/app/globals.css` (MODIFIED — add new classes, no new tokens) | config/styles | — | itself, existing file | exact |

## Pattern Assignments

### `dashboard/lib/github-write.ts` (service, CRUD via GitHub Contents API)

**Analog:** `dashboard/lib/github.ts` (read-only sibling — same module, same house style, opposite verb)

**Doc-comment convention** (github.ts lines 1-6):
```typescript
/** Request-time fetch of the poller's committed JSON from GitHub raw content (D-03).
 *
 *  raw.githubusercontent.com, not the Contents API: CDN-backed, no base64 decode step, and not
 *  subject to the 60 req/hr unauthenticated Contents API cap. The repo is public (D-04) so no
 *  token is involved — this module must never read a credential.
 */
```
`github-write.ts` must open with an equivalent doc comment explaining *why* it uses the authenticated Contents API (not raw.githubusercontent.com): because it needs to PUT, and PUT requires the GitHub PAT — the mirror-image rationale to github.ts's "no token is involved."

**Discriminated, non-throwing result pattern** (github.ts lines 13, 17-34):
```typescript
export type FetchResult = { ok: true; data: unknown } | { ok: false; error: string };

/** Never throws. Returns a discriminated result so page.tsx renders the UI-SPEC "Unable to load
 *  dashboard data" copy instead of 500-ing the whole page (RESEARCH.md Security Domain, V5). */
export async function fetchJson(file: DataFile): Promise<FetchResult> {
  try {
    const res = await fetch(`${RAW_BASE}/${file}`, { next: { revalidate: 30 } });
    if (!res.ok) return { ok: false, error: `${file}: HTTP ${res.status}` };
    return { ok: true, data: (await res.json()) as unknown };
  } catch (err) {
    return { ok: false, error: `${file}: ${err instanceof Error ? err.message : String(err)}` };
  }
}
```
`github-write.ts`'s `getWatchesFile`/`putWatchesFile` must follow this exact never-throws + discriminated-result shape. RESEARCH.md's "Pattern 1" code example (see 05-RESEARCH.md lines 218-258) is the concrete shape to implement — it already matches this house style (result types `{ watches, sha } | { error }` and `{ ok: true } | { ok: false; conflict; error }`). Use `Bearer ${process.env.GITHUB_WRITE_TOKEN}` (new env var, not yet in `.env.example` — add it), `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `cache: 'no-store'` on GET (never serve a stale sha for a write).

**Allowlist convention** (github.ts lines 9-11):
```typescript
/** Files this dashboard is allowed to fetch. An allowlist, not a free-form path parameter... */
export type DataFile = 'watches.json' | 'state.json' | 'runs.json';
```
`github-write.ts` needs no allowlist type (it only ever writes `watches.json`) but should hardcode the path the same explicit way, not accept a path parameter — mirrors the "not a general-purpose proxy" threat reasoning (T-03-05).

**409-retry caller pattern** (from 05-RESEARCH.md, not yet in codebase): "fetch sha → apply diff → PUT → on conflict, re-fetch sha and re-apply diff → PUT again (one retry only)" — bounded, single retry, per PITFALLS.md Pitfall 3. This retry bound mirrors the *shape* (not the code) of `src/recreation-gov/http.ts`'s `retryWithBackoff` — bounded attempts, no infinite loop — but must NOT reuse that module (it's `src/`-side, cross-boundary import is forbidden by convention).

---

### `dashboard/lib/ridb.ts` (service, request-response proxy to RIDB)

**Analog:** `src/recreation-gov/client.ts` (`resolveArea`, `listAreaFacilities`) + `src/recreation-gov/types.ts` (`RidbRecAreaSchema`, `RidbRecAreaSearchSchema`, `RidbRecAreaFacilitiesSchema`)

**Doc-comment / no-env-read convention** (client.ts lines 1-11):
```typescript
/** RIDB facility resolution + Recreation.gov monthly availability fetch.
 *
 *  Every outbound request goes through retryWithBackoff(() => fetchJson(...))
 *  from ./http.js — no bare `fetch` calls in this module. Every response is
 *  zod-parsed before any field access (T-02-04).
 *
 *  This module intentionally never reads environment variables directly — the
 *  RIDB API key is read by the config loader (plan 04) and passed in via
 *  ClientOptions, so this module stays trivially testable...
 */
```
`dashboard/lib/ridb.ts` should mirror the zod-parse-before-field-access discipline but MAY read `process.env.RIDB_API_KEY` directly (unlike `src/`'s client.ts) since the dashboard has no separate config-loader layer — RESEARCH.md's own code example (lines 317-347) does this directly. Mark the file `import 'server-only'` at the top (RESEARCH.md Pitfall 2) — this is the one deviation from the src/ analog, and it's load-bearing: it must never be importable from a `'use client'` component.

**Area search pattern** (client.ts lines 106-139):
```typescript
export async function resolveArea(areaName: string, opts?: ClientOptions): Promise<ResolvedRecArea> {
  const url = new URL(`${RIDB_BASE}/recareas`);
  url.searchParams.set('query', areaName);
  url.searchParams.set('limit', '10');
  const headers: Record<string, string> = {};
  if (opts?.ridbApiKey) headers['apikey'] = opts.ridbApiKey;
  const raw = await retryWithBackoff(() => fetchJson(url.toString(), { headers, fetchImpl: opts?.fetchImpl }), { sleep: opts?.sleep });
  const parsed = RidbRecAreaSearchSchema.safeParse(raw);
  if (!parsed.success) throw new ResponseSchemaError(...);
  const [first, ...rest] = parsed.data.RECDATA;
  if (!first) throw new RecAreaNotFoundError(...);
  return { recAreaId: first.RecAreaID, recAreaName: first.RecAreaName, alternatives: rest.map((r) => r.RecAreaName) };
}
```
`dashboard/lib/ridb.ts`'s `searchRecAreas(query)` must mirror this shape but return a discriminated non-throwing result (dashboard house style, per github.ts) instead of throwing — RESEARCH.md's own example already does this correctly (05-RESEARCH.md lines 333-347): `{ ok: true; areas: {...}[] } | { ok: false; error: string }`. Use a plain `fetch` (dashboard has no `retryWithBackoff`/`fetchJson` helper — don't import `src/recreation-gov/http.ts` across the boundary; either hand-duplicate a minimal version or skip retry for this read-only, low-stakes typeahead call, since RESEARCH.md doesn't mandate retry here the way it does for the poller's core availability fetch).

**Facility listing + classification pattern** (client.ts lines 140-225, especially `classifyFacility` lines 144-159 and `listAreaFacilities` lines 184-225):
```typescript
const CAMPGROUND_TYPE_PATTERN = /campground/i;
const GROUP_TYPE_PATTERN = /group/i;

function classifyFacility(f: { FacilityID: number; FacilityName: string; FacilityTypeDescription?: string; Reservable?: boolean }): AreaFacility | null {
  const desc = f.FacilityTypeDescription;
  if (desc === undefined) return null;
  if (!CAMPGROUND_TYPE_PATTERN.test(desc)) return null;
  if (f.Reservable !== true) return null; // strict: undefined is NOT reservable (fail closed)
  return { facilityId: f.FacilityID, facilityName: f.FacilityName, facilityType: GROUP_TYPE_PATTERN.test(desc) ? 'group' : 'standard' };
}
```
The MGMT-05 preview's `listAreaFacilities`-equivalent in `dashboard/lib/ridb.ts` must reuse this exact classify/filter logic (hand-duplicated, not imported) — same allowlist-of-campground-type philosophy, same `standard`/`group` tagging that D-10/UI-SPEC's `[GROUP]` tag depends on. Also carry forward `AREA_FACILITY_CAP = 20` (referenced in CONTEXT.md D-10 but defined in `src/config/` per Phase 4 — grep for it there and hand-copy the constant and the truncation `{ requested, kept }` shape, which already matches `dashboard/lib/types.ts`'s `TruncationInfo` interface used elsewhere).

**Types to hand-duplicate** (src/recreation-gov/types.ts lines 37-45):
```typescript
export const RidbRecAreaSchema = z.object({
  RecAreaID: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  RecAreaName: z.string(),
});
export const RidbRecAreaSearchSchema = z.object({
  RECDATA: z.array(RidbRecAreaSchema),
  METADATA: z.unknown().optional(),
});
```
Per RESEARCH.md's verified finding, do NOT add a `RecAreaState` field — it doesn't exist on this schema. Name-only typeahead suggestions for v1 (RESEARCH.md's own recommendation).

---

### `dashboard/lib/schema.ts` (MODIFIED — new strict write-path schema)

**Analog:** `src/config/schema.ts` (the strict sibling of the dashboard's own loose schema)

**Strict vs. loose diff** — `dashboard/lib/schema.ts` currently (lines 34-42):
```typescript
export const AreaWatchSchema = z.object({
  type: z.literal('area'),
  id: z.string().min(1),
  // No .min(1) here, deliberately: the dashboard is a read-only viewer and must
  // display whatever is committed, not gate-keep it (same reasoning as WatchesSchema below).
  areas: z.array(z.object({ name: z.string(), recAreaId: z.number().int().positive().optional() })),
  dateRange: z.object({ start: DateStr, end: DateStr }),
  siteType: SiteTypeSchema,
});
```
vs. `src/config/schema.ts`'s strict version (lines 8-39, the pattern to copy for the NEW write-path schema):
```typescript
const DateRangeSchema = z
  .object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  })
  .refine((r) => r.start < r.end, {
    message: 'dateRange.start must be before dateRange.end (end is the exclusive checkout date)',
  });

export const AreaWatchSchema = z.object({
  type: z.literal('area'),
  id: z.string().min(1),
  areas: z.array(z.object({ name: z.string().min(1), recAreaId: z.number().int().positive().optional() }))
    .min(1, 'an area watch must list at least one area'),
  dateRange: DateRangeSchema,
  siteType: SiteTypeSchema,
});

export const WatchesFileSchema = z
  .array(WatchSchema)
  .min(1, 'watches.json must contain at least one watch')
  .refine((ws) => new Set(ws.map((w) => w.id)).size === ws.length, {
    message: 'watch ids must be unique',
  });
```
Add a new exported schema (e.g. `WriteWatchSchema`/`StrictWatchSchema`, name TBD by planner per CONTEXT.md discretion) alongside the existing loose `WatchSchema` in `dashboard/lib/schema.ts` — do NOT replace the loose one (still needed for the read path's tolerant display). This new schema must include the `.min(1)` rules and the `DateRangeSchema.refine` start<end check, copied verbatim from `src/config/schema.ts`. The unique-id refine is trickier for a single-watch write path (create/edit validates ONE watch object, not the whole array) — the Route Handler must check uniqueness against the freshly-fetched `watches[]` array itself (from `github-write.ts`'s GET), not via a zod refine on the single-object schema.

---

### `dashboard/app/api/session/route.ts` (controller/route, request-response)

**Analog:** none existing in codebase (first Route Handler) — use RESEARCH.md's own verified code example directly (05-RESEARCH.md lines 266-289):
```typescript
import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { passphrase } = (await request.json()) as { passphrase: string };
  if (passphrase !== process.env.DASHBOARD_PASSPHRASE) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const cookieStore = await cookies();
  cookieStore.set('session', process.env.DASHBOARD_PASSPHRASE!, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30, path: '/',
  });
  return NextResponse.json({ ok: true });
}
```
Adopt github.ts's non-throwing discriminated-result convention for the JSON body shape returned to the client (`{ ok: true } | { ok: false }`), consistent with the rest of the codebase's error-shape style.

---

### `dashboard/app/api/watches/route.ts` (POST create) + `dashboard/app/api/watches/[id]/route.ts` (PATCH/DELETE)

**Analog:** composition of `dashboard/lib/github-write.ts` (new) + `dashboard/lib/schema.ts`'s new strict schema — no existing Route Handler in this codebase to mirror structurally, but the internal logic flow is fully specified in RESEARCH.md's Architecture Patterns diagram (05-RESEARCH.md lines 159-176):
```
POST /api/watches (create) or PATCH /api/watches/{id} (edit) or DELETE /api/watches/{id}
  ├─► proxy.ts intercepts first: no valid session cookie? ──► 401
  ▼ (cookie valid)
Route Handler: validate body with dashboard/lib/schema.ts's STRICT schema (.min(1), unique-id refine)
  ▼
github-write.ts: GET current watches.json + sha ──► apply create/edit/delete diff ──► PUT with sha
  │  on 409: re-fetch sha, re-apply diff, retry once
```
Each Route Handler must ALSO re-check the session cookie directly (defense-in-depth per RESEARCH.md Pattern 2's closing note and Pitfall 1) — never rely on `proxy.ts` alone. Error responses should follow the `ErrorState`/`COPY.errorBody` tone already established in `dashboard/lib/copy.ts` (short, no stack trace, no internals) — same discipline as `describeFailure()` in `src/errors.ts` (one safe line, no request internals, no secrets).

---

### `dashboard/app/api/ridb/recareas/route.ts` + `dashboard/app/api/ridb/recareas/[id]/facilities/route.ts`

**Analog:** thin Route Handler wrappers around `dashboard/lib/ridb.ts`'s `searchRecAreas`/`listAreaFacilities` — same shape as the `/api/watches` handlers above but GET-only and (per RESEARCH.md Open Question 2's recommendation) gated behind the SAME session cookie as the mutation routes, even though read-only, to avoid an anonymous RIDB-key proxy. Route these through `proxy.ts`'s matcher too: `['/api/watches/:path*', '/api/ridb/:path*']`.

---

### `dashboard/proxy.ts` (middleware, request-response gate)

**Analog:** none in codebase (net-new Next.js 16 concept) — RESEARCH.md's verified code example is the direct source of truth (05-RESEARCH.md lines 292-309):
```typescript
// dashboard/proxy.ts  — NOTE THE FILENAME: Next.js 16 renamed middleware.ts to proxy.ts.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const session = request.cookies.get('session')?.value;
  if (session !== process.env.DASHBOARD_PASSPHRASE) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/watches/:path*', '/api/ridb/:path*'],
};
```
**CRITICAL:** filename must be `proxy.ts` (not `middleware.ts`) with an exported `proxy()` function (not `middleware()`) — a `middleware.ts` file is silently ignored at Next.js 16 build time with no error (RESEARCH.md's single highest-confidence, highest-risk finding). This must be explicitly verified against a production build (`next build && next start`), not just `next dev`, per RESEARCH.md Pitfall 4.

---

### `dashboard/app/page.tsx` (MODIFIED)

**Analog:** itself, unchanged structure — this is a Server Component; do not add `'use client'` here. Existing pattern (page.tsx lines 14-40):
```typescript
export default async function Page() {
  const [watches, state, runs] = await Promise.all([
    fetchJson('watches.json'), fetchJson('state.json'), fetchJson('runs.json'),
  ]);
  const model = buildDashboardModel({ watches, state, runs }, new Date());
  return (
    <main className="page">
      <h1 className="page-title">{COPY.pageTitle}</h1>
      ...
      <div className="sections">
        {model.ok ? (<>...</>) : (<ErrorState />)}
      </div>
    </main>
  );
}
```
Add a new section/slot for `<WatchManager watches={...} />` (a new client component boundary) inside `.sections`, passed the already-fetched/parsed `watches` array as a prop — page.tsx stays a Server Component and does the initial data fetch exactly as today; only `watch-manager.tsx` and its children go client-side for interactivity. Do not disable the `next: { revalidate: 30 }` Data Cache window (page.tsx's own comment at lines 11-12 warns against this) — the write path invalidates via its own POST/PATCH/DELETE responses updating client state directly, not by changing the page's fetch strategy.

---

### `dashboard/app/watches/*.tsx` (new client components: watch-manager, watch-form, area-typeahead, area-preview, unlock-prompt)

**Analog:** `dashboard/app/sections.tsx` for presentational conventions only (COPY-driven strings, `.row`/`.section`/`badge` CSS classes, `aria-label` usage) — but these are the dashboard's FIRST interactive/client components, so there is no direct behavioral analog in this codebase. Reuse:
- `sections.tsx`'s `.badge`/`BADGE_CLASS` pattern (lines 11-20) for the `[GROUP]` tag in `area-preview.tsx`, matching `derive-active-matches.ts`'s existing `[GROUP]` suffix convention (`${slot.facilityName}${slot.facilityType === 'group' ? ' [GROUP]' : ''}`).
- `copy.ts`'s convention of centralizing every string as a `COPY` key (all new strings from 05-UI-SPEC.md's Copywriting Contract table must be added here, not inlined).
- `globals.css`'s existing CSS custom properties (`--space-*`, `--color-*`, `--text-*`) — UI-SPEC.md explicitly forbids introducing a 5th font size, 3rd weight, or any new color; only new class names using existing tokens.
- Native `<dialog>` element for `watch-form.tsx` (create/edit modal) and a second `<dialog>` for the delete-confirm — per UI-SPEC.md Interaction Notes and RESEARCH.md's explicit recommendation (no custom overlay div, no dependency).

---

## Shared Patterns

### Never-throws, discriminated-result module style
**Source:** `dashboard/lib/github.ts` (lines 13, 17-34)
**Apply to:** `github-write.ts`, `ridb.ts`, and every new `lib/` module in this phase
```typescript
export type FetchResult = { ok: true; data: unknown } | { ok: false; error: string };
```
Every new service module should export its own analogous `{ ok: true; ... } | { ok: false; error: string }` result type and never throw across its public API boundary — matches this codebase's established convention (also true of `dashboard/lib/schema.ts`'s `ParseResult<T>`).

### Doc-comment convention (rationale, not restatement)
**Source:** every existing `dashboard/lib/*.ts` file's header comment (e.g. github.ts lines 1-6, schema.ts lines 1-8)
**Apply to:** all new files
Every new module should open with a doc comment citing the *why* (a decision ID from CONTEXT.md, a threat ID from RESEARCH.md, or an architectural rationale) — never a comment that just restates what the code does.

### `src/` ↔ `dashboard/` hand-duplication boundary
**Source:** `dashboard/lib/types.ts` header (lines 1-13)
**Apply to:** `dashboard/lib/ridb.ts`, `dashboard/lib/schema.ts`'s new strict schema
```typescript
/** Local redeclarations of the poller's shared shapes.
 *  Hand-copied from the poller's `types.ts`... this dashboard is a fully independent
 *  Next.js project ... and must never import across the `src/` <-> `dashboard/` boundary.
 */
```
Both the new RIDB client and the new strict validation schema must be hand-duplicated from `src/recreation-gov/client.ts`/`types.ts` and `src/config/schema.ts` respectively — never imported. If those source files change, the dashboard copies must be updated by hand.

### Server-only secret discipline
**Source:** `src/recreation-gov/client.ts` header (lines 7-10) — "this module intentionally never reads environment variables directly" (inverted for the dashboard, which has no config-loader layer, but the *destination* secrecy principle is identical)
**Apply to:** `dashboard/lib/ridb.ts` (`RIDB_API_KEY`), `dashboard/lib/github-write.ts` (`GITHUB_WRITE_TOKEN`), `dashboard/lib/session.ts`/`proxy.ts` (`DASHBOARD_PASSPHRASE`)
Mark server-only modules with `import 'server-only'` at the top; never let any of these three secrets reach a `'use client'` file, a `NEXT_PUBLIC_*` var, or a thrown error message (mirrors `src/errors.ts`'s `describeFailure()` discipline of never embedding request headers/apikeys in error strings).

### Zod allowlist-of-one / fail-closed classification
**Source:** `src/recreation-gov/types.ts` line 6-7 (`AVAILABLE_STATUS`) and `src/recreation-gov/client.ts` lines 144-159 (`classifyFacility`)
**Apply to:** `dashboard/lib/ridb.ts`'s facility classification for the MGMT-05 preview
Reuse the exact `CAMPGROUND_TYPE_PATTERN`/`GROUP_TYPE_PATTERN` regex-allowlist + `Reservable !== true` fail-closed check — an unrecognized type must degrade to "excluded," never to a false positive.

### COPY-driven strings, no inline UI text
**Source:** `dashboard/lib/copy.ts` (whole file) + `dashboard/app/sections.tsx`'s exclusive use of `COPY.*`
**Apply to:** all new client components in `dashboard/app/watches/`
Every string in 05-UI-SPEC.md's Copywriting Contract table must be added as a new `COPY` key, not inlined in JSX — matches the existing "changing a value here is a UI-SPEC change" discipline.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `dashboard/lib/session.ts` | utility | request-response | No prior cookie/session handling exists anywhere in this codebase; RESEARCH.md's own inline code example (embedded directly in `route.ts`/`proxy.ts`) is the only available reference — planner may choose to extract shared cookie-name/maxAge constants into this file or inline them, per CONTEXT.md's discretion note |
| `dashboard/proxy.ts` | middleware | request-response | Net-new Next.js 16 concept, no prior `middleware.ts` ever existed in this project to migrate from; RESEARCH.md's verified code example is the sole source |
| `dashboard/app/watches/watch-form.tsx`, `area-typeahead.tsx`, `unlock-prompt.tsx` | component (Client) | CRUD / streaming | Dashboard has zero existing client components (`'use client'`) or interactive form state prior to this phase — Phase 3/4 built a fully static, read-only Server Component tree. UI-SPEC.md's Interaction Notes section is the closest thing to a spec these should follow |

## Metadata

**Analog search scope:** `dashboard/lib/`, `dashboard/app/`, `src/recreation-gov/`, `src/config/`, `src/errors.ts`, `dashboard/package.json`, `dashboard/app/globals.css`, `.env.example`
**Files scanned:** 17 (read in full: github.ts, schema.ts, types.ts, page.tsx, sections.tsx, copy.ts, globals.css, package.json, client.ts, types.ts [src], schema.ts [src config], http.ts, errors.ts, .env.example)
**Pattern extraction date:** 2026-08-26
