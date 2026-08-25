import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  resolveFacility,
  resolveArea,
  listAreaFacilities,
  fetchMonthAvailability,
  fetchAvailabilityForRange,
  RIDB_BASE,
  AVAILABILITY_BASE,
  AREA_HYDRATION_LIMIT,
} from './client.js';
import { AvailabilityResponseSchema } from './types.js';
import { FacilityNotFoundError, RecAreaNotFoundError, ResponseSchemaError } from '../errors.js';

const fixturesDir = new URL('./fixtures/', import.meta.url);

async function loadFixture(name: string): Promise<unknown> {
  const text = await readFile(fileURLToPath(new URL(name, fixturesDir)), 'utf-8');
  return JSON.parse(text);
}

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
}

function makeFetchImpl(responses: Response[]): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    requests.push({ url: String(url), headers });
    const res = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return res;
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ---------- resolveFacility ----------

test('resolveFacility: returns facilityId/facilityName from RECDATA[0]', async () => {
  const { fetchImpl } = makeFetchImpl([
    jsonResponse({ RECDATA: [{ FacilityID: 232447, FacilityName: 'UPPER PINES' }] }),
  ]);
  const result = await resolveFacility('Upper Pines', { fetchImpl, sleep: async () => {} });
  assert.equal(result.facilityId, 232447);
  assert.equal(result.facilityName, 'UPPER PINES');
});

test('resolveFacility: throws FacilityNotFoundError with the queried parkName on RECDATA: []', async () => {
  const { fetchImpl } = makeFetchImpl([jsonResponse({ RECDATA: [] })]);
  await assert.rejects(
    resolveFacility('Nonexistent Park', { fetchImpl, sleep: async () => {} }),
    (err: unknown) => {
      assert.ok(err instanceof FacilityNotFoundError);
      assert.equal(err.parkName, 'Nonexistent Park');
      return true;
    }
  );
});

test('resolveFacility: throws ResponseSchemaError when RidbFacilitySearchSchema fails', async () => {
  const { fetchImpl } = makeFetchImpl([jsonResponse({ not: 'the right shape' })]);
  await assert.rejects(
    resolveFacility('Upper Pines', { fetchImpl, sleep: async () => {} }),
    (err: unknown) => {
      assert.ok(err instanceof ResponseSchemaError);
      return true;
    }
  );
});

test('resolveFacility: sends query/limit/sort params and hits ridb.recreation.gov/api/v1/facilities', async () => {
  const { fetchImpl, requests } = makeFetchImpl([
    jsonResponse({ RECDATA: [{ FacilityID: 1, FacilityName: 'X' }] }),
  ]);
  await resolveFacility('Upper Pines', { fetchImpl, sleep: async () => {} });
  assert.equal(requests.length, 1);
  const url = new URL(requests[0]!.url);
  assert.equal(`${url.origin}${url.pathname}`, `${RIDB_BASE}/facilities`);
  assert.equal(url.searchParams.get('query'), 'Upper Pines');
  assert.equal(url.searchParams.get('limit'), '10');
  assert.equal(url.searchParams.get('sort'), 'Name');
});

test('resolveFacility: sends an apikey header when ridbApiKey is provided', async () => {
  const { fetchImpl, requests } = makeFetchImpl([
    jsonResponse({ RECDATA: [{ FacilityID: 1, FacilityName: 'X' }] }),
  ]);
  await resolveFacility('Upper Pines', { fetchImpl, sleep: async () => {}, ridbApiKey: 'secret-key' });
  assert.equal(requests[0]!.headers['apikey'], 'secret-key');
});

test('resolveFacility: omits apikey header when ridbApiKey is not provided', async () => {
  const { fetchImpl, requests } = makeFetchImpl([
    jsonResponse({ RECDATA: [{ FacilityID: 1, FacilityName: 'X' }] }),
  ]);
  await resolveFacility('Upper Pines', { fetchImpl, sleep: async () => {} });
  assert.equal(requests[0]!.headers['apikey'], undefined);
});

