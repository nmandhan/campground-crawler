---
phase: 05-watch-management-write-path
reviewed: 2026-08-27T02:30:00Z
depth: medium
files_reviewed: 32
files_reviewed_list:
  - dashboard/app/api/ridb/preview/route.ts
  - dashboard/app/api/ridb/recareas/route.ts
  - dashboard/app/api/session/route.ts
  - dashboard/app/api/watches/[id]/route.ts
  - dashboard/app/api/watches/route.ts
  - dashboard/app/globals.css
  - dashboard/app/page.tsx
  - dashboard/app/watches/area-preview.tsx
  - dashboard/app/watches/area-typeahead.tsx
  - dashboard/app/watches/unlock-prompt.tsx
  - dashboard/app/watches/watch-form.tsx
  - dashboard/app/watches/watch-manager.tsx
  - dashboard/lib/copy.ts
  - dashboard/lib/debounce.test.ts
  - dashboard/lib/debounce.ts
  - dashboard/lib/derive-status.test.ts
  - dashboard/lib/derive-timeline.test.ts
  - dashboard/lib/format-watch.test.ts
  - dashboard/lib/format-watch.ts
  - dashboard/lib/github-write.test.ts
  - dashboard/lib/github-write.ts
  - dashboard/lib/page-data.test.ts
  - dashboard/lib/ridb.test.ts
  - dashboard/lib/ridb.ts
  - dashboard/lib/schema.test.ts
  - dashboard/lib/schema.ts
  - dashboard/lib/session.test.ts
  - dashboard/lib/session.ts
  - dashboard/package.json
  - dashboard/proxy.ts
  - dashboard/scripts/verify-auth-gate.sh
  - dashboard/tsconfig.json
findings:
  critical: 0
  warning: 5
  info: 3
  total: 8
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-08-27T02:30:00Z
**Depth:** medium (8 finder angles, 1-vote verify pass, all 8 candidates CONFIRMED)
**Files Reviewed:** 32
**Status:** issues_found

## Summary

This phase adds the dashboard's first mutation surface: a shared-secret auth gate, GitHub Contents API write path, RIDB-backed area typeahead/preview, and the create/edit/delete UI. The core security posture is sound — the `proxy.ts` rename trap (Next.js 16 `middleware.ts` → `proxy.ts`) was correctly avoided and proven against a real production build, every mutating route independently re-checks the session, secrets never reach the client bundle, and the GitHub write path's sha-based optimistic concurrency with a bounded retry works as designed.

