import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AvailabilityResponseSchema,
  RidbFacilitySearchSchema,
  RidbRecAreaSearchSchema,
  RidbRecAreaFacilitiesSchema,
} from './types.js';

const ridbRecareasFixture = JSON.parse(
  readFileSync(new URL('./fixtures/ridb-recareas.json', import.meta.url), 'utf8')
);
const ridbRecareaFacilitiesFixture = JSON.parse(
  readFileSync(new URL('./fixtures/ridb-recarea-facilities.json', import.meta.url), 'utf8')
);

test('a valid availability response parses', () => {
  const result = AvailabilityResponseSchema.safeParse({
    campsites: {
      '12345': {
        availabilities: { '2026-09-01T00:00:00Z': 'Available' },
        campsite_type: 'STANDARD NONELECTRIC',
        type_of_use: 'Overnight',
        loop: 'Loop A',
        site: '012',
      },
    },
  });
  assert.equal(result.success, true);
});

test('an availability response missing campsites fails to parse', () => {
  const result = AvailabilityResponseSchema.safeParse({});
  assert.equal(result.success, false);
});

test('unknown extra fields on a campsite entry do not cause failure', () => {
  const result = AvailabilityResponseSchema.safeParse({
    campsites: {
      '12345': {
        availabilities: { '2026-09-01T00:00:00Z': 'Available' },
        campsite_type: 'STANDARD NONELECTRIC',
        some_new_field_from_upstream: 'whatever',
      },
    },
  });
  assert.equal(result.success, true);
});

test('an unrecognized status string parses successfully (not an enum)', () => {
  const result = AvailabilityResponseSchema.safeParse({
    campsites: {
      '12345': {
        availabilities: { '2026-09-01T00:00:00Z': 'Some New Status' },
        campsite_type: 'STANDARD NONELECTRIC',
      },
    },
  });
  assert.equal(result.success, true);
});

test('a valid RIDB facility search response parses', () => {
  const result = RidbFacilitySearchSchema.safeParse({
    RECDATA: [{ FacilityID: 232447, FacilityName: 'UPPER PINES' }],
    METADATA: { RESULTS: { TOTAL_COUNT: 1 } },
  });
  assert.equal(result.success, true);
});

test('RIDB FacilityID normalizes a numeric string to a number', () => {
  const result = RidbFacilitySearchSchema.parse({
    RECDATA: [{ FacilityID: '232447', FacilityName: 'UPPER PINES' }],
  });
  assert.equal(typeof result.RECDATA[0]?.FacilityID, 'number');
  assert.equal(result.RECDATA[0]?.FacilityID, 232447);
});

test('an empty RECDATA array parses successfully', () => {
  const result = RidbFacilitySearchSchema.safeParse({ RECDATA: [] });
  assert.equal(result.success, true);
});

describe('RidbRecAreaSearchSchema', () => {
  test('parses the live-captured ridb-recareas.json fixture', () => {
    const result = RidbRecAreaSearchSchema.safeParse(ridbRecareasFixture);
    assert.equal(result.success, true);
  });

  test('coerces a string RecAreaID to a number', () => {
    const result = RidbRecAreaSearchSchema.parse({
      RECDATA: [{ RecAreaID: '2991', RecAreaName: 'Test Area' }],
    });
    assert.equal(typeof result.RECDATA[0]?.RecAreaID, 'number');
    assert.equal(result.RECDATA[0]?.RecAreaID, 2991);
  });

  test('an empty RECDATA array parses successfully (not-found is caller decision)', () => {
    const result = RidbRecAreaSearchSchema.safeParse({ RECDATA: [] });
    assert.equal(result.success, true);
  });
});

describe('RidbRecAreaFacilitiesSchema', () => {
  test('parses the live-captured ridb-recarea-facilities.json fixture', () => {
    const result = RidbRecAreaFacilitiesSchema.safeParse(ridbRecareaFacilitiesFixture);
    assert.equal(result.success, true);
  });

  test('accepts a full-record entry and leaves FacilityTypeDescription defined', () => {
    const result = RidbRecAreaFacilitiesSchema.parse({
      RECDATA: [
        {
          FacilityID: 232447,
          FacilityName: 'Upper Pines',
          FacilityTypeDescription: 'Campground',
          Reservable: true,
        },
      ],
    });
    assert.equal(result.RECDATA[0]?.FacilityTypeDescription, 'Campground');
  });

  test('accepts a compact-stub entry and leaves FacilityTypeDescription undefined', () => {
    const result = RidbRecAreaFacilitiesSchema.parse({
      RECDATA: [{ FacilityID: 232447, FacilityName: 'Upper Pines' }],
    });
    assert.equal(result.RECDATA[0]?.FacilityTypeDescription, undefined);
  });

  test('rejects a facility with no ID', () => {
    const result = RidbRecAreaFacilitiesSchema.safeParse({
      RECDATA: [{ FacilityName: 'no id' }],
    });
    assert.equal(result.success, false);
  });
});
