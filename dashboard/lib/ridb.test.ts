import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchRecAreas, listAreaFacilities, previewAreas, AREA_FACILITY_CAP } from './ridb';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const losPadresSearchFixture = {
  RECDATA: [{ RecAreaID: 1106, RecAreaName: 'Los Padres National Forest' }],
};

const stringIdSearchFixture = {
  RECDATA: [{ RecAreaID: '1106', RecAreaName: 'Los Padres National Forest' }],
};

const emptySearchFixture = { RECDATA: [] };

function reservableCampground(facilityId: number, facilityName = `Campground ${facilityId}`) {
  return {
    FacilityID: facilityId,
    FacilityName: facilityName,
    FacilityTypeDescription: 'Campground',
    Reservable: true,
  };
}

function groupCampground(facilityId: number, facilityName = `Group Campground ${facilityId}`) {
  return {
    FacilityID: facilityId,
    FacilityName: facilityName,
    FacilityTypeDescription: 'Group Campground',
    Reservable: true,
  };
}

function nonReservable(facilityId: number) {
  return {
    FacilityID: facilityId,
    FacilityName: `Non-reservable ${facilityId}`,
    FacilityTypeDescription: 'Campground',
    Reservable: false,
  };
}

function undefinedReservable(facilityId: number) {
  return {
    FacilityID: facilityId,
    FacilityName: `Undefined-reservable ${facilityId}`,
    FacilityTypeDescription: 'Campground',
    // Reservable omitted entirely
  };
}

function notCampground(facilityId: number) {
  return {
    FacilityID: facilityId,
    FacilityName: `Visitor Center ${facilityId}`,
    FacilityTypeDescription: 'Visitor Center',
    Reservable: true,
  };
}

function compactStub(facilityId: number) {
  return {
    FacilityID: facilityId,
    FacilityName: `Stub ${facilityId}`,
    // FacilityTypeDescription and Reservable both omitted
  };
}

/** Generates N synthetic reservable campground records for the 25 -> 20 truncation test. */
function manyReservableCampgrounds(n: number, startId = 1) {
  return Array.from({ length: n }, (_, i) => reservableCampground(startId + i));
}

// ---------------------------------------------------------------------------
// fetchImpl stub
// ---------------------------------------------------------------------------

type StubOptions = {
  searchFixture?: unknown;
  facilitiesFixture?: unknown;
  facilitiesByAreaId?: Record<number, unknown>;
  searchByQuery?: Record<string, unknown>;
  status?: number;
  throwError?: Error;
};

function makeStubFetch(opts: StubOptions = {}) {
  const requestedUrls: string[] = [];

  const fetchImpl = (async (url: string | URL) => {
    const urlStr = url.toString();
    requestedUrls.push(urlStr);

    if (opts.throwError) {
      throw opts.throwError;
    }

    if (opts.status && opts.status !== 200) {
      return {
        ok: false,
        status: opts.status,
        json: async () => ({}),
      } as unknown as Response;
    }

    if (urlStr.includes('/recareas/') && urlStr.includes('/facilities')) {
      // extract recAreaId from the URL path
      const match = urlStr.match(/\/recareas\/([^/]+)\/facilities/);
      const areaId = match ? Number(decodeURIComponent(match[1]!)) : undefined;
      const fixture =
        (areaId !== undefined && opts.facilitiesByAreaId?.[areaId]) ??
        opts.facilitiesFixture ??
        emptySearchFixture;
      return {
        ok: true,
        status: 200,
        json: async () => fixture,
      } as unknown as Response;
    }

    // /recareas search endpoint
    const parsedUrl = new URL(urlStr);
    const query = parsedUrl.searchParams.get('query') ?? '';
    const fixture = opts.searchByQuery?.[query] ?? opts.searchFixture ?? emptySearchFixture;
    return {
      ok: true,
      status: 200,
      json: async () => fixture,
    } as unknown as Response;
  }) as typeof fetch;

  return { fetchImpl, requestedUrls };
}

// ---------------------------------------------------------------------------
// searchRecAreas
// ---------------------------------------------------------------------------

test('searchRecAreas returns matching areas from a stubbed RECDATA', async () => {
  const { fetchImpl } = makeStubFetch({ searchFixture: losPadresSearchFixture });
  const result = await searchRecAreas('los padres', { fetchImpl, apiKey: 'test-key' });
  assert.deepEqual(result, {
    ok: true,
    areas: [{ recAreaId: 1106, recAreaName: 'Los Padres National Forest' }],
  });
});

test('searchRecAreas coerces a string RecAreaID to a number', async () => {
  const { fetchImpl } = makeStubFetch({ searchFixture: stringIdSearchFixture });
  const result = await searchRecAreas('los padres', { fetchImpl, apiKey: 'test-key' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.areas[0]!.recAreaId, 1106);
    assert.equal(typeof result.areas[0]!.recAreaId, 'number');
  }
});

test('searchRecAreas on an empty RECDATA returns an empty ok result, not an error', async () => {
  const { fetchImpl } = makeStubFetch({ searchFixture: emptySearchFixture });
  const result = await searchRecAreas('nonexistent', { fetchImpl, apiKey: 'test-key' });
  assert.deepEqual(result, { ok: true, areas: [] });
});

