/** watches.json + runs.json -> per-watch latest outcome (D-05).
 *
 *  Pure module: no `fetch`, no `console`, no ambient clock read — `now: Date` is always an
 *  explicit parameter. Models the exhaustive discriminated-union branching in src/run.ts
 *  (lines 91-104): every WatchOutcome variant is handled, with no silent fallthrough.
 */
import type { Watch, RunLogEntry } from './types';
import { formatDateRange, formatRelativeTime, watchLabel } from './format';

export type WatchStatus = 'MATCH' | 'NO_MATCH' | 'FAILED' | 'UNKNOWN';

export interface WatchStatusRow {
  watchId: string;
  parkName: string;
  dateRangeLabel: string; // formatDateRange(dateRange.start, dateRange.end)
  siteType: string; // the watch's siteType, verbatim
  status: WatchStatus;
  detail: string;
  observedAt: string | null; // startedAt of the run this status came from
  observedRelative: string; // formatRelativeTime(observedAt, now), or '—' when null
}

function outcomeSuffix(outcome: {
  truncated?: { requested: number; kept: number };
  facilityFailures?: unknown[];
}): string {
  const parts: string[] = [];
  if (outcome.truncated) {
    parts.push(`showing ${outcome.truncated.kept} of ${outcome.truncated.requested} campgrounds`);
  }
  const failed = outcome.facilityFailures?.length ?? 0;
  if (failed > 0) {
    parts.push(`${failed} ${failed === 1 ? 'campground' : 'campgrounds'} could not be checked`);
  }
  return parts.length === 0 ? '' : ` — ${parts.join('; ')}`;
}

export function deriveWatchStatuses(
  watches: Watch[],
  runs: RunLogEntry[],
  now: Date,
): WatchStatusRow[] {
  const sortedRuns = [...runs].sort((a, b) => {
    if (a.startedAt === b.startedAt) return 0;
    return a.startedAt > b.startedAt ? -1 : 1;
  });

  return watches.map((watch) => {
    const dateRangeLabel = formatDateRange(watch.dateRange.start, watch.dateRange.end);
    const label = watchLabel(watch);

    for (const run of sortedRuns) {
      const outcome = run.outcomes.find((o) => o.watchId === watch.id);
      if (!outcome) continue;

      const observedAt = run.startedAt;
      const observedRelative = formatRelativeTime(observedAt, now);

      if (outcome.status === 'MATCH') {
        const total = outcome.newMatches.length + outcome.suppressed.length;
        const siteNoun = total === 1 ? 'site' : 'sites';
        const detail = `${total} ${siteNoun} available (${outcome.newMatches.length} new)${outcomeSuffix(outcome)}`;
        return {
          watchId: watch.id,
          parkName: label,
          dateRangeLabel,
          siteType: watch.siteType,
          status: 'MATCH' as const,
          detail,
          observedAt,
          observedRelative,
        };
      } else if (outcome.status === 'NO_MATCH') {
        return {
          watchId: watch.id,
          parkName: label,
          dateRangeLabel,
          siteType: watch.siteType,
          status: 'NO_MATCH' as const,
          detail: `No matching availability${outcomeSuffix(outcome)}`,
          observedAt,
          observedRelative,
        };
      } else if (outcome.status === 'FAILED') {
        return {
          watchId: watch.id,
          parkName: label,
          dateRangeLabel,
          siteType: watch.siteType,
          status: 'FAILED' as const,
          detail: `${outcome.reason}${outcomeSuffix(outcome)}`,
          observedAt,
          observedRelative,
        };
      }
    }

    return {
      watchId: watch.id,
      parkName: label,
      dateRangeLabel,
      siteType: watch.siteType,
      status: 'UNKNOWN' as const,
      detail: 'No poll run has covered this watch yet',
      observedAt: null,
      observedRelative: '—',
    };
  });
}
