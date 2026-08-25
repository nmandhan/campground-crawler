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

test('a type-less watch entry migrates to type: facility (backward compatibility)', () => {
  const result = WatchSchema.safeParse({
    id: 'kirk',
    parkName: 'Kirk Creek',
    dateRange: { start: '2026-09-01', end: '2026-09-03' },
    siteType: 'tent',
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.type, 'facility');
  }
});

test('an explicit type: facility watch with facilityId override parses', () => {
  const result = WatchSchema.safeParse({
    type: 'facility',
    id: 'kirk',
    parkName: 'Kirk Creek',
    facilityId: 232447,
    dateRange: { start: '2026-09-01', end: '2026-09-03' },
    siteType: 'tent',
  });
  assert.equal(result.success, true);
});

test('a type: area watch with a non-empty areas list parses', () => {
  const result = WatchSchema.safeParse({
    type: 'area',
    id: 'sierra',
    areas: [{ name: 'Sequoia National Forest' }, { name: 'Sierra National Forest', recAreaId: 1106 }],
    dateRange: { start: '2026-09-01', end: '2026-09-03' },
    siteType: 'tent',
  });
  assert.equal(result.success, true);
});

test('a type: area watch with an empty areas array is rejected', () => {
  const result = WatchSchema.safeParse({
    type: 'area',
    id: 'x',
    areas: [],
    dateRange: { start: '2026-09-01', end: '2026-09-03' },
    siteType: 'tent',
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message);
    assert.ok(messages.some((m) => m.includes('at least one area')));
  }
});

test('a type: area watch with a blank area name is rejected', () => {
  const result = WatchSchema.safeParse({
    type: 'area',
    id: 'x',
    areas: [{ name: '' }],
    dateRange: { start: '2026-09-01', end: '2026-09-03' },
    siteType: 'tent',
  });
  assert.equal(result.success, false);
});

test('a type: area watch with a negative recAreaId is rejected', () => {
  const result = WatchSchema.safeParse({
    type: 'area',
    id: 'x',
    areas: [{ name: 'Y', recAreaId: -3 }],
    dateRange: { start: '2026-09-01', end: '2026-09-03' },
    siteType: 'tent',
  });
  assert.equal(result.success, false);
});

test('an area watch with dateRange.start >= dateRange.end is rejected with the exclusive-checkout message', () => {
  const result = WatchSchema.safeParse({
    type: 'area',
    id: 'x',
    areas: [{ name: 'Y' }],
    dateRange: { start: '2026-09-04', end: '2026-09-01' },
    siteType: 'tent',
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message);
    assert.ok(messages.some((m) => m.includes('exclusive checkout date')));
  }
});

test('duplicate watch ids across mixed-variant watches are rejected', () => {
  const facilityWatch = {
    id: 'dup',
    parkName: 'Some Park',
    dateRange: { start: '2026-09-01', end: '2026-09-04' },
    siteType: 'tent' as const,
  };
  const areaWatch = {
    type: 'area' as const,
    id: 'dup',
    areas: [{ name: 'Some Area' }],
    dateRange: { start: '2026-09-01', end: '2026-09-04' },
    siteType: 'tent' as const,
  };
  const result = WatchesFileSchema.safeParse([facilityWatch, areaWatch]);
  assert.equal(result.success, false);
});