test('resolveFacility: includes alternatives when multiple results are returned', async () => {
  const { fetchImpl } = makeFetchImpl([
    jsonResponse({
      RECDATA: [
        { FacilityID: 1, FacilityName: 'Pine Grove A' },
        { FacilityID: 2, FacilityName: 'Pine Grove B' },
        { FacilityID: 3, FacilityName: 'Pine Grove C' },
      ],
    }),
  ]);
  const result = await resolveFacility('Pine Grove', { fetchImpl, sleep: async () => {} });
  assert.equal(result.facilityId, 1);
  assert.deepEqual(result.alternatives, ['Pine Grove B', 'Pine Grove C']);
});

// ---------- resolveArea ----------

test('resolveArea: returns top-match recAreaId/recAreaName plus alternatives', async () => {
  const { fetchImpl } = makeFetchImpl([
    jsonResponse({
      RECDATA: [
        { RecAreaID: 1106, RecAreaName: 'Sequoia National Forest' },
        { RecAreaID: 9, RecAreaName: 'Sequoia NP' },
      ],
    }),
  ]);
  const result = await resolveArea('Sequoia National Forest', { fetchImpl, sleep: async () => {} });
  assert.deepEqual(result, {
    recAreaId: 1106,
    recAreaName: 'Sequoia National Forest',
    alternatives: ['Sequoia NP'],
  });
});

test('resolveArea: throws RecAreaNotFoundError with the queried areaName on RECDATA: []', async () => {
  const { fetchImpl } = makeFetchImpl([jsonResponse({ RECDATA: [] })]);
  await assert.rejects(
    resolveArea('Bogus', { fetchImpl, sleep: async () => {} }),
    (err: unknown) => {
      assert.ok(err instanceof RecAreaNotFoundError);
      assert.equal(err.areaName, 'Bogus');
      return true;
    }
  );
});

test('resolveArea: throws ResponseSchemaError when RidbRecAreaSearchSchema fails', async () => {
  const { fetchImpl } = makeFetchImpl([jsonResponse({ nope: 1 })]);
  await assert.rejects(
    resolveArea('X', { fetchImpl, sleep: async () => {} }),
    (err: unknown) => {
      assert.ok(err instanceof ResponseSchemaError);
      return true;
    }
  );
});

test('resolveArea: sends the key in the apikey header and the URL never contains apikey=', async () => {
  const { fetchImpl, requests } = makeFetchImpl([
    jsonResponse({ RECDATA: [{ RecAreaID: 1, RecAreaName: 'X' }] }),
  ]);
  await resolveArea('X', { fetchImpl, sleep: async () => {}, ridbApiKey: 'secret-key' });
  assert.equal(requests[0]!.headers['apikey'], 'secret-key');
  assert.equal(requests[0]!.url.includes('apikey='), false);
});

// ---------- listAreaFacilities ----------

test('listAreaFacilities: filters out non-campground and non-reservable facility types', async () => {
  const { fetchImpl } = makeFetchImpl([
    jsonResponse({
      RECDATA: [
        { FacilityID: 1, FacilityName: 'Visitor Center', FacilityTypeDescription: 'Visitor Center', Reservable: true },
        { FacilityID: 2, FacilityName: 'Boat Ramp', FacilityTypeDescription: 'Boat Ramp', Reservable: true },
        { FacilityID: 3, FacilityName: 'Day Use Area', FacilityTypeDescription: 'Day Use Area', Reservable: true },
        { FacilityID: 4, FacilityName: 'Non-Reservable Campground', FacilityTypeDescription: 'Campground', Reservable: false },
      ],
    }),
  ]);
  const result = await listAreaFacilities(1106, { fetchImpl, sleep: async () => {} });
  assert.deepEqual(result, []);
});

test('listAreaFacilities: keeps reservable Campground tagged standard and Group Campground tagged group, preserving order', async () => {
  const { fetchImpl } = makeFetchImpl([
    jsonResponse({
      RECDATA: [
        { FacilityID: 5, FacilityName: 'Group Site', FacilityTypeDescription: 'Group Campground', Reservable: true },
        { FacilityID: 6, FacilityName: 'Standard Site', FacilityTypeDescription: 'Campground', Reservable: true },
      ],
    }),
  ]);
  const result = await listAreaFacilities(1106, { fetchImpl, sleep: async () => {} });
  assert.deepEqual(result, [
    { facilityId: 5, facilityName: 'Group Site', facilityType: 'group' },
    { facilityId: 6, facilityName: 'Standard Site', facilityType: 'standard' },
  ]);
});

