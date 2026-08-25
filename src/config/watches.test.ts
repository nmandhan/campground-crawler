import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWatches, resolveWatches, DEFAULT_WATCHES_PATH } from './watches.js';
import type { Watch } from '../types.js';
import type { ResolvedFacility } from '../recreation-gov/client.js';
import { FacilityNotFoundError } from '../errors.js';

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
  assert.equal(info.length, 1);
  assert.match(info[0]!, /resolved "Upper Pines Campground" -> facility 100 \(Upper Pines\)/);
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
