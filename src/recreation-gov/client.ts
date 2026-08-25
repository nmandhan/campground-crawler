/** RIDB facility resolution + Recreation.gov monthly availability fetch.
 *
 *  Every outbound request goes through retryWithBackoff(() => fetchJson(...))
 *  from ./http.js — no bare `fetch` calls in this module. Every response is
 *  zod-parsed before any field access (T-02-04).
 *
 *  This module intentionally never reads environment variables directly — the
 *  RIDB API key is read by the config loader (plan 04) and passed in via
 *  ClientOptions, so this module stays trivially testable and never risks
 *  leaking a key into an error message via an implicit global read (T-02-02).
 */

import { retryWithBackoff } from './http.js';
import { fetchJson } from './http.js';
import {
  AvailabilityResponseSchema,
  RidbFacilitySchema,
  RidbFacilitySearchSchema,
  RidbRecAreaSearchSchema,
  RidbRecAreaFacilitiesSchema,
} from './types.js';
import type { RawAvailabilityResponse } from './types.js';
import { FacilityNotFoundError, RecAreaNotFoundError, ResponseSchemaError } from '../errors.js';

export const RIDB_BASE = 'https://ridb.recreation.gov/api/v1';
export const AVAILABILITY_BASE = 'https://www.recreation.gov/api/camps/availability/campground';

export interface ClientOptions {
  ridbApiKey?: string; // optional RIDB API key, read from the environment by the caller
  fetchImpl?: typeof fetch; // injected in tests
  sleep?: (ms: number) => Promise<void>; // injected in tests
}

export interface ResolvedFacility {
  facilityId: number;
  facilityName: string;
  alternatives: string[]; // other candidate FacilityNames from the search (Pitfall 3 visibility)
}

function formatZodIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

export interface ResolvedRecArea {
  recAreaId: number;
  recAreaName: string;
  alternatives: string[]; // other candidate RecAreaNames (D-02 visibility, mirrors ResolvedFacility)
}

/** One campground inside a RecArea, already filtered and classified. */
export interface AreaFacility {
  facilityId: number;
  facilityName: string;
  facilityType: 'standard' | 'group'; // D-05
}

/** Hard ceiling on per-facility GET /facilities/{id} hydration calls per area.
 *  Only fires when /recareas/{id}/facilities returns the compact stub shape
 *  (RESEARCH.md Open Question 1). Bounds a hostile/huge RecArea from turning one
 *  area into hundreds of RIDB requests (threat T-04-02). Deliberately larger than
 *  AREA_FACILITY_CAP (20) because hydration happens BEFORE filtering. */
export const AREA_HYDRATION_LIMIT = 40;

/** D-04/AREA-03 allowlist, not a denylist — mirrors the AVAILABLE_STATUS
 *  allowlist-of-one philosophy in types.ts. An unrecognized FacilityTypeDescription
 *  degrades to "not a campground", never to a false positive (the v1.0 BANDIDO bug class). */
const CAMPGROUND_TYPE_PATTERN = /campground/i;
const GROUP_TYPE_PATTERN = /group/i;

export async function resolveFacility(parkName: string, opts?: ClientOptions): Promise<ResolvedFacility> {
  const url = new URL(`${RIDB_BASE}/facilities`);
  url.searchParams.set('query', parkName);
  url.searchParams.set('limit', '10');
  url.searchParams.set('sort', 'Name');

  const headers: Record<string, string> = {};
  if (opts?.ridbApiKey) {
    headers['apikey'] = opts.ridbApiKey;
  }

  const raw = await retryWithBackoff(
    () => fetchJson(url.toString(), { headers, fetchImpl: opts?.fetchImpl }),
    { sleep: opts?.sleep }
  );

  const parsed = RidbFacilitySearchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ResponseSchemaError(
      'RIDB facility search returned an unexpected shape',
      formatZodIssues(parsed.error.issues)
    );
  }

  const [first, ...rest] = parsed.data.RECDATA;
  if (!first) {
    throw new FacilityNotFoundError(`no RIDB facility matched "${parkName}"`, parkName);
  }

  return {
    facilityId: first.FacilityID,
    facilityName: first.FacilityName,
    alternatives: rest.map((r) => r.FacilityName),
  };
}

