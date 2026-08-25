/** state.json entries -> display rows with booking links (D-07).
 *
 *  Pure module: no `fetch`, no `console`, no ambient clock read — `now: Date` is always an
 *  explicit parameter. Imports only from `./types` and `./format`.
 */
import type { StateFile, Watch, RunLogEntry, MatchedSlot } from './types';
import { formatDateRange, formatRelativeTime, watchLabel } from './format';

export interface ActiveMatchRow {
  key: string;
  watchId: string;
  parkName: string;
  campsiteId: string;
  startDate: string;
  endDate: string;
  dateRangeLabel: string; // formatDateRange(startDate, endDate)
  bookingUrl: string | null; // null => render as plain text, never as an <a href>
  notifiedAt: string; // raw ISO from StateEntry.lastNotifiedAt
  notifiedRelative: string; // formatRelativeTime(notifiedAt, now)
  stillOpenInLatestRun: boolean;
}

export function parseDedupKey(
  key: string,
): { watchId: string; campsiteId: string; startDate: string; endDate: string } | null {
  const parts = key.split(':');
  if (parts.length !== 4 || parts.some((p) => p.length === 0)) return null;
  const watchId = parts[0] as string;
  const campsiteId = parts[1] as string;
  const startDate = parts[2] as string;
  const endDate = parts[3] as string;
  return { watchId, campsiteId, startDate, endDate };
}

/** Identical allowlist to src/notify/email.ts's safeBookingUrl (threat T-03-08, link spoofing):
 *  only https://www.recreation.gov/ links are ever emitted. Note the trailing slash — it is what
 *  rejects https://www.recreation.gov.evil.com/. */
export function safeBookingUrl(url: string): string | null {
  return typeof url === 'string' && url.startsWith('https://www.recreation.gov/') ? url : null;
}

const CAMPSITE_ID_ALLOWLIST = /^[A-Za-z0-9_-]+$/;

function buildBookingUrl(campsiteId: string): string | null {
  if (!CAMPSITE_ID_ALLOWLIST.test(campsiteId)) return null;
  return safeBookingUrl(`https://www.recreation.gov/camping/campsites/${campsiteId}`);
}

function findLatestRun(runs: RunLogEntry[]): RunLogEntry | null {
  if (runs.length === 0) return null;
  let latest: RunLogEntry = runs[0] as RunLogEntry;
  for (const run of runs) {
    if (run.startedAt > latest.startedAt) latest = run;
  }
  return latest;
}

function findMatchedSlot(
  latestRun: RunLogEntry | null,
  watchId: string,
  campsiteId: string,
  startDate: string,
  endDate: string,
): MatchedSlot | null {
  if (!latestRun) return null;
  const outcome = latestRun.outcomes.find((o) => o.watchId === watchId);
  if (!outcome || outcome.status !== 'MATCH') return null;
  const slots = [...outcome.newMatches, ...outcome.suppressed];
  return (
    slots.find((s) => s.campsiteId === campsiteId && s.startDate === startDate && s.endDate === endDate) ??
    null
  );
}

function isStillOpen(
  latestRun: RunLogEntry | null,
  watchId: string,
  campsiteId: string,
  startDate: string,
  endDate: string,
): boolean {
  if (!latestRun) return false;
  const outcome = latestRun.outcomes.find((o) => o.watchId === watchId);
  if (!outcome || outcome.status !== 'MATCH') return false;
  const slots = [...outcome.newMatches, ...outcome.suppressed];
  return slots.some(
    (s) => s.campsiteId === campsiteId && s.startDate === startDate && s.endDate === endDate,
  );
}

export function deriveActiveMatches(
  state: StateFile,
  watches: Watch[],
  runs: RunLogEntry[],
  now: Date,
): ActiveMatchRow[] {
  const latest = findLatestRun(runs);
  const rows: ActiveMatchRow[] = [];

  for (const [key, entry] of Object.entries(state.entries)) {
    const parsed = parseDedupKey(key);
    if (!parsed) continue;

    const { watchId, campsiteId, startDate, endDate } = parsed;
    // AREA-05: name the campground that actually matched, not just the watch's area(s).
    // MatchedSlot already carries facilityId/facilityName per match, so attribution costs
    // no new poller field. D-05: a group campground is flagged unmistakably, because the
    // user's real use case is 1-2 tent sites and a group site must never look like one.
    const slot = findMatchedSlot(latest, watchId, campsiteId, startDate, endDate);
    const watch = watches.find((w) => w.id === watchId);
    const parkName = slot
      ? `${slot.facilityName}${slot.facilityType === 'group' ? ' [GROUP]' : ''}`
      : (watch ? watchLabel(watch) : watchId);

    rows.push({
      key,
      watchId,
      parkName,
      campsiteId,
      startDate,
      endDate,
      dateRangeLabel: formatDateRange(startDate, endDate),
      bookingUrl: buildBookingUrl(campsiteId),
      notifiedAt: entry.lastNotifiedAt,
      notifiedRelative: formatRelativeTime(entry.lastNotifiedAt, now),
      stillOpenInLatestRun: isStillOpen(latest, watchId, campsiteId, startDate, endDate),
    });
  }

  rows.sort((a, b) => {
    if (a.notifiedAt !== b.notifiedAt) return a.notifiedAt < b.notifiedAt ? 1 : -1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return rows;
}
