/** Loads watches.json, validates against WatchesFileSchema, and resolves each
 *  watch's parkName -> facilityId via RIDB, memoized per unique name (D-02).
 *  A watch that fails to resolve never aborts the run for the others (D-06).
 */
import { readFile } from 'node:fs/promises';
import { WatchesFileSchema } from './schema.js';
import {
  resolveFacility as defaultResolveFacility,
  resolveArea as defaultResolveArea,
  listAreaFacilities as defaultListAreaFacilities,
  type ClientOptions,
  type ResolvedFacility,
  type AreaFacility,
} from '../recreation-gov/client.js';
import { describeFailure } from '../errors.js';
import type { Watch, ResolvedWatch, TruncationInfo } from '../types.js';

export const DEFAULT_WATCHES_PATH = 'watches.json';

/** D-07/AREA-02: hard ceiling on facilities polled per area watch, shared across ALL
 *  areas in that watch (D-10) — a 3-area watch tops out at 20, not 60. Applied AFTER
 *  type/reservable filtering and dedup, BEFORE any availability polling. There is no
 *  UI in this phase, so this resolver is the only enforcement point; it is unconditional. */
export const AREA_FACILITY_CAP = 20;

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
}

export async function loadWatches(path?: string): Promise<Watch[]> {
  const filePath = path ?? DEFAULT_WATCHES_PATH;

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        `watches config not found at ${filePath} — copy watches.example.json to watches.json and edit it`
      );
    }
    throw new Error(`watches config at ${filePath} could not be read: ${(err as Error).message}`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    throw new Error(`watches config at ${filePath} is not valid JSON: ${(err as Error).message}`);
  }

  const result = WatchesFileSchema.safeParse(parsedJson);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`watches config at ${filePath} is invalid: ${issues}`);
  }

  return result.data;
}

export interface ResolveResult {
  resolved: ResolvedWatch[];
  failures: Array<{ watchId: string; reason: string }>;
  /** D-08: one entry per watch whose area resolution exceeded AREA_FACILITY_CAP.
   *  Empty for facility watches and for area watches under the cap. */
  truncations: Array<{ watchId: string } & TruncationInfo>;
}

export interface ResolveWatchesOptions extends ClientOptions {
  logger?: Logger;
  resolve?: typeof defaultResolveFacility;
  resolveArea?: typeof defaultResolveArea;
  listAreaFacilities?: typeof defaultListAreaFacilities;
}

