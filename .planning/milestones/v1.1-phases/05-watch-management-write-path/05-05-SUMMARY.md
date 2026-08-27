---
phase: 05-watch-management-write-path
plan: 05
subsystem: dashboard
tags: [dashboard, watch-management, ui, client-component]
requires:
  - dashboard/lib/session.ts (plan 05-02)
  - dashboard/app/watches/unlock-prompt.tsx (plan 05-04)
  - dashboard/lib/copy.ts + dashboard/app/globals.css (plan 05-04)
  - /api/watches/{id} DELETE contract (plan 05-03)
provides:
  - dashboard/lib/format-watch.ts (formatWatchLocation, formatWatchDates, formatSiteType, formatWatchKind)
  - dashboard/app/watches/watch-manager.tsx (WatchManager client component)
  - dashboard/app/page.tsx server-side lock detection + Manage Watches wiring
affects:
  - dashboard/app/page.tsx (modified)
tech-stack:
  added: []
  patterns:
    - "Native <dialog>.showModal() for confirm dialogs, driven by a ref + useEffect keyed on pending state"
    - "Client-side watch list mutated directly in React state after a successful mutation, never via router.refresh(), because the read path sits behind a 30s Data Cache window"
key-files:
  created:
    - dashboard/lib/format-watch.ts
    - dashboard/lib/format-watch.test.ts
    - dashboard/app/watches/watch-manager.tsx
  modified:
    - dashboard/app/page.tsx
decisions:
  - "Comments describing the trap being avoided (router.refresh mis-timing, cookie-jar unreadability, dynamic-rendering opt-out) were phrased to avoid containing the literal disallowed substrings (`router.refresh`, `document.cookie`, `force-dynamic`) so both the human-readable rationale and the plan's automated greps hold simultaneously."
metrics:
  duration: "~25 minutes"
  completed: "2026-08-26"
---

# Phase 5 Plan 05: Watch List, Lock Gate, Delete + Confirm Summary

Puts the write path on screen: a `Manage Watches` section listing every configured watch regardless of lock state, an inline unlock prompt swapped in for the delete control when locked, and a native-`<dialog>`-confirmed delete flow with a propagation-delay toast.

## What Was Built

**`dashboard/lib/format-watch.ts`** — four pure, timezone-safe label helpers for a `Watch` row:
`formatWatchLocation` (parkName for facility watches; comma-joined area names for area watches,
including the `'(no areas)'` degenerate case for a hand-edited zero-area watch), `formatWatchDates`
(`YYYY-MM-DD → YYYY-MM-DD`, no `Date` reparsing), `formatSiteType` (label lookup), and
`formatWatchKind` (`'Campground'` | `'Area'`). 12 tests in `format-watch.test.ts`, one per
`<behavior>` bullet plus the `formatWatchKind` cases, using `it()` from `node:test` (matching the
`describe`/`it` style already used in `schema.test.ts`, distinct from the `test()`-only style in
`format.test.ts`).

**`dashboard/app/watches/watch-manager.tsx`** — the `WatchManager` client component. Renders the
watch list identically whether locked or unlocked (only the trailing delete button is conditional
on `unlocked`); shows `UnlockPrompt` above the list when locked. Delete flow: click opens a native
`<dialog>` via `showModal()` (ref + `useEffect` keyed on `pendingDelete`), confirming issues a
`DELETE /api/watches/{encodeURIComponent(id)}` request. On success the watch is filtered out of
local state and a `4s`-auto-dismissing toast appears; on `401` the component flips `unlocked` back
to `false` (session expired mid-visit) instead of failing silently; on any other failure the API's
returned error string is surfaced via `COPY.saveFailed`.

**`dashboard/app/page.tsx`** — added server-side lock detection (`cookies()` + `hasValidSession`)
and raw-watch parsing (`parseWatches`, kept separate from `buildDashboardModel`'s derived rows
since the manager needs the editable `Watch[]`, not display rows). `WatchManager` renders as the
first child of the `model.ok` branch, above the existing read-only sections. The `next: { revalidate:
30 }` Data Cache window in `lib/github.ts` and the three existing sections were left untouched.

## Deviations from Plan

None — plan executed exactly as written, with one wording adjustment (see Decisions above): two
explanatory code comments were rephrased to avoid containing the literal substrings the plan's own
acceptance-criteria greps check for zero occurrences of (`router.refresh`, `document.cookie`,
`force-dynamic`), since the plan's own action-block prose used those exact phrases in a docstring
example. The underlying behavior — no `router.refresh()` call, no cookie-jar reads, no dynamic-
rendering opt-out — is unchanged; only prose wording moved.

## Verification

- `cd dashboard && npm test` — 152/152 passing (12 new `format-watch` tests plus all existing suites)
- `cd dashboard && npm run typecheck` — clean
- `cd dashboard && npm run build` — exits 0; `/` is now `ƒ` (dynamic) as expected from reading `cookies()`
- `grep -rn "document.cookie\|localStorage\|sessionStorage" dashboard/app/` — no matches
- `grep -rn "dangerouslySetInnerHTML" dashboard/app/` — no matches

Note: `dashboard/node_modules` was not present in this worktree at execution start; `npm install`
was run in `dashboard/` to enable `npm test`/`typecheck`/`build` verification (no `package.json` or
lockfile changes — dependencies matched the existing `package-lock.json`).

## Self-Check: PASSED

- FOUND: dashboard/lib/format-watch.ts
- FOUND: dashboard/lib/format-watch.test.ts
- FOUND: dashboard/app/watches/watch-manager.tsx
- FOUND: dashboard/app/page.tsx
- FOUND commit: 5d35cfd (feat(05-05): add format-watch.ts pure label helpers)
- FOUND commit: 03c3f43 (feat(05-05): add WatchManager client component)
- FOUND commit: 3a0253e (feat(05-05): wire Manage Watches section and lock detection into page.tsx)
