import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTimeline, latestRun } from './derive-timeline';
import type { RunLogEntry } from './types';

const NOW = new Date('2026-08-24T00:00:00Z');

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

const matchOutcome = {
  watchId: 'kirk-creek-october',
  status: 'MATCH' as const,
  newMatches: [
    {
      watchId: 'kirk-creek-october',
      campsiteId: '90195',
      siteLabel: '001',
      loop: 'LOOP A',
      siteType: 'tent' as const,
      facilityId: 232447,
      facilityName: 'Kirk Creek Campground',
      startDate: '2026-10-05',
      endDate: '2026-10-08',
      bookingUrl: 'https://www.recreation.gov/camping/campsites/90195',
    },
  ],
  suppressed: [],
};
const noMatchOutcome = { watchId: 'upper-pines-labor-day', status: 'NO_MATCH' as const };
const failedOutcome = { watchId: 'some-watch', status: 'FAILED' as const, reason: 'blocked: non-JSON response' };

test('deriveTimeline orders rows startedAt descending when input is oldest-first', () => {
  const oldest = makeRun({ startedAt: '2026-08-20T00:00:00.000Z' });
  const middle = makeRun({ startedAt: '2026-08-22T00:00:00.000Z' });
  const newest = makeRun({ startedAt: '2026-08-23T00:00:00.000Z' });
  const rows = deriveTimeline([oldest, middle, newest], NOW);
  assert.deepEqual(
    rows.map((r) => r.startedAt),
    [newest.startedAt, middle.startedAt, oldest.startedAt],
  );
});

test('deriveTimeline orders rows startedAt descending when input is shuffled', () => {
  const oldest = makeRun({ startedAt: '2026-08-20T00:00:00.000Z' });
  const middle = makeRun({ startedAt: '2026-08-22T00:00:00.000Z' });
  const newest = makeRun({ startedAt: '2026-08-23T00:00:00.000Z' });
  const rows = deriveTimeline([middle, newest, oldest], NOW);
  assert.deepEqual(
    rows.map((r) => r.startedAt),
    [newest.startedAt, middle.startedAt, oldest.startedAt],
  );
});

test('each row has all expected fields', () => {
  const run = makeRun({ outcomes: [matchOutcome, noMatchOutcome] });
  const [row] = deriveTimeline([run], NOW);
  assert.ok(row);
  assert.equal(row.startedAt, run.startedAt);
  assert.ok(row.startedRelative.length > 0);
  assert.ok(row.startedAbsolute.length > 0);
  assert.equal(row.checked, 2);
  assert.equal(row.matchCount, 1);
  assert.equal(row.newMatchCount, 1);
  assert.equal(row.noMatchCount, 1);
  assert.equal(row.failedCount, 0);
  assert.deepEqual(row.failures, []);
});

test('summaryLabel reads as expected and appends failed count when present', () => {
  const run = makeRun({ outcomes: [matchOutcome, noMatchOutcome] });
  const [row] = deriveTimeline([run], NOW);
  assert.equal(row!.summaryLabel, '2 watches checked — 1 match (1 new), 1 no match');

  const runWithFailure = makeRun({ outcomes: [matchOutcome, noMatchOutcome, failedOutcome], checked: 3 });
  const [rowWithFailure] = deriveTimeline([runWithFailure], NOW);
  assert.equal(
    rowWithFailure!.summaryLabel,
    '3 watches checked — 1 match (1 new), 1 no match, 1 failed',
  );
});

test('a run whose outcomes are all FAILED yields matchCount 0 and populated failures', () => {
  const run = makeRun({
    checked: 2,
    outcomes: [
      { watchId: 'a', status: 'FAILED' as const, reason: 'timeout' },
      { watchId: 'b', status: 'FAILED' as const, reason: 'blocked' },
    ],
  });
  const [row] = deriveTimeline([run], NOW);
  assert.equal(row!.matchCount, 0);
  assert.equal(row!.failedCount, 2);
  assert.deepEqual(row!.failures, [
    { watchId: 'a', reason: 'timeout' },
    { watchId: 'b', reason: 'blocked' },
  ]);
});

test('deriveTimeline([], now) returns []', () => {
  assert.deepEqual(deriveTimeline([], NOW), []);
});

test('latestRun returns the entry with the greatest startedAt', () => {
  const oldest = makeRun({ startedAt: '2026-08-20T00:00:00.000Z' });
  const newest = makeRun({ startedAt: '2026-08-23T00:00:00.000Z' });
  assert.equal(latestRun([oldest, newest]), newest);
  assert.equal(latestRun([newest, oldest]), newest);
});

test('latestRun returns null for an empty array', () => {
  assert.equal(latestRun([]), null);
});
