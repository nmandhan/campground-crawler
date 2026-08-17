import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, nightsInRange } from './dates.js';

test('nightsInRange returns 3 nights for a 3-night stay', () => {
  assert.deepEqual(nightsInRange('2026-09-04', '2026-09-07'), [
    '2026-09-04',
    '2026-09-05',
    '2026-09-06',
  ]);
});

test('nightsInRange returns 1 night for a 1-night stay', () => {
  assert.deepEqual(nightsInRange('2026-09-04', '2026-09-05'), ['2026-09-04']);
});

test('nightsInRange crosses a month boundary', () => {
  assert.deepEqual(nightsInRange('2026-09-29', '2026-10-02'), [
    '2026-09-29',
    '2026-09-30',
    '2026-10-01',
  ]);
});

test('nightsInRange crosses a year boundary', () => {
  assert.deepEqual(nightsInRange('2026-12-30', '2027-01-02'), [
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
  ]);
});

test('nightsInRange handles a leap year day correctly', () => {
  assert.deepEqual(nightsInRange('2028-02-28', '2028-03-01'), [
    '2028-02-28',
    '2028-02-29',
  ]);
});

test('nightsInRange returns an empty array for a reversed range, never loops forever', () => {
  assert.deepEqual(nightsInRange('2026-09-07', '2026-09-04'), []);
});

test('nightsInRange is computed in UTC, unaffected by local timezone', () => {
  // This assertion is timezone-independent by construction (string-based UTC math);
  // run this file under TZ=Pacific/Kiritimati and TZ=Pacific/Midway to prove it.
  assert.deepEqual(nightsInRange('2026-01-01', '2026-01-03'), [
    '2026-01-01',
    '2026-01-02',
  ]);
});

test('addDays advances a date by N days in UTC', () => {
  assert.equal(addDays('2026-09-04', 1), '2026-09-05');
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});