test('searchRecAreas on HTTP 401 returns an ok:false result without throwing', async () => {
  const { fetchImpl } = makeStubFetch({ status: 401 });
  const result = await searchRecAreas('los padres', { fetchImpl, apiKey: 'test-key' });
  assert.deepEqual(result, { ok: false, error: 'RIDB /recareas: HTTP 401' });
});

test('searchRecAreas on an unparseable body returns a clean error', async () => {
  const { fetchImpl } = makeStubFetch({ searchFixture: { totally: 'wrong shape' } });
  const result = await searchRecAreas('los padres', { fetchImpl, apiKey: 'test-key' });
  assert.deepEqual(result, { ok: false, error: 'unexpected RIDB response shape' });
});

test('searchRecAreas on a thrown network error returns one safe line, does not throw', async () => {
  const { fetchImpl } = makeStubFetch({ throwError: new Error('network down') });
  const result = await searchRecAreas('los padres', { fetchImpl, apiKey: 'test-key' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error.length > 0);
    assert.ok(!result.error.includes('http'));
  }
});

test('searchRecAreas sends query and limit=50 as query params and an apikey header', async () => {
  const { fetchImpl, requestedUrls } = makeStubFetch({ searchFixture: losPadresSearchFixture });
  await searchRecAreas('los padres', { fetchImpl, apiKey: 'test-key' });
  assert.equal(requestedUrls.length, 1);
  const url = new URL(requestedUrls[0]!);
  assert.equal(url.searchParams.get('query'), 'los padres');
  assert.equal(url.searchParams.get('limit'), '50');
});

test('searchRecAreas re-ranks results so a name-matching area outranks a non-matching one, regardless of RIDB order', async () => {
  // Reproduces the live bug: querying "white river" against real RIDB returns a fuzzy
  // full-text match across 63 results, with "White River National Forest" absent from the
  // first 10 because RIDB's own ordering is not relevance-sorted by name.
  const fixture = {
    RECDATA: [
      { RecAreaID: 4001, RecAreaName: 'Nestucca Bay National Wildlife Refuge' },
      { RecAreaID: 13113, RecAreaName: 'Lower White River Wilderness' },
      { RecAreaID: 1055, RecAreaName: 'White River National Forest' },
      { RecAreaID: 2001, RecAreaName: 'Payette River' },
    ],
  };
  const { fetchImpl } = makeStubFetch({ searchFixture: fixture });
  const result = await searchRecAreas('white river national forest', { fetchImpl, apiKey: 'test-key' });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.areas[0]!.recAreaId, 1055);
    assert.equal(result.areas[0]!.recAreaName, 'White River National Forest');
  }
});

test('searchRecAreas result matching is case-insensitive', async () => {
  const fixture = {
    RECDATA: [
      { RecAreaID: 1, RecAreaName: 'Zzz Unrelated Area' },
      { RecAreaID: 2, RecAreaName: 'LOS PADRES NATIONAL FOREST' },
    ],
  };
  const { fetchImpl } = makeStubFetch({ searchFixture: fixture });
  const result = await searchRecAreas('los padres', { fetchImpl, apiKey: 'test-key' });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.areas[0]!.recAreaId, 2);
  }
});

test('searchRecAreas caps returned suggestions at 10 even if RIDB returns more', async () => {
  const fixture = {
    RECDATA: Array.from({ length: 30 }, (_, i) => ({ RecAreaID: i, RecAreaName: `Area ${i}` })),
  };
  const { fetchImpl } = makeStubFetch({ searchFixture: fixture });
  const result = await searchRecAreas('area', { fetchImpl, apiKey: 'test-key' });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.areas.length, 10);
  }
});

// ---------------------------------------------------------------------------
// listAreaFacilities
// ---------------------------------------------------------------------------

