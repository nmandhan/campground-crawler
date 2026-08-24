/** runs.json -> reverse-chronological timeline rows (D-06).
 *
 *  Pure module: no `fetch`, no `console`, no ambient clock read — `now: Date` is always an
 *  explicit parameter. Models the exhaustive discriminated-union branching in src/run.ts
 *  (lines 91-104): every WatchOutcome variant is handled, with no silent fallthrough.
 */
import type { RunLogEntry } from './types';
import { formatRelativeTime, formatAbsolute } from './format';

export interface TimelineRow {
  startedAt: string;
  startedRelative: string;
  startedAbsolute: string;
  checked: number;
  matchCount: number;
  newMatchCount: number;
  noMatchCount: number;
  failedCount: number;
  failures: Array<{ watchId: string; reason: string }>;
  summaryLabel: string;
}

function sortDescending(runs: RunLogEntry[]): RunLogEntry[] {
  return [...runs].sort((a, b) => {
    if (a.startedAt === b.startedAt) return 0;
    return a.startedAt > b.startedAt ? -1 : 1;
  });
}

export function deriveTimeline(runs: RunLogEntry[], now: Date): TimelineRow[] {
  return sortDescending(runs).map((run) => {
    let matchCount = 0;
    let newMatchCount = 0;
    let noMatchCount = 0;
    let failedCount = 0;
    const failures: Array<{ watchId: string; reason: string }> = [];

    for (const outcome of run.outcomes) {
      if (outcome.status === 'MATCH') {
        matchCount += 1;
        newMatchCount += outcome.newMatches.length;
      } else if (outcome.status === 'NO_MATCH') {
        noMatchCount += 1;
      } else if (outcome.status === 'FAILED') {
        failedCount += 1;
        failures.push({ watchId: outcome.watchId, reason: outcome.reason });
      }
    }

    const checkedNoun = run.checked === 1 ? 'watch' : 'watches';
    const matchNoun = matchCount === 1 ? 'match' : 'matches';
    const noMatchNoun = noMatchCount === 1 ? 'no match' : 'no matches';

    let summaryLabel = `${run.checked} ${checkedNoun} checked — ${matchCount} ${matchNoun} (${newMatchCount} new), ${noMatchCount} ${noMatchNoun}`;
    if (failedCount > 0) {
      summaryLabel += `, ${failedCount} failed`;
    }

    return {
      startedAt: run.startedAt,
      startedRelative: formatRelativeTime(run.startedAt, now),
      startedAbsolute: formatAbsolute(run.startedAt),
      checked: run.checked,
      matchCount,
      newMatchCount,
      noMatchCount,
      failedCount,
      failures,
      summaryLabel,
    };
  });
}

export function latestRun(runs: RunLogEntry[]): RunLogEntry | null {
  if (runs.length === 0) return null;
  const sorted = sortDescending(runs);
  return sorted[0] as RunLogEntry;
}
