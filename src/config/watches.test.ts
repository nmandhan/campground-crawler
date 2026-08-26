import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWatches, resolveWatches, DEFAULT_WATCHES_PATH, AREA_FACILITY_CAP } from './watches.js';
import type { Watch } from '../types.js';
import type { ResolvedFacility, ResolvedRecArea, AreaFacility } from '../recreation-gov/client.js';
import { FacilityNotFoundError, RecAreaNotFoundError } from '../errors.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cc-watches-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function recordingLogger() {
  const info: string[] = [];
  const warn: string[] = [];
  return { logger: { info: (m: string) => info.push(m), warn: (m: string) => warn.push(m) }, info, warn };
}

const validWatches = [
  {
    id: 'w1',
    parkName: 'Upper Pines Campground',
    dateRange: { start: '2026-09-04', end: '2026-09-07' },
    siteType: 'tent',
  },
];

test('DEFAULT_WATCHES_PATH is watches.json', () => {
  assert.equal(DEFAULT_WATCHES_PATH, 'watches.json');
});

test('loadWatches on a missing file throws an error naming the path and suggesting watches.example.json', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'nope.json');
    await assert.rejects(() => loadWatches(path), (err: Error) => {
      assert.match(err.message, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(err.message, /watches\.example\.json/);
      return true;
    });
  });
});

test('loadWatches on invalid JSON throws an error naming the path', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'watches.json');
    await writeFile(path, '{ not valid json', 'utf8');
    await assert.rejects(() => loadWatches(path), (err: Error) => {
      assert.match(err.message, /is not valid JSON/);
      assert.match(err.message, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return true;
    });
  });
});

test('loadWatches on content failing schema throws an error containing the zod issue path', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'watches.json');
    const bad = [{ id: 'w1', parkName: 'X', dateRange: { start: '2026-09-04', end: '2026-09-07' }, siteType: 'bogus' }];
    await writeFile(path, JSON.stringify(bad), 'utf8');
    await assert.rejects(() => loadWatches(path), (err: Error) => {
      assert.match(err.message, /0\.siteType/);
      return true;
    });
  });
});

test('loadWatches returns Watch[] on valid content', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'watches.json');
    await writeFile(path, JSON.stringify(validWatches), 'utf8');
    const watches = await loadWatches(path);
    assert.equal(watches.length, 1);
    assert.equal(watches[0]!.id, 'w1');
  });
});

function fakeResolve(callLog: string[], responses: Record<string, ResolvedFacility | Error>) {
  return async (parkName: string): Promise<ResolvedFacility> => {
    callLog.push(parkName);
    const result = responses[parkName];
    if (result instanceof Error) throw result;
    if (!result) throw new FacilityNotFoundError(`no match for ${parkName}`, parkName);
    return result;
  };
}

test('two watches with the same parkName trigger exactly one resolveFacility call (memoized)', async () => {
  const callLog: string[] = [];
  const resolve = fakeResolve(callLog, {
    'Upper Pines Campground': { facilityId: 100, facilityName: 'Upper Pines', alternatives: [] },
  });
  const watches: Watch[] = [
    { type: 'facility', id: 'w1', parkName: 'Upper Pines Campground', dateRange: { start: '2026-09-04', end: '2026-09-07' }, siteType: 'any' },
    { type: 'facility', id: 'w2', parkName: 'Upper Pines Campground', dateRange: { start: '2026-10-04', end: '2026-10-07' }, siteType: 'any' },
  ];
  const { logger } = recordingLogger();
  const { resolved, failures } = await resolveWatches(watches, { resolve, logger });
  assert.equal(callLog.length, 1);
  assert.equal(resolved.length, 2);
  assert.equal(failures.length, 0);
  assert.equal(resolved[0]!.facilityId, 100);
  assert.equal(resolved[1]!.facilityId, 100);
});

test('two watches with different parkNames trigger two resolveFacility calls', async () => {
  const callLog: string[] = [];
  const resolve = fakeResolve(callLog, {
    'Upper Pines Campground': { facilityId: 100, facilityName: 'Upper Pines', alternatives: [] },
    'Kirk Creek Campground': { facilityId: 200, facilityName: 'Kirk Creek', alternatives: [] },
  });
  const watches: Watch[] = [
    { type: 'facility', id: 'w1', parkName: 'Upper Pines Campground', dateRange: { start: '2026-09-04', end: '2026-09-07' }, siteType: 'any' },
    { type: 'facility', id: 'w2', parkName: 'Kirk Creek Campground', dateRange: { start: '2026-10-04', end: '2026-10-07' }, siteType: 'any' },
  ];
  const { resolved, failures } = await resolveWatches(watches, { resolve, logger: recordingLogger().logger });
  assert.equal(callLog.length, 2);
  assert.equal(resolved.length, 2);
  assert.equal(failures.length, 0);
});

