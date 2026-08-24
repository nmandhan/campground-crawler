import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWatches, parseStateFile, parseRunLog } from './schema';
import type { RunSummary } from './types';

// Real watches.json payload (2026-08-23).
const realWatches = [
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

// Real state.json payload (2026-08-23).
const realState = {
  version: 1,
  entries: {
    'kirk-creek-october:90195:2026-10-05:2026-10-08': {
      lastNotifiedAt: '2026-08-23T22:16:52.594Z',
    },
  },
};

const validRun: RunSummary = {
  startedAt: '2026-08-23T22:16:00.000Z',
  finishedAt: '2026-08-23T22:16:52.594Z',
  checked: 2,
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
      suppressed: [],
    },
    { watchId: 'upper-pines-labor-day', status: 'NO_MATCH' },
    { watchId: 'some-other-watch', status: 'FAILED', reason: 'blocked: non-JSON response' },
  ],
  newMatches: [],
  failed: [{ watchId: 'some-other-watch', reason: 'blocked: non-JSON response' }],
  noMatch: ['upper-pines-labor-day'],
};

test('parseWatches accepts the real watches.json payload', () => {
  const result = parseWatches(realWatches);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.length, 2);
  }
});

test('parseWatches accepts an empty array', () => {
  const result = parseWatches([]);
  assert.deepEqual(result, { ok: true, data: [] });
});

test('parseWatches rejects a malformed payload', () => {
  const result = parseWatches({ nope: 1 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error.length > 0);
  }
});

test('parseStateFile accepts the real state.json payload', () => {
  const result = parseStateFile(realState);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok('kirk-creek-october:90195:2026-10-05:2026-10-08' in result.data.entries);
  }
});

test('parseStateFile rejects an unsupported version', () => {
  const result = parseStateFile({ version: 2, entries: {} });
  assert.equal(result.ok, false);
});

test('parseRunLog accepts an empty array with skipped: 0', () => {
  const result = parseRunLog([]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data, []);
    assert.equal(result.skipped, 0);
  }
});

test('parseRunLog skips a single malformed entry without discarding the rest', () => {
  const result = parseRunLog([validRun, { garbage: true }, validRun]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.length, 2);
    assert.equal(result.skipped, 1);
  }
});

test('parseRunLog rejects a non-array payload', () => {
  const result = parseRunLog({ not: 'an array' });
  assert.equal(result.ok, false);
});

test('a RunSummary with each WatchOutcome variant validates successfully', () => {
  const result = parseRunLog([validRun]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.length, 1);
    assert.equal(result.skipped, 0);
  }
});

test('a MATCH outcome missing newMatches is rejected (skipped from the log)', () => {
  const badRun = {
    ...validRun,
    outcomes: [{ watchId: 'x', status: 'MATCH', suppressed: [] }],
  };
  const result = parseRunLog([badRun]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.length, 0);
    assert.equal(result.skipped, 1);
  }
});
