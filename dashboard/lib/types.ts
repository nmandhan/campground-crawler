/** Local redeclarations of the poller's shared shapes.
 *
 *  Hand-copied from the poller's `types.ts` and `state/store.ts` (under `src/` at the repo root) — this
 *  dashboard is a fully independent Next.js project (RESEARCH.md Pattern 2 / Anti-Patterns)
 *  and must never import across the `src/` <-> `dashboard/` boundary. If those source files
 *  change, these declarations must be updated together, by hand.
 *
 *  Import-style rule for the whole `dashboard/` project: files under `lib/` import each other
 *  with extensionless relative paths (e.g. `./types`), because `npm test` runs them through
 *  `tsx` directly, and `tsx` resolves extensionless TS specifiers but does not apply tsconfig
 *  `paths`. The `@/` alias is reserved for `app/*.tsx` files, which go through the Next.js
 *  compiler.
 */

export type SiteType = 'any' | 'tent' | 'rv' | 'group';
export type ResolvedSiteType = 'tent' | 'rv' | 'group' | 'unknown';

export interface Watch {
  id: string;
  parkName: string;
  facilityId?: number;
  dateRange: { start: string; end: string }; // YYYY-MM-DD
  siteType: SiteType;
}

export interface MatchedSlot {
  watchId: string;
  campsiteId: string;
  siteLabel: string;
  loop: string;
  siteType: ResolvedSiteType;
  facilityId: number;
  facilityName: string;
  startDate: string; // YYYY-MM-DD, first night
  endDate: string; // YYYY-MM-DD, checkout (exclusive)
  bookingUrl: string; // https://www.recreation.gov/camping/campsites/{campsiteId}
}

export type WatchOutcome =
  | { watchId: string; status: 'MATCH'; newMatches: MatchedSlot[]; suppressed: MatchedSlot[] }
  | { watchId: string; status: 'NO_MATCH' }
  | { watchId: string; status: 'FAILED'; reason: string };

export interface RunSummary {
  startedAt: string; // ISO
  finishedAt: string; // ISO
  checked: number;
  outcomes: WatchOutcome[];
  newMatches: MatchedSlot[];
  failed: Array<{ watchId: string; reason: string }>;
  noMatch: string[]; // watchIds
}

export interface StateEntry {
  lastNotifiedAt: string; // ISO timestamp
}

export interface StateFile {
  version: 1;
  entries: Record<string, StateEntry>;
}
// dedup key format: `${watchId}:${campsiteId}:${startDate}:${endDate}`

/** Each runs.json array element is a RunSummary stored as-is (plan 03-01 design decision). */
export type RunLogEntry = RunSummary;
