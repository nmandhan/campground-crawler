/** UTC-safe date helpers for the matcher. Local-time `new Date('2026-09-04')`
 *  arithmetic silently shifts by a day in negative-offset timezones, which would
 *  make the matcher check the wrong nights — all arithmetic here is done in UTC.
 */

/** Add N days to a YYYY-MM-DD string, computed in UTC. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Nights required for a stay: [start, end) — `end` is the exclusive checkout
 *  date (D-03). A reversed or empty range yields `[]` immediately, never loops.
 */
export function nightsInRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let cur = start; cur < end; cur = addDays(cur, 1)) out.push(cur);
  return out;
}
