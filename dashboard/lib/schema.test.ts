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

test('parseWatches accepts a legacy watch with no type field, defaulting to facility', () => {
  const result = parseWatches([
    {
      id: 'kirk',
      parkName: 'Kirk Creek',
      dateRange: { start: '2026-09-01', end: '2026-09-03' },
      siteType: 'tent',
    },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data[0]!.type, 'facility');
  }
});

test('parseWatches accepts an area watch', () => {
  const result = parseWatches([
    {
      type: 'area',
      id: 'sierra',
      areas: [{ name: 'Sequoia National Forest' }],
      dateRange: { start: '2026-09-01', end: '2026-09-03' },
      siteType: 'tent',
    },
  ]);
  assert.equal(result.ok, true);
});

test('parseWatches accepts an area watch with an empty areas array (no gate-keeping)', () => {
  const result = parseWatches([
    {
      type: 'area',
      id: 'x',
      areas: [],
      dateRange: { start: '2026-09-01', end: '2026-09-03' },
      siteType: 'tent',
    },
  ]);
  assert.equal(result.ok, true);
});

test('MatchedSlotSchema accepts a slot with facilityType: group', () => {
  const result = parseRunLog([
    {
      ...validRun,
      outcomes: [
        {
          watchId: 'w',
          status: 'MATCH',
          newMatches: [
            {
              watchId: 'w',
              campsiteId: '1',
              siteLabel: '001',
              loop: 'A',
              siteType: 'group',
              facilityId: 1,
              facilityName: 'Group Camp',
              facilityType: 'group',
              startDate: '2026-09-01',
              endDate: '2026-09-02',
              bookingUrl: 'https://www.recreation.gov/camping/campsites/1',
            },
          ],
          suppressed: [],
        },
      ],
    },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.length, 1);
    assert.equal(result.skipped, 0);
  }
});

test('MatchedSlotSchema defaults facilityType to standard when absent (pre-Phase-4 runs.json)', () => {
  const result = parseRunLog([validRun]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.length, 1);
    assert.equal(result.skipped, 0);
    const outcome = result.data[0]!.outcomes[0];
    if (outcome && outcome.status === 'MATCH') {
      assert.equal(outcome.newMatches[0]!.facilityType, 'standard');
    }
  }
});

test('WatchOutcomeSchema accepts a NO_MATCH outcome with a truncated field', () => {
  const result = parseRunLog([
    { ...validRun, outcomes: [{ watchId: 'a', status: 'NO_MATCH', truncated: { requested: 34, kept: 20 } }] },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.length, 1);
    assert.equal(result.skipped, 0);
  }
});

test('WatchOutcomeSchema still accepts a NO_MATCH outcome with no truncated field', () => {
  const result = parseRunLog([{ ...validRun, outcomes: [{ watchId: 'a', status: 'NO_MATCH' }] }]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.length, 1);
    assert.equal(result.skipped, 0);
  }
});