test('listAreaFacilities: hydrates entries with no FacilityTypeDescription via GET /facilities/{id}', async () => {
  const { fetchImpl, requests } = makeFetchImpl([
    jsonResponse({ RECDATA: [{ FacilityID: 7, FacilityName: 'Needs Hydration' }] }),
    jsonResponse({ RECDATA: [{ FacilityID: 7, FacilityName: 'Needs Hydration', FacilityTypeDescription: 'Campground', Reservable: true }] }),
  ]);
  const result = await listAreaFacilities(1106, { fetchImpl, sleep: async () => {} });
  assert.deepEqual(result, [{ facilityId: 7, facilityName: 'Needs Hydration', facilityType: 'standard' }]);
  assert.equal(requests.length, 2);
  const hydrationUrl = new URL(requests[1]!.url);
  assert.equal(`${hydrationUrl.origin}${hydrationUrl.pathname}`, `${RIDB_BASE}/facilities/7`);
});

test('listAreaFacilities: caps hydration at AREA_HYDRATION_LIMIT and drops the un-hydrated remainder', async () => {
  const stubEntries = Array.from({ length: 100 }, (_, i) => ({
    FacilityID: i + 1,
    FacilityName: `Stub ${i + 1}`,
  }));
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    requests.push({ url: String(url), headers });
    const urlStr = String(url);
    if (urlStr.includes('/recareas/')) {
      return jsonResponse({ RECDATA: stubEntries });
    }
    // /facilities/{id} hydration: extract id from the URL and return a fresh
    // per-call Response (a shared Response instance's body can only be read once).
    const id = Number(urlStr.split('/facilities/')[1]);
    return jsonResponse({
      RECDATA: [{ FacilityID: id, FacilityName: `Stub ${id}`, FacilityTypeDescription: 'Campground', Reservable: true }],
    });
  }) as unknown as typeof fetch;

  const result = await listAreaFacilities(1106, { fetchImpl, sleep: async () => {} });
  // 1 list request + AREA_HYDRATION_LIMIT hydration requests
  assert.equal(requests.length, 1 + AREA_HYDRATION_LIMIT);
  assert.equal(result.length, AREA_HYDRATION_LIMIT);
});

test('listAreaFacilities: a rejecting hydration call still returns the successfully-resolved facilities', async () => {
  const stubEntries = [
    { FacilityID: 1, FacilityName: 'Will Fail' },
    { FacilityID: 2, FacilityName: 'Will Succeed' },
  ];
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    requests.push({ url: String(url), headers });
    const urlStr = String(url);
    if (urlStr.includes('/recareas/')) {
      return jsonResponse({ RECDATA: stubEntries });
    }
    // Route by facility id: facility 1 fails with a non-retryable 404, facility 2 succeeds.
    if (urlStr.includes('/facilities/1')) {
      return jsonResponse({ error: 'not found' }, 404);
    }
    return jsonResponse({
      RECDATA: [{ FacilityID: 2, FacilityName: 'Will Succeed', FacilityTypeDescription: 'Campground', Reservable: true }],
    });
  }) as unknown as typeof fetch;

  const result = await listAreaFacilities(1106, { fetchImpl, sleep: async () => {} });
  assert.deepEqual(result, [{ facilityId: 2, facilityName: 'Will Succeed', facilityType: 'standard' }]);
});

test('listAreaFacilities: builds the URL RIDB_BASE/recareas/{id}/facilities', async () => {
  const { fetchImpl, requests } = makeFetchImpl([jsonResponse({ RECDATA: [] })]);
  await listAreaFacilities(1106, { fetchImpl, sleep: async () => {} });
  const url = new URL(requests[0]!.url);
  assert.equal(`${url.origin}${url.pathname}`, `${RIDB_BASE}/recareas/1106/facilities`);
});

// ---------- fetchMonthAvailability ----------

