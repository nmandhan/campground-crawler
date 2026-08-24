/** Pure fetch-result -> DashboardModel assembly (D-03/D-04/D-05/D-06/D-07).
 *
 *  No `fetch`, no `console`, no ambient current-time read — `now: Date` is always an explicit
 *  parameter. Imports with extensionless relative paths (`./schema`, `./derive-status`, …) so
 *  `npm test` can run this module through `tsx` directly.
 */
import type { FetchResult } from './github';
import { parseWatches, parseStateFile, parseRunLog } from './schema';
import { deriveActiveMatches, type ActiveMatchRow } from './derive-active-matches';
import { deriveWatchStatuses, type WatchStatusRow } from './derive-status';
import { deriveTimeline, latestRun, type TimelineRow } from './derive-timeline';
import { formatAbsolute, formatRelativeTime } from './format';
import { COPY } from './copy';

export interface DashboardRaw {
  watches: FetchResult;
  state: FetchResult;
  runs: FetchResult;
}

export type DashboardModel =
  | { ok: false }
  | {
      ok: true;
      dataAsOfLabel: string | null; // null when runs.json is empty
      activeMatches: ActiveMatchRow[];
      watchStatuses: WatchStatusRow[];
      timeline: TimelineRow[];
      skippedRuns: number; // malformed runs.json entries dropped by parseRunLog
    };

/** Any fetch failure or top-level parse failure across the three files collapses to a single
 *  fieldless `{ ok: false }` — no `error` string from `FetchResult`/`ParseResult` is ever copied
 *  onto the model, because everything in the model is rendered to a public page (threat T-03-13).
 *  A malformed *individual* runs.json entry is different: `parseRunLog` already skips those and
 *  the count surfaces via `skippedRuns`. */
export function buildDashboardModel(raw: DashboardRaw, now: Date): DashboardModel {
  if (!raw.watches.ok || !raw.state.ok || !raw.runs.ok) {
    return { ok: false };
  }

  const watchesResult = parseWatches(raw.watches.data);
  const stateResult = parseStateFile(raw.state.data);
  const runsResult = parseRunLog(raw.runs.data);

  if (!watchesResult.ok || !stateResult.ok || !runsResult.ok) {
    return { ok: false };
  }

  const watches = watchesResult.data;
  const state = stateResult.data;
  const runs = runsResult.data;
  const skippedRuns = runsResult.skipped ?? 0;

  const last = latestRun(runs);
  const dataAsOfLabel =
    last === null
      ? null
      : `${COPY.dataAsOfPrefix}${formatAbsolute(last.startedAt)} (${formatRelativeTime(last.startedAt, now)})`;

  return {
    ok: true,
    dataAsOfLabel,
    activeMatches: deriveActiveMatches(state, watches, runs, now),
    watchStatuses: deriveWatchStatuses(watches, runs, now),
    timeline: deriveTimeline(runs, now),
    skippedRuns,
  };
}
