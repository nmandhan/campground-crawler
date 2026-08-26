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
import { sendDigestEmail } from './notify/email.js';
import type {
  RunSummary,
  WatchOutcome,
  MatchedSlot,
  ResolvedWatch,
  FacilityFailure,
  TruncationInfo,
} from './types.js';

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
  /** Called at most once per cycle with the post-dedup new matches (NOTF-01/D-04:
   *  one digest per cycle, never one email per site). Injectable so tests never
   *  touch the network. */
  sendNotification?: (matches: MatchedSlot[]) => Promise<void>;
}

export async function run(deps?: RunDeps): Promise<RunSummary> {
  const loadResolved = deps?.loadResolved ?? loadResolvedWatches;
  const fetchRange = deps?.fetchRange ?? fetchAvailabilityForRange;
  const store = deps?.store ?? new FileStateStore();
  const logger = deps?.logger ?? console;
  const now = deps?.now ?? (() => new Date());
  const sendNotification =
    deps?.sendNotification ?? ((matches: MatchedSlot[]) => sendDigestEmail(matches, { logger }));

  const startedAt = now().toISOString();

  const { resolved, failures, truncations } = await loadResolved();

  await store.load();

  const truncationByWatch = new Map<string, TruncationInfo>(
    truncations.map((t) => [t.watchId, { requested: t.requested, kept: t.kept }])
  );

  const outcomes: WatchOutcome[] = failures.map((f) => {
    const truncated = truncationByWatch.get(f.watchId);
    return {
      watchId: f.watchId,
      status: 'FAILED' as const,
      reason: f.reason,
      ...(truncated ? { truncated } : {}),
    };
  });

  // ARCHITECTURE.md Anti-Pattern 2: an AreaWatch contributes N ResolvedWatch entries
  // sharing one id, but every runs.json consumer does outcomes.find(o => o.watchId === id).
  // Collapse to exactly ONE outcome per watch id before anything downstream sees it.
  const groups = new Map<string, ResolvedWatch[]>();
  for (const w of resolved) {
    const arr = groups.get(w.id) ?? [];
    arr.push(w);
    groups.set(w.id, arr);
  }

  for (const [watchId, facilities] of groups) {
    const allMatches: MatchedSlot[] = [];
    const facilityFailures: FacilityFailure[] = [];

    for (const facility of facilities) {
      try {
        const responses = await fetchRange(facility.facilityId, facility.dateRange.start, facility.dateRange.end);
        const slots = mergeSlots(...responses.map(parseAvailability));
        allMatches.push(...matchWatch(slots, facility));
      } catch (err) {
        // RESEARCH.md Open Question 3 — RESOLVED: degrade gracefully. One flaky campground
        // must never hide matches found on its 14 healthy siblings. This extends
        // resolveWatches()'s "a failure never aborts the run for the others" convention
        // one level deeper, from per-watch to per-facility.
        facilityFailures.push({
          facilityId: facility.facilityId,
          facilityName: facility.facilityName,
          reason: describeFailure(err),
        });
      }
    }

    const extra: { truncated?: TruncationInfo; facilityFailures?: FacilityFailure[] } = {};
    const truncated = truncationByWatch.get(watchId);
    if (truncated) extra.truncated = truncated;
    if (facilityFailures.length > 0) extra.facilityFailures = facilityFailures;

    // Every facility failed => the watch genuinely failed. Some failed => still report
    // what was found, with the failures attached.
    if (facilityFailures.length === facilities.length) {
      outcomes.push({
        watchId,
        status: 'FAILED',
        reason:
          facilities.length === 1
            ? (facilityFailures[0]?.reason ?? 'unknown failure')
            : `all ${facilities.length} campgrounds failed; first: ${facilityFailures[0]?.reason ?? 'unknown failure'}`,
        ...extra,
      });
      continue;
    }

    if (allMatches.length === 0) {
      outcomes.push({ watchId, status: 'NO_MATCH', ...extra });
      continue;
    }

    const newMatches: MatchedSlot[] = [];
    const suppressed: MatchedSlot[] = [];
    for (const match of allMatches) {
      const key = dedupKey(match.watchId, match.campsiteId, match.startDate, match.endDate);
      if (store.has(key)) {
        suppressed.push(match);
      } else {
        store.markNotified(key, now());
        newMatches.push(match);
      }
    }

    outcomes.push({ watchId, status: 'MATCH', newMatches, suppressed, ...extra });
  }

  await store.save();

  for (const outcome of outcomes) {
    if (outcome.status === 'MATCH') {
      const sites = [...outcome.newMatches, ...outcome.suppressed].map((m) => m.siteLabel || m.campsiteId).join(', ');
      logger.info(
        `OK    ${outcome.watchId} — ${outcome.newMatches.length} new, ${outcome.suppressed.length} already notified: ${sites}`
      );
    } else if (outcome.status === 'NO_MATCH') {
      const watch = groups.get(outcome.watchId)?.[0];
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

  if (newMatches.length > 0) {
    try {
      await sendNotification(newMatches);
    } catch (err) {
      // D-11/D-12: a notification failure is NOT a watch failure. It must never enter
      // RunSummary.failed, never change cli.ts's exit code, and never abort the cycle.
      logger.error(`notification failed: ${describeFailure(err)}`);
    }
  }

  const failed = outcomes
    .filter((o): o is Extract<WatchOutcome, { status: 'FAILED' }> => o.status === 'FAILED')
    .map((o) => ({ watchId: o.watchId, reason: o.reason }));
  const noMatch = outcomes.filter((o) => o.status === 'NO_MATCH').map((o) => o.watchId);

  return {
    startedAt,
    finishedAt,
    // Counts WATCHES attempted, not facilities polled: a 20-campground area watch is 1.
    // Dashboard consumers have always read `checked` as "watches attempted".
    checked: groups.size + failures.length,
    outcomes,
    newMatches,
    failed,
    noMatch,
  };
}
