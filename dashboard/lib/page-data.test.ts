import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardModel } from './page-data';
import type { FetchResult } from './github';
import type { RunSummary } from './types';

const NOW = new Date('2026-08-24T00:00:00.000Z');

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

const matchRun: RunSummary = {
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
  ],
  newMatches: [],
  failed: [],
  noMatch: ['upper-pines-labor-day'],
};

const failedRun: RunSummary = {
  startedAt: '2026-08-23T23:00:00.000Z',
  finishedAt: '2026-08-23T23:00:10.000Z',
  checked: 2,
  outcomes: [
    { watchId: 'kirk-creek-october', status: 'FAILED', reason: 'blocked: non-JSON response' },
    { watchId: 'upper-pines-labor-day', status: 'NO_MATCH' },
  ],
  newMatches: [],
  failed: [{ watchId: 'kirk-creek-october', reason: 'blocked: non-JSON response' }],
  noMatch: ['upper-pines-labor-day'],
};

function ok(data: unknown): FetchResult {
  return { ok: true, data };
}
function fail(error: string): FetchResult {
  return { ok: false, error };
}

test('all three fetches ok and parse ok -> ok:true with populated arrays', () => {
  const model = buildDashboardModel(
    { watches: ok(realWatches), state: ok(realState), runs: ok([matchRun, failedRun]) },
    NOW,
  );
  assert.equal(model.ok, true);
  if (model.ok) {
    assert.ok(model.activeMatches.length > 0);
    assert.equal(model.watchStatuses.length, 2);
    assert.equal(model.timeline.length, 2);
  }
});

test('watches fetch failure -> ok:false', () => {
  const model = buildDashboardModel(
    { watches: fail('watches.json: HTTP 404'), state: ok(realState), runs: ok([matchRun]) },
    NOW,
  );
  assert.deepEqual(model, { ok: false });
});

test('state fetch failure -> ok:false', () => {
  const model = buildDashboardModel(
    { watches: ok(realWatches), state: fail('state.json: HTTP 500'), runs: ok([matchRun]) },
    NOW,
  );
  assert.deepEqual(model, { ok: false });
});

test('runs fetch failure -> ok:false', () => {
  const model = buildDashboardModel(
    { watches: ok(realWatches), state: ok(realState), runs: fail('runs.json: HTTP 503') },
    NOW,
  );
  assert.deepEqual(model, { ok: false });
});

test('watches fetch ok but payload fails parseWatches -> ok:false', () => {
  const model = buildDashboardModel(
    { watches: ok({ nope: 1 }), state: ok(realState), runs: ok([matchRun]) },
    NOW,
  );
  assert.deepEqual(model, { ok: false });
});

test('runs payload with one valid and one garbage entry -> ok:true, valid entry present, garbage skipped', () => {
  const model = buildDashboardModel(
    {
      watches: ok(realWatches),
      state: ok(realState),
      runs: ok([matchRun, { garbage: true }]),
    },
    NOW,
  );
  assert.equal(model.ok, true);
  if (model.ok) {
    assert.equal(model.timeline.length, 1);
    assert.equal(model.skippedRuns, 1);
  }
});

test('empty state.entries with non-empty watches/runs -> ok:true, activeMatches: []', () => {
  const model = buildDashboardModel(
    {
      watches: ok(realWatches),
      state: ok({ version: 1, entries: {} }),
      runs: ok([matchRun]),
    },
    NOW,
  );
  assert.equal(model.ok, true);
  if (model.ok) {
    assert.deepEqual(model.activeMatches, []);
  }
});

test('empty runs array -> ok:true, timeline: [], dataAsOfLabel: null', () => {
  const model = buildDashboardModel(
    { watches: ok(realWatches), state: ok(realState), runs: ok([]) },
    NOW,
  );
  assert.equal(model.ok, true);
  if (model.ok) {
    assert.deepEqual(model.timeline, []);
    assert.equal(model.dataAsOfLabel, null);
  }
});

test('empty watches array -> ok:true, watchStatuses: []', () => {
  const model = buildDashboardModel(
    { watches: ok([]), state: ok({ version: 1, entries: {} }), runs: ok([matchRun]) },
    NOW,
  );
  assert.equal(model.ok, true);
  if (model.ok) {
    assert.deepEqual(model.watchStatuses, []);
  }
});

test('dataAsOfLabel starts with the COPY prefix and reflects the latest run startedAt via formatAbsolute, not now', () => {
  const model = buildDashboardModel(
    { watches: ok(realWatches), state: ok(realState), runs: ok([matchRun, failedRun]) },
    NOW,
  );
  assert.equal(model.ok, true);
  if (model.ok) {
    assert.ok(model.dataAsOfLabel !== null);
    assert.ok(model.dataAsOfLabel!.startsWith('Data as of '));
    // failedRun (23:00:00Z) is later than matchRun (22:16:00Z) -> that's the latest run.
    assert.ok(model.dataAsOfLabel!.includes('Aug'));
    assert.ok(!model.dataAsOfLabel!.includes(NOW.toISOString()));
  }
});

test('returned model never contains a fetch error string fed in as input', () => {
  const model = buildDashboardModel(
    { watches: fail('watches.json: HTTP 404'), state: ok(realState), runs: ok([matchRun]) },
    NOW,
  );
  assert.ok(!JSON.stringify(model).includes('404'));
});

test('buildDashboardModel does not throw for null/{}/[]/string payloads in any slot', () => {
  const badInputs: unknown[] = [null, {}, [], 'not json'];
  for (const bad of badInputs) {
    assert.doesNotThrow(() => {
      buildDashboardModel({ watches: ok(bad), state: ok(realState), runs: ok([matchRun]) }, NOW);
    });
    assert.doesNotThrow(() => {
      buildDashboardModel({ watches: ok(realWatches), state: ok(bad), runs: ok([matchRun]) }, NOW);
    });
    assert.doesNotThrow(() => {
      buildDashboardModel({ watches: ok(realWatches), state: ok(realState), runs: ok(bad) }, NOW);
    });
  }
});
