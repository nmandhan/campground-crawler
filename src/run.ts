/** The single deployment-agnostic pipeline function (ARCHITECTURE.md Pattern 1).
 *  Phase 2 calls this same function from a GitHub Actions job and attaches email
 *  delivery to its return value without changing its shape (D-07).
 */
import { loadResolvedWatches, type ResolveResult } from './config/watches.js';
import { fetchAvailabilityForRange } from './recreation-gov/client.js';
import { parseAvailability, mergeSlots } from './recreation-gov/parse.js';
import type { RawAvailabilityResponse } from './recreation-gov/types.js';
import { matchWatch } from './matcher/match.js';
import { dedupKey, type StateStore } from './state/store.js';
import { FileStateStore } from './state/fileStore.js';
import { describeFailure } from './errors.js';
import { nightsInRange } from './matcher/dates.js';
import type { RunSummary, WatchOutcome, MatchedSlot } from './types.js';

export interface RunLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface RunDeps {
  loadResolved?: () => Promise<ResolveResult>;
  fetchRange?: (
    facilityId: number,
    start: string,
    end: string
  ) => Promise<RawAvailabilityResponse[]>;
  store?: StateStore;
  logger?: RunLogger;
  now?: () => Date;
}

export async function run(deps?: RunDeps): Promise<RunSummary> {
  const loadResolved = deps?.loadResolved ?? loadResolvedWatches;
  const fetchRange = deps?.fetchRange ?? fetchAvailabilityForRange;
  const store = deps?.store ?? new FileStateStore();
  const logger = deps?.logger ?? console;
  const now = deps?.now ?? (() => new Date());

  const startedAt = now().toISOString();

  const { resolved, failures } = await loadResolved();

  await store.load();

  const outcomes: WatchOutcome[] = failures.map((f) => ({
    watchId: f.watchId,
    status: 'FAILED' as const,
    reason: f.reason,
  }));

  for (const watch of resolved) {
    try {
      const responses = await fetchRange(watch.facilityId, watch.dateRange.start, watch.dateRange.end);
      const slots = mergeSlots(...responses.map(parseAvailability));
      const matches = matchWatch(slots, watch);

      if (matches.length === 0) {
        outcomes.push({ watchId: watch.id, status: 'NO_MATCH' });
        continue;
      }

      const newMatches: MatchedSlot[] = [];
      const suppressed: MatchedSlot[] = [];
      for (const match of matches) {
        const key = dedupKey(match.watchId, match.campsiteId, match.startDate, match.endDate);
        if (store.has(key)) {
          suppressed.push(match);
        } else {
          store.markNotified(key, now());
          newMatches.push(match);
        }
      }

      outcomes.push({ watchId: watch.id, status: 'MATCH', newMatches, suppressed });
    } catch (err) {
      outcomes.push({ watchId: watch.id, status: 'FAILED', reason: describeFailure(err) });
    }
  }

  await store.save();

  for (const outcome of outcomes) {
    if (outcome.status === 'MATCH') {
      const sites = [...outcome.newMatches, ...outcome.suppressed].map((m) => m.siteLabel || m.campsiteId).join(', ');
      logger.info(
        `OK    ${outcome.watchId} — ${outcome.newMatches.length} new, ${outcome.suppressed.length} already notified: ${sites}`
      );
    } else if (outcome.status === 'NO_MATCH') {
      const watch = resolved.find((w) => w.id === outcome.watchId);
      const nightCount = watch ? nightsInRange(watch.dateRange.start, watch.dateRange.end).length : 0;
      logger.info(`NO MATCH ${outcome.watchId} — checked ${nightCount} nights, nothing available`);
    } else {
      logger.error(`FAILED ${outcome.watchId} — ${outcome.reason}`);
    }
  }

  const finishedAt = now().toISOString();

  const newMatches = outcomes
    .filter((o): o is Extract<WatchOutcome, { status: 'MATCH' }> => o.status === 'MATCH')
    .flatMap((o) => o.newMatches);
  const failed = outcomes
    .filter((o): o is Extract<WatchOutcome, { status: 'FAILED' }> => o.status === 'FAILED')
    .map((o) => ({ watchId: o.watchId, reason: o.reason }));
  const noMatch = outcomes.filter((o) => o.status === 'NO_MATCH').map((o) => o.watchId);

  return {
    startedAt,
    finishedAt,
    checked: resolved.length + failures.length,
    outcomes,
    newMatches,
    failed,
    noMatch,
  };
}