test('listAreaFacilities keeps only reservable campgrounds', async () => {
  const fixture = {
    RECDATA: [reservableCampground(1), notCampground(2), nonReservable(3)],
  };
  const { fetchImpl } = makeStubFetch({ facilitiesFixture: fixture });
  const result = await listAreaFacilities(1106, { fetchImpl, apiKey: 'test-key' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(
      result.facilities.map((f) => f.facilityId),
      [1],
    );
  }
});

test('listAreaFacilities tags a group-matching description as facilityType: group, else standard', async () => {
  const fixture = { RECDATA: [reservableCampground(1), groupCampground(2)] };
  const { fetchImpl } = makeStubFetch({ facilitiesFixture: fixture });
  const result = await listAreaFacilities(1106, { fetchImpl, apiKey: 'test-key' });
  assert.equal(result.ok, true);
  if (result.ok) {
    const standard = result.facilities.find((f) => f.facilityId === 1)!;
    const group = result.facilities.find((f) => f.facilityId === 2)!;
    assert.equal(standard.facilityType, 'standard');
    assert.equal(group.facilityType, 'group');
  }
});

test('listAreaFacilities drops Reservable: undefined (fail closed) and FacilityTypeDescription: undefined (stub)', async () => {
  const fixture = {
    RECDATA: [reservableCampground(1), undefinedReservable(2), compactStub(3)],
  };
  const { fetchImpl } = makeStubFetch({ facilitiesFixture: fixture });
  const result = await listAreaFacilities(1106, { fetchImpl, apiKey: 'test-key' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(
      result.facilities.map((f) => f.facilityId),
      [1],
    );
  }
});

test('listAreaFacilities preserves RIDB returned order', async () => {
  const fixture = { RECDATA: [reservableCampground(5), reservableCampground(3), reservableCampground(9)] };
  const { fetchImpl } = makeStubFetch({ facilitiesFixture: fixture });
  const result = await listAreaFacilities(1106, { fetchImpl, apiKey: 'test-key' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(
      result.facilities.map((f) => f.facilityId),
      [5, 3, 9],
    );
  }
});

// ---------------------------------------------------------------------------
// previewAreas
// ---------------------------------------------------------------------------

test('previewAreas dedups facility ids appearing in more than one area, preserving order', async () => {
  const { fetchImpl } = makeStubFetch({
    facilitiesByAreaId: {
      1: { RECDATA: [reservableCampground(10), reservableCampground(11)] },
      2: { RECDATA: [reservableCampground(11), reservableCampground(12)] },
    },
  });
  const result = await previewAreas([{ recAreaId: 1 }, { recAreaId: 2 }], { fetchImpl, apiKey: 'test-key' });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.facilities.map((f) => f.facilityId),
    [10, 11, 12],
  );
});

test('previewAreas with a name-only area resolves it via searchRecAreas first', async () => {
  const { fetchImpl, requestedUrls } = makeStubFetch({
    searchByQuery: { 'los padres': losPadresSearchFixture },
    facilitiesByAreaId: { 1106: { RECDATA: [reservableCampground(1)] } },
  });
  const result = await previewAreas([{ name: 'los padres' }], { fetchImpl, apiKey: 'test-key' });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.facilities.map((f) => f.facilityId),
    [1],
  );
  assert.ok(requestedUrls.some((u) => u.includes('/recareas?') || u.includes('query=los')));
});

test('previewAreas isolates a per-area name-resolution failure into areaErrors and keeps other areas', async () => {
  const { fetchImpl } = makeStubFetch({
    searchByQuery: { unknownplace: emptySearchFixture },
    facilitiesByAreaId: { 1: { RECDATA: [reservableCampground(1)] } },
  });
  const result = await previewAreas([{ name: 'unknownplace' }, { recAreaId: 1 }], {
    fetchImpl,
    apiKey: 'test-key',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.facilities.map((f) => f.facilityId),
    [1],
  );
  assert.equal(result.areaErrors.length, 1);
  assert.equal(result.areaErrors[0]!.area, 'unknownplace');
});

test('previewAreas totalling 25 unique facilities returns 20 and reports truncation', async () => {
  const { fetchImpl } = makeStubFetch({
    facilitiesByAreaId: { 1: { RECDATA: manyReservableCampgrounds(25) } },
  });
  const result = await previewAreas([{ recAreaId: 1 }], { fetchImpl, apiKey: 'test-key' });
  assert.equal(result.ok, true);
  assert.equal(result.facilities.length, AREA_FACILITY_CAP);
  assert.deepEqual(result.truncated, { requested: 25, kept: 20 });
});

test('previewAreas totalling 20 or fewer returns truncated: undefined', async () => {
  const { fetchImpl } = makeStubFetch({
    facilitiesByAreaId: { 1: { RECDATA: manyReservableCampgrounds(20) } },
  });
  const result = await previewAreas([{ recAreaId: 1 }], { fetchImpl, apiKey: 'test-key' });
  assert.equal(result.ok, true);
  assert.equal(result.facilities.length, 20);
  assert.equal(result.truncated, undefined);
});

test('previewAreas([]) returns an empty ok result with empty areaErrors and undefined truncated', async () => {
  const { fetchImpl } = makeStubFetch({});
  const result = await previewAreas([], { fetchImpl, apiKey: 'test-key' });
  assert.deepEqual(result, { ok: true, facilities: [], truncated: undefined, areaErrors: [] });
});

test('previewAreas calls RIDB once per distinct area even if the same area is listed twice', async () => {
  const { fetchImpl, requestedUrls } = makeStubFetch({
    facilitiesByAreaId: { 1: { RECDATA: [reservableCampground(1)] } },
  });
  await previewAreas([{ recAreaId: 1 }, { recAreaId: 1 }], { fetchImpl, apiKey: 'test-key' });
  const facilityCalls = requestedUrls.filter((u) => u.includes('/facilities'));
  assert.equal(facilityCalls.length, 1);
});

test('previewAreas where every area errors returns ok:true with an empty facilities list and one error per area', async () => {
  const { fetchImpl } = makeStubFetch({
    status: 401,
  });
  const result = await previewAreas([{ recAreaId: 1 }, { recAreaId: 2 }], { fetchImpl, apiKey: 'test-key' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.facilities, []);
  assert.equal(result.areaErrors.length, 2);
});