test('a watch with an explicit facilityId triggers zero resolveFacility calls and uses the provided id', async () => {
  const callLog: string[] = [];
  const resolve = fakeResolve(callLog, {});
  const watches: Watch[] = [
    { type: 'facility', id: 'w1', parkName: 'Some Park', facilityId: 999, dateRange: { start: '2026-09-04', end: '2026-09-07' }, siteType: 'any' },
  ];
  const { resolved, failures } = await resolveWatches(watches, { resolve, logger: recordingLogger().logger });
  assert.equal(callLog.length, 0);
  assert.equal(resolved.length, 1);
  assert.equal(failures.length, 0);
  assert.equal(resolved[0]!.facilityId, 999);
  assert.equal(resolved[0]!.facilityName, 'Some Park');
});

test('each resolved watch carries facilityId and facilityName', async () => {
  const callLog: string[] = [];
  const resolve = fakeResolve(callLog, {
    'Upper Pines Campground': { facilityId: 100, facilityName: 'Upper Pines Official Name', alternatives: [] },
  });
  const watches: Watch[] = [
    { type: 'facility', id: 'w1', parkName: 'Upper Pines Campground', dateRange: { start: '2026-09-04', end: '2026-09-07' }, siteType: 'any' },
  ];
  const { resolved } = await resolveWatches(watches, { resolve, logger: recordingLogger().logger });
  assert.equal(resolved[0]!.facilityId, 100);
  assert.equal(resolved[0]!.facilityName, 'Upper Pines Official Name');
});

test('resolution logs one line per unique name including resolved id and name, and logs alternatives when non-empty', async () => {
  const callLog: string[] = [];
  const resolve = fakeResolve(callLog, {
    'Upper Pines Campground': { facilityId: 100, facilityName: 'Upper Pines', alternatives: ['Lower Pines', 'North Pines'] },
  });
  const watches: Watch[] = [
    { type: 'facility', id: 'w1', parkName: 'Upper Pines Campground', dateRange: { start: '2026-09-04', end: '2026-09-07' }, siteType: 'any' },
    { type: 'facility', id: 'w2', parkName: 'Upper Pines Campground', dateRange: { start: '2026-10-04', end: '2026-10-07' }, siteType: 'any' },
  ];
  const { logger, info, warn } = recordingLogger();
  await resolveWatches(watches, { resolve, logger });
  assert.equal(info.length, 2);
  assert.match(info[0]!, /resolved "Upper Pines Campground" -> facility 100 \(Upper Pines\)/);
  assert.match(info[1]!, /RIDB resolution calls this run:/);
  assert.equal(warn.length, 1);
  assert.match(warn[0]!, /Lower Pines, North Pines/);
});

test('a FacilityNotFoundError for one watch does not prevent the other watches from resolving; failed watch appears in failures', async () => {
  const callLog: string[] = [];
  const resolve = fakeResolve(callLog, {
    'Bad Park Name': new FacilityNotFoundError('no RIDB facility matched "Bad Park Name"', 'Bad Park Name'),
    'Upper Pines Campground': { facilityId: 100, facilityName: 'Upper Pines', alternatives: [] },
  });
  const watches: Watch[] = [
    { type: 'facility', id: 'w1', parkName: 'Bad Park Name', dateRange: { start: '2026-09-04', end: '2026-09-07' }, siteType: 'any' },
    { type: 'facility', id: 'w2', parkName: 'Upper Pines Campground', dateRange: { start: '2026-10-04', end: '2026-10-07' }, siteType: 'any' },
  ];
  const { resolved, failures } = await resolveWatches(watches, { resolve, logger: recordingLogger().logger });
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]!.id, 'w2');
  assert.equal(failures.length, 1);
  assert.equal(failures[0]!.watchId, 'w1');
  assert.match(failures[0]!.reason, /no Recreation\.gov facility found/);
});

test('resolveWatches([]) returns empty resolved, failures, and truncations', async () => {
  const { resolved, failures, truncations } = await resolveWatches([], {
    logger: recordingLogger().logger,
  });
  assert.deepEqual(resolved, []);
  assert.deepEqual(failures, []);
  assert.deepEqual(truncations, []);
});

