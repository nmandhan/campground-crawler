import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AvailabilityResponseSchema,
  RidbFacilitySearchSchema,
} from './types.js';

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
