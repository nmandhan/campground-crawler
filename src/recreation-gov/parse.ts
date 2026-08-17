/** Normalizes raw Recreation.gov availability JSON into sorted, gapless
 *  AvailabilitySlot[] — the only shape downstream code (matcher, plan 03)
 *  consumes. Isolates every upstream field-name/status-vocabulary quirk. */

import { AVAILABLE_STATUS } from './types.js';
import type { RawAvailabilityResponse } from './types.js';
import type { AvailabilitySlot, ResolvedSiteType } from '../types.js';

/** RESEARCH Pattern 3 / Assumption A3: this heuristic is unverified against
 *  an official campsite_type enum (none exists) — 'unknown' is deliberately
 *  conservative and only matches watches with siteType: 'any'. Order matters:
 *  GROUP is checked before RV so e.g. "GROUP RV AREA" maps to 'group'. */
export function mapSiteType(campsiteType: string): ResolvedSiteType {
  const t = (campsiteType ?? '').toUpperCase();
  if (t.includes('GROUP')) return 'group';
  if (t.includes('RV') || t.includes('TRAILER')) return 'rv';
  if (t.includes('TENT') || t.includes('WALK')) return 'tent';
  return 'unknown';
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}/;

/** Turns { campsites: { [id]: { availabilities: { isoDate: status } } } }
 *  into a flat, sorted AvailabilitySlot[]. `available` is derived from an
 *  ALLOWLIST — only rawStatus === AVAILABLE_STATUS is true (RESEARCH Pitfall 1:
 *  denylists of unavailable statuses are incomplete and include the
 *  counterintuitive "Open"). */
export function parseAvailability(raw: RawAvailabilityResponse): AvailabilitySlot[] {
  const slots: AvailabilitySlot[] = [];

  for (const [campsiteId, entry] of Object.entries(raw.campsites)) {
    const siteType = mapSiteType(entry.campsite_type ?? '');
    for (const [dateKey, status] of Object.entries(entry.availabilities)) {
      if (!DATE_KEY_PATTERN.test(dateKey)) continue;
      slots.push({
        campsiteId,
        siteLabel: entry.site ?? '',
        loop: entry.loop ?? '',
        campsiteType: entry.campsite_type ?? '',
        siteType,
        date: dateKey.slice(0, 10),
        rawStatus: status,
        available: status === AVAILABLE_STATUS,
      });
    }
  }

  return slots.sort((a, b) => {
    if (a.campsiteId !== b.campsiteId) return a.campsiteId < b.campsiteId ? -1 : 1;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
}

/** Stitches multiple months' slot arrays into one gapless, sorted array with
 *  no duplicate (campsiteId, date) pairs — later arrays win on conflict. This
 *  is what makes a month-boundary-spanning watch (D-03) see one unbroken
 *  night sequence (RESEARCH Open Question 1). */
export function mergeSlots(...slotLists: AvailabilitySlot[][]): AvailabilitySlot[] {
  const byKey = new Map<string, AvailabilitySlot>();
  for (const list of slotLists) {
    for (const slot of list) {
      byKey.set(`${slot.campsiteId}|${slot.date}`, slot);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => {
    if (a.campsiteId !== b.campsiteId) return a.campsiteId < b.campsiteId ? -1 : 1;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
}
