import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWatches, parseStateFile, parseRunLog, parseStrictWatch, assertUniqueId } from './schema';
import type { RunSummary, Watch } from './types';

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
          facilityType: 'standard',
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

describe('StrictWatchSchema', () => {
  const validFacility = {
    type: 'facility',
    id: 'kirk-creek',
    parkName: 'Kirk Creek Campground',
    dateRange: { start: '2026-09-01', end: '2026-09-03' },
    siteType: 'any',
  };

  const validArea = {
    type: 'area',
    id: 'los-padres',
    areas: [{ name: 'Los Padres National Forest' }],
    dateRange: { start: '2026-09-01', end: '2026-09-03' },
    siteType: 'tent',
  };

  it('accepts a valid facility watch', () => {
    const result = parseStrictWatch(validFacility);
    assert.equal(result.ok, true);
  });

  it('accepts a valid area watch with one area', () => {
    const result = parseStrictWatch(validArea);
    assert.equal(result.ok, true);
  });

  it('rejects id: ""', () => {
    const result = parseStrictWatch({ ...validFacility, id: '' });
    assert.equal(result.ok, false);
  });

  it('rejects a facility watch with parkName: ""', () => {
    const result = parseStrictWatch({ ...validFacility, parkName: '' });
    assert.equal(result.ok, false);
  });

  it('rejects an area watch with areas: [] (message mentions at least one area)', () => {
    const result = parseStrictWatch({ ...validArea, areas: [] });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /at least one area/);
    }
  });

  it('rejects an area watch with areas: [{ name: "" }]', () => {
    const result = parseStrictWatch({ ...validArea, areas: [{ name: '' }] });
    assert.equal(result.ok, false);
  });

  it('rejects dateRange with start after end', () => {
    const result = parseStrictWatch({
      ...validFacility,
      dateRange: { start: '2026-09-03', end: '2026-09-01' },
    });
    assert.equal(result.ok, false);
  });

  it('rejects dateRange with start equal to end (end is exclusive checkout)', () => {
    const result = parseStrictWatch({
      ...validFacility,
      dateRange: { start: '2026-09-01', end: '2026-09-01' },
    });
    assert.equal(result.ok, false);
  });

  it('rejects a dateRange not in YYYY-MM-DD format', () => {
    const result = parseStrictWatch({
      ...validFacility,
      dateRange: { start: '09/01/2026', end: '09/03/2026' },
    });
    assert.equal(result.ok, false);
  });

  it('rejects an object with no type field', () => {
    const { type, ...untyped } = validFacility;
    void type;
    const result = parseStrictWatch(untyped);
    assert.equal(result.ok, false);
  });

  it('returns { ok: true, data } on success and { ok: false, error } with path: message on failure', () => {
    const success = parseStrictWatch(validFacility);
    assert.equal(success.ok, true);
    const failure = parseStrictWatch({ ...validFacility, id: '' });
    assert.equal(failure.ok, false);
    if (!failure.ok) {
      assert.match(failure.error, /:/);
    }
  });
});

describe('assertUniqueId', () => {
  const watches: Watch[] = [
    {
      type: 'facility',
      id: 'kirk-creek',
      parkName: 'Kirk Creek Campground',
      dateRange: { start: '2026-09-01', end: '2026-09-03' },
      siteType: 'any',
    },
    {
      type: 'facility',
      id: 'upper-pines',
      parkName: 'Upper Pines Campground',
      dateRange: { start: '2026-09-01', end: '2026-09-03' },
      siteType: 'any',
    },
  ];

  it('returns true when the id is free', () => {
    assert.equal(assertUniqueId(watches, 'new-watch'), true);
  });

  it('returns false when another watch already uses it', () => {
    assert.equal(assertUniqueId(watches, 'kirk-creek'), false);
  });

  it('returns true when the colliding id is the ignoreId (editing without renaming)', () => {
    assert.equal(assertUniqueId(watches, 'kirk-creek', 'kirk-creek'), true);
  });
});
