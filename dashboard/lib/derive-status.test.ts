import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveWatchStatuses } from './derive-status';
import type { Watch, RunLogEntry } from './types';

const NOW = new Date('2026-08-24T00:00:00Z');

// Real watches.json payload (2026-08-23).
const realWatches: Watch[] = [
  {
    id: 'upper-pines-labor-day',
    parkName: 'Upper Pines Campground',
    facilityId: 232447,
    dateRange: { start: '2026-09-04', end: '2026-09-07' },
    siteType: 'tent',
  },
  {
    id: 'kirk-creek-october',
    parkName: 'Kirk Creek Campground',
    dateRange: { start: '2026-10-09', end: '2026-10-11' },
    siteType: 'any',
  },
];

function makeRun(overrides: Partial<RunLogEntry>): RunLogEntry {
  return {
    startedAt: '2026-08-23T22:00:00.000Z',
    finishedAt: '2026-08-23T22:01:00.000Z',
    checked: 2,
    outcomes: [],
    newMatches: [],
    failed: [],
    noMatch: [],
    ...overrides,
  };
}

test('deriveWatchStatuses returns exactly one row per watch, in watches.json order', () => {
  const rows = deriveWatchStatuses(realWatches, [], NOW);
  assert.deepEqual(
    rows.map((r) => r.watchId),
    ['upper-pines-labor-day', 'kirk-creek-october'],
  );
});

test('a watch present in no run entry gets UNKNOWN status and is never dropped', () => {
  const rows = deriveWatchStatuses(realWatches, [], NOW);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.status, 'UNKNOWN');
    assert.equal(row.detail, 'No poll run has covered this watch yet');
    assert.equal(row.observedAt, null);
    assert.equal(row.observedRelative, '—');
  }
});

test('a MATCH outcome yields status MATCH and a site-count detail', () => {
  const run = makeRun({
    outcomes: [
      {
        watchId: 'kirk-creek-october',
        status: 'MATCH',
        newMatches: [
          {
            watchId: 'kirk-creek-october',
            campsiteId: '90195',
            siteLabel: '001',
            loop: 'LOOP A',
            siteType: 'tent',
            facilityId: 232447,
            facilityName: 'Kirk Creek Campground',
            startDate: '2026-10-05',
            endDate: '2026-10-08',
            bookingUrl: 'https://www.recreation.gov/camping/campsites/90195',
          },
        ],
        suppressed: [
          {
            watchId: 'kirk-creek-october',
            campsiteId: '90196',
            siteLabel: '002',
            loop: 'LOOP A',
            siteType: 'tent',
            facilityId: 232447,
            facilityName: 'Kirk Creek Campground',
            startDate: '2026-10-05',
            endDate: '2026-10-08',
            bookingUrl: 'https://www.recreation.gov/camping/campsites/90196',
          },
        ],
      },
    ],
  });
  const rows = deriveWatchStatuses(realWatches, [run], NOW);
  const row = rows.find((r) => r.watchId === 'kirk-creek-october')!;
  assert.equal(row.status, 'MATCH');
  assert.equal(row.detail, '2 sites available (1 new)');
  assert.equal(row.observedAt, run.startedAt);
});

test('a NO_MATCH outcome yields status NO_MATCH and a fixed detail', () => {
  const run = makeRun({ outcomes: [{ watchId: 'upper-pines-labor-day', status: 'NO_MATCH' }] });
  const rows = deriveWatchStatuses(realWatches, [run], NOW);
  const row = rows.find((r) => r.watchId === 'upper-pines-labor-day')!;
  assert.equal(row.status, 'NO_MATCH');
  assert.equal(row.detail, 'No matching availability');
});

test('a FAILED outcome yields status FAILED and detail equal to the reason', () => {
  const run = makeRun({
    outcomes: [{ watchId: 'upper-pines-labor-day', status: 'FAILED', reason: 'blocked: non-JSON response' }],
  });
  const rows = deriveWatchStatuses(realWatches, [run], NOW);
  const row = rows.find((r) => r.watchId === 'upper-pines-labor-day')!;
  assert.equal(row.status, 'FAILED');
  assert.equal(row.detail, 'blocked: non-JSON response');
});

test('status comes from the most recent run containing an outcome for that watch, not merely the last array element', () => {
  const olderRun = makeRun({
    startedAt: '2026-08-20T00:00:00.000Z',
    outcomes: [{ watchId: 'kirk-creek-october', status: 'NO_MATCH' }],
  });
  const newerRun = makeRun({
    startedAt: '2026-08-23T00:00:00.000Z',
    outcomes: [{ watchId: 'kirk-creek-october', status: 'FAILED', reason: 'timeout' }],
  });
  // Passed oldest-first, deliberately not "last element is newest".
  const rows = deriveWatchStatuses(realWatches, [olderRun, newerRun], NOW);
  const row = rows.find((r) => r.watchId === 'kirk-creek-october')!;
  assert.equal(row.status, 'FAILED');
  assert.equal(row.observedAt, newerRun.startedAt);
});

test('deriveWatchStatuses([], [], now) returns []', () => {
  assert.deepEqual(deriveWatchStatuses([], [], NOW), []);
});
