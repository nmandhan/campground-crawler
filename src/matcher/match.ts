/** Pure contiguous-range, site-type-filtered matcher (D-03/D-04).
 *
 *  No I/O, no imports from the API adapter module or `src/state/` — this module
 *  consumes AvailabilitySlot[] already produced by the API adapter and decides
 *  whether a campsite satisfies a watch's ENTIRE date range as one continuous
 *  bookable stay (D-03) — NOT whether any single night in the range is open.
 */
import { buildBookingUrl } from '../types.js';
import type { AvailabilitySlot, MatchedSlot, ResolvedSiteType, ResolvedWatch, SiteType } from '../types.js';
import { nightsInRange } from './dates.js';

export function siteTypeMatches(watchType: SiteType, slotType: ResolvedSiteType): boolean {
  return watchType === 'any' ? true : watchType === slotType;
}

export function matchWatch(slots: AvailabilitySlot[], watch: ResolvedWatch): MatchedSlot[] {
  const nights = nightsInRange(watch.dateRange.start, watch.dateRange.end);
  if (nights.length === 0) return [];

  // Group slots by campsiteId, then by date, without mutating the input array.
  const byCampsite = new Map<string, Map<string, AvailabilitySlot>>();
  for (const slot of slots) {
    let byDate = byCampsite.get(slot.campsiteId);
    if (!byDate) {
      byDate = new Map<string, AvailabilitySlot>();
      byCampsite.set(slot.campsiteId, byDate);
    }
    byDate.set(slot.date, slot);
  }

  const matches: MatchedSlot[] = [];

  for (const [campsiteId, byDate] of byCampsite) {
    // Take any one slot as the representative for site metadata.
    const representative = byDate.values().next().value as AvailabilitySlot;
    if (!siteTypeMatches(watch.siteType, representative.siteType)) continue;

    // Every night in the range must have a slot AND that slot must be available.
    // A missing date is a failed match — absence of data is never treated as
    // availability (T-03-05).
    const fullyAvailable = nights.every((night) => byDate.get(night)?.available === true);
    if (!fullyAvailable) continue;

    matches.push({
      watchId: watch.id,
      campsiteId,
      siteLabel: representative.siteLabel,
      loop: representative.loop,
      siteType: representative.siteType,
      facilityId: watch.facilityId,
      facilityName: watch.facilityName,
      startDate: watch.dateRange.start,
      endDate: watch.dateRange.end,
      bookingUrl: buildBookingUrl(campsiteId),
    });
  }

  matches.sort((a, b) => (a.campsiteId < b.campsiteId ? -1 : a.campsiteId > b.campsiteId ? 1 : 0));
  return matches;
}
