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
import { AvailabilityResponseSchema, RidbFacilitySearchSchema } from './types.js';
import type { RawAvailabilityResponse } from './types.js';
import { FacilityNotFoundError, ResponseSchemaError } from '../errors.js';

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
  fetchMonthAvailability: (facilityId: number, monthStart: string) => Promise<RawAvailabilityResponse>;
  fetchAvailabilityForRange: (
    facilityId: number,
    start: string,
    end: string
  ) => Promise<RawAvailabilityResponse[]>;
} {
  return {
    resolveFacility: (parkName: string) => resolveFacility(parkName, opts),
    fetchMonthAvailability: (facilityId: number, monthStart: string) =>
      fetchMonthAvailability(facilityId, monthStart, opts),
    fetchAvailabilityForRange: (facilityId: number, start: string, end: string) =>
      fetchAvailabilityForRange(facilityId, start, end, opts),
  };
}
