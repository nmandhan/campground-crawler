# Phase 3: Status Dashboard - Research

**Researched:** 2026-08-23
**Domain:** Next.js App Router on Vercel, reading public GitHub repo state at request time; extending an existing GitHub Actions workflow to append a capped rolling log
**Confidence:** MEDIUM-HIGH (framework/deployment mechanics HIGH via official docs; specific rate-limit numbers MEDIUM via GitHub docs/changelog, not independently load-tested)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Run History Data**
- **D-01:** The GitHub Actions workflow (`.github/workflows/poll.yml`) is extended to append each cycle's run outcome to a rolling run-history log file (e.g. `runs.json`), committed back to the repo alongside `state.json`. Each entry captures at minimum: timestamp, per-watch outcome (MATCH/NO_MATCH/FAILED + reason), and counts — sourced from the existing `RunSummary` shape already returned by `run()` (`src/types.ts`).
- **D-02:** The run-history log is capped at the last 50 entries (~4 hours at the current 5-minute cadence). Oldest entries are dropped as new ones are appended, so the committed file doesn't grow unbounded over months of polling.

**Data Access**
- **D-03:** The dashboard is server-rendered and fetches `watches.json`, `state.json`, and the new `runs.json` directly from GitHub (raw content or Contents API) at request time — no build-time baking, no Vercel/GitHub Actions integration needed. Always reflects the latest committed state; page-load latency from the extra fetches is acceptable for a single-user, low-traffic tool.

**Access Control**
- **D-04:** The dashboard page is public with no authentication. The repo (including `watches.json` and now `runs.json`) is already public per Phase 2 D-01 — the dashboard doesn't increase exposure. No login, token, or shared-secret gate.

**Dashboard Content**
- **D-05:** Per-watch current status: park name, date range, site type, and most recent outcome (MATCH / NO_MATCH / FAILED + reason) with a timestamp, derived from `watches.json` + the latest matching entries in `runs.json`.
- **D-06:** Recent run timeline: a chronological feed of the last N poll cycles across all watches (from `runs.json`) — when they ran, what happened, any failures.
- **D-07:** Currently-active matches section: sites currently matched-and-dedup'd (from `state.json`'s entries) shown with booking links, so the user can see "here's what's open right now" at a glance without email.

**Framework**
- **D-08:** Built as a Next.js App Router project deployed on Vercel. A server component (or route handler) does the GitHub fetches and renders the page server-side per request. This is the first frontend/framework code in the repo — the existing `src/` CLI/poller code is untouched; the dashboard lives in its own project structure (e.g. a `dashboard/` or `web/` subdirectory, or a separate Next.js app — left to research/planning to determine the cleanest layout for a single-repo, two-deployable-artifact setup).

### Claude's Discretion
- Exact `runs.json` schema/field names beyond "timestamp + per-watch outcome + counts, sourced from RunSummary" (D-01)
- Exact page layout, styling, and component structure within Next.js App Router
- Whether the dashboard lives in a subdirectory of the existing repo or requires restructuring (e.g. moving `src/` under a `poller/` subfolder) — research should recommend based on Vercel's monorepo/root-directory support
- GitHub raw-file fetch mechanism (raw.githubusercontent.com vs. Contents API vs. authenticated API call) and any caching/revalidation strategy within the "request time" constraint of D-03
- Exact wording/formatting of timestamps, relative time display ("5 minutes ago" vs. ISO), and empty-state copy when no watches have matched yet

### Deferred Ideas (OUT OF SCOPE)
- Watch-management UI (editing `watches.json` from the browser) — explicitly out of scope per REQUIREMENTS.md; this phase is read-only.
- Auth/access gating beyond "public, no auth" (D-04) — could be revisited if the user later wants the dashboard private, but not needed now since the repo itself is already public.
- Re-attempting real email delivery via Resend domain verification — remains blocked/deferred from Phase 2 plan 02-04; this phase does not touch that path.
</user_constraints>

## Project Constraints (from CLAUDE.md)

- **Runtime/stack baseline:** Node.js 22.x LTS + TypeScript 5.7+, run via `tsx` (no build step) for existing `src/` code — this phase's `dashboard/` subproject is the first exception, since Next.js requires its own build/dev tooling (not `tsx`-run); this is expected and does not violate the root convention since it's isolated to `dashboard/`.
- **Validation:** `zod` is the project-standard validation library — reuse it in `dashboard/` for parsing fetched JSON rather than introducing a different schema library.
- **Persistence:** State is committed JSON files in the repo (no database) — `runs.json` continues this pattern; the dashboard must not introduce a database or new persistence layer.
- **Architecture:** Core pipeline (config loader -> API client -> matcher -> persisted state -> email sender) stays deployment-agnostic; this phase does not touch that pipeline, it only adds a read-only viewer.
- **GSD workflow enforcement:** File-changing work must go through a GSD command (`/gsd-execute-phase` etc.) — noted for the execution phase, not directly actionable by research, but the planner should structure tasks accordingly.


## Summary

