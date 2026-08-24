import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveActiveMatches, parseDedupKey, safeBookingUrl } from './derive-active-matches';
import type { StateFile, Watch, RunLogEntry } from './types';

const NOW = new Date('2026-08-24T00:00:00Z');

// Real state.json payload (2026-08-23).
const realState: StateFile = {
  version: 1,
  entries: {
    'kirk-creek-october:90195:2026-10-05:2026-10-08': {
      lastNotifiedAt: '2026-08-23T22:16:52.594Z',
    },
  },
};

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

const matchingRun: RunLogEntry = {
  startedAt: '2026-08-24T00:00:00Z',
  finishedAt: '2026-08-24T00:01:00Z',
  checked: 1,
  outcomes: [
    {
      watchId: 'kirk-creek-october',
      status: 'MATCH',
      newMatches: [],
      suppressed: [
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
    },
  ],
  newMatches: [],
  failed: [],
  noMatch: [],
};

test('parseDedupKey parses a well-formed key', () => {
  assert.deepEqual(parseDedupKey('kirk-creek-october:90195:2026-10-05:2026-10-08'), {
    watchId: 'kirk-creek-october',
    campsiteId: '90195',
    startDate: '2026-10-05',
    endDate: '2026-10-08',
  });
});

test('parseDedupKey returns null for too few parts', () => {
  assert.equal(parseDedupKey('too:few:parts'), null);
});

test('parseDedupKey returns null for too many parts', () => {
  assert.equal(parseDedupKey('a:b:c:d:e'), null);
});

test('safeBookingUrl accepts a recreation.gov campsite URL unchanged', () => {
  assert.equal(
    safeBookingUrl('https://www.recreation.gov/camping/campsites/90195'),
    'https://www.recreation.gov/camping/campsites/90195',
  );
});

test('safeBookingUrl rejects an off-domain URL', () => {
  assert.equal(safeBookingUrl('https://evil.example.com/x'), null);
});

test('safeBookingUrl rejects a javascript: URL', () => {
  assert.equal(safeBookingUrl('javascript:alert(1)'), null);
});

test('safeBookingUrl rejects a suffix-spoofed subdomain', () => {
  assert.equal(safeBookingUrl('https://www.recreation.gov.evil.com/x'), null);
});

test('a non-allowlisted campsiteId yields bookingUrl: null, not a crafted link', () => {
  const state: StateFile = {
    version: 1,
    entries: {
      'kirk-creek-october:90195/../evil:2026-10-05:2026-10-08': {
        lastNotifiedAt: '2026-08-23T22:16:52.594Z',
      },
    },
  };
  const rows = deriveActiveMatches(state, realWatches, [], NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.bookingUrl, null);
});

test('deriveActiveMatches returns one row per state.entries key with all expected fields', () => {
  const rows = deriveActiveMatches(realState, realWatches, [matchingRun], NOW);
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.watchId, 'kirk-creek-october');
  assert.equal(row.parkName, 'Kirk Creek Campground');
  assert.equal(row.campsiteId, '90195');
  assert.equal(row.startDate, '2026-10-05');
  assert.equal(row.endDate, '2026-10-08');
  assert.equal(row.dateRangeLabel, 'Oct 5 – Oct 8, 2026 (3 nights)');
  assert.equal(row.bookingUrl, 'https://www.recreation.gov/camping/campsites/90195');
  assert.equal(row.notifiedAt, '2026-08-23T22:16:52.594Z');
  assert.ok(row.notifiedRelative.length > 0);
});

test('parkName falls back to the raw watchId when no matching watch exists', () => {
  const state: StateFile = {
    version: 1,
    entries: {
      'deleted-watch:90195:2026-10-05:2026-10-08': { lastNotifiedAt: '2026-08-23T22:16:52.594Z' },
    },
  };
  const rows = deriveActiveMatches(state, realWatches, [], NOW);
  assert.equal(rows[0]!.parkName, 'deleted-watch');
});

test('rows are sorted by notifiedAt descending (most recently notified first)', () => {
  const state: StateFile = {
    version: 1,
    entries: {
      'watch-a:1:2026-10-05:2026-10-08': { lastNotifiedAt: '2026-08-20T00:00:00.000Z' },
      'watch-b:2:2026-10-05:2026-10-08': { lastNotifiedAt: '2026-08-23T00:00:00.000Z' },
      'watch-c:3:2026-10-05:2026-10-08': { lastNotifiedAt: '2026-08-21T00:00:00.000Z' },
    },
  };
  const rows = deriveActiveMatches(state, [], [], NOW);
  assert.deepEqual(
    rows.map((r) => r.watchId),
    ['watch-b', 'watch-c', 'watch-a'],
  );
});

test('a malformed dedup key is skipped, remaining valid entries still returned', () => {
  const state: StateFile = {
    version: 1,
    entries: {
      'too:few': { lastNotifiedAt: '2026-08-23T00:00:00.000Z' },
      'kirk-creek-october:90195:2026-10-05:2026-10-08': {
        lastNotifiedAt: '2026-08-23T22:16:52.594Z',
      },
    },
  };
  const rows = deriveActiveMatches(state, realWatches, [], NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.watchId, 'kirk-creek-october');
});

test('stillOpenInLatestRun is true when the campsite appears in the latest MATCH outcome', () => {
  const rows = deriveActiveMatches(realState, realWatches, [matchingRun], NOW);
  assert.equal(rows[0]!.stillOpenInLatestRun, true);
});

test('stillOpenInLatestRun is false when there are no runs', () => {
  const rows = deriveActiveMatches(realState, realWatches, [], NOW);
  assert.equal(rows[0]!.stillOpenInLatestRun, false);
});

test('stillOpenInLatestRun is false when the latest run has no matching outcome', () => {
  const noMatchRun: RunLogEntry = {
    startedAt: '2026-08-24T00:00:00Z',
    finishedAt: '2026-08-24T00:01:00Z',
    checked: 1,
    outcomes: [{ watchId: 'kirk-creek-october', status: 'NO_MATCH' }],
    newMatches: [],
    failed: [],
    noMatch: ['kirk-creek-october'],
  };
  const rows = deriveActiveMatches(realState, realWatches, [noMatchRun], NOW);
  assert.equal(rows[0]!.stillOpenInLatestRun, false);
});

test('deriveActiveMatches returns [] for empty state, watches, and runs', () => {
  assert.deepEqual(deriveActiveMatches({ version: 1, entries: {} }, [], [], NOW), []);
});
