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

/** How many raw results to request from RIDB before re-ranking client-side (below).
 *  RIDB's own `query` search is a fuzzy full-text match across name/description/keywords,
 *  NOT a relevance-ranked name search — a real Recreation Area whose name contains the
 *  query can be buried past position 10 behind unrelated results that merely mention the
 *  query terms in their description (confirmed live: querying "white river" returns 63 total
 *  matches, with "White River National Forest" absent from the first 10). Fetching a larger
 *  page and re-ranking client-side (see rankByNameMatch) is the fix — RIDB has no
 *  relevance/sort query param to ask for this server-side. 50 is RIDB's documented per-page max. */
const SEARCH_FETCH_LIMIT = 50;

/** Number of ranked suggestions returned to the caller after re-ranking. */
const SEARCH_RESULT_LIMIT = 10;

/** Client-side re-rank: put results whose RecAreaName actually contains the query
 *  (case-insensitive) first, in RIDB's original relative order, ahead of everything else.
 *  This is the fix for RIDB's fuzzy full-text search burying exact name matches — see
 *  SEARCH_FETCH_LIMIT's comment for the reproduction. A stable sort (Array.prototype.sort
 *  is stable per spec) preserves RIDB's own ordering within each group. */
function rankByNameMatch(
  areas: RecAreaSuggestion[],
  query: string,
): RecAreaSuggestion[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return areas;
  return [...areas].sort((a, b) => {
    const aMatch = a.recAreaName.toLowerCase().includes(needle) ? 0 : 1;
    const bMatch = b.recAreaName.toLowerCase().includes(needle) ? 0 : 1;
    return aMatch - bMatch;
  });
}

/** AREA-04: find a Recreation Area by name, no numeric id required from the caller. */
export async function searchRecAreas(query: string, opts?: RidbOptions): Promise<SearchResult> {
  try {
    const url = new URL(`${RIDB_BASE}/recareas`);
    url.searchParams.set('query', query);
    url.searchParams.set('limit', String(SEARCH_FETCH_LIMIT));

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

    const areas = parsed.data.RECDATA.map((r) => ({ recAreaId: r.RecAreaID, recAreaName: r.RecAreaName }));
    const ranked = rankByNameMatch(areas, query);

    return { ok: true, areas: ranked.slice(0, SEARCH_RESULT_LIMIT) };
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

export interface PreviewArea {
  name?: string;
  recAreaId?: number;
}
export interface PreviewAreaError {
  area: string;
  error: string;
}
export type PreviewResult = {
  ok: true;
  facilities: AreaFacility[];
  truncated?: TruncationInfo;
  areaErrors: PreviewAreaError[];
};

/** MGMT-05 / D-09 / D-10: resolves the currently-selected area chips to the exact campgrounds
 *  the poller would check, so the user can catch a wrong area match BEFORE saving.
 *
 *  Mirrors src/config/watches.ts's resolveWatches() area branch exactly — same per-area dedup by
 *  facilityId, same RIDB order (never re-sorted, D-09), same cap applied AFTER filter+dedup
 *  (D-07). If these two ever diverge, the preview lies.
 *
 *  Per-area failures are returned in `areaErrors` rather than thrown: one bad chip must never
 *  blank the whole preview (project convention — a per-unit failure is isolated).
 *
 *  READ ONLY. The returned list is never persisted (ARCHITECTURE.md Anti-Pattern 1).
 */
export async function previewAreas(areas: PreviewArea[], opts?: RidbOptions): Promise<PreviewResult> {
  const seen = new Set<number>();
  const collected: AreaFacility[] = [];
  const areaErrors: PreviewAreaError[] = [];
  const resolvedCache = new Map<string, Promise<FacilitiesResult>>();

  for (const area of areas) {
    const cacheKey = area.recAreaId !== undefined ? `id:${area.recAreaId}` : `name:${area.name ?? ''}`;

    let pending = resolvedCache.get(cacheKey);
    if (!pending) {
      pending = (async (): Promise<FacilitiesResult> => {
        let recAreaId = area.recAreaId;
        if (recAreaId === undefined) {
          const searchResult = await searchRecAreas(area.name ?? '', opts);
          if (!searchResult.ok) return searchResult;
          if (searchResult.areas.length === 0) {
            return { ok: false, error: `no Recreation Area matched "${area.name}"` };
          }
          recAreaId = searchResult.areas[0]!.recAreaId;
        }
        return listAreaFacilities(recAreaId, opts);
      })();
      resolvedCache.set(cacheKey, pending);
    }

    const result = await pending;
    if (!result.ok) {
      areaErrors.push({ area: area.name ?? String(area.recAreaId), error: result.error });
      continue;
    }

    for (const f of result.facilities) {
      // never re-sorted
      if (seen.has(f.facilityId)) continue;
      seen.add(f.facilityId);
      collected.push(f);
    }
  }

  const kept = collected.slice(0, AREA_FACILITY_CAP);
  const truncated = collected.length > kept.length ? { requested: collected.length, kept: kept.length } : undefined;

  return { ok: true, facilities: kept, truncated, areaErrors };
}