export async function resolveArea(areaName: string, opts?: ClientOptions): Promise<ResolvedRecArea> {
  const url = new URL(`${RIDB_BASE}/recareas`);
  url.searchParams.set('query', areaName);
  url.searchParams.set('limit', '10');

  const headers: Record<string, string> = {};
  if (opts?.ridbApiKey) {
    headers['apikey'] = opts.ridbApiKey;
  }

  const raw = await retryWithBackoff(
    () => fetchJson(url.toString(), { headers, fetchImpl: opts?.fetchImpl }),
    { sleep: opts?.sleep }
  );

  const parsed = RidbRecAreaSearchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ResponseSchemaError(
      'RIDB recreation area search returned an unexpected shape',
      formatZodIssues(parsed.error.issues)
    );
  }

  const [first, ...rest] = parsed.data.RECDATA;
  if (!first) {
    throw new RecAreaNotFoundError(`no RIDB recreation area matched "${areaName}"`, areaName);
  }

  return {
    recAreaId: first.RecAreaID,
    recAreaName: first.RecAreaName,
    alternatives: rest.map((r) => r.RecAreaName),
  };
}

/** Classifies a raw RIDB facility record as a reservable campground, or `null`
 *  if it should be excluded (not a campground, not reservable) or needs
 *  hydration (FacilityTypeDescription undefined — caller decides). */
function classifyFacility(f: {
  FacilityID: number;
  FacilityName: string;
  FacilityTypeDescription?: string;
  Reservable?: boolean;
}): AreaFacility | null {
  const desc = f.FacilityTypeDescription;
  if (desc === undefined) return null; // needs hydration, caller decides
  if (!CAMPGROUND_TYPE_PATTERN.test(desc)) return null;
  if (f.Reservable !== true) return null; // strict: undefined is NOT reservable (fail closed)
  return {
    facilityId: f.FacilityID,
    facilityName: f.FacilityName,
    facilityType: GROUP_TYPE_PATTERN.test(desc) ? 'group' : 'standard',
  };
}

/** Per-facility hydration fallback for the compact-stub case
 *  (RESEARCH.md Open Question 1). Bounded by AREA_HYDRATION_LIMIT in the caller. */
async function hydrateFacility(facilityId: number, opts?: ClientOptions): Promise<AreaFacility | null> {
  const url = new URL(`${RIDB_BASE}/facilities/${encodeURIComponent(String(facilityId))}`);
  const headers: Record<string, string> = {};
  if (opts?.ridbApiKey) headers['apikey'] = opts.ridbApiKey;

  const raw = await retryWithBackoff(
    () => fetchJson(url.toString(), { headers, fetchImpl: opts?.fetchImpl }),
    { sleep: opts?.sleep }
  );
  // /facilities/{id} returns the bare record, not the RECDATA envelope. Accept either.
  const envelope = RidbFacilitySearchSchema.safeParse(raw);
  const record = envelope.success ? envelope.data.RECDATA[0] : RidbFacilitySchema.safeParse(raw).data;
  if (!record) return null;
  return classifyFacility(record);
}

/** Filters /recareas/{id}/facilities to reservable campgrounds (D-04/AREA-03
 *  allowlist), tagged 'standard' vs 'group' (D-05), preserving RIDB's returned
 *  order (D-09). Facilities lacking type data are hydrated via a bounded
 *  per-facility lookup (AREA_HYDRATION_LIMIT, T-04-02) rather than silently
 *  dropped or silently passed. */
export async function listAreaFacilities(recAreaId: number, opts?: ClientOptions): Promise<AreaFacility[]> {
  const url = new URL(`${RIDB_BASE}/recareas/${encodeURIComponent(String(recAreaId))}/facilities`);
  url.searchParams.set('limit', '50');

  const headers: Record<string, string> = {};
  if (opts?.ridbApiKey) headers['apikey'] = opts.ridbApiKey;

  const raw = await retryWithBackoff(
    () => fetchJson(url.toString(), { headers, fetchImpl: opts?.fetchImpl }),
    { sleep: opts?.sleep }
  );

  const parsed = RidbRecAreaFacilitiesSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ResponseSchemaError(
      'RIDB recreation area facilities returned an unexpected shape',
      formatZodIssues(parsed.error.issues)
    );
  }

  const out: AreaFacility[] = [];
  let hydrations = 0;
  for (const f of parsed.data.RECDATA) {
    // D-09: RIDB's order, never re-sorted
    const direct = classifyFacility(f);
    if (direct) {
      out.push(direct);
      continue;
    }
    if (f.FacilityTypeDescription !== undefined) continue; // typed, but not a reservable campground
    if (hydrations >= AREA_HYDRATION_LIMIT) continue; // T-04-02 bound
    hydrations += 1;
    try {
      const hydrated = await hydrateFacility(f.FacilityID, opts);
      if (hydrated) out.push(hydrated);
    } catch {
      // One un-hydratable facility never fails the whole area (project convention:
      // a per-unit failure is isolated, never aborts its siblings).
    }
  }
  return out;
}

