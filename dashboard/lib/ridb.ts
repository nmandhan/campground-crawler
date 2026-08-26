/** Read-only RIDB access for the dashboard's area typeahead (AREA-04) and
 *  campground preview (MGMT-05).
 *
 *  Hand-duplicated from src/recreation-gov/client.ts, never imported: this dashboard is an
 *  independent Next.js project and must not reach across the src/ <-> dashboard/ boundary
 *  (dashboard/lib/types.ts header). If the poller's classification rules change, this file
 *  must be updated by hand — a preview that disagrees with the poller is worse than none.
 *
 *  server-only, and load-bearing: RIDB_API_KEY is a secret and must never reach the client
 *  bundle (RESEARCH.md Pitfall 2, threat T-05-06). Every RIDB call from the browser goes
 *  through a Route Handler that imports this module, never directly.
 *
 *  This module NEVER writes. ARCHITECTURE.md Anti-Pattern 1 stands: the resolved campground
 *  list is preview-only UI state and must never be frozen into watches.json — the poller
 *  re-resolves areas every cycle.
 */
import 'server-only';
import { z } from 'zod';
import type { TruncationInfo } from './types';

const RIDB_BASE = 'https://ridb.recreation.gov/api/v1';

/** Same allowlist philosophy as the poller (AREA-03/D-04): an unrecognized facility type
 *  degrades to "excluded", never to a false positive. */
const CAMPGROUND_TYPE_PATTERN = /campground/i;
const GROUP_TYPE_PATTERN = /group/i;

/** Mirrors AREA_FACILITY_CAP in src/config/watches.ts (Phase 4 D-07). Hand-copied. */
export const AREA_FACILITY_CAP = 20;

const RidbRecAreaSchema = z.object({
  RecAreaID: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  RecAreaName: z.string(),
});
const RidbRecAreaSearchSchema = z.object({
  RECDATA: z.array(RidbRecAreaSchema),
  METADATA: z.unknown().optional(),
});

const RidbFacilitySchema = z.object({
  FacilityID: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  FacilityName: z.string(),
  FacilityTypeDescription: z.string().optional(),
  Reservable: z.boolean().optional(),
});
const RidbRecAreaFacilitiesSchema = z.object({
  RECDATA: z.array(RidbFacilitySchema),
  METADATA: z.unknown().optional(),
});

export interface RecAreaSuggestion {
  recAreaId: number;
  recAreaName: string;
}
export interface AreaFacility {
  facilityId: number;
  facilityName: string;
  facilityType: 'standard' | 'group';
}
export interface RidbOptions {
  fetchImpl?: typeof fetch;
  apiKey?: string;
}

export type SearchResult = { ok: true; areas: RecAreaSuggestion[] } | { ok: false; error: string };
export type FacilitiesResult = { ok: true; facilities: AreaFacility[] } | { ok: false; error: string };

/** AREA-04: find a Recreation Area by name, no numeric id required from the caller. */
export async function searchRecAreas(query: string, opts?: RidbOptions): Promise<SearchResult> {
  try {
    const url = new URL(`${RIDB_BASE}/recareas`);
    url.searchParams.set('query', query);
    url.searchParams.set('limit', '10');

    const doFetch = opts?.fetchImpl ?? fetch;
    const res = await doFetch(url.toString(), {
      headers: { apikey: opts?.apiKey ?? process.env.RIDB_API_KEY ?? '' },
    });

    if (!res.ok) {
      return { ok: false, error: `RIDB /recareas: HTTP ${res.status}` };
    }

    const body = await res.json();
    const parsed = RidbRecAreaSearchSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, error: 'unexpected RIDB response shape' };
    }

    return {
      ok: true,
      areas: parsed.data.RECDATA.map((r) => ({ recAreaId: r.RecAreaID, recAreaName: r.RecAreaName })),
    };
  } catch (err) {
    // One safe line — never the URL (carries the query) or any header.
    return { ok: false, error: `RIDB /recareas request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Classifies a raw RIDB facility record as a reservable campground, or `null` if it should be
 *  excluded (not a campground, not reservable, or a compact stub needing hydration — which this
 *  module deliberately does not do; see listAreaFacilities). Verbatim from the poller. */
function classifyFacility(f: {
  FacilityID: number;
  FacilityName: string;
  FacilityTypeDescription?: string;
  Reservable?: boolean;
}): AreaFacility | null {
  const desc = f.FacilityTypeDescription;
  if (desc === undefined) return null; // stub, needs hydration
  if (!CAMPGROUND_TYPE_PATTERN.test(desc)) return null; // not a campground
  if (f.Reservable !== true) return null; // fail closed: undefined is NOT reservable
  return {
    facilityId: f.FacilityID,
    facilityName: f.FacilityName,
    facilityType: GROUP_TYPE_PATTERN.test(desc) ? 'group' : 'standard',
  };
}

/** MGMT-05: lists the reservable campgrounds inside one Recreation Area, filtered to
 *  /campground/i FacilityTypeDescription AND Reservable === true, tagged standard/group,
 *  preserving RIDB's returned order.
 *
 *  No per-facility hydration fallback here, unlike src/recreation-gov/client.ts's
 *  AREA_HYDRATION_LIMIT path. This is an interactive preview that re-fires on every chip
 *  add/remove (D-09) — up to 20 extra sequential RIDB round trips would make the modal feel
 *  broken. A compact stub is simply omitted from the preview; the poller still hydrates and
 *  may therefore find slightly MORE campgrounds than shown. The preview is a
 *  "these will definitely be checked" floor, not an exhaustive list.
 */
export async function listAreaFacilities(recAreaId: number, opts?: RidbOptions): Promise<FacilitiesResult> {
  try {
    const url = new URL(`${RIDB_BASE}/recareas/${encodeURIComponent(String(recAreaId))}/facilities`);
    url.searchParams.set('limit', '50');

    const doFetch = opts?.fetchImpl ?? fetch;
    const res = await doFetch(url.toString(), {
      headers: { apikey: opts?.apiKey ?? process.env.RIDB_API_KEY ?? '' },
    });

    if (!res.ok) {
      return { ok: false, error: `RIDB /recareas/{id}/facilities: HTTP ${res.status}` };
    }

    const body = await res.json();
    const parsed = RidbRecAreaFacilitiesSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, error: 'unexpected RIDB response shape' };
    }

    const facilities: AreaFacility[] = [];
    for (const f of parsed.data.RECDATA) {
      // RIDB's order, never re-sorted
      const classified = classifyFacility(f);
      if (classified) facilities.push(classified);
    }
    return { ok: true, facilities };
  } catch (err) {
    return {
      ok: false,
      error: `RIDB /recareas/{id}/facilities request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
