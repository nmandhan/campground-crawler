# Phase 5: Watch-Management Write Path - Research

**Researched:** 2026-08-26
**Domain:** Next.js 16 write-path (Route Handlers + session auth) over the GitHub Contents API, plus a read-only RIDB client for area typeahead/preview
**Confidence:** MEDIUM-HIGH (codebase facts and GitHub Contents API shape HIGH; RIDB `/recareas` field-name claims MEDIUM — corroborated via an auto-generated OpenAPI client's docs, not a live authenticated probe; Next.js 16 `proxy.ts` rename VERIFIED against official docs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Shared-Secret Auth**
- **D-01:** One-time login, not per-action re-entry. A passphrase form sets a short-lived-looking but actually long-lived (~30 day) httpOnly session cookie server-side; once unlocked, all create/edit/delete actions in that browser session proceed without re-prompting.
- **D-02:** The unlock prompt is inline on the watches page itself ("Unlock to manage watches"), not a separate `/login` route. Unauthenticated visitors still see the full read-only watch list; only the management controls are gated.
- **D-03:** Session cookie validity: ~30 days. Single named user on their own browser — optimize for not re-entering the secret often, not for minimizing exposure window.
- Consistent with research (`ARCHITECTURE.md`, `PITFALLS.md`): the secret is validated server-side only, the GitHub PAT never reaches the client bundle, and this is a deliberate "minimum viable gate," not a real accounts system.

**Create/Edit Form**
- **D-04:** Create/edit opens as a modal/panel over the watch list, not a dedicated page/route.
- **D-05:** One form handles both watch types, with a Facility/Area toggle at the top that swaps the location-picker section (single-campground typeahead vs. multi-area chip picker) while date range and site type stay shared below — mirrors the `Watch` discriminated union directly.
- **D-06:** Multi-area watches: a typeahead search box finds a Recreation Area by name; selecting one adds it as a removable chip. Repeat to add more areas to the same watch (maps directly to the `areas[]` array in `AreaWatchSchema`).

**Area Typeahead**
- **D-07:** Debounced live-suggestions dropdown (e.g. ~300ms debounce, 2-3 char minimum) — not an explicit search button. Calls RIDB's `/recareas?query=` search as the user types.
- **D-08:** Each suggestion shows the Recreation Area name plus disambiguating context (state/parent org, e.g. "Los Padres National Forest — CA") so the user can tell apart similarly-named areas.
  - **Open verification item for research/planning:** the live `RidbRecAreaSchema` captured in Phase 4 (`src/recreation-gov/types.ts`) currently only parses `RecAreaID` and `RecAreaName` — no state/org field was captured or verified against a live response. Researcher must confirm the actual field name(s) RIDB returns for state/parent-org before this schema can be extended and the disambiguating context can render. If no such field exists or is unreliable, fall back to name-only display for that suggestion.
  - **RESOLVED BY THIS RESEARCH (see "RIDB /recareas Field Verification" below): no direct state field exists on the base RecArea object. Fall back to name-only (+ optional long-form description) display, or add a second lookup for address/org if disambiguation proves necessary in practice — do not add a `RecAreaState` field to the schema, it does not exist.**

**Area Preview (MGMT-05)**
- **D-09:** Auto-fetch: the preview refreshes automatically whenever an area chip is added or removed — no separate "Preview" button. Costs one extra RIDB round trip per add/remove, accepted for the responsiveness.
- **D-10:** Preview shows the full resolved campground list (not just a count), each tagged standard vs. group (reusing Phase 4's D-05 tag), plus a truncation warning (e.g. "showing 20 of 34") if the combined areas will hit the shared 20-facility cap from Phase 4 (D-07/D-10 of `04-CONTEXT.md`).
- **Architectural note carried into canonical_refs below:** `ARCHITECTURE.md`'s "Anti-Pattern 1" warns against the write path resolving area→facility and *freezing* that list into `watches.json` — that guidance still holds (the persisted watch keeps only area criteria, resolved fresh by the poller every cycle). It does **not** forbid the dashboard from making a live, read-only RIDB call purely to render this preview. This means the dashboard needs its own small RIDB client (hand-duplicated into `dashboard/lib/`, consistent with the project's existing no-shared-import convention between `src/` and `dashboard/`) exposing area search + facility listing for typeahead/preview only — never used to write the frozen list.

**Delete & Save Feedback**
- **D-11:** Delete requires a confirmation dialog ("Delete this watch? This can't be undone") before the DELETE call fires — deletion is destructive/irreversible from the UI's perspective (git history is the only real undo).
- **D-12:** After a successful save (create or edit), show a toast/banner: "Saved — live within ~5 min" — sets correct expectations that the change isn't reflected in poll history until the next GitHub Actions cron tick, per `ARCHITECTURE.md`'s propagation-delay note.

### Claude's Discretion
- Exact Route Handler structure (`dashboard/app/api/watches/route.ts` vs `[id]/route.ts` split), the GitHub Contents API sha-read/PUT/409-retry implementation details, and the new hand-duplicated RIDB client's exact module shape in `dashboard/lib/` — architecture direction is already well-specified in `ARCHITECTURE.md`/`PITFALLS.md`/`STACK.md`.
- Exact toast/banner component choice, modal implementation (native `<dialog>` vs a small custom component) — no existing UI library beyond plain Tailwind/React per `dashboard/package.json`; keep consistent with that zero-dependency-by-default posture unless the form genuinely needs `react-hook-form` (per `STACK.md`'s conditional recommendation).
- Whether the write-path validation schema (`dashboard/lib/schema.ts`, stricter `.min(1)`/unique-id rules per `ARCHITECTURE.md`'s file table) lives alongside the existing read schemas or in a new file.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. (Per-facility exclusion within an area watch is already v2-deferred as MGMT-07 in REQUIREMENTS.md; lat/long+radius search is already v2-deferred as AREA-06.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AREA-04 | User can find a Recreation Area by name (typeahead) rather than needing to already know its numeric RIDB ID | RIDB `/recareas?query=` search (same endpoint Phase 4's `resolveArea()` already calls) via a new dashboard-side RIDB client; debounce pattern in Code Examples below |
| MGMT-01 | User can view a list of all configured watches on the dashboard | Existing `fetchJson('watches.json')` read path (`dashboard/lib/github.ts`) is unaffected — no new read mechanism needed, only new mutation UI layered on top |
| MGMT-02 | User can create a new watch (area(s) or facility, date range, site type) through the dashboard UI | `POST /api/watches` Route Handler + `github-write.ts` GET-sha/PUT pattern (Code Examples below) |
| MGMT-03 | User can edit an existing watch through the dashboard UI | `PATCH /api/watches/[id]` Route Handler, same write module |
| MGMT-04 | User can delete a watch through the dashboard UI | `DELETE /api/watches/[id]` Route Handler, same write module, gated behind D-11 confirmation dialog |
| MGMT-05 | Preview of resolved campgrounds before saving an area watch | New dashboard-side RIDB client mirroring `listAreaFacilities()`/`resolveArea()` from `src/recreation-gov/client.ts` (Phase 4, already shipped) — read-only, never persisted |
| MGMT-06 | Writes gated behind a server-side shared secret; reads stay public | `proxy.ts` (Next.js 16's renamed `middleware.ts`) gating `/api/watches/*` only, session cookie set by a passphrase Route Handler (Code Examples below) |
</phase_requirements>

## Summary

Phase 4 already shipped and is live in `src/`: `resolveArea()`, `listAreaFacilities()`, the `AREA_FACILITY_CAP = 20` truncation logic, and the `FacilityWatch | AreaWatch` discriminated union are all real, working code today (not upcoming work) — this phase can treat them as a stable, finished contract to build against, not a moving target. The dashboard (`dashboard/`) already mirrors the `Watch` union in `lib/types.ts`/`lib/schema.ts` per Phase 4's hand-duplication convention, and already has the "safeParse, discriminated result, no-throw" module style established in `lib/github.ts` to extend.

This phase's job is almost entirely new-file work in `dashboard/`: a `github-write.ts` module (GET-sha + PUT + 409-retry against GitHub's Contents API), a new small read-only RIDB client (`dashboard/lib/ridb.ts` or similar) for the area typeahead and MGMT-05 preview, a passphrase-gated session-cookie Route Handler, a **`dashboard/proxy.ts`** (not `middleware.ts` — Next.js 16 renamed this, verified below) restricting mutation routes only, and the create/edit/delete UI itself (modal + form + typeahead + chips + preview + confirm dialog + toast).

**Primary recommendation:** Build the write path as plain `fetch`-based Route Handlers (no Octokit, no database) exactly as `ARCHITECTURE.md`/`STACK.md` already specify, but name the auth-gating file `dashboard/proxy.ts` with an exported `proxy()` function — using the deprecated `middleware.ts`/`middleware()` naming on Next.js 16.3.x is silently ignored at build time with **no error or warning**, which would ship the entire write-path auth gate as a no-op. This is the single highest-risk implementation detail in this phase and must be a first-class item in the plan, not an afterthought.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Watch list display (MGMT-01) | Frontend Server (SSR, existing) | — | Already implemented in `page.tsx`/`sections.tsx`; unaffected by this phase |
| Session/passphrase auth (D-01/D-02, MGMT-06) | API / Backend (Route Handler) | Browser (proxy/edge gate reads the cookie, doesn't issue it) | Passphrase must be checked server-side only; cookie issuance happens in a Route Handler, cookie *verification for gating* happens in `proxy.ts` |
| Route gating for mutation endpoints (MGMT-06) | Frontend Server (`proxy.ts`, Node runtime in Next 16) | — | `proxy.ts` replaces `middleware.ts` in Next.js 16 and runs before the Route Handler; scope its `matcher` to `/api/watches/:path*` only so read routes stay ungated |
| Watch CRUD writes (MGMT-02/03/04) | API / Backend (Route Handlers) | Database/Storage tier (GitHub Contents API, acting as the persistence layer) | The "database" for this project is a committed JSON file in git; Route Handlers are the only place the GitHub PAT may be read |
| Area typeahead search (AREA-04, D-07) | Browser (debounce/UI) + API/Backend (proxy call to RIDB, to keep `RIDB_API_KEY` server-side) | — | The RIDB API key must not reach the client bundle, so the typeahead's actual `/recareas` fetch needs a thin server-side RIDB proxy Route Handler (e.g. `GET /api/ridb/recareas?query=`), not a direct client-side fetch to `ridb.recreation.gov` |
| Area preview / facility resolution (MGMT-05, D-09/D-10) | API / Backend (same RIDB proxy Route Handler, extended) | Browser (renders the returned list, no persistence) | Same reasoning as typeahead — the `RIDB_API_KEY` requirement forces this server-side, even though the result is read-only and never written back |
| Watch persistence (`watches.json`) | Database / Storage (GitHub repo, Contents API) | — | Unchanged single-writer-per-file invariant: dashboard becomes `watches.json`'s sole writer, poller remains its sole reader |

**Important correction to CONTEXT.md's framing:** CONTEXT.md's code_context section describes the RIDB client as needed only for "typeahead + preview," implying a purely client-side capability. Because `RIDB_API_KEY` is a secret (per `.env.example`, required for any name/area resolution call) and must never ship to the browser, **the new RIDB client's actual network calls must run server-side** — either as its own thin Route Handler(s) (e.g. `dashboard/app/api/ridb/recareas/route.ts`, `dashboard/app/api/ridb/facilities/route.ts`) that the client-side typeahead/preview components call, or as Server Actions invoked from client components. `dashboard/lib/ridb.ts` should contain the actual `fetch(RIDB_BASE...)` + zod-parse logic (mirroring `src/recreation-gov/client.ts`), but it must only ever be imported by server-side code (Route Handlers), never by a `'use client'` component directly.

## Standard Stack

### Core (already installed, no version bump needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.3.3 (installed: 16.3.2, `npm view` confirms 16.3.3 is current) | Route Handlers, `proxy.ts`, `cookies()` | Already the project's framework; no new dependency |
| `react` / `react-dom` | 19.2.8 | Modal/form/typeahead client components | Already installed |
| `zod` | ^4.4.3 | Stricter write-path validation schema, RIDB response parsing | Matches existing `lib/schema.ts` conventions exactly |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react-hook-form` | ^7.86.0 (verified via `npm view`, STACK.md cited ^7.71.0 — newer patch/minor now current) | Manage the create/edit form's fields, validation errors, conditional Facility/Area sections | Only if plain `useState` genuinely becomes unwieldy once area chips + inline preview + validation errors are all live in one form — try plain `useState` first per the project's zero-dependency posture; this is Claude's discretion per CONTEXT.md |
| None (no additional GitHub client library) | — | GitHub Contents API calls | Plain `fetch` + `Buffer.from(...).toString('base64')`, matching `dashboard/lib/github.ts`'s existing "no SDK" convention |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Route Handlers for CRUD | Next.js Server Actions | Server Actions would work equally well server-side-only, but this dashboard currently has zero `app/api/` routes AND zero Server Actions — Route Handlers give a conventional REST shape (`POST`/`PATCH`/`DELETE` per resource) that maps directly to MGMT-02/03/04 and is easier to test with a plain `fetch`/curl for the "call it unauthenticated and confirm rejection" pitfall-check in PITFALLS.md. Server Actions are harder to probe this way (no stable public URL/verb to curl). Recommend Route Handlers. |
| `proxy.ts` cookie check | Doing the auth check inside each Route Handler individually (no `proxy.ts` at all) | Also valid and arguably simpler for a 3-route surface — avoids the entire `middleware`→`proxy` rename trap. Since the blast radius of getting `proxy.ts` wrong is "auth silently doesn't apply," a defense-in-depth approach (check the cookie both in `proxy.ts` AND again at the top of each mutating Route Handler) is recommended regardless of which primary mechanism the planner picks. |
| Native `<dialog>` for modal/confirm | A hand-rolled `position: fixed` overlay div | `<dialog>` gets focus-trapping and `Escape`-to-close for free with zero JS, fits the zero-dependency posture better than a custom overlay |

**Installation:**
```bash
# No new dependency required for the GitHub write path or the RIDB proxy client —
# plain fetch + Buffer.from(...).toString('base64') covers both.

# Optional, only if the create/edit form outgrows plain useState:
npm install react-hook-form
```

**Version verification:**
```
npm view next version        -> 16.3.3
npm view react-hook-form version -> 7.86.0
```
Both checked live in this session (2026-08-26). The project's installed `next` (16.3.2) is one patch behind current; no action required for this phase, but worth noting the `middleware`→`proxy` rename shipped in the Next.js 16.0 line and is present in the already-installed 16.3.2.

## Architecture Patterns

### System Architecture Diagram

```
Browser (dashboard, public URL)
  │
  │  GET /  (unauthenticated, unchanged)
  ▼
Next.js SSR page.tsx ──► fetchJson('watches.json') ──► raw.githubusercontent.com (public, 30s cache)
  │  renders watch list + "Unlock to manage watches" prompt (D-02) if no valid session cookie
  │
  │  User enters passphrase
  ▼
POST /api/session  (new Route Handler)
  │  compares submitted passphrase to server-only env var (constant-time compare)
  │  on match: cookies().set('session', signedValue, { httpOnly, secure, sameSite:'lax', maxAge: 30d })
  ▼
Browser now holds an httpOnly session cookie ── every subsequent request to /api/watches/* automatically includes it

  User opens "Create Watch" modal (D-04), toggles Facility/Area (D-05)
  │
  │  Area mode: types into typeahead (debounced ~300ms, 2-3 char min, D-07)
  ▼
GET /api/ridb/recareas?query=...  (new Route Handler — RIDB_API_KEY stays server-side)
  │  dashboard/lib/ridb.ts: fetch RIDB_BASE/recareas?query=... ──► zod-parse ──► return name(+description) list
  ▼
Dropdown renders suggestions ──► user picks one ──► added as removable chip (D-06)
  │  on every chip add/remove:
  ▼
GET /api/ridb/recareas/{id}/facilities  (new Route Handler, mirrors listAreaFacilities())
  │  applies same D-04/AREA-03 campground+reservable filter, D-09 order, D-10 truncation warning
  ▼
Preview panel renders full resolved list, tagged standard/group (D-10) — READ ONLY, never sent to GitHub

  User fills date range + site type, clicks Save
  │
  ▼
POST /api/watches  (create) or PATCH /api/watches/{id}  (edit) or DELETE /api/watches/{id}
  │
  ├─► proxy.ts intercepts first: no valid session cookie? ──► 401, UI shows "Unlock to manage watches" again
  │
  ▼ (cookie valid)
Route Handler: validate body with dashboard/lib/schema.ts's STRICT schema (.min(1), unique-id refine)
  │
  ▼
github-write.ts: GET current watches.json + sha ──► apply create/edit/delete diff ──► PUT with sha
  │  on 409: re-fetch sha, re-apply diff, retry once
  ▼
Commit lands on main (author: dashboard's fine-grained PAT identity)
  │
  ▼
UI shows "Saved — live within ~5 min" toast (D-12)
  │
  ▼ (≤5 min later, independent of this request)
GitHub Actions poll.yml: actions/checkout pulls main HEAD ──► new/edited/deleted watch is live
```

### Recommended Project Structure

```
dashboard/
├── proxy.ts                       # NEW — Next.js 16's renamed middleware.ts; gates /api/watches/* only
├── app/
│   ├── page.tsx                   # MODIFIED — add unlock prompt + management entry point
│   ├── sections.tsx                # MODIFIED — existing read-only sections, likely unaffected
│   ├── watches/
│   │   ├── watch-manager.tsx       # NEW — client component: list + create/edit/delete controls, orchestrates modal state
│   │   ├── watch-form.tsx          # NEW — client component: the create/edit modal, Facility/Area toggle (D-05)
│   │   ├── area-typeahead.tsx      # NEW — client component: debounced search + chips (D-06/D-07)
│   │   ├── area-preview.tsx        # NEW — client component: auto-fetching resolved-campground list (D-09/D-10)
│   │   └── unlock-prompt.tsx       # NEW — client component: inline passphrase form (D-02)
│   └── api/
│       ├── session/route.ts        # NEW — POST: passphrase check, sets session cookie
│       ├── watches/
│       │   ├── route.ts            # NEW — POST (create)
│       │   └── [id]/route.ts       # NEW — PATCH (edit), DELETE
│       └── ridb/
│           ├── recareas/route.ts   # NEW — GET: typeahead search proxy (AREA-04)
│           └── recareas/[id]/facilities/route.ts  # NEW — GET: area preview proxy (MGMT-05)
└── lib/
    ├── github.ts                   # UNCHANGED — existing read path
    ├── github-write.ts             # NEW — GET-sha/PUT/409-retry
    ├── ridb.ts                     # NEW — server-only, mirrors src/recreation-gov/client.ts's resolveArea/listAreaFacilities shape
    ├── session.ts                  # NEW — cookie sign/verify helpers, shared by api/session and proxy.ts
    ├── schema.ts                   # MODIFIED — add a stricter write-path schema (or a sibling file, per discretion)
    └── types.ts                    # UNCHANGED — Watch union already mirrored in Phase 4
```

### Pattern 1: GET-sha / PUT-with-409-retry (GitHub Contents API)

**What:** Read the current `watches.json` blob + its `sha`, apply an in-memory edit, PUT back with that `sha`; on `409`, refetch and retry once.
**When to use:** Every create/edit/delete mutation.
**Example (shape, not copy-paste — matches `dashboard/lib/github.ts`'s never-throws, discriminated-result house style):**
```typescript
// Source: GitHub REST Contents API docs (docs.github.com/en/rest/repos/contents),
// verified in this session — GET returns { sha, content (base64) }, PUT requires
// { message, content (base64), sha } and returns 409 on sha mismatch.
const CONTENTS_URL = (path: string) =>
  `https://api.github.com/repos/nmandhan/campground-crawler/contents/${path}`;

async function getWatchesFile(): Promise<{ watches: Watch[]; sha: string } | { error: string }> {
  const res = await fetch(CONTENTS_URL('watches.json'), {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_WRITE_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store', // never serve a stale sha for a write path
  });
  if (!res.ok) return { error: `GET watches.json: HTTP ${res.status}` };
  const body = (await res.json()) as { sha: string; content: string };
  const watches = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')) as Watch[];
  return { watches, sha: body.sha };
}

async function putWatchesFile(watches: Watch[], sha: string, message: string): Promise<{ ok: true } | { ok: false; conflict: boolean; error: string }> {
  const res = await fetch(CONTENTS_URL('watches.json'), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_WRITE_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(JSON.stringify(watches, null, 2) + '\n').toString('base64'),
      sha,
    }),
  });
  if (res.status === 409) return { ok: false, conflict: true, error: 'sha mismatch' };
  if (!res.ok) return { ok: false, conflict: false, error: `PUT watches.json: HTTP ${res.status}` };
  return { ok: true };
}
```
Caller wraps this in "fetch sha → apply diff → PUT → on conflict, re-fetch sha and re-apply diff → PUT again (one retry only)" per PITFALLS.md Pitfall 3.

### Pattern 2: Session cookie set from a Route Handler, checked in `proxy.ts`

**What:** `POST /api/session` validates a submitted passphrase against a server-only env var and sets an httpOnly cookie; `proxy.ts` reads that cookie on every request matching `/api/watches/:path*` and rejects if absent/invalid.
**When to use:** D-01/D-02/D-03, MGMT-06.
**Example:**
```typescript
// dashboard/app/api/session/route.ts
// Source: Next.js docs (cookies() API, verified via Context7 in this session)
import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { passphrase } = (await request.json()) as { passphrase: string };
  // Constant-time-ish compare; a timing side-channel is a negligible risk here
  // (single user, low-value secret rotation cost) but cheap to harden if desired.
  if (passphrase !== process.env.DASHBOARD_PASSPHRASE) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const cookieStore = await cookies();
  cookieStore.set('session', process.env.DASHBOARD_PASSPHRASE!, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // ~30 days, D-03
    path: '/',
  });
  return NextResponse.json({ ok: true });
}
```
```typescript
// dashboard/proxy.ts  — NOTE THE FILENAME: Next.js 16 renamed middleware.ts to proxy.ts.
// A leftover middleware.ts is silently ignored at BUILD TIME with no error (verified
// via official Next.js 16 upgrade docs + community migration reports, this session).
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
  matcher: ['/api/watches/:path*'], // reads stay ungated; RIDB proxy routes may also need gating — see Open Questions
};
```
**Defense in depth:** also re-check the cookie inside each `route.ts` handler directly (don't rely solely on `proxy.ts`), given the "silently ignored if misnamed" failure mode PITFALLS.md-style thinking would flag as a "looks done but isn't" risk unique to this Next.js version.

### Pattern 3: Server-side RIDB proxy for typeahead + preview (mirrors Phase 4's client.ts, doesn't import it)

**What:** A small `dashboard/lib/ridb.ts` exposing `searchRecAreas(query)` and `listAreaFacilities(recAreaId)`, called only from Route Handlers (never directly from a client component, since `RIDB_API_KEY` must stay server-side).
**When to use:** AREA-04 typeahead, MGMT-05 preview.
**Example (mirrors `src/recreation-gov/client.ts`'s resolveArea/listAreaFacilities shape — hand-duplicated, not imported, per the existing `src/`↔`dashboard/` convention):**
```typescript
// dashboard/lib/ridb.ts
// Source: pattern mirrored from src/recreation-gov/client.ts (this repo, Phase 4) —
// same RIDB_BASE, same RECDATA envelope, same zod-parse-before-field-access discipline.
import 'server-only';
import { z } from 'zod';

const RIDB_BASE = 'https://ridb.recreation.gov/api/v1';

const RidbRecAreaSchema = z.object({
  RecAreaID: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  RecAreaName: z.string(),
  RecAreaDescription: z.string().optional(), // long-form text; NOT a concise state/org field — see verification below
});
const RidbRecAreaSearchSchema = z.object({ RECDATA: z.array(RidbRecAreaSchema) });

export async function searchRecAreas(query: string): Promise<
  { ok: true; areas: { recAreaId: number; recAreaName: string }[] } | { ok: false; error: string }
> {
  const url = new URL(`${RIDB_BASE}/recareas`);
  url.searchParams.set('query', query);
  url.searchParams.set('limit', '10');
  const res = await fetch(url, { headers: { apikey: process.env.RIDB_API_KEY ?? '' } });
  if (!res.ok) return { ok: false, error: `RIDB /recareas: HTTP ${res.status}` };
  const parsed = RidbRecAreaSearchSchema.safeParse(await res.json());
  if (!parsed.success) return { ok: false, error: 'unexpected RIDB response shape' };
  return {
    ok: true,
    areas: parsed.data.RECDATA.map((a) => ({ recAreaId: a.RecAreaID, recAreaName: a.RecAreaName })),
  };
}
```
The facility-preview counterpart follows the identical shape to `listAreaFacilities()` in `src/recreation-gov/client.ts` — same campground-type-pattern + reservable filter, same `AREA_FACILITY_CAP = 20` truncation constant, hand-duplicated (do not import across the boundary).

### Anti-Patterns to Avoid

- **Naming the gating file `middleware.ts` on Next.js 16.3.x:** it is silently ignored at build time — no error, no warning, the write path ships completely unauthenticated. Must be `proxy.ts` with an exported `proxy()` function.
- **Fetching RIDB directly from a client component:** leaks `RIDB_API_KEY` into the browser bundle/network tab. Route all RIDB calls through a server-side Route Handler or Server Action.
- **Freezing the area→facility preview list into the saved watch** (ARCHITECTURE.md Anti-Pattern 1, still applies): MGMT-05's preview is read-only UI state; only `areas: [{ name, recAreaId }]` criteria get persisted to `watches.json`.
- **Skipping the 409 retry** ("it'll rarely collide"): PITFALLS.md Pitfall 3 explicitly flags this as a "never acceptable" shortcut — a lost edit is silent and hard to debug.
- **Using the loose dashboard `WatchesSchema`/`WatchSchema` (no `.min(1)`, no unique-id refine) for the write path's own validation:** that schema is deliberately loose because the dashboard is a read-only viewer for other files. The write path must import/duplicate the **strict** rules from `src/config/schema.ts` (`.min(1)` on `id`/`areas`, unique-id refine) so a UI-created watch never produces a `watches.json` the poller would reject.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session/cookie signing | A custom JWT or crypto scheme | A plain equality check against `process.env.DASHBOARD_PASSPHRASE` stored directly in the httpOnly cookie value | Single user, no need for a signed/stateless token scheme; the cookie itself never leaves the server-set httpOnly boundary, and the "secret" is already a shared secret by design (D-01 note: not a real accounts system). If a lighter-weight non-secret-bearing cookie is preferred, an HMAC'd session marker (per STACK.md's alternative) is the next step up — still no library needed (`crypto.createHmac` from Node's built-in `crypto`). |
| Base64 encode/decode for GitHub Contents API | A helper library | `Buffer.from(str).toString('base64')` / `Buffer.from(b64, 'base64').toString('utf8')` | Node built-in, zero dependency, exactly what the Contents API expects |
| Debounce for the typeahead | A debounce npm package (`lodash.debounce`, `use-debounce`) | A ~10-line `useEffect` + `setTimeout`/`clearTimeout` hook | Trivial to hand-roll correctly for one input; adding a dependency for this is disproportionate given the project's zero-dependency-by-default posture |
| GitHub write client | `@octokit/rest` | Plain `fetch` | Matches `dashboard/lib/github.ts`'s existing no-SDK convention; only two call shapes needed (GET, PUT) |

**Key insight:** every "don't hand-roll" temptation in this phase (auth, GitHub API client, debounce) has a well-established, tiny, dependency-free solution already implied by the codebase's existing conventions — the risk in this phase is over-engineering (reaching for NextAuth, Octokit, or a debounce package), not under-engineering.

## RIDB `/recareas` Field Verification (D-08's open question)

**Question:** Does RIDB's `/recareas?query=` search return a state/parent-org field alongside `RecAreaID`/`RecAreaName`, to power the D-08 disambiguation UI ("Los Padres National Forest — CA")?

**Finding: NO direct state field exists on the base RecArea object.** Verified via the `ships/ridb` OpenAPI-generated Rust client's model docs (github.com/ships/ridb, auto-generated from RIDB's own published OpenAPI/Swagger spec — field-naming convention cross-checked against this codebase's already-verified `RecAreaID`/`RecAreaName` PascalCase pattern and matches exactly, once converted from the client's snake_case back to RIDB's PascalCase JSON):

- `RecArea` fields present: `RecAreaID`, `OrgRecAreaID`, `ParentOrgID` (optional), `RecAreaName`, `RecAreaDescription`, `RecAreaFeeDescription`, `RecAreaDirections`, `RecAreaPhone`, `RecAreaEmail`, `RecAreaReservationURL`, `RecAreaMapURL`, `GEOJSON`, `RecAreaLongitude`, `RecAreaLatitude`, `StayLimit`, `Keywords`, `Reservable`, `Enabled`, `LastUpdatedDate` — **no `RecAreaState` field.**
- State/city/address information lives in a **separate, related resource**: `RecreationAreaAddress` (`GET /recareaaddresses`, or `GET /recareas/{id}/recareaaddresses`), with fields `RecAreaAddressID`, `RecAreaID`, `RecAreaAddressType`, street lines, `City`, `PostalCode`, `AddressStateCode`, `AddressCountryCode`. This is a **separate API call per RecArea**, not inline on the search response, unless the RIDB API's `full=true` parameter (a documented-but-unverified-in-this-session convention on some RIDB endpoints) embeds it.
- `ParentOrgID` **is** present directly on the base RecArea object — but it's a numeric ID, not a name (e.g. "USDA Forest Service"); resolving it to a display string requires a separate `GET /organizations/{orgId}` call (`OrgName` field, confirmed via the same client's `Organization` model docs).
- `RecAreaDescription` **is** present and could serve as loose disambiguation text, but per the model docs and general RIDB usage patterns, this is typically a full marketing paragraph, not a concise "State — Org" string — likely too verbose for a typeahead dropdown row without truncation.

**Recommendation for the planner:** Do not extend `RidbRecAreaSchema` with a `RecAreaState` field — it doesn't exist. Options, in order of increasing cost:
1. **(Recommended, matches D-08's own fallback clause)** Name-only typeahead suggestions for v1 of this phase, optionally truncating `RecAreaDescription` as a secondary line if it reads reasonably as a one-line snippet in practice — cheapest, no extra RIDB round trip.
2. If disambiguation is later found genuinely necessary in testing: a second RIDB call per suggestion (or a batched call) to `/recareas/{id}/recareaaddresses` to fetch `City`/`AddressStateCode`, rendered as "Los Padres National Forest — CA" once resolved. This adds N extra RIDB calls per keystroke-driven search (bounded by the existing `limit=10`), which is cheap against RIDB's 50 req/min cap for a single user, but adds latency/complexity Phase 5 may not need for a v1.

**Confidence: MEDIUM.** The `ships/ridb` OpenAPI client docs are auto-generated from RIDB's own published Swagger spec (a credible secondary source, cross-verified against this codebase's own already-confirmed field-naming convention), but this was not re-confirmed against a live authenticated `GET https://ridb.recreation.gov/api/v1/recareas?query=...` response in this session (no `RIDB_API_KEY` available in this environment). **Recommend a live fixture-capture spike as this phase's first task** (same recommendation `STACK.md` already made for Phase 4's geo-search fields) before finalizing whether `RecAreaDescription` is usable as-is or needs truncation/filtering.

## GitHub Contents API — Verified Shape

Verified via official GitHub REST API docs (`docs.github.com/en/rest/repos/contents`) in this session:

- **`GET /repos/{owner}/{repo}/contents/{path}`** — no request body; optional `?ref=` query param (defaults to default branch). Response includes `sha`, `content` (base64, only for files ≤1MB — `watches.json` is well under this), `encoding`.
- **`PUT /repos/{owner}/{repo}/contents/{path}`** — required body: `message`, `content` (base64). `sha` is required specifically for *updates* (omit only for a brand-new file, which won't apply here since `watches.json` already exists). Optional: `branch`, `committer`, `author`.
- **409 Conflict** — returned on `sha` mismatch during update; standard fix is refetch-sha-and-retry (already documented in PITFALLS.md, corroborated here).
- **Rate limit:** a fine-grained PAT gets the standard authenticated-user rate limit, **5,000 requests/hour** [CITED: GitHub REST API rate-limit documentation] — vastly more than a single-user CRUD UI will ever approach (a handful of watch edits per session, at most).
- **Headers:** `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` (or the current pinned version) are the modern convention; older `token <PAT>` auth scheme header still works but `Bearer` is current.

**Confidence: HIGH** for the GET/PUT/409 shape (stable, long-documented GitHub API, consistent across every source consulted including the milestone-level PITFALLS.md/STACK.md research). **MEDIUM** for the exact 5,000/hr number applying identically to fine-grained PATs vs. classic PATs — GitHub's docs describe this as the standard authenticated rate limit; no fine-grained-PAT-specific carve-out was found suggesting a lower limit, and it is functionally irrelevant at this project's scale either way.

## Next.js 16 `middleware` → `proxy` Rename — Verified Finding

**This is the single most important verified finding in this research pass.** Confirmed via official Next.js 16 upgrade documentation (fetched via Context7 in this session, `/vercel/next.js` canary docs, `version-16.mdx` and `proxy.mdx`):

- Next.js 16 deprecates `middleware.ts`/`middleware.js` and the `middleware` named export, replacing them with `proxy.ts`/`proxy.js` and a `proxy` named export.
- **The `edge` runtime is NOT supported in `proxy`** — `proxy.ts` always runs on the `nodejs` runtime and this cannot be configured. (Not a concern for this phase — the auth check here is a plain cookie comparison, no edge-specific API needed.)
- Config flags are also renamed (e.g. `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`) — irrelevant to this phase's minimal config, but worth knowing if the planner reaches for any middleware-adjacent config flag.
- **Critical failure mode, independently corroborated by multiple community migration reports (bhived.ai, dev.to, medium.com — all 2026-dated posts specifically about this Next.js 16 change):** a leftover `middleware.ts` file is **silently ignored at build time with no error or warning**. Auth/redirect logic in it simply stops executing; there is no compile error, no runtime warning — the route it was meant to protect becomes silently, invisibly public.
- A codemod exists (`npx @next/codemod@latest middleware-to-proxy .`) but is irrelevant here since this is a net-new file in a project that has never had a `middleware.ts` — just create `proxy.ts` directly.
- The project's installed `next` version is 16.3.2 (package.json) / 16.3.3 (npm current) — both are well within the 16.x line where this rename is already in effect (the rename shipped with Next.js 16.0).

**Confidence: HIGH.** Verified against official Next.js upgrade docs (primary source) and cross-corroborated by multiple independent, dated community posts describing the exact same silent-failure behavior — a textbook "verify a negative claim against official docs" case per this research's own verification protocol.

## Common Pitfalls

### Pitfall 1: Shipping `middleware.ts` instead of `proxy.ts` on Next.js 16

**What goes wrong:** The gating logic is written, tested locally (if `next dev` still respects it — verify this too, since dev-mode behavior for a deprecated convention should be checked explicitly during implementation), but silently does nothing once the specific Next.js 16 build/runtime path treats it as absent, per the verified finding above.
**Why it happens:** Every piece of upstream research (CONTEXT.md, ARCHITECTURE.md, STACK.md, PITFALLS.md) was written referencing "`middleware.ts`" — a completely reasonable, previously-correct convention that changed specifically in the major version this project happens to be on.
**How to avoid:** Name the file `dashboard/proxy.ts`, export a `proxy()` function (not `middleware()`), and add a defense-in-depth cookie check inside each mutating Route Handler directly (don't rely on `proxy.ts` alone).
**Warning signs:** Calling a mutation endpoint with `curl` and no cookie succeeds (200) instead of 401 — this exact check is already called out in PITFALLS.md's "Looks Done But Isn't" checklist and becomes even more important given this Next.js-version-specific trap.

### Pitfall 2: Fetching RIDB from the client, leaking `RIDB_API_KEY`

**What goes wrong:** The area typeahead/preview components call `ridb.recreation.gov` directly from `'use client'` code for simplicity, requiring the API key to be exposed as `NEXT_PUBLIC_RIDB_API_KEY` (or hardcoded), leaking a credential to every visitor's browser/devtools.
**Why it happens:** RIDB's API doesn't inherently require a backend proxy — it's a plain REST GET — so it's tempting to just call it from the browser like any public API, especially since the existing dashboard read path (`fetchJson`) already calls a public, unauthenticated endpoint (raw.githubusercontent.com) directly from a Server Component, and it's easy to blur the line between "already public data source" and "requires a secret key."
**How to avoid:** Route every RIDB call through a server-side Route Handler (`/api/ridb/recareas`, `/api/ridb/recareas/[id]/facilities`); `dashboard/lib/ridb.ts` reads `RIDB_API_KEY` and must carry the same "never a `NEXT_PUBLIC_` var" discipline already established for `GITHUB_WRITE_TOKEN`.
**Warning signs:** `RIDB_API_KEY` (or its value) appearing in a client bundle search (`grep` the `.next/static` build output) or in the Network tab's request to a non-`/api/` URL.

### Pitfall 3: Write-path validation reusing the dashboard's intentionally-loose read schema

**What goes wrong:** The new create/edit Route Handlers validate the incoming watch with the existing `dashboard/lib/schema.ts`'s `WatchSchema`/`WatchesSchema`, which deliberately omit `.min(1)` and the unique-id refine ("the dashboard is a read-only viewer and must display whatever is committed, not gate-keep it" — direct quote from the current file). A write path built on this loose schema could persist an empty `id` or a duplicate `id`, which the poller's stricter `src/config/schema.ts` would then reject on its next run, silently breaking the whole poller (not just the one bad watch, if `WatchesFileSchema`'s top-level parse fails).
**Why it happens:** Reusing an existing schema file feels natural and DRY, but this particular file's looseness was a deliberate design choice for a different purpose (display robustness) that doesn't hold for a write path (which must produce data at least as strict as the poller's own input contract).
**How to avoid:** Add a distinct, stricter schema for the write path (either alongside the existing one in `schema.ts`, clearly separated, or in a new file — CONTEXT.md leaves this as Claude's discretion) that mirrors `src/config/schema.ts`'s `.min(1)`/unique-id rules exactly.
**Warning signs:** A watch created via the UI with an empty date string or a duplicate id passes the write path's validation but the next poller run logs a `watches.json` parse failure.

### Pitfall 4: Assuming `next dev` and `next build`/`next start` treat `proxy.ts` identically

**What goes wrong:** Not directly verified in this research pass — flagged as an open question. If dev-mode behavior differs from production build behavior for the deprecated `middleware.ts` convention (e.g. dev mode still picks it up with a warning, but production build silently drops it), a developer could test locally, see the gate working, and ship a build where it's a no-op.
**Why it happens:** Deprecation warnings are sometimes dev-only conveniences that don't survive into production builds.
**How to avoid:** Explicitly test the auth gate against a production build (`next build && next start`, or the actual Vercel preview deployment) before considering MGMT-06 verified — not just `next dev`.
**Warning signs:** Auth works in local dev but a deployed preview allows unauthenticated writes.

## Code Examples

See "Architecture Patterns" section above for the full GET-sha/PUT-with-409-retry, session-cookie, `proxy.ts`, and server-side RIDB client examples — all sourced from official docs (GitHub REST API docs, Next.js docs via Context7) or hand-mirrored from this repo's own existing `src/recreation-gov/client.ts` and `dashboard/lib/github.ts`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `dashboard/middleware.ts` | `dashboard/proxy.ts` | Next.js 16.0 (already in effect in the installed 16.3.2/16.3.3) | Every reference to "middleware" in this project's own upstream research (ARCHITECTURE.md, STACK.md, CONTEXT.md) needs this substitution during planning/implementation — those docs predate this verification pass and were written assuming the older, now-incorrect filename |

**Deprecated/outdated:**
- `middleware.ts`/`middleware()` naming convention: deprecated in Next.js 16, silently non-functional (not just warned-about) per the verified finding above.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `RecAreaDescription` is a long marketing paragraph unsuitable for a one-line typeahead row, not independently confirmed against a live response | RIDB /recareas Field Verification | If actually short, could be used directly for D-08 disambiguation without the extra `/recareaaddresses` call — low risk, easily discovered during the recommended fixture-capture spike |
| A2 | GitHub's 5,000 req/hr rate limit applies identically to fine-grained PATs as to classic PATs | GitHub Contents API — Verified Shape | Functionally irrelevant at this project's single-user CRUD scale even if the real number were lower (e.g. 1,000/hr) |
| A3 | `next dev` and production build/deploy treat a correctly-named `proxy.ts` identically (no dev-only leniency masking a production gap) | Pitfall 4 | If dev leniently allows something production doesn't (or vice versa), the auth gate could pass local testing but fail — or incorrectly appear broken — in production; mitigated by explicitly testing against a production build before sign-off |

## Open Questions

1. **Does the dashboard need its own `RIDB_API_KEY` env var provisioned in Vercel, separate from the poller's GitHub Actions secret of the same name?**
   - What we know: `RIDB_API_KEY` is currently only configured as a GitHub Actions secret for the poller (`src/`); the dashboard runs on Vercel, a separate execution environment with its own env var store.
   - What's unclear: Whether the same RIDB account/key can simply be copy-pasted into Vercel's env vars (very likely fine — RIDB doesn't appear to scope keys per-application) or whether a second key should be provisioned for isolation.
   - Recommendation: Reuse the same key value in Vercel (simplest, no new RIDB account setup), but store it as a separate Vercel env var entry — this is an operational/deployment step to include in the plan's task list, not a design decision.

2. **Should the RIDB proxy routes (`/api/ridb/*`) also sit behind the session-cookie gate, or remain open (since they're read-only)?**
   - What we know: MGMT-06 only requires gating "write actions (create/edit/delete)" — the RIDB search/preview calls don't write anything.
   - What's unclear: Whether leaving `/api/ridb/*` open invites abuse of the RIDB_API_KEY-backed proxy by an anonymous visitor (e.g. someone scripting requests through the dashboard's own proxy route to search RIDB using this project's key, unrelated to watch management).
   - Recommendation: Gate `/api/ridb/*` behind the same session cookie too, even though it's read-only — the typeahead/preview UI only ever renders inside the already-gated create/edit modal (D-04), so there's no legitimate unauthenticated caller of these routes anyway, and it closes off a free RIDB-key proxy for anyone who finds the URL. Cheap to include in the same `proxy.ts` matcher (`['/api/watches/:path*', '/api/ridb/:path*']`).

3. **Exact wording/placement of the "Saved — live within ~5 min" toast and the delete confirmation dialog copy** — left to the planner/implementer as UI-copy detail, not a research gap; CONTEXT.md already specifies the substance (D-11, D-12), only exact component/wording is open.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Dashboard runtime | ✓ | v25.9.0 | — |
| `next` (npm) | Route Handlers, `proxy.ts`, cookies API | ✓ | 16.3.2 installed / 16.3.3 current | Optional patch bump, not required |
| `RIDB_API_KEY` | Typeahead (AREA-04), preview (MGMT-05) | ✗ (not present in this research session's environment) | — | No fallback for live verification — the planner/implementer must run a fixture-capture spike with a real key (as `STACK.md` already recommended for Phase 4) before trusting `RecAreaDescription`/address-lookup field behavior; the poller's Phase 4 code already works in production with a real key, so this is purely a "verify field names for the new dashboard-side client" gap, not a blocked capability |
| GitHub fine-grained PAT (`GITHUB_WRITE_TOKEN`) | Write path (MGMT-02/03/04) | ✗ (must be created and provisioned in Vercel; not yet done per STATE.md, this is Phase 5 scope) | — | None — blocking until created; this is expected first-task setup work for this phase, per STACK.md's existing guidance (fine-grained PAT, `Contents: Read and write` + `Metadata: Read`, scoped to this one repo) |

**Missing dependencies with no fallback:**
- `RIDB_API_KEY` for a live fixture-capture spike (recommended, not strictly blocking — the schema can be implemented against the MEDIUM-confidence field list above and corrected later if wrong)
- `GITHUB_WRITE_TOKEN` (fine-grained PAT) — must be created as part of this phase's setup, not a pre-existing blocker

## Security Domain

`security_enforcement` is not set to `false` in `.planning/config.json`, so this section is included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | Yes (minimal) | Server-side shared-secret comparison (D-01), never client-side; httpOnly cookie, not localStorage/sessionStorage |
| V3 Session Management | Yes | httpOnly + `secure` + `sameSite: 'lax'` cookie with explicit `maxAge` (~30 days, D-03); no session storage/rotation mechanism beyond re-entering the passphrase — acceptable per PITFALLS.md's explicit "single user, no accounts system" scoping |
| V4 Access Control | Yes | `proxy.ts` (or equivalent) gates all of `/api/watches/*` (and recommended: `/api/ridb/*`); defense-in-depth re-check inside each Route Handler |
| V5 Input Validation | Yes | Strict zod schema (`.min(1)`, unique-id refine) on every write path payload, mirroring `src/config/schema.ts`; never trust client-side form validation alone |
| V6 Cryptography | Minimal | No custom crypto needed — a plain equality check against an env-var secret is sufficient at this threat model (single named user); do not build a custom hashing/signing scheme where none is required |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Unauthenticated write to `watches.json` (PITFALLS.md Pitfall 4) | Tampering / Denial of Service | Session-cookie gate on all mutation routes, verified server-side, defense-in-depth double-check in each Route Handler |
| GitHub PAT leaking to the client bundle | Information Disclosure | PAT read only inside server-only modules (`github-write.ts`), never in a `'use client'` file or `NEXT_PUBLIC_*` var |
| RIDB API key leaking to the client bundle | Information Disclosure | Same discipline applied to `dashboard/lib/ridb.ts` — server-only, called via Route Handlers |
| Lost edit via git-write race (PITFALLS.md Pitfall 3) | Tampering (data loss, not malicious) | sha-based optimistic concurrency + one bounded 409 retry |
| Silent auth bypass via `middleware.ts`/`proxy.ts` filename mismatch (this research's own finding) | Elevation of Privilege (accidental) | Use `proxy.ts` + `proxy()` export; verify against a production build, not just `next dev` |

## Sources

### Primary (HIGH confidence)
- Direct reads of `dashboard/lib/github.ts`, `dashboard/lib/schema.ts`, `dashboard/lib/types.ts`, `src/recreation-gov/client.ts`, `src/recreation-gov/types.ts`, `src/config/schema.ts`, `dashboard/app/page.tsx`, `dashboard/package.json`, `.env.example`, `.planning/phases/04-area-based-search/04-PATTERNS.md` — this session, ground truth for "what exists today."
- Context7 (`/vercel/next.js`) — `cookies()` API usage, `proxy.mdx`/`version-16.mdx` middleware→proxy rename, `matcher` config — fetched and quoted directly in this session.
- `docs.github.com/en/rest/repos/contents` (via WebFetch, this session) — GET/PUT Contents API request/response shape, 409 behavior.
- `npm view next version` / `npm view react-hook-form version` (this session) — 16.3.3 / 7.86.0 current.

### Secondary (MEDIUM confidence)
- `github.com/ships/ridb` docs (RecArea.md, RecreationAreaAddress.md, Organization.md, Facility.md — via WebFetch of raw GitHub content, this session) — an OpenAPI-generated client's model documentation, cross-verified against this codebase's own already-confirmed `RecAreaID`/`RecAreaName` field-naming convention. Used to answer D-08's open verification question: no direct state field on RecArea; state lives in a separate `RecreationAreaAddress` resource.
- WebSearch, multiple 2026-dated community posts (bhived.ai, dev.to, medium.com) independently corroborating the Next.js 16 `middleware.ts`→`proxy.ts` silent-failure behavior — cross-referenced against the official Next.js docs finding above (used to increase confidence from "official doc mentions rename" to "official doc + independent community confirmation of the exact silent-failure risk").

### Tertiary (LOW confidence)
- A `ctx7`-fetched RIDB API summary via the generic `/websites/ridb_recreation_gov` Context7 library ID produced garbled, apparently-corrupted output (stray non-Latin characters mixed into field names, camelCase field names inconsistent with this codebase's already-verified PascalCase `RECDATA`/`RecAreaID` convention) — **explicitly discarded, not used for any claim in this document.** Flagging this here as a documented "looked wrong, didn't trust it" decision per this research's own honesty discipline.

## Metadata

**Confidence breakdown:**
- Standard stack / GitHub Contents API mechanics: HIGH — official docs, stable API, cross-verified with existing milestone research
- Next.js 16 `middleware`→`proxy` rename: HIGH — official docs + independent community corroboration, directly relevant and directly verified in this session
- RIDB `/recareas` field shape (D-08's disambiguation question): MEDIUM — credible secondary source (OpenAPI-generated client docs), not a live authenticated probe; recommend a fixture-capture spike as this phase's first task
- Architecture/patterns for the write path itself: HIGH — directly extends this repo's own established, already-shipped conventions (`github.ts`, Phase 4's `client.ts`)
- Security domain: HIGH for what's in scope (shared-secret gate, PAT hygiene) — deliberately minimal per the project's explicit "no accounts system" constraint, not a gap

**Research date:** 2026-08-26
**Valid until:** ~30 days for the codebase-pattern claims (stable, won't drift); ~7 days for the Next.js version-specific claims if the project's `next` dependency is upgraded again before this phase is implemented (re-check the changelog for any further `proxy.ts` behavior changes); the RIDB field-shape MEDIUM-confidence claim should be re-verified via the recommended live spike before, not after, implementation — treat it as unresolved until then, not just "aging."

---
*Research for: Phase 5 — Watch-Management Write Path, Campground Crawler v1.1*
*Researched: 2026-08-26*
