export type SiteType = 'any' | 'tent' | 'rv' | 'group';
export type ResolvedSiteType = 'tent' | 'rv' | 'group' | 'unknown';

/** A single pinned campground, resolved by name via RIDB (v1.0 shape).
 *
 *  dateRange semantics (D-03): `dateRange.start` = first night; `dateRange.end` =
 *  checkout date, EXCLUSIVE. Required nights = every date from `start` up to but
 *  NOT including `end` — this represents one continuous bookable stay, no gaps.
 */
export interface FacilityWatch {
  type: 'facility';
  id: string;
  parkName: string;
  facilityId?: number;      // optional explicit override (RESEARCH Pitfall 3)
  dateRange: { start: string; end: string };  // YYYY-MM-DD
  siteType: SiteType;
}

/** One or more named Recreation Areas, expanded to their constituent campgrounds
 *  at poll time (AREA-01/D-01). Stores CRITERIA ONLY — never a frozen resolved
 *  facility list (ARCHITECTURE.md Anti-Pattern 1). `recAreaId` is the explicit
 *  override for a bad name auto-match (D-02); it skips the /recareas name search
 *  but NOT the /recareas/{id}/facilities expansion. */
export interface AreaWatch {
  type: 'area';
  id: string;
  areas: Array<{ name: string; recAreaId?: number }>;
  dateRange: { start: string; end: string };  // YYYY-MM-DD
  siteType: SiteType;
}

export type Watch = FacilityWatch | AreaWatch;

/** A Watch after resolution to ONE concrete facility. An AreaWatch produces N of
 *  these sharing one `id`; a FacilityWatch produces exactly one. Deliberately flat
 *  (no `extends Watch`) now that Watch is a union. */
export interface ResolvedWatch {
  id: string;
  facilityId: number;
  facilityName: string;
  /** D-05: 'group' when RIDB's FacilityTypeDescription matches /group/i, else 'standard'.
   *  A FacilityWatch always resolves to 'standard' — v1.0 never classified, and the
   *  user's pinned campground is theirs by definition. */
  facilityType: 'standard' | 'group';
  dateRange: { start: string; end: string };
  siteType: SiteType;
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
  // D-05: carried from ResolvedWatch so match output can flag a group campground unmistakably
  facilityType: 'standard' | 'group';
  startDate: string;        // YYYY-MM-DD, first night
  endDate: string;          // YYYY-MM-DD, checkout (exclusive)
  bookingUrl: string;       // https://www.recreation.gov/camping/campsites/{campsiteId}
}

/** D-08: present only when an area watch's resolution exceeded AREA_FACILITY_CAP.
 *  `requested` is the post-filter facility count across all the watch's areas;
 *  `kept` is how many actually got polled. */
export interface TruncationInfo {
  requested: number;
  kept: number;
}

/** RESEARCH.md Open Question 3 — RESOLVED: per-facility failures inside an area
 *  watch degrade gracefully. One flaky campground must never hide matches found on
 *  its siblings, matching resolveWatches()'s existing "a failure never aborts the
 *  run for the others" convention one level deeper. A watch is only FAILED when
 *  EVERY facility in its group failed. */
export interface FacilityFailure {
  facilityId: number;
  facilityName: string;
  reason: string;
}

export type WatchOutcome =
  | {
      watchId: string;
      status: 'MATCH';
      newMatches: MatchedSlot[];
      suppressed: MatchedSlot[];
      truncated?: TruncationInfo;
      facilityFailures?: FacilityFailure[];
    }
  | { watchId: string; status: 'NO_MATCH'; truncated?: TruncationInfo; facilityFailures?: FacilityFailure[] }
  | { watchId: string; status: 'FAILED'; reason: string; truncated?: TruncationInfo; facilityFailures?: FacilityFailure[] };

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