test('fetchMonthAvailability: requests the availability endpoint with start_date normalized to the 1st', async () => {
  const { fetchImpl, requests } = makeFetchImpl([jsonResponse({ campsites: {} })]);
  await fetchMonthAvailability(232447, '2026-09-15', { fetchImpl, sleep: async () => {} });
  assert.equal(requests.length, 1);
  const url = new URL(requests[0]!.url);
  assert.equal(`${url.origin}${url.pathname}`, `${AVAILABILITY_BASE}/232447/month`);
  assert.equal(url.searchParams.get('start_date'), '2026-09-01T00:00:00.000Z');
});

test('fetchMonthAvailability: returns the zod-parsed body', async () => {
  const body = {
    campsites: { '1': { availabilities: { '2026-09-01T00:00:00Z': 'Available' } } },
  };
  const { fetchImpl } = makeFetchImpl([jsonResponse(body)]);
  const result = await fetchMonthAvailability(232447, '2026-09-01', { fetchImpl, sleep: async () => {} });
  // AvailabilityResponseSchema fills in campsite_type's zod .default('') —
  // assert on the fields that came from the raw body, not strict equality.
  assert.deepEqual(
    result.campsites['1']!.availabilities,
    body.campsites['1'].availabilities
  );
});

test('fetchMonthAvailability: throws ResponseSchemaError when AvailabilityResponseSchema fails', async () => {
  const { fetchImpl } = makeFetchImpl([jsonResponse({ not: 'valid' })]);
  await assert.rejects(
    fetchMonthAvailability(232447, '2026-09-01', { fetchImpl, sleep: async () => {} }),
    (err: unknown) => {
      assert.ok(err instanceof ResponseSchemaError);
      return true;
    }
  );
});

// ---------- fetchAvailabilityForRange ----------

test('fetchAvailabilityForRange: same-month range makes exactly 1 request', async () => {
  const { fetchImpl, requests } = makeFetchImpl([jsonResponse({ campsites: {} })]);
  await fetchAvailabilityForRange(232447, '2026-09-04', '2026-09-07', { fetchImpl, sleep: async () => {} });
  assert.equal(requests.length, 1);
});

test('fetchAvailabilityForRange: month-boundary-crossing range makes exactly 2 requests for 09-01 and 10-01', async () => {
  const { fetchImpl, requests } = makeFetchImpl([
    jsonResponse({ campsites: {} }),
    jsonResponse({ campsites: {} }),
  ]);
  await fetchAvailabilityForRange(232447, '2026-09-29', '2026-10-02', { fetchImpl, sleep: async () => {} });
  assert.equal(requests.length, 2);
  const startDates = requests.map((r) => new URL(r.url).searchParams.get('start_date'));
  assert.deepEqual(startDates, ['2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z']);
});

test('fetchAvailabilityForRange: year-rollover range makes 2 requests for 2026-12-01 and 2027-01-01', async () => {
  const { fetchImpl, requests } = makeFetchImpl([
    jsonResponse({ campsites: {} }),
    jsonResponse({ campsites: {} }),
  ]);
  await fetchAvailabilityForRange(232447, '2026-12-30', '2027-01-02', { fetchImpl, sleep: async () => {} });
  assert.equal(requests.length, 2);
  const startDates = requests.map((r) => new URL(r.url).searchParams.get('start_date'));
  assert.deepEqual(startDates, ['2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z']);
});

test('fetchAvailabilityForRange: returns all responses in month order', async () => {
  const bodyA = { campsites: { a: { availabilities: {} } } };
  const bodyB = { campsites: { b: { availabilities: {} } } };
  const { fetchImpl } = makeFetchImpl([jsonResponse(bodyA), jsonResponse(bodyB)]);
  const result = await fetchAvailabilityForRange(232447, '2026-09-29', '2026-10-02', {
    fetchImpl,
    sleep: async () => {},
  });
  assert.equal(result.length, 2);
  assert.deepEqual(Object.keys(result[0]!.campsites), ['a']);
  assert.deepEqual(Object.keys(result[1]!.campsites), ['b']);
});

// ---------- fixture schema validation ----------

test('the captured availability fixture parses against AvailabilityResponseSchema', async () => {
  const fixture = await loadFixture('availability-month.json');
  const result = AvailabilityResponseSchema.safeParse(fixture);
  assert.equal(result.success, true);
});
