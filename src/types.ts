export type SiteType = 'any' | 'tent' | 'rv' | 'group';
export type ResolvedSiteType = 'tent' | 'rv' | 'group' | 'unknown';

/** A watch as authored in watches.json. `start` is the first night; `end` is the
 *  checkout date (exclusive). Nights required = [start, end).
 *
 *  dateRange semantics (D-03): `dateRange.start` = first night; `dateRange.end` =
 *  checkout date, EXCLUSIVE. Required nights = every date from `start` up to but
 *  NOT including `end` — this represents one continuous bookable stay, no gaps.
 */
export interface Watch {
  id: string;
  parkName: string;
  facilityId?: number;      // optional explicit override (RESEARCH Pitfall 3)
  dateRange: { start: string; end: string };  // YYYY-MM-DD
  siteType: SiteType;
}

/** A Watch after RIDB name->facilityId resolution (D-02). */
export interface ResolvedWatch extends Watch {
  facilityId: number;
  facilityName: string;
}

/** One campsite on one night, normalized from the availability endpoint.
 *
 *  `available` is derived from an ALLOWLIST: `rawStatus === 'Available'` only.
 *  Never a denylist (RESEARCH Pitfall 1 / Assumption A2) — an unrecognized upstream
 *  status string must degrade to "not available", never crash or false-positive.
 *
 *  `siteType: 'unknown'` means the campsite_type string matched none of the
 *  GROUP/RV/TENT patterns; it only matches a watch whose `siteType` is `'any'`.
 */
export interface AvailabilitySlot {
  campsiteId: string;
  siteLabel: string;        // raw `site`, e.g. "012"
  loop: string;             // raw `loop`, e.g. "Loop A" ('' if absent)
  campsiteType: string;     // raw `campsite_type`
  siteType: ResolvedSiteType;
  date: string;             // YYYY-MM-DD (night)
  rawStatus: string;        // raw status string from the API
  available: boolean;       // rawStatus === 'Available' (allowlist, RESEARCH Pitfall 1)
}

/** A campsite whose entire watched range is contiguously available. */
export interface MatchedSlot {
  watchId: string;
  campsiteId: string;
  siteLabel: string;
  loop: string;
  siteType: ResolvedSiteType;
  facilityId: number;
  facilityName: string;
  startDate: string;        // YYYY-MM-DD, first night
  endDate: string;          // YYYY-MM-DD, checkout (exclusive)
  bookingUrl: string;       // https://www.recreation.gov/camping/campsites/{campsiteId}
}

export type WatchOutcome =
  | { watchId: string; status: 'MATCH'; newMatches: MatchedSlot[]; suppressed: MatchedSlot[] }
  | { watchId: string; status: 'NO_MATCH' }
  | { watchId: string; status: 'FAILED'; reason: string };

/** Returned by run(); Phase 2 wires email off this without changing run()'s shape (D-07). */
export interface RunSummary {
  startedAt: string;        // ISO
  finishedAt: string;       // ISO
  checked: number;
  outcomes: WatchOutcome[];
  newMatches: MatchedSlot[];
  failed: Array<{ watchId: string; reason: string }>;
  noMatch: string[];        // watchIds
}

export function buildBookingUrl(campsiteId: string): string {
  return `https://www.recreation.gov/camping/campsites/${campsiteId}`;
}