test('a resolved facility watch has no parkName, type, or areas key (flat shape only)', async () => {
  const callLog: string[] = [];
  const resolve = fakeResolve(callLog, {
    'Upper Pines Campground': { facilityId: 100, facilityName: 'Upper Pines', alternatives: [] },
  });
  const watches: Watch[] = [
    { type: 'facility', id: 'w1', parkName: 'Upper Pines Campground', dateRange: { start: '2026-09-04', end: '2026-09-07' }, siteType: 'any' },
  ];
  const { resolved } = await resolveWatches(watches, { resolve, logger: recordingLogger().logger });
  const entry = resolved[0]! as unknown as Record<string, unknown>;
  assert.equal('parkName' in entry, false);
  assert.equal('type' in entry, false);
  assert.equal('areas' in entry, false);
  assert.equal(entry.facilityType, 'standard');
});

test('a pinned facility watch (explicit facilityId) yields facilityType "standard"', async () => {
  const callLog: string[] = [];
  const resolve = fakeResolve(callLog, {});
  const watches: Watch[] = [
    { type: 'facility', id: 'w1', parkName: 'Some Park', facilityId: 999, dateRange: { start: '2026-09-04', end: '2026-09-07' }, siteType: 'any' },
  ];
  const { resolved } = await resolveWatches(watches, { resolve, logger: recordingLogger().logger });
  assert.equal(resolved[0]!.facilityType, 'standard');
});

// --- Task 2: area branch ---

function fakeResolveArea(callLog: string[], responses: Record<string, ResolvedRecArea | Error>) {
  return async (areaName: string): Promise<ResolvedRecArea> => {
    callLog.push(areaName);
    const result = responses[areaName];
    if (result instanceof Error) throw result;
    if (!result) throw new RecAreaNotFoundError(`no match for ${areaName}`, areaName);
    return result;
  };
}

function fakeListAreaFacilities(callLog: number[], responses: Record<number, AreaFacility[]>) {
  return async (recAreaId: number): Promise<AreaFacility[]> => {
    callLog.push(recAreaId);
    return responses[recAreaId] ?? [];
  };
}

function makeFacilities(count: number, offset = 0): AreaFacility[] {
  return Array.from({ length: count }, (_, i) => ({
    facilityId: offset + i + 1,
    facilityName: `Campground ${offset + i + 1}`,
    facilityType: 'standard' as const,
  }));
}

test('an area watch with one area yielding 3 facilities produces 3 ResolvedWatch entries', async () => {
  const areaCallLog: string[] = [];
  const listCallLog: number[] = [];
  const resolveArea = fakeResolveArea(areaCallLog, {
    'Sequoia National Forest': { recAreaId: 100, recAreaName: 'Sequoia National Forest', alternatives: [] },
  });
  const listAreaFacilities = fakeListAreaFacilities(listCallLog, { 100: makeFacilities(3) });
  const watches: Watch[] = [
    {
      type: 'area',
      id: 'aw1',
      areas: [{ name: 'Sequoia National Forest' }],
      dateRange: { start: '2026-09-04', end: '2026-09-07' },
      siteType: 'any',
    },
  ];
  const { resolved, failures } = await resolveWatches(watches, {
    resolveArea,
    listAreaFacilities,
    logger: recordingLogger().logger,
  });
  assert.equal(failures.length, 0);
  assert.equal(resolved.length, 3);
  for (const r of resolved) {
    assert.equal(r.id, 'aw1');
    assert.equal(r.facilityType, 'standard');
  }
});

test('an area watch with two areas yielding 5 and 4 facilities produces 9 entries in area-list order', async () => {
  const areaCallLog: string[] = [];
  const listCallLog: number[] = [];
  const resolveArea = fakeResolveArea(areaCallLog, {
    'Area One': { recAreaId: 1, recAreaName: 'Area One', alternatives: [] },
    'Area Two': { recAreaId: 2, recAreaName: 'Area Two', alternatives: [] },
  });
  const listAreaFacilities = fakeListAreaFacilities(listCallLog, {
    1: makeFacilities(5, 0),
    2: makeFacilities(4, 100),
  });
  const watches: Watch[] = [
    {
      type: 'area',
      id: 'aw1',
      areas: [{ name: 'Area One' }, { name: 'Area Two' }],
      dateRange: { start: '2026-09-04', end: '2026-09-07' },
      siteType: 'any',
    },
  ];
  const { resolved } = await resolveWatches(watches, {
    resolveArea,
    listAreaFacilities,
    logger: recordingLogger().logger,
  });
  assert.equal(resolved.length, 9);
  assert.deepEqual(
    resolved.map((r) => r.facilityId),
    [1, 2, 3, 4, 5, 101, 102, 103, 104]
  );
});

