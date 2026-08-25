# Phase 2: Notification Delivery & Deployment - Pattern Map

**Mapped:** 2026-08-22
**Files analyzed:** 6 (2 new source files, 1 new test file, 1 modified source file, 1 new workflow file, 1 modified config file)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/notify/email.ts` | service (outbound I/O) | request-response (single external API call) | `src/recreation-gov/client.ts` | role-match (outbound HTTP client wrapping a 3rd-party API, env-var key passed in via options not read internally) |
| `src/notify/email.ts` (pure formatting fns `buildSubject`/`buildBody`) | utility/transform | transform | `src/matcher/match.ts` (not read; inferred from ARCHITECTURE.md "pure/isolated module" note) — closer direct analog is `src/state/store.ts`'s `dedupKey()`: small pure exported function, no I/O | exact (pure-function style) |
| `src/notify/email.test.ts` | test | transform / unit | `src/run.test.ts` | exact (same `node:test` + `assert/strict` + hand-rolled fakes convention, no mocking library) |
| `src/run.ts` (MODIFIED — add `sendNotification` to `RunDeps`, call after matches computed) | orchestrator (existing) | event-driven (calls a new dependency conditionally on `newMatches.length > 0`) | itself — extend existing `RunDeps` pattern (`loadResolved`, `fetchRange`, `store`, `logger`, `now`) | exact (this IS the pattern to copy, in-place) |
| `.github/workflows/poll.yml` | config (CI/CD workflow) | batch (scheduled trigger) | none exists in repo — no analog; use RESEARCH.md Pattern 3 verbatim as the template | no analog |
| `package.json` (MODIFIED — add `resend` dependency) | config | — | itself — existing `dependencies`/`devDependencies` block | exact (trivial edit) |

## Pattern Assignments

### `src/notify/email.ts` (service, request-response)

**Analog:** `src/recreation-gov/client.ts` (imports/error pattern) + `src/errors.ts` (error formatting convention) + RESEARCH.md Code Examples (Resend SDK usage, since no Resend analog exists in-repo yet)

**Imports pattern** — copy the style from `client.ts` lines 13-17 (explicit `.js`-suffixed relative imports, named imports, type-only imports separated):
```typescript
// src/recreation-gov/client.ts:13-17
import { retryWithBackoff } from './http.js';
import { fetchJson } from './http.js';
import { AvailabilityResponseSchema, RidbFacilitySearchSchema } from './types.js';
import type { RawAvailabilityResponse } from './types.js';
import { FacilityNotFoundError, ResponseSchemaError } from '../errors.js';
```
Apply the same convention in `email.ts`:
```typescript
import { Resend } from 'resend';
import type { MatchedSlot } from '../types.js';
```

**Env-var / credential handling pattern** — CRITICAL: copy the "never read env vars inside the low-level module without a documented reason" convention. `client.ts` (lines 6-11) explicitly documents that it "intentionally never reads environment variables directly" to avoid leaking a key into an error message (T-02-02). The one place `process.env` IS read directly in this codebase is `src/config/watches.ts:124`, at the *composition/wiring* layer, not inside the client:
```typescript
// src/config/watches.ts:120-129 — env read happens at the wiring layer, passed down as an option
export async function loadResolvedWatches(
  opts?: ClientOptions & { path?: string; logger?: Logger }
): Promise<ResolveResult> {
  const watches = await loadWatches(opts?.path);
  const ridbApiKey = process.env.RIDB_API_KEY;
  return resolveWatches(watches, {
    ...opts,
    ridbApiKey: ridbApiKey && ridbApiKey.length > 0 ? ridbApiKey : opts?.ridbApiKey,
  });
}
```
For `email.ts`, RESEARCH.md's example reads `process.env.RESEND_API_KEY`/`process.env.NOTIFY_EMAIL` directly inside the module (acceptable here since `email.ts` IS the wiring/composition point for this concern — there's no separate "config loader" for notification credentials the way there is for RIDB). Follow RESEARCH.md's Code Examples section verbatim for the `Resend` client construction and `sendDigestEmail` shape.

**Core request-response pattern** (Resend call + explicit error check, NOT a throw):
```typescript
// RESEARCH.md Code Examples — sending via Resend
const { error } = await resend.emails.send({
  from: process.env.NOTIFY_FROM ?? 'Campground Crawler <onboarding@resend.dev>',
  to: [process.env.NOTIFY_EMAIL!],
  subject: buildSubject(matches),
  text: buildBody(matches),
});

