import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchWatch, siteTypeMatches } from './match.js';
import type { AvailabilitySlot, ResolvedSiteType, ResolvedWatch, SiteType } from '../types.js';

function slot(
  campsiteId: string,
  date: string,
  available: boolean,
  siteType: ResolvedSiteType = 'tent'
): AvailabilitySlot {
  return {
    campsiteId,
    siteLabel: `site-${campsiteId}`,
    loop: 'Loop A',
    campsiteType: 'STANDARD NONELECTRIC',
    siteType,
    date,
    rawStatus: available ? 'Available' : 'Reserved',
    available,
  };
}

function watch(overrides: Partial<ResolvedWatch> = {}): ResolvedWatch {
  return {
    id: 'watch-1',
    parkName: 'Test Park',
    facilityId: 12345,
    facilityName: 'Test Facility',
    dateRange: { start: '2026-09-04', end: '2026-09-07' },
    siteType: 'any',
    ...overrides,
  };
}

test('siteTypeMatches: any matches anything, including unknown', () => {
  assert.equal(siteTypeMatches('any', 'unknown'), true);
  assert.equal(siteTypeMatches('any', 'rv'), true);
});

test('siteTypeMatches: tent only matches tent', () => {
  assert.equal(siteTypeMatches('tent', 'tent'), true);
  assert.equal(siteTypeMatches('tent', 'rv'), false);
  assert.equal(siteTypeMatches('tent', 'unknown'), false);
});

test('siteTypeMatches: rv only matches rv, group only matches group', () => {
  assert.equal(siteTypeMatches('rv', 'rv'), true);
  assert.equal(siteTypeMatches('group', 'group'), true);
  assert.equal(siteTypeMatches('group', 'tent'), false);
});

test('a campsite available all 3 nights of a 3-night watch produces exactly 1 match', () => {
  const slots = [
    slot('100', '2026-09-04', true),
    slot('100', '2026-09-05', true),
    slot('100', '2026-09-06', true),
  ];
  const matches = matchWatch(slots, watch());
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.campsiteId, '100');
});

test('a campsite available on nights 1 and 3 but not night 2 produces 0 matches (gap)', () => {
  const slots = [
    slot('100', '2026-09-04', true),
    slot('100', '2026-09-05', false),
    slot('100', '2026-09-06', true),
  ];
  const matches = matchWatch(slots, watch());
  assert.equal(matches.length, 0);
});

test('a campsite missing a slot entirely for night 3 produces 0 matches (missing data is not availability)', () => {
  const slots = [slot('100', '2026-09-04', true), slot('100', '2026-09-05', true)];
  const matches = matchWatch(slots, watch());
  assert.equal(matches.length, 0);
});

test('a campsite with all slots available: false produces 0 matches', () => {
  const slots = [
    slot('100', '2026-09-04', false),
    slot('100', '2026-09-05', false),
    slot('100', '2026-09-06', false),
  ];
  const matches = matchWatch(slots, watch());
  assert.equal(matches.length, 0);
});

test('with siteType tent, an all-available RV campsite produces 0 matches', () => {
  const slots = [
    slot('100', '2026-09-04', true, 'rv'),
    slot('100', '2026-09-05', true, 'rv'),
    slot('100', '2026-09-06', true, 'rv'),
  ];
  const matches = matchWatch(slots, watch({ siteType: 'tent' as SiteType }));
  assert.equal(matches.length, 0);
});

test('with siteType any, an all-available unknown-type campsite produces 1 match', () => {
  const slots = [
    slot('100', '2026-09-04', true, 'unknown'),
    slot('100', '2026-09-05', true, 'unknown'),
    slot('100', '2026-09-06', true, 'unknown'),
  ];
  const matches = matchWatch(slots, watch({ siteType: 'any' }));
  assert.equal(matches.length, 1);
});

test('three campsites all fully available produce 3 MatchedSlots, sorted by campsiteId', () => {
  const slots = [
    ...['300', '100', '200'].flatMap((id) => [
      slot(id, '2026-09-04', true),
      slot(id, '2026-09-05', true),
      slot(id, '2026-09-06', true),
    ]),
  ];
  const matches = matchWatch(slots, watch());
  assert.equal(matches.length, 3);
  assert.deepEqual(
    matches.map((m) => m.campsiteId),
    ['100', '200', '300']
  );
});

test('each MatchedSlot carries watchId, facilityId, facilityName, startDate, endDate, bookingUrl', () => {
  const slots = [
    slot('100', '2026-09-04', true),
    slot('100', '2026-09-05', true),
    slot('100', '2026-09-06', true),
  ];
  const w = watch();
  const matches = matchWatch(slots, w);
  assert.equal(matches.length, 1);
  const m = matches[0]!;
  assert.equal(m.watchId, w.id);
  assert.equal(m.facilityId, w.facilityId);
  assert.equal(m.facilityName, w.facilityName);
  assert.equal(m.startDate, w.dateRange.start);
  assert.equal(m.endDate, w.dateRange.end);
  assert.equal(m.bookingUrl, 'https://www.recreation.gov/camping/campsites/100');
});

test('slots for dates outside the watch range are ignored', () => {
  const slots = [
    slot('100', '2026-09-04', true),
    slot('100', '2026-09-05', true),
    slot('100', '2026-09-06', true),
    slot('100', '2026-09-01', false), // outside range, should not break contiguity
    slot('100', '2026-09-10', false), // outside range, should not break contiguity
  ];
  const matches = matchWatch(slots, watch());
  assert.equal(matches.length, 1);
});

test('an empty slot array produces 0 matches', () => {
  const matches = matchWatch([], watch());
  assert.equal(matches.length, 0);
});

test('matchWatch does not mutate its input array', () => {
  const slots = [
    slot('100', '2026-09-04', true),
    slot('100', '2026-09-05', true),
    slot('100', '2026-09-06', true),
  ];
  const before = JSON.parse(JSON.stringify(slots));
  matchWatch(slots, watch());
  assert.deepEqual(slots, before);
});