test('an area watch across three areas totaling 36 facilities is capped at 20 and records a truncation', async () => {
  const areaCallLog: string[] = [];
  const listCallLog: number[] = [];
  const resolveArea = fakeResolveArea(areaCallLog, {
    'Area One': { recAreaId: 1, recAreaName: 'Area One', alternatives: [] },
    'Area Two': { recAreaId: 2, recAreaName: 'Area Two', alternatives: [] },
    'Area Three': { recAreaId: 3, recAreaName: 'Area Three', alternatives: [] },
  });
  const listAreaFacilities = fakeListAreaFacilities(listCallLog, {
    1: makeFacilities(12, 0),
    2: makeFacilities(12, 100),
    3: makeFacilities(12, 200),
  });
  const watches: Watch[] = [
    {
      type: 'area',
      id: 'aw1',
      areas: [{ name: 'Area One' }, { name: 'Area Two' }, { name: 'Area Three' }],
      dateRange: { start: '2026-09-04', end: '2026-09-07' },
      siteType: 'any',
    },
  ];
  const { resolved, truncations } = await resolveWatches(watches, {
    resolveArea,
    listAreaFacilities,
    logger: recordingLogger().logger,
  });
  assert.equal(resolved.length, AREA_FACILITY_CAP);
  assert.equal(truncations.length, 1);
  assert.deepEqual(truncations[0], { watchId: 'aw1', requested: 36, kept: 20 });
});

test('an area watch resolving to exactly 20 facilities produces 20 entries and no truncation', async () => {
  const listAreaFacilities = fakeListAreaFacilities([], { 1: makeFacilities(20) });
  const watches: Watch[] = [
    {
      type: 'area',
      id: 'aw1',
      areas: [{ name: 'Area One', recAreaId: 1 }],
      dateRange: { start: '2026-09-04', end: '2026-09-07' },
      siteType: 'any',
    },
  ];
  const { resolved, truncations } = await resolveWatches(watches, {
    listAreaFacilities,
    logger: recordingLogger().logger,
  });
  assert.equal(resolved.length, 20);
  assert.equal(truncations.length, 0);
});

test('a facility reachable from two areas in one watch is counted once (dedup) and requested counts it once', async () => {
  const listAreaFacilities = fakeListAreaFacilities([], {
    1: [{ facilityId: 999, facilityName: 'Shared', facilityType: 'standard' }, ...makeFacilities(2, 0)],
    2: [{ facilityId: 999, facilityName: 'Shared', facilityType: 'standard' }, ...makeFacilities(2, 50)],
  });
  const watches: Watch[] = [
    {
      type: 'area',
      id: 'aw1',
      areas: [
        { name: 'Area One', recAreaId: 1 },
        { name: 'Area Two', recAreaId: 2 },
      ],
      dateRange: { start: '2026-09-04', end: '2026-09-07' },
      siteType: 'any',
    },
  ];
  const { resolved } = await resolveWatches(watches, {
    listAreaFacilities,
    logger: recordingLogger().logger,
  });
  const sharedEntries = resolved.filter((r) => r.facilityId === 999);
  assert.equal(sharedEntries.length, 1);
  assert.equal(resolved.length, 5);
});

test('two watches naming the same area (case/whitespace differ) trigger exactly one resolveArea and one listAreaFacilities call', async () => {
  const areaCallLog: string[] = [];
  const listCallLog: number[] = [];
  const resolveArea = fakeResolveArea(areaCallLog, {
    'Sequoia National Forest': { recAreaId: 100, recAreaName: 'Sequoia National Forest', alternatives: [] },
  });
  const listAreaFacilities = fakeListAreaFacilities(listCallLog, { 100: makeFacilities(2) });
  const watches: Watch[] = [
    {
      type: 'area',
      id: 'aw1',
      areas: [{ name: 'Sequoia National Forest' }],
      dateRange: { start: '2026-09-04', end: '2026-09-07' },
      siteType: 'any',
    },
    {
      type: 'area',
      id: 'aw2',
      areas: [{ name: '  sequoia national forest  ' }],
      dateRange: { start: '2026-10-04', end: '2026-10-07' },
      siteType: 'any',
    },
  ];
  await resolveWatches(watches, { resolveArea, listAreaFacilities, logger: recordingLogger().logger });
  assert.equal(areaCallLog.length, 1);
  assert.equal(listCallLog.length, 1);
});