This phase adds the repo's first frontend code. The cleanest, lowest-risk pattern is a **monorepo-style subdirectory** (`dashboard/`) inside the existing repo, with Vercel's **Root Directory** project setting pointed at that subdirectory. This keeps `src/` (the CLI/poller) and the new Next.js app in one repo with zero build-step coupling — the poller stays plain `tsx`/Node, the dashboard gets its own `package.json`, its own `node_modules`, and its own TypeScript/ESM config, isolated from the root `tsconfig.json` and root `"type": "module"` setting. Vercel builds only the subdirectory by default (via Root Directory), so the CLI code and its dependencies never enter the dashboard's build graph, and vice versa.

For data access, **`raw.githubusercontent.com`** (not the Contents API) is the right fetch target: it's served off GitHub's CDN, is not subject to the much stricter 60 req/hr unauthenticated Contents API cap, and needs no token for a public repo. Next.js's built-in `fetch()` cache with a short `revalidate` window (e.g. 30-60s) is sufficient to avoid hammering GitHub on every page load while keeping data "current enough" for a 5-minute poll cadence — there is no need for ISR, ISG, ondemand ISR/webhooks, ordinary ISG or ondemand revalidation given D-03's "no build-time baking, no deploy-hook integration" constraint.

For the workflow extension, the existing bash "commit only if changed" step in `.github/workflows/poll.yml` can be copied nearly verbatim; the only new logic is a `jq`-based append-and-slice step that reads `runs.json` (or starts a fresh array), pushes the new run entry, and keeps only the last 50 with `jq '.[-50:]'`.

