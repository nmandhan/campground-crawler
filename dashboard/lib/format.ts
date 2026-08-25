/** Pure, injected-clock formatting helpers (no ambient current-time reads).
 *
 *  `formatRelativeTime`/`formatAbsolute`/`formatDateRange` are the only place this dashboard
 *  turns raw ISO timestamps into copy. Built entirely on `Intl.RelativeTimeFormat` /
 *  `Intl.DateTimeFormat` (RESEARCH.md "Don't Hand-Roll") — no extra date-formatting library.
 */

import type { Watch } from './types';

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

type Unit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';

const THRESHOLDS: Array<{ unit: Unit; seconds: number }> = [
  { unit: 'year', seconds: 31536000 },
  { unit: 'month', seconds: 2592000 },
  { unit: 'week', seconds: 604800 },
  { unit: 'day', seconds: 86400 },
  { unit: 'hour', seconds: 3600 },
  { unit: 'minute', seconds: 60 },
  { unit: 'second', seconds: 1 },
];

/** `now` is an explicit parameter, never an ambient clock read — this keeps the function pure
 *  and test-deterministic, and lets `page.tsx` render one consistent "as of" instant. */
export function formatRelativeTime(iso: string, now: Date): string {
  if (Number.isNaN(Date.parse(iso))) return 'unknown';

  const deltaSeconds = (new Date(iso).getTime() - now.getTime()) / 1000;
  const absSeconds = Math.abs(deltaSeconds);

  for (const { unit, seconds } of THRESHOLDS) {
    if (absSeconds >= seconds || unit === 'second') {
      const value = Math.trunc(deltaSeconds / seconds);
      return RTF.format(value, unit);
    }
  }

  // Unreachable: the 'second' threshold above always matches.
  return RTF.format(0, 'second');
}

export function formatAbsolute(iso: string): string {
  if (Number.isNaN(Date.parse(iso))) return 'unknown';

  const formatted = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(iso));

  return `${formatted} UTC`;
}

/** `end` is the exclusive checkout date (see `Watch.dateRange` docstring in `src/types.ts`).
 *  Parses with `Date.UTC` from the split `YYYY-MM-DD` components, never `new Date('YYYY-MM-DD')`
 *  interpreted in local time, so nothing shifts by a day on a non-UTC server. */
export function formatDateRange(start: string, end: string): string {
  const startMs = parseDateOnlyUTC(start);
  const endMs = parseDateOnlyUTC(end);
  if (startMs === null || endMs === null || endMs <= startMs) return 'unknown dates';

  const nights = Math.round((endMs - startMs) / 86400000);
  const nightsLabel = nights === 1 ? '1 night' : `${nights} nights`;

  const startDate = new Date(startMs);
  const endDate = new Date(endMs);
  const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();

  const monthDayFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const monthDayYearFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const startLabel = sameYear ? monthDayFmt.format(startDate) : monthDayYearFmt.format(startDate);
  const endLabel = monthDayYearFmt.format(endDate);

  return `${startLabel} – ${endLabel} (${nightsLabel})`;
}

/** The single place a Watch becomes display text. A FacilityWatch shows its parkName;
 *  an AreaWatch shows its area names joined by ' + ' with an '(area)' suffix so the two
 *  kinds of watch are never confusable in the UI (AREA-01). */
export function watchLabel(watch: Watch): string {
  if (watch.type === 'area') {
    const names = watch.areas.map((a) => a.name).filter((n) => n.length > 0);
    if (names.length === 0) return '(area, none listed)';
    return `${names.join(' + ')} (area)`;
  }
  return watch.parkName;
}

function parseDateOnlyUTC(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(ms) ? null : ms;
}
