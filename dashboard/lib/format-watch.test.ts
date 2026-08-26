import { it } from 'node:test';
import assert from 'node:assert/strict';
import { formatWatchLocation, formatWatchDates, formatSiteType, formatWatchKind } from './format-watch';
import type { Watch } from './types';

const dateRange = { start: '2026-09-01', end: '2026-09-03' } as const;

it('formatWatchLocation: a facility watch returns its parkName', () => {
  const watch: Watch = {
    type: 'facility',
    id: 'a',
    parkName: 'Kirk Creek Campground',
    dateRange,
    siteType: 'tent',
  };
  assert.equal(formatWatchLocation(watch), 'Kirk Creek Campground');
});

it('formatWatchLocation: a single-area watch returns its area name', () => {
  const watch: Watch = {
    type: 'area',
    id: 'a',
    areas: [{ name: 'Los Padres National Forest' }],
    dateRange,
    siteType: 'tent',
  };
  assert.equal(formatWatchLocation(watch), 'Los Padres National Forest');
});

it('formatWatchLocation: a three-area watch joins names comma-separated in stored order', () => {
  const watch: Watch = {
    type: 'area',
    id: 'a',
    areas: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    dateRange,
    siteType: 'tent',
  };
  assert.equal(formatWatchLocation(watch), 'A, B, C');
});

it('formatWatchLocation: an area watch with an empty areas array returns "(no areas)"', () => {
  const watch: Watch = { type: 'area', id: 'a', areas: [], dateRange, siteType: 'tent' };
  assert.equal(formatWatchLocation(watch), '(no areas)');
});

it('formatWatchDates: renders the start and end joined by an arrow', () => {
  const watch: Watch = {
    type: 'facility',
    id: 'a',
    parkName: 'Kirk Creek Campground',
    dateRange: { start: '2026-09-01', end: '2026-09-03' },
    siteType: 'tent',
  };
  assert.equal(formatWatchDates(watch), '2026-09-01 → 2026-09-03');
});

it('formatSiteType: "any" returns "Any site type"', () => {
  assert.equal(formatSiteType('any'), 'Any site type');
});

it('formatSiteType: "tent" returns "Tent"', () => {
  assert.equal(formatSiteType('tent'), 'Tent');
});

it('formatSiteType: "rv" returns "RV"', () => {
  assert.equal(formatSiteType('rv'), 'RV');
});

it('formatSiteType: "group" returns "Group"', () => {
  assert.equal(formatSiteType('group'), 'Group');
});

it('formatWatchKind: a facility watch returns "Campground"', () => {
  const watch: Watch = {
    type: 'facility',
    id: 'a',
    parkName: 'Kirk Creek Campground',
    dateRange,
    siteType: 'tent',
  };
  assert.equal(formatWatchKind(watch), 'Campground');
});

it('formatWatchKind: an area watch returns "Area"', () => {
  const watch: Watch = { type: 'area', id: 'a', areas: [{ name: 'X' }], dateRange, siteType: 'tent' };
  assert.equal(formatWatchKind(watch), 'Area');
});
