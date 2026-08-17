import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { mapSiteType, parseAvailability, mergeSlots } from './parse.js';
import { AvailabilityResponseSchema } from './types.js';
import type { AvailabilitySlot } from '../types.js';

// ---------- mapSiteType ----------

test('mapSiteType: "GROUP STANDARD AREA NONELECTRIC" -> group', () => {
  assert.equal(mapSiteType('GROUP STANDARD AREA NONELECTRIC'), 'group');
});

test('mapSiteType: "RV NONELECTRIC" -> rv', () => {
  assert.equal(mapSiteType('RV NONELECTRIC'), 'rv');
});

test('mapSiteType: "STANDARD NONELECTRIC" -> unknown', () => {
  assert.equal(mapSiteType('STANDARD NONELECTRIC'), 'unknown');
});

test('mapSiteType: "TENT ONLY NONELECTRIC" -> tent', () => {
  assert.equal(mapSiteType('TENT ONLY NONELECTRIC'), 'tent');
});

test('mapSiteType: "WALK TO" -> tent', () => {
  assert.equal(mapSiteType('WALK TO'), 'tent');
});

test('mapSiteType: "rv trailer" (lowercase) -> rv (case-insensitive)', () => {
  assert.equal(mapSiteType('rv trailer'), 'rv');
});

test('mapSiteType: "GROUP RV AREA" -> group (GROUP wins over RV)', () => {
  assert.equal(mapSiteType('GROUP RV AREA'), 'group');
});

test('mapSiteType: "" -> unknown', () => {
  assert.equal(mapSiteType(''), 'unknown');
});

// ---------- parseAvailability ----------

test('parseAvailability: a campsite with one Available night yields available === true, date sliced to YYYY-MM-DD', () => {
  const slots = parseAvailability({
    campsites: {
      '1': {
        availabilities: { '2026-09-01T00:00:00Z': 'Available' },
        campsite_type: '',
      },
    },
  });
  assert.equal(slots.length, 1);
  assert.equal(slots[0]!.date, '2026-09-01');
  assert.equal(slots[0]!.available, true);
});

test('parseAvailability: Reserved/Not Available/NYR/Open/Closed/unrecognized all yield available === false', () => {
  const statuses = ['Reserved', 'Not Available', 'NYR', 'Open', 'Closed', 'SomeNewFutureStatus'];
  const availabilities: Record<string, string> = {};
  statuses.forEach((s, i) => {
    availabilities[`2026-09-0${i + 1}T00:00:00Z`] = s;
  });
  const slots = parseAvailability({
    campsites: { '1': { availabilities, campsite_type: '' } },
  });
  assert.equal(slots.length, statuses.length);
  for (const slot of slots) {
    assert.equal(slot.available, false);
  }
});

test('parseAvailability: a "Open" status yields available === false', () => {
  const slots = parseAvailability({
    campsites: { '1': { availabilities: { '2026-09-01T00:00:00Z': 'Open' }, campsite_type: '' } },
  });
  assert.equal(slots[0]!.available, false);
});

test('parseAvailability: rawStatus preserves the original string verbatim', () => {
  const slots = parseAvailability({
    campsites: { '1': { availabilities: { '2026-09-01T00:00:00Z': 'Not Reservable Management' }, campsite_type: '' } },
  });
  assert.equal(slots[0]!.rawStatus, 'Not Reservable Management');
});

test('parseAvailability: siteLabel and loop fall back to "" when absent', () => {
  const slots = parseAvailability({
    campsites: { '1': { availabilities: { '2026-09-01T00:00:00Z': 'Available' }, campsite_type: '' } },
  });
  assert.equal(slots[0]!.siteLabel, '');
  assert.equal(slots[0]!.loop, '');
});

test('parseAvailability: campsiteId is the object key from campsites', () => {
  const slots = parseAvailability({
    campsites: { 'abc123': { availabilities: { '2026-09-01T00:00:00Z': 'Available' }, campsite_type: '' } },
  });
  assert.equal(slots[0]!.campsiteId, 'abc123');
});

test('parseAvailability: slots are sorted by campsiteId then date', () => {
  const slots = parseAvailability({
    campsites: {
      b: {
        availabilities: { '2026-09-02T00:00:00Z': 'Available', '2026-09-01T00:00:00Z': 'Available' },
        campsite_type: '',
      },
      a: {
        availabilities: { '2026-09-01T00:00:00Z': 'Available' },
        campsite_type: '',
      },
    },
  });
  assert.deepEqual(
    slots.map((s) => `${s.campsiteId}:${s.date}`),
    ['a:2026-09-01', 'b:2026-09-01', 'b:2026-09-02']
  );
});

test('parseAvailability: parsing the real fixture file yields a non-empty array with YYYY-MM-DD dates', async () => {
  const url = new URL('./fixtures/availability-month.json', import.meta.url);
  const text = await readFile(fileURLToPath(url), 'utf-8');
  const raw = AvailabilityResponseSchema.parse(JSON.parse(text));
  const slots = parseAvailability(raw);
  assert.ok(slots.length > 0);
  for (const slot of slots) {
    assert.match(slot.date, /^\d{4}-\d{2}-\d{2}$/);
  }
});

// ---------- mergeSlots ----------

function slot(campsiteId: string, date: string, available: boolean): AvailabilitySlot {
  return {
    campsiteId,
    siteLabel: '',
    loop: '',
    campsiteType: '',
    siteType: 'unknown',
    date,
    rawStatus: available ? 'Available' : 'Reserved',
    available,
  };
}

test('mergeSlots: merging two months yields no duplicate (campsiteId, date) pairs', () => {
  const monthA = [slot('1', '2026-09-01', true), slot('1', '2026-09-30', false)];
  const monthB = [slot('1', '2026-10-01', true)];
  const merged = mergeSlots(monthA, monthB);
  const keys = merged.map((s) => `${s.campsiteId}|${s.date}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(merged.length, 3);
});

test('mergeSlots: when both months contain the same (campsiteId, date), the later-listed array wins', () => {
  const monthA = [slot('1', '2026-09-01', false)];
  const monthB = [slot('1', '2026-09-01', true)];
  const merged = mergeSlots(monthA, monthB);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.available, true);
});

test('mergeSlots: the merged result stays sorted by campsiteId then date', () => {
  const monthA = [slot('b', '2026-09-01', true)];
  const monthB = [slot('a', '2026-10-01', true), slot('b', '2026-08-01', true)];
  const merged = mergeSlots(monthA, monthB);
  assert.deepEqual(
    merged.map((s) => `${s.campsiteId}:${s.date}`),
    ['a:2026-10-01', 'b:2026-08-01', 'b:2026-09-01']
  );
});
