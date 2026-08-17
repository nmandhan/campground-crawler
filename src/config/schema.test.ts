import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WatchSchema, WatchesFileSchema } from './schema.js';

test('a valid array of one watch parses successfully', () => {
  const result = WatchesFileSchema.parse([
    {
      id: 'upper-pines-labor-day',
      parkName: 'Upper Pines Campground',
      dateRange: { start: '2026-09-04', end: '2026-09-07' },
      siteType: 'tent',
    },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, 'upper-pines-labor-day');
});

test('an empty array is rejected', () => {
  assert.throws(() => WatchesFileSchema.parse([]));
});

test('missing parkName is rejected with an issue path containing parkName', () => {
  const result = WatchSchema.safeParse({
    id: 'x',
    dateRange: { start: '2026-09-01', end: '2026-09-04' },
    siteType: 'tent',
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join('.'));
    assert.ok(paths.some((p) => p.includes('parkName')));
  }
});

test('siteType "cabin" is rejected', () => {
  const result = WatchSchema.safeParse({
    id: 'x',
    parkName: 'Some Park',
    dateRange: { start: '2026-09-01', end: '2026-09-04' },
    siteType: 'cabin',
  });
  assert.equal(result.success, false);
});

test('dateRange with end before start is rejected', () => {
  const result = WatchSchema.safeParse({
    id: 'x',
    parkName: 'Some Park',
    dateRange: { start: '2026-09-04', end: '2026-09-01' },
    siteType: 'tent',
  });
  assert.equal(result.success, false);
});

test('dateRange with a non-YYYY-MM-DD date is rejected', () => {
  const result = WatchSchema.safeParse({
    id: 'x',
    parkName: 'Some Park',
    dateRange: { start: '09/01/2026', end: '2026-09-04' },
    siteType: 'tent',
  });
  assert.equal(result.success, false);
});

test('duplicate watch ids across two watches are rejected', () => {
  const watch = {
    id: 'dup',
    parkName: 'Some Park',
    dateRange: { start: '2026-09-01', end: '2026-09-04' },
    siteType: 'tent' as const,
  };
  const result = WatchesFileSchema.safeParse([watch, { ...watch }]);
  assert.equal(result.success, false);
});

test('an optional numeric facilityId override is accepted', () => {
  const result = WatchSchema.safeParse({
    id: 'x',
    parkName: 'Some Park',
    facilityId: 232447,
    dateRange: { start: '2026-09-01', end: '2026-09-04' },
    siteType: 'tent',
  });
  assert.equal(result.success, true);
});

test('watches.example.json validates against WatchesFileSchema', () => {
  const path = fileURLToPath(new URL('../../watches.example.json', import.meta.url));
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  const result = WatchesFileSchema.parse(raw);
  assert.ok(result.length >= 1);
});