/** Normalizes a YYYY-MM-DD (or any YYYY-MM-prefixed) string to the exact
 *  `${YYYY}-${MM}-01T00:00:00.000Z` param the availability endpoint expects.
 *  Built via string manipulation on the YYYY-MM prefix — NOT via `new Date()`
 *  round-tripping, which shifts across local timezones (RESEARCH "Don't
 *  Hand-Roll" table: classic off-by-one-month bug). */
function monthStartParam(dateStr: string): string {
  const monthPrefix = dateStr.slice(0, 7); // YYYY-MM
  return `${monthPrefix}-01T00:00:00.000Z`;
}

export async function fetchMonthAvailability(
  facilityId: number,
  monthStart: string,
  opts?: ClientOptions
): Promise<RawAvailabilityResponse> {
  const url = new URL(`${AVAILABILITY_BASE}/${facilityId}/month`);
  url.searchParams.set('start_date', monthStartParam(monthStart));

  const raw = await retryWithBackoff(
    () => fetchJson(url.toString(), { fetchImpl: opts?.fetchImpl }),
    { sleep: opts?.sleep }
  );

  const parsed = AvailabilityResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ResponseSchemaError(
      'Recreation.gov availability response returned an unexpected shape',
      formatZodIssues(parsed.error.issues)
    );
  }
  return parsed.data;
}

/** Enumerates every distinct YYYY-MM from `start` through the month
 *  containing `end` INCLUSIVE (end is the exclusive checkout date, but
 *  enumerating that extra month is harmless and safer than missing one). */
function enumerateMonths(start: string, end: string): string[] {
  const [startY, startM] = start.slice(0, 7).split('-').map(Number) as [number, number];
  const [endY, endM] = end.slice(0, 7).split('-').map(Number) as [number, number];

  const months: string[] = [];
  let y = startY;
  let m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

export async function fetchAvailabilityForRange(
  facilityId: number,
  start: string,
  end: string,
  opts?: ClientOptions
): Promise<RawAvailabilityResponse[]> {
  const months = enumerateMonths(start, end);
  const results: RawAvailabilityResponse[] = [];

  for (let i = 0; i < months.length; i++) {
    const month = months[i]!;
    const result = await fetchMonthAvailability(facilityId, month, opts);
    results.push(result);
    // ~1 req/sec norm against the undocumented endpoint (T-02-03) — pause
    // between sequential month fetches, but not after the last one.
    if (i < months.length - 1) {
      const sleep = opts?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
      await sleep(1000);
    }
  }

  return results;
}

export function createClient(opts?: ClientOptions): {
  resolveFacility: (parkName: string) => Promise<ResolvedFacility>;
  resolveArea: (areaName: string) => Promise<ResolvedRecArea>;
  listAreaFacilities: (recAreaId: number) => Promise<AreaFacility[]>;
  fetchMonthAvailability: (facilityId: number, monthStart: string) => Promise<RawAvailabilityResponse>;
  fetchAvailabilityForRange: (
    facilityId: number,
    start: string,
    end: string
  ) => Promise<RawAvailabilityResponse[]>;
} {
  return {
    resolveFacility: (parkName: string) => resolveFacility(parkName, opts),
    resolveArea: (areaName: string) => resolveArea(areaName, opts),
    listAreaFacilities: (recAreaId: number) => listAreaFacilities(recAreaId, opts),
    fetchMonthAvailability: (facilityId: number, monthStart: string) =>
      fetchMonthAvailability(facilityId, monthStart, opts),
    fetchAvailabilityForRange: (facilityId: number, start: string, end: string) =>
      fetchAvailabilityForRange(facilityId, start, end, opts),
  };
}