if (error) {
  console.error(`email send failed: ${error.name}: ${error.message}`);
}
```

**Error handling / logging pattern** — copy the "one-line human-readable, never leak secrets" contract from `src/errors.ts:46-51`:
```typescript
// src/errors.ts:46-51
/**
 * One-line human-readable failure reason for the FAILED log line + RunSummary.
 *
 * MUST NOT throw for any input and MUST NOT include HTTP request headers or an
 * `apikey` value in its output (threat T-01-02).
 */
```
Apply the same discipline to the Resend error branch: log only `error.name`/`error.message`, never the full request payload or `RESEND_API_KEY`. Do NOT throw from `sendDigestEmail` — a failed send must not crash `run()` or change `RunSummary.failed` semantics (per D-11/D-12 and RESEARCH.md Pitfall 4).

**Pure-function formatting pattern** — copy the small, pure, side-effect-free exported function style from `src/state/store.ts:20-23`:
```typescript
// src/state/store.ts:20-23
/** D-08: `${watchId}:${campsiteId}:${startDate}:${endDate}` */
export function dedupKey(watchId: string, campsiteId: string, startDate: string, endDate: string): string {
  return `${watchId}:${campsiteId}:${startDate}:${endDate}`;
}
```
`buildSubject(matches)` and `buildBody(matches)` in `email.ts` should follow this same shape: pure functions of their input, independently unit-testable, no I/O — exactly as shown in RESEARCH.md's Code Examples section (already vetted against D-06/D-07).

---

### `src/run.ts` (MODIFIED — orchestrator, extend `RunDeps`)

**Analog:** itself (`src/run.ts:22-39`) — this is an in-place extension of an established pattern, not a new file.

**Existing `RunDeps` pattern to extend** (lines 22-39):
```typescript
// src/run.ts:22-39
export interface RunDeps {
  loadResolved?: () => Promise<ResolveResult>;
  fetchRange?: (
    facilityId: number,
    start: string,
    end: string
  ) => Promise<RawAvailabilityResponse[]>;
  store?: StateStore;
  logger?: RunLogger;
  now?: () => Date;
}

