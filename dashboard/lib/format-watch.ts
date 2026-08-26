/** Display labels for a Watch row (MGMT-01).
 *
 *  Pure and separate from the client component on purpose: this is the only logic in the watch
 *  list worth testing, and lib/*.test.ts is the one test harness this project runs
 *  (`node --import tsx --test "lib/**\/*.test.ts"`) — a helper stranded inside a .tsx file
 *  would be untestable here.
 *
 *  These render read-path data, so they must tolerate shapes the strict write schema would
 *  reject (a hand-edited watches.json with zero areas is displayable, not a crash).
 */
import type { Watch, SiteType } from './types';

const SITE_TYPE_LABELS: Record<SiteType, string> = {
  any: 'Any site type',
  tent: 'Tent',
  rv: 'RV',
  group: 'Group',
};

export function formatWatchLocation(watch: Watch): string {
  if (watch.type === 'facility') return watch.parkName;
  if (watch.areas.length === 0) return '(no areas)';
  return watch.areas.map((a) => a.name).join(', ');
}

export function formatWatchDates(watch: Watch): string {
  return `${watch.dateRange.start} → ${watch.dateRange.end}`;
}

export function formatSiteType(siteType: SiteType): string {
  return SITE_TYPE_LABELS[siteType];
}

export function formatWatchKind(watch: Watch): string {
  return watch.type === 'facility' ? 'Campground' : 'Area';
}
