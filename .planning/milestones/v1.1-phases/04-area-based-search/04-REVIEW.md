---
phase: 04-area-based-search
reviewed: 2026-08-25T00:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - dashboard/lib/derive-active-matches.test.ts
  - dashboard/lib/derive-active-matches.ts
  - dashboard/lib/derive-status.test.ts
  - dashboard/lib/derive-status.ts
  - dashboard/lib/format.test.ts
  - dashboard/lib/format.ts
  - dashboard/lib/schema.test.ts
  - dashboard/lib/schema.ts
  - dashboard/lib/types.ts
  - scripts/capture-recarea-fixtures.ts
  - src/config/schema.test.ts
  - src/config/schema.ts
  - src/config/watches.test.ts
  - src/config/watches.ts
  - src/errors.ts
  - src/matcher/match.test.ts
  - src/matcher/match.ts
  - src/notify/email.test.ts
  - src/notify/email.ts
  - src/recreation-gov/client.test.ts
  - src/recreation-gov/client.ts
  - src/recreation-gov/fixtures/README.md
  - src/recreation-gov/fixtures/ridb-recarea-facilities.json
  - src/recreation-gov/fixtures/ridb-recareas.json
  - src/recreation-gov/types.test.ts
  - src/recreation-gov/types.ts
  - src/run.test.ts
  - src/run.ts
  - src/runSummaryFile.test.ts
  - src/types.ts
  - watches.example.json
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-08-25T00:00:00Z
**Depth:** standard
**Files Reviewed:** 28 (2 pure JSON fixtures read for content, not separately findable)
**Status:** issues_found

## Summary

This phase adds area-based watches (`AreaWatch`), RIDB RecArea resolution/expansion with a shared 20-facility cap, group-campground classification, and the dashboard's rendering of area-attributed matches. The pipeline discipline established in earlier phases holds up well: per-unit failure isolation (per-facility, per-area, per-watch) is consistent, dedup/notification semantics are unchanged and well-tested, booking-URL/email-header injection defenses are intact and covered by tests (`safeBookingUrl`, `sanitize`), and the RIDB response parsing correctly treats "needs hydration" as distinct from "not a campground" (fail-closed on `Reservable !== true`).

One genuine, if narrow, correctness gap was found: `watches.json`'s `id` field has no character restriction, but both the poller's dedup-key builder (`src/state/store.ts`) and the dashboard's dedup-key parser (`dashboard/lib/derive-active-matches.ts`) assume `:` never appears in `watchId`/`campsiteId`. A colon in a user-authored watch id would silently drop that watch's active-match rows from the dashboard. Two minor code-quality items are also noted below.

## Warnings

### WR-01: Watch `id` has no character restriction, but dedup-key parsing assumes no `:` in it

**File:** `src/config/schema.ts:19` (also `src/config/schema.ts:28`, `dashboard/lib/schema.ts:27`/`36`)
**Issue:** `id: z.string().min(1)` places no restriction on which characters are allowed in a watch id. `src/state/store.ts`'s `dedupKey()` builds state/run-log keys as `` `${watchId}:${campsiteId}:${startDate}:${endDate}` ``. The dashboard's `parseDedupKey` (`dashboard/lib/derive-active-matches.ts:23-33`) reverses this by splitting on `:` and requiring exactly 4 non-empty parts:
```ts
const parts = key.split(':');
if (parts.length !== 4 || parts.some((p) => p.length === 0)) return null;
```
If a user configures a watch id containing a colon (e.g. `"id": "yosemite:sept"` — a plausible naming convention, and nothing in the schema or docs forbids it), every dedup key for that watch splits into 5+ parts and `parseDedupKey` returns `null`. The row is silently skipped in `deriveActiveMatches` (test `'a malformed dedup key is skipped, remaining valid entries still returned'` shows this is by design for genuinely malformed keys, but a colon-containing id is a valid config value, not malformed data) — the user's active match simply never appears on the dashboard, with no error surfaced anywhere. `campsiteId` is API-controlled and unlikely to contain `:`, so `watchId` is the realistic offender.
**Fix:** Either restrict `id` to a safe character set (e.g. `.regex(/^[A-Za-z0-9_-]+$/)`) in both `src/config/schema.ts` and `dashboard/lib/schema.ts`, or switch `dedupKey`/`parseDedupKey` to a delimiter/encoding that can't collide with id content (e.g. JSON-array-then-hash, or `encodeURIComponent` each field and join with a delimiter guaranteed absent from the encoded output). Restricting the id charset is the smaller change and also prevents any related ambiguity in log lines and file paths that key off watch id.

## Info

### IN-01: `findMatchedSlot` and `isStillOpen` duplicate the same lookup

**File:** `dashboard/lib/derive-active-matches.ts:58-89`
**Issue:** `findMatchedSlot` and `isStillOpen` both filter `latestRun.outcomes` for a `watchId`, require `status === 'MATCH'`, concatenate `newMatches` + `suppressed`, and search by `campsiteId`/`startDate`/`endDate` — `isStillOpen` is functionally `findMatchedSlot(...) !== null`. `deriveActiveMatches` calls both with identical arguments per row (lines 109 and 126), doing the work twice.
**Fix:** Drop `isStillOpen` and derive it from the already-computed `slot`:
```ts
stillOpenInLatestRun: slot !== null,
```

### IN-02: Ambiguous group key in email digest grouping

**File:** `src/notify/email.ts:49`
**Issue:** `buildBody` groups matches with `` const key = `${m.watchId} ${m.facilityName}`; ``. Because the watch id and facility name are concatenated with a plain space (not an unambiguous delimiter), two distinct (watchId, facilityName) pairs can produce the same key — e.g. `watchId: 'a', facilityName: 'b c'` and `watchId: 'a b', facilityName: 'c'` both yield `"a b c"`. This would merge two logically distinct groups under one header in the digest email. Low likelihood in practice (facility names rarely collide with watch-id-shaped strings) and low impact (cosmetic, not a data-loss bug), but easy to make unambiguous.
**Fix:** Use a delimiter that can't appear in either field's sanitized form, or a tuple/array key materialized via `JSON.stringify([m.watchId, m.facilityName])`.

---

_Reviewed: 2026-08-25T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