test('an area entry with recAreaId set does not call resolveArea but does call listAreaFacilities', async () => {
  const areaCallLog: string[] = [];
  const listCallLog: number[] = [];
  const resolveArea = fakeResolveArea(areaCallLog, {});
  const listAreaFacilities = fakeListAreaFacilities(listCallLog, { 1106: makeFacilities(2) });
  const watches: Watch[] = [
    {
      type: 'area',
      id: 'aw1',
      areas: [{ name: 'Some Area', recAreaId: 1106 }],
      dateRange: { start: '2026-09-04', end: '2026-09-07' },
      siteType: 'any',
    },
  ];
  await resolveWatches(watches, { resolveArea, listAreaFacilities, logger: recordingLogger().logger });
  assert.equal(areaCallLog.length, 0);
  assert.deepEqual(listCallLog, [1106]);
});

test('an area entry whose resolveArea rejects with RecAreaNotFoundError isolates to its own watch', async () => {
  const resolveArea = fakeResolveArea([], {
    'Good Area': { recAreaId: 1, recAreaName: 'Good Area', alternatives: [] },
  });
  const listAreaFacilities = fakeListAreaFacilities([], { 1: makeFacilities(2) });
  const watches: Watch[] = [
    {
      type: 'area',
      id: 'bad',
      areas: [{ name: 'Nonexistent Area' }],
      dateRange: { start: '2026-09-04', end: '2026-09-07' },
      siteType: 'any',
    },
    {
      type: 'area',
      id: 'good',
      areas: [{ name: 'Good Area' }],
      dateRange: { start: '2026-10-04', end: '2026-10-07' },
      siteType: 'any',
    },
  ];
  const { resolved, failures } = await resolveWatches(watches, {
    resolveArea,
    listAreaFacilities,
    logger: recordingLogger().logger,
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0]!.watchId, 'bad');
  assert.equal(resolved.filter((r) => r.id === 'bad').length, 0);
  assert.equal(resolved.filter((r) => r.id === 'good').length, 2);
});

test('an area watch resolving to zero facilities produces zero resolved entries and one failure mentioning no reservable campgrounds', async () => {
  const listAreaFacilities = fakeListAreaFacilities([], { 1: [] });
  const watches: Watch[] = [
    {
      type: 'area',
      id: 'aw1',
      areas: [{ name: 'Empty Area', recAreaId: 1 }],
      dateRange: { start: '2026-09-04', end: '2026-09-07' },
      siteType: 'any',
    },
  ];
  const { resolved, failures } = await resolveWatches(watches, {
    listAreaFacilities,
    logger: recordingLogger().logger,
  });
  assert.equal(resolved.length, 0);
  assert.equal(failures.length, 1);
  assert.match(failures[0]!.reason, /no reservable campgrounds/);
});

test('logger.warn is called with truncation text when the cap kicks in', async () => {
  const listAreaFacilities = fakeListAreaFacilities([], { 1: makeFacilities(36) });
  const watches: Watch[] = [
    {
      type: 'area',
      id: 'aw1',
      areas: [{ name: 'Big Area', recAreaId: 1 }],
      dateRange: { start: '2026-09-04', end: '2026-09-07' },
      siteType: 'any',
    },
  ];
  const { warn, logger } = recordingLogger();
  await resolveWatches(watches, { listAreaFacilities, logger });
  const truncationWarnings = warn.filter((w) => w.includes('showing 20 of 36'));
  assert.equal(truncationWarnings.length, 1);
});

test('logger.info includes exactly one "RIDB resolution calls this run:" line per run', async () => {
  const resolve = fakeResolve([], {
    'Some Park': { facilityId: 1, facilityName: 'Some Park', alternatives: [] },
  });
  const watches: Watch[] = [
    { type: 'facility', id: 'w1', parkName: 'Some Park', dateRange: { start: '2026-09-04', end: '2026-09-07' }, siteType: 'any' },
  ];
  const { info, logger } = recordingLogger();
  await resolveWatches(watches, { resolve, logger });
  const budgetLines = info.filter((m) => m.includes('RIDB resolution calls this run:'));
  assert.equal(budgetLines.length, 1);
});