export async function resolveWatches(
  watches: Watch[],
  opts?: ResolveWatchesOptions
): Promise<ResolveResult> {
  const logger = opts?.logger ?? console;
  const resolve = opts?.resolve ?? defaultResolveFacility;
  const resolveAreaFn = opts?.resolveArea ?? defaultResolveArea;
  const listFacilitiesFn = opts?.listAreaFacilities ?? defaultListAreaFacilities;
  const facilityCache = new Map<string, Promise<ResolvedFacility>>();
  /** Per-run memo of the fully resolved+filtered facility list for one area.
   *  Key is `id:<recAreaId>` when the override is set, else `name:<lowercased trimmed name>`.
   *  Caching the FACILITY LIST (not just the RecArea match) is what makes the expensive
   *  half — two sequential RIDB calls — cost once per unique area per run. */
  const areaCache = new Map<string, Promise<AreaFacility[]>>();
  const loggedNames = new Set<string>();
  let ridbCallCount = 0;

  const resolved: ResolvedWatch[] = [];
  const failures: Array<{ watchId: string; reason: string }> = [];
  const truncations: ResolveResult['truncations'] = [];

  for (const watch of watches) {
    try {
      if (watch.type === 'facility') {
        if (watch.facilityId !== undefined) {
          resolved.push({
            id: watch.id,
            facilityId: watch.facilityId,
            facilityName: watch.parkName,
            facilityType: 'standard',
            dateRange: watch.dateRange,
            siteType: watch.siteType,
          });
          continue;
        }

        const cacheKey = watch.parkName.trim().toLowerCase();
        let pending = facilityCache.get(cacheKey);
        if (!pending) {
          ridbCallCount += 1;
          pending = resolve(watch.parkName, opts);
          facilityCache.set(cacheKey, pending);
        }
        const facility = await pending;

        if (!loggedNames.has(cacheKey)) {
          loggedNames.add(cacheKey);
          logger.info(
            `resolved "${watch.parkName}" -> facility ${facility.facilityId} (${facility.facilityName})`
          );
          if (facility.alternatives.length > 0) {
            logger.warn(
              `  other RIDB matches for "${watch.parkName}": ${facility.alternatives.join(
                ', '
              )} — set "facilityId" in watches.json if this resolved to the wrong campground`
            );
          }
        }

        resolved.push({
          id: watch.id,
          facilityId: facility.facilityId,
          facilityName: facility.facilityName,
          facilityType: 'standard',
          dateRange: watch.dateRange,
          siteType: watch.siteType,
        });
        continue;
      }

      const seen = new Set<number>();
      const collected: AreaFacility[] = [];

      for (const area of watch.areas) {
        // D-10: area-list order
        const cacheKey =
          area.recAreaId !== undefined
            ? `id:${area.recAreaId}`
            : `name:${area.name.trim().toLowerCase()}`;

        let pending = areaCache.get(cacheKey);
        if (!pending) {
          ridbCallCount += area.recAreaId !== undefined ? 1 : 2;
          pending = (async () => {
            let recAreaId = area.recAreaId;
            if (recAreaId === undefined) {
              // D-02/D-03: auto-pick RIDB's top match, surface the rest, never fail closed.
              const match = await resolveAreaFn(area.name, opts);
              recAreaId = match.recAreaId;
              logger.info(`resolved area "${area.name}" -> recArea ${match.recAreaId} (${match.recAreaName})`);
              if (match.alternatives.length > 0) {
                logger.warn(
                  `  other RIDB areas for "${area.name}": ${match.alternatives.join(', ')} — ` +
                    `set "recAreaId" on this area in watches.json if this resolved to the wrong area`
                );
              }
            }
            return listFacilitiesFn(recAreaId, opts);
          })();
          areaCache.set(cacheKey, pending);
        }

        for (const f of await pending) {
          // D-09: RIDB's order, never re-sorted
          if (seen.has(f.facilityId)) continue; // one campground reachable from two areas counts once
          seen.add(f.facilityId);
          collected.push(f);
        }
      }

      if (collected.length === 0) {
        throw new Error(
          `no reservable campgrounds found across ${watch.areas.length} area(s) for watch "${watch.id}"`
        );
      }

      const kept = collected.slice(0, AREA_FACILITY_CAP); // D-07: cap AFTER filter+dedup, BEFORE polling
      if (collected.length > kept.length) {
        truncations.push({ watchId: watch.id, requested: collected.length, kept: kept.length });
        logger.warn(
          `watch "${watch.id}" resolved ${collected.length} campgrounds — showing ${kept.length} of ` +
            `${collected.length} (capped at AREA_FACILITY_CAP=${AREA_FACILITY_CAP})`
        );
      }

      for (const f of kept) {
        resolved.push({
          id: watch.id,
          facilityId: f.facilityId,
          facilityName: f.facilityName,
          facilityType: f.facilityType,
          dateRange: watch.dateRange,
          siteType: watch.siteType,
        });
      }
    } catch (err) {
      failures.push({ watchId: watch.id, reason: describeFailure(err) });
    }
  }

  // Pitfall 1 visibility: RIDB's cap is 50 req/min and these all fire in a burst at
  // run start. Logged (not enforced) so a future scale-up shows up in runs.json history
  // rather than as a surprise live 429.
  logger.info(`RIDB resolution calls this run: ${ridbCallCount}`);

  return { resolved, failures, truncations };
}

export async function loadResolvedWatches(
  opts?: ClientOptions & { path?: string; logger?: Logger }
): Promise<ResolveResult> {
  const watches = await loadWatches(opts?.path);
  const ridbApiKey = process.env.RIDB_API_KEY;
  return resolveWatches(watches, {
    ...opts,
    ridbApiKey: ridbApiKey && ridbApiKey.length > 0 ? ridbApiKey : opts?.ridbApiKey,
  });
}