Two genuine correctness bugs stand out as worth fixing soon: editing a facility watch silently drops its `facilityId` override (a real data-loss path with no user-visible signal), and a three-way cap mismatch across the area typeahead/preview/save schemas means a watch can be saved with more areas than its own preview ever validated. The remaining findings are lower-severity gaps (a missing zod validation on the one read path that doesn't have one, a UI race on rapid chip clicks, sequential area resolution adding avoidable latency, and two structural/duplication concerns in the auth layer) that are worth tracking but didn't block this phase's live UAT sign-off.

## Warnings

### WR-01: Editing a facility watch silently drops its `facilityId` override

**File:** `dashboard/app/watches/watch-form.tsx:70-121`
**Issue:** `FacilityWatch.facilityId` (`dashboard/lib/types.ts:22`) is an optional explicit override used to disambiguate two campgrounds sharing a name (`src/config/schema.ts`'s comment: `// explicit override, RESEARCH Pitfall 3`). The edit-seed effect (lines 70-77) copies `id`, `parkName`, `dateRange`, `siteType` from the watch being edited but never reads `initial.facilityId`, and the submit handler (lines 118-121) builds `{ type: 'facility', id, parkName, dateRange, siteType }` with no `facilityId` key at all. `PATCH /api/watches/[id]/route.ts` treats the submitted body as a complete replacement (`next[idx] = watch`), not a partial patch.
**Fix:** Add a hidden/read-only `facilityId` field to the edit form's state (seeded from `initial.facilityId`, not user-editable through this UI) and include it in the submitted object when present, so an edit-and-save round trip preserves it.

### WR-02: Area-watch save has no cap, but the preview it's shown through does

**File:** `dashboard/lib/schema.ts:206-211` (also `dashboard/app/watches/area-typeahead.tsx:72-80`, `dashboard/app/api/ridb/preview/route.ts:28-37`)
**Issue:** `area-typeahead.tsx`'s `addChip` has no count check — a user can add unlimited Recreation Area chips. `PreviewRequestSchema` in the preview route caps at `.max(10)` and returns a generic `Malformed request body` 400 on the 11th. `StrictAreaWatchSchema` (the schema actually used by `POST`/`PATCH /api/watches`) has no upper bound on `areas` at all.
**Fix:** Either cap `StrictAreaWatchSchema.areas` at the same 10 (or whatever limit is intended) so a watch can never be saved with more areas than its preview validated, or cap chip-adding client-side at 10 with a specific "you can watch at most 10 areas" message instead of letting the preview's generic error be the only signal.

### WR-03: `getWatchesFile()` never validates `watches.json` with zod, unlike every other API-response path in this phase

**File:** `dashboard/lib/github-write.ts:65-69`
**Issue:** `getWatchesFile()` parses the GitHub Contents API response with `JSON.parse`, checks only `Array.isArray(parsed)`, and does a raw `parsed as Watch[]` type assertion — no zod call. `dashboard/lib/schema.ts` already exports `WatchesSchema = z.array(WatchSchema)` (line 55) for exactly this shape, and CLAUDE.md's Technology Stack section states: *"Validation: `zod` for watch config and API response shapes."* `commitWatches` passes this unvalidated array straight into every mutator's `.findIndex(w => w.id === id)`/`.some(...)` logic.
**Fix:** Run the parsed content through `WatchesSchema.safeParse` in `getWatchesFile()` and return an `ok: false` result on failure, consistent with every other fetch path in the dashboard.

### WR-04: Rapid chip add/remove in the area typeahead can silently drop a mutation

**File:** `dashboard/app/watches/area-typeahead.tsx:75,153`
**Issue:** `addChip` (`onChange([...areas, chip])`) and the chip-removal handler (`onChange(areas.filter(...))`) both compute the next array from the closed-over `areas` prop rather than a functional update, and `watch-form.tsx`'s `onChange={setAreas}` is a plain `useState` setter. Two chip mutations dispatched within the same render batch (e.g. two rapid clicks on different suggestions, or two remove buttons in quick succession) both read the same stale `areas` value; whichever `setAreas` call lands last wins, silently discarding the other add/remove.
**Fix:** Change both call sites to a functional update pattern, e.g. have `AreaTypeahead` accept an updater-style `onChange` (`(prev) => next`) or have `watch-form.tsx` wrap `setAreas` calls through `setAreas(prev => ...)` internally.

### WR-05: `previewAreas()` resolves area chips sequentially instead of in parallel

**File:** `dashboard/lib/ridb.ts:230-262`
**Issue:** The `for...of` loop awaits each area's RIDB resolution (`const result = await pending`) before starting the next iteration. With `area-preview.tsx` auto-refetching on every chip add/remove, total preview latency scales as the sum of all areas' RIDB round trips rather than the max — noticeably slower for a multi-area watch than necessary.
**Fix:** Build all per-area promises first (map over `areas` without awaiting inside the loop), then `Promise.all` them and process results afterward, preserving the existing per-area cache/dedup logic.

## Info

### IN-01: `previewAreas`'s `PreviewRequestSchema` accepts an area with neither `name` nor `recAreaId`, falling through to an empty-string RIDB query

**File:** `dashboard/app/api/ridb/preview/route.ts:28-37`, `dashboard/lib/ridb.ts:230-244`
**Issue:** `PreviewRequestSchema` makes both `name` and `recAreaId` `.optional()` with no `.refine()` requiring at least one. A request body `{"areas":[{}]}` passes validation; `previewAreas()` then calls `searchRecAreas(area.name ?? '', opts)` — an empty-string query to RIDB — and if RIDB returns any result, silently accepts `areas[0]` as "the" resolved area with no entry in `areaErrors`.
**Fix:** Add `.refine((a) => a.name !== undefined || a.recAreaId !== undefined, 'area must have a name or recAreaId')` to the schema (mirrors the existing per-area shape already used server-side).

### IN-02: `dashboard/proxy.ts`'s auth gate is an inclusion allowlist with no automated check tying new routes to protection

**File:** `dashboard/proxy.ts:33`
**Issue:** `matcher: ['/api/watches/:path*', '/api/ridb/:path*']` protects by enumerating known paths. Nothing in the test suite (11 `.test.ts` files, none touching `proxy.ts` or route enumeration) or CI verifies that every mutating route under `app/api/` is covered by this array. Defense-in-depth (`requireSession()` re-checked in every route) mitigates this today, but relies entirely on a future author remembering both steps.
**Fix:** Not urgent given the current defense-in-depth posture, but worth a lightweight test asserting `fs.readdirSync('app/api')` routes are a subset of what `proxy.ts`'s matcher would cover, so a forgotten route fails CI instead of shipping silently unauthenticated.

### IN-03: `requireSession()` is copy-pasted verbatim into four Route Handler files

**File:** `dashboard/app/api/watches/route.ts:19` (also `[id]/route.ts`, `ridb/recareas/route.ts`, `ridb/preview/route.ts`)
**Issue:** An identical 6-line `requireSession()` helper is redefined in each of the four mutating/RIDB-proxying route files instead of being a single shared export from `dashboard/lib/session.ts` (which exports `hasValidSession`/`SESSION_COOKIE` but not `requireSession` itself).
**Fix:** Move `requireSession()` into `session.ts` as a shared export; each route imports it instead of redefining it. Preserves the same defense-in-depth property while removing the four-way copy-paste maintenance risk.

---

*Findings from this review were surfaced to the user; fixing them is deferred to a follow-up chore rather than blocking Phase 5's completion, since the live UAT walkthrough (05-08-SUMMARY.md) already exercised and confirmed the core create/edit/delete/typeahead/preview flows end-to-end.*
