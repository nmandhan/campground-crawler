# Phase 3: Status Dashboard - Pattern Map

**Mapped:** 2026-08-23
**Files analyzed:** 12
**Analogs found:** 9 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/cli.ts` (or `src/run.ts`) extension for CI run-summary file | utility (CI serialization hook) | file-I/O | `src/state/fileStore.ts` (`save()`) | role-match |
| `.github/workflows/poll.yml` — new "Append run to history log" step | config (CI workflow step) | batch/transform | existing "Commit dedup state if it changed" step (same file, lines 45-57) | exact |
| `.github/workflows/poll.yml` — extended commit step (state.json + runs.json) | config (CI workflow step) | file-I/O | existing "Commit dedup state if it changed" step (lines 45-57) | exact |
| `runs.json` (repo root, generated artifact) | model (data file) | CRUD (append+cap) | `state.json` (existing committed JSON file) | exact |
| `dashboard/package.json`, `dashboard/tsconfig.json`, `dashboard/next.config.ts` | config | — | none (first frontend project in repo) | no analog |
| `dashboard/lib/types.ts` | model (type declarations) | transform | `src/types.ts` | role-match |
| `dashboard/lib/github.ts` (`fetchJson`) | service (HTTP client) | request-response | `src/recreation-gov/client.ts` (fetch wrapper) | role-match |
| `dashboard/lib/schema.ts` (zod validation of fetched JSON) | utility (validation) | transform | `src/config/schema.ts` | exact |
| `dashboard/lib/derive-active-matches.ts` | utility (pure transform) | transform | `src/matcher/match.ts` (pure function, no I/O) | role-match |
| `dashboard/lib/derive-status.ts` | utility (pure transform) | transform | `src/run.ts` (outcome-classification logic, lines 91-104) | role-match |
| `dashboard/lib/derive-timeline.ts` | utility (pure transform) | transform | `src/run.ts` (outcome-classification logic, lines 91-104) | role-match |
| `dashboard/app/page.tsx` | component (server component) | request-response | none (first React/Next.js code in repo) | no analog |
| `dashboard/app/layout.tsx`, `dashboard/app/globals.css` | component/config | — | none | no analog |
| `dashboard/lib/*.test.ts` | test | — | `src/run.test.ts` (test structure/style) | role-match |

## Pattern Assignments

### `src/cli.ts` extension (or new `scripts/`/`src/` CI hook) — writes `run-summary.json`

**Analog:** `src/cli.ts` (`runOnce`) + `src/state/fileStore.ts` (`save()` atomic-write pattern)

**Existing CLI invocation of `run()`** (`src/cli.ts` lines 33-37):
```typescript
async function runOnce(): Promise<number> {
  const summary = await run();
  console.log(`checked ${summary.checked} — ${summary.newMatches.length} new matches, ${summary.failed.length} failed`);
  return summary.failed.length === 0 ? 0 : 1;
}
```
`run()` already returns the full `RunSummary` (see `src/types.ts` lines 64-73) — the planner's new CI hook should call `run()` exactly as `cli.ts` does today and just add a file write of the returned object, not duplicate `run()`'s logic. Recommend NOT modifying `run()`'s signature/return shape (explicit precedent from RunSummary's own docstring: "Phase 2 wires email off this without changing run()'s shape (D-07)" — same constraint applies here).

**Atomic file-write pattern to copy** (`src/state/fileStore.ts` lines 107-116):
```typescript
async save(): Promise<void> {
  const file: StateFile = {
    version: 1,
    entries: Object.fromEntries([...this.entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
  await mkdir(dirname(this.path), { recursive: true });
  const tmp = `${this.path}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2) + '\n', 'utf8');
  await rename(tmp, this.path);
}
```
Use this same `write-to-.tmp` then `rename()` pattern (avoids partial-write corruption) when writing `run-summary.json` from the CI hook, matching the project's existing convention for all committed JSON files.

---

### `.github/workflows/poll.yml` — new "Append run to history log" step + extended commit step

**Analog:** same file, existing "Commit dedup state if it changed" step (lines 45-57)

**Exact pattern to extend** (`.github/workflows/poll.yml` lines 45-57):
```yaml
- name: Commit dedup state if it changed
  if: always()
  run: |
    set -euo pipefail
    if [ -z "$(git status --porcelain -- state.json)" ]; then
      echo "state.json unchanged — skipping commit"
      exit 0
    fi
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git add state.json
    git commit -m "chore: update dedup state [skip ci]"
    git push
```
Copy verbatim, extending the `git status --porcelain` check, `git add`, and commit message to cover both `state.json` and `runs.json` in one commit (RESEARCH.md's Code Examples section already drafts this exact extension — reuse it):
```yaml
if [ -z "$(git status --porcelain -- state.json runs.json)" ]; then
  echo "No state changes — skipping commit"
  exit 0
fi
...
git add state.json runs.json
git commit -m "chore: update dedup state and run history [skip ci]"
```
Same bot identity (`github-actions[bot]`), same `[skip ci]` suffix, same `if: always()` guard (so a failed poll cycle still gets its FAILED outcome logged) — do not deviate from this convention.

**Workflow permissions/concurrency context to preserve** (`.github/workflows/poll.yml` lines 11-21):
```yaml
concurrency:
  group: poller
  cancel-in-progress: false

permissions:
  contents: write
```
No changes needed here — the new step runs inside the same job, inherits the same `contents: write` permission and non-cancelling concurrency group. Do not add a second job or a separate concurrency group.

**New step (append + cap, no existing analog in-repo — from RESEARCH.md Code Examples, verified consistent with the commit step's `jq`/bash idiom):**
```yaml
- name: Append run to history log
  if: always()
  run: |
    set -euo pipefail
    if [ ! -f runs.json ]; then echo '[]' > runs.json; fi
    jq --slurpfile new run-summary.json '. + $new | .[-50:]' runs.json > runs.json.tmp
    mv runs.json.tmp runs.json
```
`.[-50:]` enforces D-02's 50-entry cap. Place this step after "Run poller" and before the extended commit step.

---

### `dashboard/lib/types.ts` (model/type declarations)

**Analog:** `src/types.ts` (whole file, 78 lines — small enough for one read, already fully in context above)

Redeclare (do not import across the `src/` / `dashboard/` package boundary — RESEARCH.md Pattern 2 explicitly forbids relative-path imports of `src/types.ts` from `dashboard/`) local copies matching:
- `Watch` (lines 11-17) — for parsing `watches.json`
- `MatchedSlot` (lines 46-57) — for parsing `state.json` entries and `runs.json`'s `newMatches`
- `WatchOutcome` (lines 59-62) — discriminated union `MATCH | NO_MATCH | FAILED`, for parsing each `runs.json` entry's `outcomes`
- `RunSummary` (lines 64-73) — the exact shape of each `runs.json` array entry (per RESEARCH.md's recommendation to store `RunSummary` "close to as-is")
- `StateFile`/`StateEntry` from `src/state/store.ts` (lines 3-10) — for parsing `state.json`

```typescript
// src/state/store.ts lines 3-10 — copy this shape into dashboard/lib/types.ts
export interface StateEntry {
  lastNotifiedAt: string; // ISO timestamp
}
export interface StateFile {
  version: 1;
  entries: Record<string, StateEntry>;
}
```

---

### `dashboard/lib/github.ts` (`fetchJson` — service, request-response)

**Analog:** `src/recreation-gov/client.ts` (fetch-wrapping service; role-match for "typed fetch helper with error handling," though data flow differs — RIDB is authenticated request-response, raw.githubusercontent.com is unauthenticated).

Since no in-repo fetch wrapper matches request-time GitHub raw-content fetching, follow RESEARCH.md's Pattern 1 directly (already vetted against official Next.js docs):
```typescript
// dashboard/lib/github.ts
const RAW_BASE = 'https://raw.githubusercontent.com/nmandhan/campground-crawler/main';

export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${RAW_BASE}/${path}`, {
    next: { revalidate: 30 },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path}: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
```
**Error-handling convention to match `src/`'s style:** `src/errors.ts`'s `describeFailure(err)` helper is the project's single point for turning caught errors into safe, loggable strings (used identically in `run.ts` lines 84-86 and `config/watches.ts` lines 27-31). The dashboard's error/empty-state copy (UI-SPEC.md: "Unable to load dashboard data") should be produced the same way — catch the fetch error at the page level and render the copy from UI-SPEC.md rather than surfacing the raw error message to the (public, unauthenticated) page.

---

### `dashboard/lib/schema.ts` (zod validation of fetched JSON)

**Analog:** `src/config/schema.ts` (exact match — same library, same "define zod schema colocated with the type it validates, assert compile-time compatibility" pattern)

**Full pattern to copy** (`src/config/schema.ts`, entire 34-line file, already in context above):
```typescript
import { z } from 'zod';
import type { Watch } from '../types.js';

export const SiteTypeSchema = z.enum(['any', 'tent', 'rv', 'group']);

export const WatchSchema = z.object({
  id: z.string().min(1),
  parkName: z.string().min(1),
  facilityId: z.number().int().positive().optional(),
  dateRange: z
    .object({
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
    })
    .refine((r) => r.start < r.end, { message: '...' }),
  siteType: SiteTypeSchema,
});

// Compile-time shape check: schema output must be assignable to the shared type
const _assert: Watch = {} as z.infer<typeof WatchSchema>;
void _assert;
```
Apply the same three conventions in `dashboard/lib/schema.ts`:
1. One zod schema per JSON file consumed (`WatchesSchema`, `StateFileSchema`, `RunLogSchema`).
2. `safeParse()` at the call site (see `src/config/watches.ts` lines 41-47) rather than `parse()` — RESEARCH.md's Security Domain section (V5) mandates `.safeParse()` with a graceful "data unavailable" fallback, not a thrown exception that would 500 the page.
3. Compile-time `_assert` line tying each zod schema back to its `dashboard/lib/types.ts` interface, preventing drift.

**`safeParse` error-surfacing pattern to copy** (`src/config/watches.ts` lines 41-47):
```typescript
const result = WatchesFileSchema.safeParse(parsedJson);
if (!result.success) {
  const issues = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`watches config at ${filePath} is invalid: ${issues}`);
}
```
In the dashboard, replace the `throw` with returning `null`/a result-object so `page.tsx` can render UI-SPEC.md's "data unavailable" fallback section instead of crashing SSR (per RESEARCH.md Security Domain: "render a clear 'data unavailable' fallback section instead of letting an unhandled exception 500 the whole page").

---

### `dashboard/lib/derive-status.ts`, `derive-timeline.ts`, `derive-active-matches.ts` (pure transforms)

**Analog:** `src/run.ts` outcome-classification/logging block (lines 91-104) — same shape of logic: switch on `WatchOutcome.status`, branch per case, no I/O.

**Pattern to copy** (`src/run.ts` lines 91-104):
```typescript
for (const outcome of outcomes) {
  if (outcome.status === 'MATCH') {
    const sites = [...outcome.newMatches, ...outcome.suppressed].map((m) => m.siteLabel || m.campsiteId).join(', ');
    logger.info(`OK    ${outcome.watchId} — ${outcome.newMatches.length} new, ${outcome.suppressed.length} already notified: ${sites}`);
  } else if (outcome.status === 'NO_MATCH') {
    ...
  } else {
    logger.error(`FAILED ${outcome.watchId} — ${outcome.reason}`);
  }
}
```
Model each `derive-*.ts` function the same way: exhaustive discriminated-union switch/if-chain over `WatchOutcome['status']` (`MATCH | NO_MATCH | FAILED`), pure functions taking already-parsed data and returning display-ready structures — no `console`/fetch calls inside these files (keeps them independently unit-testable per RESEARCH.md's Validation Architecture, which explicitly calls out `derive-status.test.ts`, `derive-timeline.test.ts`, `derive-active-matches.test.ts` as the Wave 0 test gaps).

- `derive-status.ts` (D-05): for each `Watch`, find its latest matching `runs.json` entry's `WatchOutcome` by `watchId`, most-recent-`startedAt`-wins.
- `derive-timeline.ts` (D-06): map `runs.json` (array, oldest-first per the `.[-50:]` cap logic) to a reverse-chronological (most-recent-first) list of `{ startedAt, outcomes }` for rendering.
- `derive-active-matches.ts` (D-07): map `state.json`'s `entries` (keyed by `dedupKey` format `watchId:campsiteId:startDate:endDate`, see `src/state/store.ts` lines 21-23) to display rows with `bookingUrl` — reuse the same key-parsing convention (`split(':')`, 4 parts) rather than inventing a new key format.

**Booking URL safety pattern to copy** (`src/notify/email.ts` lines 25-27, XSS/link-spoofing mitigation — directly relevant to UI-SPEC.md's `Book on Recreation.gov →` CTA):
```typescript
function safeBookingUrl(url: string): string | null {
  return typeof url === 'string' && url.startsWith('https://www.recreation.gov/') ? url : null;
}
```
Apply the identical allowlist check in `derive-active-matches.ts` before rendering any `<a href>` — RESEARCH.md's Security Domain (Known Threat Patterns table) flags this exact class of risk for repo-sourced strings rendered into HTML.

---

### `dashboard/app/page.tsx` (server component)

**No in-repo analog** (first React/Next.js file). Follow RESEARCH.md's Code Examples section verbatim as the canonical starting structure:
```typescript
import { fetchJson } from '@/lib/github';
import type { Watch, StateFile, RunLogEntry } from '@/lib/types';

export default async function Page() {
  const [watches, state, runs] = await Promise.all([
    fetchJson<Watch[]>('watches.json'),
    fetchJson<StateFile>('state.json'),
    fetchJson<RunLogEntry[]>('runs.json'),
  ]);

  return (
    <main>
      <section aria-label="Active matches">{/* D-07 */}</section>
      <section aria-label="Per-watch status">{/* D-05 */}</section>
      <section aria-label="Run timeline">{/* D-06 */}</section>
    </main>
  );
}
```
Do NOT set `export const dynamic = 'force-dynamic'` (defeats the `revalidate: 30` fetch-cache window — see RESEARCH.md Pattern 1/Code Examples note). Section ordering (Active Matches, then Per-Watch Status, then Run Timeline) matches UI-SPEC.md's Spacing Scale section which lists them in that order ("Active Matches / Per-Watch Status / Run Timeline").

---

## Shared Patterns

### Zod validation of externally-sourced JSON
**Source:** `src/config/schema.ts` (whole file) + `src/config/watches.ts` lines 34-49 (`safeParse` + issue-formatting call site)
**Apply to:** `dashboard/lib/schema.ts`, and every `fetchJson()` call site in `page.tsx` (wrap each of the three fetches in a `safeParse` before use)

### Atomic JSON file writes (write-to-.tmp + rename)
**Source:** `src/state/fileStore.ts` lines 107-116
**Apply to:** The new `run-summary.json` write in the CI hook, and (if planning decides `jq` alone is insufficient) any Node-based fallback for the `runs.json` append/cap step

### Commit-if-changed workflow step (bot identity, `[skip ci]`, guarded by `git status --porcelain`)
**Source:** `.github/workflows/poll.yml` lines 45-57
**Apply to:** The extended commit step covering both `state.json` and `runs.json`

### Error description / safe-failure convention
**Source:** `src/errors.ts`'s `describeFailure(err)` (used in `src/run.ts` lines 84-86, `src/config/watches.ts` lines 27-31)
**Apply to:** `dashboard/lib/github.ts`'s fetch error handling and `page.tsx`'s top-level try/catch producing UI-SPEC.md's "Unable to load dashboard data" error state — never surface raw error/stack text to the public page (Security Domain V5/Information Disclosure guidance)

### URL allowlisting before rendering as a link
**Source:** `src/notify/email.ts` lines 25-27 (`safeBookingUrl`)
**Apply to:** `dashboard/lib/derive-active-matches.ts` before emitting `bookingUrl` for the `Book on Recreation.gov →` CTA

### Discriminated-union outcome handling (`MATCH | NO_MATCH | FAILED`)
**Source:** `src/types.ts` lines 59-62 (`WatchOutcome`), consumed in `src/run.ts` lines 91-104
**Apply to:** `dashboard/lib/derive-status.ts` and `derive-timeline.ts`, and the status-badge color mapping in UI-SPEC.md (MATCH=green `#16A34A`, NO_MATCH=gray `#6B7280`, FAILED=red `#DC2626`)

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `dashboard/package.json`, `dashboard/tsconfig.json`, `dashboard/next.config.ts` | config | — | First Next.js/frontend project in the repo; no prior config to model from. Use RESEARCH.md's `create-next-app` scaffold command and defaults (do not copy root `tsconfig.json`'s `NodeNext`/ESM settings — RESEARCH.md Pitfall 4 explicitly warns against this). |
| `dashboard/app/page.tsx`, `layout.tsx`, `globals.css` | component | request-response | First React/JSX code in the repo — no analog component exists. Follow RESEARCH.md's Code Examples section and UI-SPEC.md's typography/color/spacing tokens directly. |
| `dashboard/lib/*.test.ts` | test | — | No dashboard test infra exists yet (RESEARCH.md: "Wave 0 gap"). Style/structure can loosely follow `src/run.test.ts`'s use of Node's built-in `node --test` runner, but there is no existing pure-derivation-function test to copy assertions from. |

## Metadata

**Analog search scope:** `src/` (all subdirectories: `config/`, `state/`, `notify/`, `recreation-gov/`, `matcher/`), `.github/workflows/poll.yml`, repo-root JSON files (`state.json`, `watches.json`, `package.json`, `tsconfig.json`)
**Files scanned:** `src/types.ts`, `src/run.ts`, `src/cli.ts`, `src/state/fileStore.ts`, `src/state/store.ts`, `src/config/watches.ts`, `src/config/schema.ts`, `src/notify/email.ts`, `.github/workflows/poll.yml`, `state.json`, `watches.json`, `package.json`, `tsconfig.json`
**Pattern extraction date:** 2026-08-23