**Primary recommendation:** `dashboard/` subdirectory + Vercel Root Directory = `dashboard`, fetch three JSON files from `raw.githubusercontent.com` with `next: { revalidate: 30 }`, and add one `jq`-based step to `poll.yml` that appends to and caps `runs.json` before the existing commit step (extended to include `runs.json` alongside `state.json`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Run history persistence (runs.json append+cap) | CI/Automation (GitHub Actions) | — | Same tier that already owns state.json commit-back (D-01/D-02); no new persistence mechanism |
| Data fetch (watches.json/state.json/runs.json) | Frontend Server (Next.js Server Component) | — | D-03 locks server-rendered, request-time fetch — never client-side, never build-time |
| Rendering (status table, timeline, active matches) | Frontend Server (SSR, no client JS needed) | Browser (static HTML only) | No interactivity required (read-only dashboard) — plain Server Components avoid shipping a client bundle |
| Hosting/deploy | CDN/Static (Vercel edge for the built app) + Frontend Server (per-request functions) | — | Vercel serves the Next.js app; the fetch-and-render work happens in a serverless/edge function per request, not at build time |
| Source of truth for displayed data | Database/Storage (GitHub repo, committed JSON) | — | No database introduced; GitHub repo continues as the persistence layer per ARCHITECTURE.md |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.3.2 [VERIFIED: npm registry] | App Router framework, SSR, fetch caching | Official, actively maintained; App Router is the current (non-legacy) Next.js paradigm |
| react / react-dom | 19.2.8 [VERIFIED: npm registry] | Required peer for Next.js 16.x Server Components | Next.js 16 requires React 19.x |
| typescript | latest stable (independent per-project) | Type safety in dashboard code, mirrors root repo convention | Consistency with rest of repo's TS-first approach |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| — | — | No date-formatting or timeline library needed | `Intl.RelativeTimeFormat` (built into Node/browser) covers "5 minutes ago" formatting without adding a dependency (date-fns/dayjs) — D-08 discretion item can be satisfied natively |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `dashboard/` subdirectory in existing repo | Separate sibling repo for the dashboard | Separate repo avoids any monorepo/root-directory config, but splits the project across two repos, complicates cross-referencing `runs.json`'s schema with `src/types.ts`, and gains nothing since Vercel's Root Directory support handles the subdirectory case cleanly. Rejected — subdirectory is simpler for a single-user project. |
| `raw.githubusercontent.com` fetch | GitHub Contents API (`api.github.com/repos/.../contents/...`) | Contents API returns JSON already base64-encoded (extra decode step) and unauthenticated requests are capped at 60/hr — far tighter than raw content's CDN-backed general limit. Contents API only makes sense if you need file metadata (SHA, path listing) or private-repo auth via a token; neither applies here (D-04: repo is public, files are simple JSON). |
| Next.js `fetch()` cache + `revalidate` | Manual `Cache-Control` headers + `unstable_cache` / Route Handler with custom in-memory cache | Built-in `fetch()` caching is simpler and is the documented, current (2026) idiom for per-request revalidation in the App Router; no need for `unstable_cache` since there's no expensive computation to memoize beyond the fetch itself. |

**Installation (inside `dashboard/`):**
```bash
cd dashboard
npx create-next-app@latest . --typescript --app --no-tailwind --no-src-dir --eslint --import-alias "@/*"
```
(Or hand-roll — see minimal scaffold below; `create-next-app` pulls in more than strictly needed for a single read-only page, but is the standard bootstrap and safe to trim.)

**Version verification:** `next@16.3.2` and `react@19.2.8` confirmed current via `npm view next version` / `npm view react version` on 2026-08-23 [VERIFIED: npm registry]. Training-data knowledge of Next.js "13/14 App Router" is stale — verify the installed major version at execution time since Next.js has moved fast (App Router itself is no longer new; by v16 it is the only router path for new projects, `pages/` is legacy).

## Architecture Patterns

### System Architecture Diagram

```
GitHub Actions (every 5 min)                 Vercel (on-demand, per request)
┌─────────────────────────────┐              ┌──────────────────────────────────┐
│ poll.yml                     │              │ dashboard/ (Next.js App Router)   │
│  1. npm start (poller)        │              │                                    │
│  2. RunSummary produced        │              │  Browser GET /  ──────────────┐   │
│  3. append to runs.json,       │              │                                │   │
│     cap at last 50             │              │  Server Component (page.tsx)  │   │
│  4. commit state.json +        │              │   │ fetch watches.json  ──┐   │   │
│     runs.json if changed       │              │   │ fetch state.json    ──┼─► raw.githubusercontent.com
│     (git push)                 │              │   │ fetch runs.json     ──┘   │   │
└──────────────┬────────────────┘              │   │  (next: {revalidate: 30}) │   │
               │ git push                       │   ▼                            │   │
               ▼                                │  merge/derive:                 │   │
   github.com/nmandhan/campground-crawler       │   - per-watch status (D-05)    │   │
   (public repo, main branch)                   │   - run timeline (D-06)        │   │
     watches.json                               │   - active matches (D-07)      │   │
     state.json                                 │   ▼                            │   │
     runs.json  ◄──────── read by dashboard ────┤  render HTML (SSR, no client   │   │
                                                 │  JS needed) ───────────────────┼──►│ Browser (rendered page)
                                                 └──────────────────────────────────┘
```

The two pipelines (poller → repo, dashboard → repo) are decoupled: the poller never talks to Vercel, and Vercel never triggers or waits on GitHub Actions. The repo's committed JSON files are the sole integration point, matching D-03 and the project's existing "committed-JSON-as-database" architecture.

### Recommended Project Structure
```
campground-crawler/
├── src/                    # UNCHANGED — existing CLI/poller (plain tsx, no framework)
├── .github/workflows/
│   └── poll.yml             # extended: + runs.json append/cap step
├── watches.json
├── state.json
├── runs.json                 # NEW — rolling 50-entry run-history log
├── package.json              # UNCHANGED (root stays CLI-only, no Next.js deps leak in)
├── tsconfig.json             # UNCHANGED
└── dashboard/                 # NEW — self-contained Next.js App Router project
    ├── package.json           # own deps: next, react, react-dom, typescript
    ├── tsconfig.json           # own config, independent of root's NodeNext/ESM setup
    ├── next.config.ts
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx            # single server component page — the whole dashboard
    │   └── globals.css         # minimal/no styling framework needed
    └── lib/
        ├── github.ts           # fetchJson(path) helper wrapping raw.githubusercontent.com
        └── types.ts             # dashboard-local copies/subsets of RunSummary/MatchedSlot/WatchOutcome shapes (see Pitfall below)
```

**Vercel project settings:**
- Root Directory: `dashboard`
- Framework Preset: Next.js (auto-detected)
- Build Command / Output Directory: leave as framework defaults
- No "Include source files outside of the Root Directory" needed — the dashboard does not import anything from `src/` (it only fetches JSON over HTTP, it does not import TypeScript types across the boundary at build time)

### Pattern 1: Request-time GitHub raw fetch with short revalidation
**What:** Server Component (or a Route Handler used by the page) calls `fetch()` against `raw.githubusercontent.com/{owner}/{repo}/{branch}/{file}` with Next.js's `next.revalidate` option, not `cache: 'no-store'`.
**When to use:** Any time the dashboard needs current data reflecting "the latest commit on `main`" without rebuilding/redeploying.
**Example:**
```typescript
// Source: https://nextjs.org/docs/app/api-reference/functions/fetch (Next.js fetch caching docs)
const RAW_BASE = 'https://raw.githubusercontent.com/nmandhan/campground-crawler/main';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${RAW_BASE}/${path}`, {
    next: { revalidate: 30 }, // seconds — balances freshness vs. request volume
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path}: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// app/page.tsx
export default async function DashboardPage() {
  const [watches, state, runs] = await Promise.all([
    fetchJson<Watch[]>('watches.json'),
    fetchJson<StateFile>('state.json'),
    fetchJson<RunLogEntry[]>('runs.json'),
  ]);
  // derive per-watch status, timeline, active matches here
  return <main>{/* ... */}</main>;
}
```
`revalidate: 30` means: Vercel's Data Cache serves a cached copy for up to 30s, then the *next* request triggers a background refetch — worst case a visitor sees data up to ~30s stale, which is acceptable for a 5-minute poll cadence and avoids a raw-content request on every single page load.

### Pattern 2: Deriving dashboard sections from raw JSON without a shared package
**What:** Since `dashboard/` is a separate Next.js project (own `package.json`), it cannot `import` from `src/types.ts` at build time without extra tooling (path mapping across package boundaries, or a shared workspace package). For a single-user, three-file dashboard, the simplest approach is to hand-copy/redeclare the relevant shapes (`RunSummary`-derived `runs.json` entry shape, `MatchedSlot`, `WatchOutcome`, `Watch`, and the `state.json` entries shape) into `dashboard/lib/types.ts` as plain interfaces matching the JSON shape.
**When to use:** Always, for this phase — introducing a shared npm workspace / pnpm monorepo tooling (Turborepo, npm workspaces) purely to share 4 type definitions is disproportionate scope for a single-user tool.
**Anti-pattern avoided:** Don't set up `npm workspaces` at the repo root just to import types — it would also start pulling Next.js's `node_modules` tree into `npm ci` at the root, which the poller's GitHub Actions workflow (`npm ci` + `npm start`) does not need and would slow down every 5-minute poll run.

### Anti-Patterns to Avoid
- **Build-time data baking (static generation of the page at deploy time):** Explicitly rejected by D-03. Do not use `generateStaticParams`, do not remove the `revalidate`/dynamic fetch, and do not rely on a Vercel deploy hook triggered from `poll.yml` — the dashboard must reflect data as of *request* time, sourced fresh(ish) from GitHub on each visit.
- **`cache: 'no-store'` on every fetch:** Technically satisfies "always current" but re-fetches from `raw.githubusercontent.com` on literally every page load, including bursty traffic (e.g., a user refreshing repeatedly). Given GitHub's raw-content CDN is generally more resilient than the 60/hr Contents API cap, this isn't strictly dangerous at single-user, low-traffic scale, but a short `revalidate` window is a low-cost hedge against surprise traffic (e.g., search-engine crawlers, someone sharing the link) with no meaningful freshness cost.
- **Sharing a single root `tsconfig.json`/`package.json` between `src/` and `dashboard/`:** Would force ESM/NodeNext resolution rules and dependency versions onto a project (Next.js) that has its own conventions and its own opinionated `tsconfig` needs (JSX, `moduleResolution: bundler`, etc.) — keep them fully independent, two `npm ci` runs, two `package-lock.json` files.
- **Importing `src/types.ts` directly from `dashboard/` via a relative path:** Works at first (TypeScript doesn't care about `package.json` boundaries for a relative import), but silently couples the dashboard's build to `src/`'s dependencies/tsconfig and breaks the "own project structure" intent of D-08. Redeclare the shapes locally instead (Pattern 2).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Relative timestamp formatting ("5 minutes ago") | Custom date-diffing function | `Intl.RelativeTimeFormat` (native, zero dependencies) | Built into Node 22/modern browsers; handles pluralization/locale correctly, no need for date-fns/dayjs for one formatting need |
| GitHub raw-file fetching with caching | Custom in-memory cache / manual `Cache-Control` header parsing | Next.js `fetch()` + `next.revalidate` | This is exactly the built-in, documented mechanism Next.js provides for "revalidate every N seconds" server-side data fetching — reinventing it with a custom cache layer adds complexity for zero benefit |
| Run-history log rotation (cap at last 50) | Custom trimming logic embedded in `run()` or a bespoke Node script | `jq '. + [$newEntry] | .[-50:]'` in the workflow YAML (same shell-scripting pattern already used for the state.json commit-if-changed step) | Keeps the append/cap logic co-located with the existing bash step it must follow the same convention as; avoids adding new src/ code and a new code path to test/maintain for a mechanical array-slicing operation |

**Key insight:** This phase is almost entirely "wire existing pieces together with standard framework primitives" — the only genuinely new logic is the JSON derivation on the dashboard page (merging watches/state/runs into three display sections), which is plain data transformation, not something with an existing library solution.

## Common Pitfalls

### Pitfall 1: `raw.githubusercontent.com` CDN cache lag vs. Next.js's own revalidate window
**What goes wrong:** Even with `revalidate: 30` on the Next.js side, `raw.githubusercontent.com` itself sits behind GitHub's own CDN (Fastly), which has been observed to cache content for a period after a push before reflecting the new commit — so "freshest possible" is bounded by both layers, not just the one you control.
**Why it happens:** raw.githubusercontent.com is a public CDN endpoint, not a live git-blob passthrough; GitHub does not guarantee an SLA for propagation delay.
**How to avoid:** Treat the dashboard as "eventually consistent within roughly a minute or two of a poll cycle," not real-time. Communicate this via a visible "last updated" or "data as of {runs.json's latest timestamp}" label sourced from the JSON payload itself (not from page-render time) — this way even if the CDN serves slightly stale content, the displayed timestamp is honest about what's actually shown, rather than implying live data. [MEDIUM confidence — CDN lag is documented community experience, not an official GitHub SLA]
**Warning signs:** Dashboard shows a run timeline that's missing the most recent 1-2 poll cycles even after waiting past the `revalidate` window.

### Pitfall 2: Two `package.json`/`package-lock.json` files diverging or CI confusion
**What goes wrong:** With `dashboard/` as an independent Next.js project, `npm ci` at the repo root (used by `poll.yml`) will NOT install Next.js's dependencies, and Vercel's build (scoped to `dashboard/` via Root Directory) will not see the root's `package.json`. If someone accidentally runs `npm install <pkg>` from the repo root intending to add it to the dashboard, it lands in the wrong `package.json`.
**Why it happens:** Two independent Node projects sharing one git repo, easy to run commands from the wrong working directory.
**How to avoid:** Document clearly (README or a comment) that `dashboard/` is `cd`'d into before any `npm` command targeting the dashboard; consider a root `.gitignore` entry for `dashboard/node_modules/` explicitly (in addition to the existing blanket `node_modules/` rule, which already covers it — verify no override is needed).
**Warning signs:** `npm ci` at root suddenly takes much longer / pulls in `next`/`react` — sign that a dependency was added to the wrong `package.json`.

### Pitfall 3: GitHub Actions bot commits (`runs.json`) racing with a slow dashboard revalidation, producing a confusing but harmless "flash of old data"
**What goes wrong:** Because `runs.json` is appended and pushed by the workflow every ~5 minutes, and the dashboard caches for ~30s at a time, a user loading the dashboard right as a new commit lands could see the previous cycle's data, then a refresh 30s+ later shows the new cycle. Not a bug, just worth setting expectations for.
**Why it happens:** Inherent to polling + caching architecture — no locking or webhook exists between the two systems (by design, per D-03: no deploy-hook integration).
**How to avoid:** No fix needed; document as expected behavior. If tighter consistency is ever wanted later, `revalidate: 0` (always fetch fresh) is a one-line change, at the cost of a raw-content request on every page load.
**Warning signs:** N/A — cosmetic, not a defect.

### Pitfall 4: ESM/CJS or Node-version mismatch between root and `dashboard/`
**What goes wrong:** The root project sets `"type": "module"` and uses `NodeNext` module resolution, targeting Node 22. A freshly scaffolded Next.js project defaults to its own `moduleResolution: "bundler"` and does not need (and should not inherit) `"type": "module"` at its own `package.json` level — Next.js's build tooling (webpack/Turbopack via the Next.js compiler) handles module interop internally regardless of `"type"` field.
**Why it happens:** Assuming settings must be "consistent" across the whole repo when in fact these are two independently-toolchained projects.
**How to avoid:** Let `create-next-app`'s defaults stand for `dashboard/package.json` and `dashboard/tsconfig.json` — do not copy settings from the root `tsconfig.json`. Confirmed no shared `tsconfig` extends relationship is needed since root's `tsconfig.json` `include: ["src"]` doesn't reach into `dashboard/` anyway.
**Warning signs:** Type errors referencing `NodeNext`/ESM resolution rules inside `dashboard/` files, or Next.js build failures about unexpected `"type": "module"` behavior (only relevant if someone manually copies the root's package.json fields into the dashboard's).

## Code Examples

### Minimal `dashboard/app/page.tsx` structure (D-05/D-06/D-07 sections)
```typescript
// Source: pattern derived from Next.js App Router Server Component docs
// https://nextjs.org/docs/app/building-your-application/rendering/server-components
import { fetchJson } from '@/lib/github';
import type { Watch, StateFile, RunLogEntry } from '@/lib/types';

export const dynamic = 'force-dynamic' === undefined ? undefined : undefined; // NOT used — see note below

export default async function Page() {
  const [watches, state, runs] = await Promise.all([
    fetchJson<Watch[]>('watches.json'),
    fetchJson<StateFile>('state.json'),
    fetchJson<RunLogEntry[]>('runs.json'),
  ]);

  return (
    <main>
      <section aria-label="Active matches">{/* D-07: derive from state.entries */}</section>
      <section aria-label="Per-watch status">{/* D-05: derive from watches + latest runs entries */}</section>
      <section aria-label="Run timeline">{/* D-06: runs, most recent first */}</section>
    </main>
  );
}
```
Note: do NOT set `export const dynamic = 'force-dynamic'` — that would opt out of the fetch cache entirely and defeat the purpose of the `revalidate` window (it's shown crossed-out above only to flag it as something planners might reach for and should avoid; rely on `next: { revalidate: 30 }` on the `fetch()` calls instead, which is the documented per-fetch granularity control).

### Workflow extension: append-and-cap `runs.json`
```yaml
# Source: pattern extends the existing "Commit dedup state if it changed" step
# in .github/workflows/poll.yml, following the same commit-if-changed convention.
- name: Append run to history log
  if: always()
  run: |
    set -euo pipefail
    # $RUN_SUMMARY_JSON assumed written by the poller step to a file, e.g. run-summary.json
    # (exact production mechanism — poller writes it vs. workflow derives it from step output —
    # is a planning decision; jq logic below is agnostic to the source)
    if [ ! -f runs.json ]; then echo '[]' > runs.json; fi
    jq --slurpfile new run-summary.json '. + $new | .[-50:]' runs.json > runs.json.tmp
    mv runs.json.tmp runs.json

- name: Commit dedup state and run history if changed
  if: always()
  run: |
    set -euo pipefail
    if [ -z "$(git status --porcelain -- state.json runs.json)" ]; then
      echo "No state changes — skipping commit"
      exit 0
    fi
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git add state.json runs.json
    git commit -m "chore: update dedup state and run history [skip ci]"
    git push
```
This mirrors the exact commit-if-changed pattern already in `poll.yml` (lines 45-57), extended to check/add both files in one commit. `jq --slurpfile` reads the single new entry as an array-wrapped value and concatenates; `.[-50:]` caps at the last 50. The exact mechanism for producing `run-summary.json` (poller writes a file directly vs. capturing stdout/step output) is left to planning — `RunSummary` already exists as a return value from `run()` in `src/run.ts`, so the poller's CLI entrypoint likely needs a small addition to serialize it to a file when running in CI, OR the workflow step could shell out to a small Node script that imports `run()`'s last-known summary. This seam is a planning decision, not fully resolved by research.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Next.js `pages/` directory router | App Router (`app/`) | Stable since Next.js 13 (2022), now the only recommended path for new projects as of Next.js 16 | `create-next-app` defaults to App Router; Server Components are the default component type (no `'use client'` needed unless interactivity is required) |
| `getServerSideProps` for per-request data fetching | `async` Server Components with `fetch()` + `next.revalidate` | Superseded with App Router's introduction | Data fetching happens directly inside the component function, no special exported function needed |
| GitHub API PAT (classic) for elevated rate limits | Fine-grained PATs / no token needed for public raw content | Ongoing GitHub-wide push toward fine-grained tokens | Not directly relevant here since D-04 keeps the repo public and no auth is planned — flagging in case a future private-repo pivot is considered |

**Deprecated/outdated:** Next.js `pages/` router is legacy but still supported — not relevant to this greenfield dashboard, App Router is the correct choice from the start.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `raw.githubusercontent.com`'s effective rate limit for this use case (CDN-backed, not the 60/hr Contents API limit) is generous enough for a single-user dashboard even without a token | Standard Stack / Pitfall 1 | If GitHub's raw-content CDN turns out to be more aggressively throttled than assumed for a given deployment's IP pool (shared Vercel IPs, per earlier Vercel "noisy neighbor" search result), occasional 429s could surface on the dashboard. Mitigation is cheap either way (Next.js's fetch cache already minimizes actual outbound requests to roughly one per 30s per unique file, well under any plausible limit) — LOW practical risk despite being unverified by a live load test. |
| A2 | GitHub Actions' `jq` is available on `ubuntu-latest` runners by default (no explicit install step needed) | Code Examples (workflow YAML) | If wrong, the append-and-cap step fails outright; trivial fix (`apt-get install -y jq` or use a `jq`-setup action), but should be verified in the actual plan/execution rather than assumed permanently true across GitHub's runner image updates. `jq` has shipped on `ubuntu-latest` images for years — LOW risk. |
| A3 | The poller (`src/run.ts`) does not currently serialize `RunSummary` to a file for CI consumption — this is new work needed to feed the `runs.json` append step | Code Examples | If the poller already logs `RunSummary` somewhere machine-readable (e.g., stdout as JSON) that this research missed, the plan might redundantly add a new file-write step. Low risk — worth a quick grep of `src/cli.ts`/`src/run.ts` during planning to confirm before designing the exact wiring. |

**Note:** A1/A2 are technical-infrastructure risk assumptions (not user-facing product decisions), so they don't require the same "confirm with user" treatment as e.g. retention policy or compliance claims — but the planner should still treat them as unverified and build in a cheap fallback (e.g., a token-authenticated fetch as a documented escape hatch if raw-content 429s are observed post-launch).

## Open Questions

1. **Exact mechanism for producing the per-run JSON payload that gets appended to `runs.json`**
   - What we know: `RunSummary` (from `src/types.ts`) is the source shape; it's already returned by `run()`.
   - What's unclear: Whether the CLI entrypoint (`src/cli.ts`) should be extended to write `RunSummary` to a file (e.g., `run-summary.json`) when invoked in CI, or whether the workflow should invoke a small dedicated script/flag for this. This is a `src/` code change, not purely a workflow YAML change — worth flagging clearly for the planner since D-01 says "extended to append," implying `src/` involvement, not just YAML.
   - Recommendation: Planner should decide between (a) `run()` gains a CI-mode flag/env var that writes its `RunSummary` to `run-summary.json` after each invocation, or (b) a thin wrapper script in `scripts/` that calls `run()` and writes the file, keeping `run()`'s public API/return-value contract untouched (safer, per Phase 1/2's stated "don't change `run()`'s shape" precedent (RunSummary docstring: "Phase 2 wires email off this without changing run()'s shape (D-07)")).

2. **Exact `runs.json` entry schema (field names)**
   - What we know: D-01 specifies "timestamp, per-watch outcome (MATCH/NO_MATCH/FAILED + reason), and counts" sourced from `RunSummary`.
   - What's unclear: Whether each `runs.json` entry stores the full `RunSummary` object as-is (simplest, but slightly larger/more nested than needed for a timeline UI) or a flattened/trimmed subset.
   - Recommendation: Store `RunSummary` close to as-is (it's already compact — `checked`, `outcomes[]`, `newMatches[]`, `failed[]`, `noMatch[]` — no need to re-derive fields), which also means the dashboard's local type copy (Pattern 2) can mirror `RunSummary` almost 1:1, minimizing drift risk. Left as Claude's Discretion per CONTEXT.md — this is not a blocking question for planning, just worth the planner explicitly deciding and documenting once.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Node.js 22.x | Both root CLI and `dashboard/` (Next.js 16 requires Node ≥ 20.9, 22 LTS already used by repo) | ✓ (per CLAUDE.md stack) | 22.x LTS | — |
| npm | Package management for both projects | ✓ | bundled with Node 22 | — |
| jq | New `runs.json` append/cap workflow step | ✓ (standard on `ubuntu-latest` GitHub-hosted runners) [ASSUMED — see A2] | ubuntu-latest default | `apt-get install -y jq` if ever missing |
| Vercel account + CLI/dashboard access | Deployment target for `dashboard/` | Not verified in this session — requires user to have/create a Vercel account and link the GitHub repo | — | None — this is a hard external dependency; planner should include a task for connecting the Vercel project to the repo with Root Directory = `dashboard` |
| GitHub public repo (`nmandhan/campground-crawler`) | Source of watches.json/state.json/runs.json for the dashboard fetch | ✓ (confirmed public per Phase 2 D-01, remote verified: `github.com/nmandhan/campground-crawler`) | — | — |

**Missing dependencies with no fallback:**
- Vercel project linkage (must be set up by the user/planner during execution — no code-only substitute since this is a hosting/deployment step, not a library dependency)

**Missing dependencies with fallback:**
- `jq` absence on runner (unlikely) — falls back to an inline Node one-liner (`node -e "..."`) using the same commit-if-changed step structure, since Node is already guaranteed present.

## Validation Architecture

No `.planning/config.json` `workflow.nyquist_validation: false` override found — section included per default-enabled policy. However, this phase's original repo has **no existing test framework configured** (`package.json`'s `test` script exists — `node --import tsx --test "src/**/*.test.ts"`, Node's built-in test runner — but this only covers `src/`; the new `dashboard/` subproject has no test setup and, per D-08/D-05-07, is a thin, mostly-presentational SSR page with data-shape-driven logic, not business logic).

### Test Framework
| Property | Value |
|----------|-------|
| Framework (root, `src/`) | Node built-in test runner (`node --test`), existing, unchanged by this phase |
| Framework (dashboard) | None configured yet — recommend adding `node --test` compatible unit tests for the pure derivation functions (deriving per-watch status, timeline entries, active matches from raw JSON) since those are the only non-trivial logic this phase introduces |
| Config file | `dashboard/` — none yet (Wave 0 gap) |
| Quick run command | `cd dashboard && node --import tsx --test "lib/**/*.test.ts"` (mirrors root convention) |
| Full suite command | Same — this phase has no integration/e2e test infra and none is proposed given single-user low-stakes scope |

### Phase Requirements → Test Map
No formal REQ-IDs exist for this phase (per CONTEXT.md domain section — scope comes from ROADMAP.md + CONTEXT.md decisions, not REQUIREMENTS.md). Mapping decisions (D-01 through D-08) to test-worthy behaviors instead:

| Decision | Behavior | Test Type | Automated Command | File Exists? |
|----------|----------|-----------|---------------------|---------------|
| D-02 | `runs.json` capped at last 50 entries after append | unit (workflow logic) | `jq` behavior can be tested with a standalone shell test, or the equivalent Node derivation function if append logic moves into `src/` per Open Question 1 | ❌ Wave 0 |
| D-05 | Per-watch status correctly derives "most recent outcome" from `runs.json` for a given watch | unit | `node --test lib/derive-status.test.ts` | ❌ Wave 0 |
| D-06 | Run timeline renders chronologically, most recent first | unit | `node --test lib/derive-timeline.test.ts` | ❌ Wave 0 |
| D-07 | Active matches derived from `state.json` entries include correct booking links | unit | `node --test lib/derive-active-matches.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** run the relevant `node --test` file for whichever derivation function was touched
- **Per wave merge:** full `dashboard/` test suite (`node --test "lib/**/*.test.ts"`) once Wave 0 scaffolding exists
- **Phase gate:** manual smoke check (load the deployed Vercel URL, confirm all three sections render with real repo data) before `/gsd-verify-work` — this phase has no automated e2e/browser test infra proposed, consistent with a single-user low-stakes internal tool; the derivation-function unit tests plus a manual visual check are the appropriate sampling rate here.

### Wave 0 Gaps
- [ ] `dashboard/lib/derive-status.test.ts`, `derive-timeline.test.ts`, `derive-active-matches.test.ts` — pure-function unit tests for the three JSON-to-display derivations (D-05/D-06/D-07)
- [ ] `dashboard/package.json` `test` script mirroring root's `node --import tsx --test` convention
- [ ] No shared fixtures needed beyond small inline sample JSON matching `Watch[]`/`StateFile`/`RunLogEntry[]` shapes in each test file

## Security Domain

No `security_enforcement: false` found in `.planning/config.json` — section included per default-enabled policy. This phase is low-risk from a security standpoint (public, read-only, no auth, no user input, no secrets touched by the new code path), but the following ASVS-relevant items apply:

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|-----------------|---------|---------------------|
| V2 Authentication | No | D-04 explicitly locks "public, no auth" — not applicable |
| V3 Session Management | No | No sessions/cookies introduced |
| V4 Access Control | No | Public data, public page, no access tiers |
| V5 Input Validation | Marginal — no user input on the dashboard itself, but the dashboard is a *consumer* of untrusted-ish data (its own repo's committed JSON, so effectively trusted, but defensively parse anyway) | Reuse `zod` (already a project-standard dependency per CLAUDE.md) to validate the shape of `watches.json`/`state.json`/`runs.json` after fetch, rather than trusting `res.json()`'s shape blindly — cheap insurance against a malformed commit crashing the page render |
| V6 Cryptography | No | No secrets, no crypto operations in this phase — dashboard reads public data only, no `RESEND_API_KEY`/`RIDB_API_KEY` involvement |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-------------------------|
| Malformed/unexpected JSON shape in `runs.json`/`state.json` (e.g., a bad manual edit, or a future schema change) crashing the SSR render | Denial of Service (of the dashboard itself, not the poller) | Parse fetched JSON through a `zod` schema with `.safeParse()`, render a clear "data unavailable" fallback section instead of letting an unhandled exception 500 the whole page |
| Dashboard exposing more of `state.json`/`runs.json` than intended (e.g., internal error messages/stack-trace-like `reason` strings in `FAILED` outcomes) to a public, unauthenticated audience | Information Disclosure | Low severity here since D-04 already accepts the repo (and thus this exact data) is public — no new exposure is created by surfacing the same fields on a webpage that are already visible in the public repo's committed JSON. No mitigation needed beyond what D-04 already accepted. |
| Cross-site scripting via rendering repo-sourced strings (e.g., `parkName`, failure `reason` text) directly into HTML | Tampering / XSS | React's default JSX text interpolation (`{value}`) auto-escapes — do not use `dangerouslySetInnerHTML` anywhere in this dashboard; no raw HTML rendering is needed for any of D-05/D-06/D-07's content |

## Sources

### Primary (HIGH confidence)
- Next.js official docs — `fetch` API reference: https://nextjs.org/docs/app/api-reference/functions/fetch
- Next.js official docs — Caching (App Router): https://nextjs.org/docs/app/guides/caching-without-cache-components
- Vercel official docs — Monorepos / Root Directory: https://vercel.com/docs/monorepos
- npm registry (`npm view next version`, `npm view react version`) — 2026-08-23 [VERIFIED: npm registry]
- Existing repo files read directly: `.github/workflows/poll.yml`, `src/types.ts`, `package.json`, `tsconfig.json`, `state.json`, `watches.json`, `.gitignore` [VERIFIED: local codebase]

### Secondary (MEDIUM confidence)
- GitHub Changelog — Updated rate limits for unauthenticated requests (2025-05-08): https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/
- GitHub Docs — REST API rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- Vercel Community/discussions on Root Directory config: https://community.vercel.com/t/help-needed-configuring-root-directory/7436
- Vercel Static IPs docs (context for the shared-outbound-IP consideration): https://vercel.com/docs/connectivity/static-ips

### Tertiary (LOW confidence)
- GitHub community discussions on `raw.githubusercontent.com` CDN caching/rate-limit behavior (anecdotal, not an official SLA): https://github.com/orgs/community/discussions/160828, https://github.com/orgs/community/discussions/157940

## Metadata

**Confidence breakdown:**
- Standard stack (Next.js/React versions, Vercel Root Directory mechanics): HIGH — verified via npm registry and official Vercel/Next.js docs
- Architecture (subdirectory layout, fetch/revalidate pattern): HIGH — directly derived from official documented Next.js App Router primitives, no exotic patterns used
- Data-fetch rate limits / CDN staleness specifics: MEDIUM — GitHub's official numbers for the Contents/REST API are documented, but raw.githubusercontent.com's exact CDN behavior/limits are community-observed, not an official published SLA
- Pitfalls (monorepo tooling isolation, ESM/CJS boundary): HIGH — standard, well-documented Next.js/Vercel monorepo guidance
- Open questions around exact `runs.json` production mechanism: intentionally left open — this is a `src/` design decision for the planner, not something research can unilaterally resolve without reading more of `src/run.ts`/`src/cli.ts` internals during planning

**Research date:** 2026-08-23
**Valid until:** ~30 days (stable domain — Next.js/Vercel APIs used here are mainstream and unlikely to break; GitHub rate-limit specifics could shift with less notice, re-verify if execution is delayed significantly)
