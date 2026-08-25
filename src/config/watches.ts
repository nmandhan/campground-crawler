/** Loads watches.json, validates against WatchesFileSchema, and resolves each
 *  watch's parkName -> facilityId via RIDB, memoized per unique name (D-02).
 *  A watch that fails to resolve never aborts the run for the others (D-06).
 */
import { readFile } from 'node:fs/promises';
import { WatchesFileSchema } from './schema.js';
import {
  resolveFacility as defaultResolveFacility,
  type ClientOptions,
  type ResolvedFacility,
} from '../recreation-gov/client.js';
import { describeFailure } from '../errors.js';
import type { Watch, ResolvedWatch, TruncationInfo } from '../types.js';

export const DEFAULT_WATCHES_PATH = 'watches.json';

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
}

export async function resolveWatches(
  watches: Watch[],
  opts?: ResolveWatchesOptions
): Promise<ResolveResult> {
  const logger = opts?.logger ?? console;
  const resolve = opts?.resolve ?? defaultResolveFacility;
  const facilityCache = new Map<string, Promise<ResolvedFacility>>();
  const loggedNames = new Set<string>();

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

      // watch.type === 'area' — implemented in Task 2 of this plan.
    } catch (err) {
      failures.push({ watchId: watch.id, reason: describeFailure(err) });
    }
  }

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