export async function run(deps?: RunDeps): Promise<RunSummary> {
  const loadResolved = deps?.loadResolved ?? loadResolvedWatches;
  const fetchRange = deps?.fetchRange ?? fetchAvailabilityForRange;
  const store = deps?.store ?? new FileStateStore();
  const logger = deps?.logger ?? console;
  const now = deps?.now ?? (() => new Date());
  ...
```
Add `sendNotification?: (matches: MatchedSlot[]) => Promise<void>;` to the `RunDeps` interface, defaulted to the real `sendDigestEmail` from `src/notify/email.ts`, following the exact same `deps?.x ?? realImplementation` pattern used for every other dependency above.

**Call-site pattern** — insert after `await store.save()` (line 82), consuming the already-computed `newMatches` local (built at lines 101-103) or accumulate it inline before the return. `run.ts` already computes `newMatches` from `outcomes` at lines 101-103:
```typescript
// src/run.ts:101-103
const newMatches = outcomes
  .filter((o): o is Extract<WatchOutcome, { status: 'MATCH' }> => o.status === 'MATCH')
  .flatMap((o) => o.newMatches);
```
Call `await sendNotification(newMatches)` guarded by `newMatches.length > 0` (mirrors RESEARCH.md Pattern 1) — place this call after `store.save()` so a slow/failed email never blocks the more time-critical state persistence, and wrap in a way that a `sendNotification` error can never propagate out of `run()` (matches the try/catch discipline already used per-watch at lines 53-79).

---

### `src/notify/email.test.ts` (test)

**Analog:** `src/run.test.ts` (whole-file convention) — see lines 1-33 for the exact idioms to copy:
```typescript
// src/run.test.ts:1-33
import { test } from 'node:test';
import assert from 'node:assert/strict';
...
function recordingLogger(): { logger: RunLogger; lines: string[] } {
  const lines: string[] = [];
  return {
    logger: {
      info: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(m),
      error: (m: string) => lines.push(m),
    },
    lines,
  };
}
```
Apply the same hand-rolled-fake convention (no mocking library) for `email.test.ts`: build a fake `sendNotification` that records calls (array push), assert `buildSubject`/`buildBody` pure-function output directly against fixture `MatchedSlot[]` arrays (see `watch()` and `fullyAvailableResponse()` fixture-builder functions at `run.test.ts:59-85` for the fixture-builder-function convention to mirror for building `MatchedSlot` test fixtures).

**Extending `run.test.ts` for the `sendNotification` wiring** — copy the `MemoryStateStore`-call-tracking convention (lines 35-57, esp. `markNotifiedCalls: string[]`) to add a `recordingNotifier()` helper that tracks calls, matching this project's established "array of recorded calls, asserted via `assert.deepEqual`" idiom (see `run.test.ts:208-220` for the exact assertion style: `assert.deepEqual(store.markNotifiedCalls, [...])`).

---

### `.github/workflows/poll.yml` (config, CI/CD workflow)

**Analog:** None in-repo (`.github/` directory does not exist yet — verified via `ls`). Use RESEARCH.md's Pattern 3 / Code Examples section verbatim as the template; it is already fully vetted against D-08 through D-11 and cites current GitHub Actions docs. Key points to preserve exactly as researched:
- `on.schedule.cron: '*/5 * * * *'` + `workflow_dispatch: {}` (D-08, plus manual-trigger convenience)
- `concurrency: { group: poller, cancel-in-progress: false }` (D-10 — do NOT flip to `true`, see RESEARCH.md Pitfall 3)
- `permissions: contents: write` at workflow or job level (required for `GITHUB_TOKEN` push, RESEARCH.md Pitfall 2)
- Secrets injected via `env:` from `${{ secrets.RESEND_API_KEY }}` / `${{ secrets.NOTIFY_EMAIL }}` (OPS-03, D-03) — never hardcoded, never echoed in a `run:` step
- Conditional commit-back step gated on `git diff --quiet -- state.json` (D-09)
- Verify current `actions/checkout`/`actions/setup-node` tags at execution time (RESEARCH.md flags this as LOW-confidence pinned to `@v7` — re-check via `gh api repos/actions/checkout/releases/latest`)

---

### `package.json` (MODIFIED — add dependency)

**Analog:** itself — existing `dependencies` block (lines 12-14):
```json
// package.json:12-14
"dependencies": {
  "zod": "^4.4.3"
}
```
Add `"resend": "^6.22.0"` following the same caret-range convention already used for `zod`.

---

## Shared Patterns

### Dependency Injection for new I/O (`RunDeps` extension)
**Source:** `src/run.ts:22-39`
**Apply to:** `src/notify/email.ts` (as the real implementation) + `src/run.ts` (as the injection point) + `src/run.test.ts`/`src/notify/email.test.ts` (as consumers of a fake)
```typescript
// The established shape every new RunDeps field must follow:
someDep?: SomeType; // optional, defaulted with `??` to the real implementation inside run()
```

### Error handling — never throw across the pipeline boundary, always describe in one line
**Source:** `src/errors.ts` (`describeFailure`) + `src/run.ts:77-79` (per-watch try/catch)
**Apply to:** `src/notify/email.ts`'s Resend error branch
```typescript
// src/run.ts:77-79 — the per-watch isolation convention to mirror for notification failures
} catch (err) {
  outcomes.push({ watchId: watch.id, status: 'FAILED', reason: describeFailure(err) });
}
```
`sendNotification`/`sendDigestEmail` must apply the equivalent discipline: catch/check the Resend `error` field (it does not throw, per RESEARCH.md Pattern 2), log a one-line message via the same `logger`/`console.error` convention, and never let a notification failure become a watch `FAILED` outcome or otherwise change `RunSummary.failed` (D-11/D-12 boundary).

### Secret handling — never read/log credentials except at the designated wiring point
**Source:** `src/recreation-gov/client.ts:6-11` (explicit "intentionally never reads environment variables directly" comment) + `src/config/watches.ts:124` (the one sanctioned `process.env` read site)
**Apply to:** `src/notify/email.ts` (may read `process.env.RESEND_API_KEY`/`NOTIFY_EMAIL` directly since it is itself the wiring point for this concern, unlike `client.ts`) and any error-logging code (never log the key/header value itself, per `src/errors.ts:46-51`'s "MUST NOT include ... an apikey value" contract, threat T-01-02).

### Test convention — `node:test` + `assert/strict` + hand-rolled fakes, no mocking library
**Source:** `src/run.test.ts` (entire file, esp. lines 1-9, 23-33, 35-57)
**Apply to:** `src/notify/email.test.ts` and the extended assertions in `src/run.test.ts`

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.github/workflows/poll.yml` | config | batch/scheduled | No `.github/workflows/` directory exists yet in this repo — this is the first CI/CD workflow file. Use RESEARCH.md Pattern 3 (already vetted, cites GitHub Actions docs directly) as the template instead of an in-repo analog. |

## Metadata

**Analog search scope:** `src/` (all subdirectories: `config/`, `matcher/`, `recreation-gov/`, `state/`), `package.json`, `.gitignore`, repo root for `.github/`
**Files scanned:** `src/run.ts`, `src/types.ts`, `src/errors.ts`, `src/cli.ts`, `src/state/store.ts`, `src/state/fileStore.ts`, `src/run.test.ts`, `src/recreation-gov/client.ts`, `src/config/watches.ts`, `package.json`, `.gitignore`
**Pattern extraction date:** 2026-08-22
