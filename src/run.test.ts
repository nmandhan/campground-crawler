import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, type RunDeps, type RunLogger } from './run.js';
import type { StateStore, StateEntry } from './state/store.js';
import { dedupKey } from './state/store.js';
import { FileStateStore } from './state/fileStore.js';
import type { ResolveResult } from './config/watches.js';
import type { RawAvailabilityResponse } from './recreation-gov/types.js';
import type { ResolvedWatch, MatchedSlot } from './types.js';
import { buildSubject, buildBody } from './notify/email.js';

function recordingNotifier(impl?: (m: MatchedSlot[]) => Promise<void>) {
  const calls: MatchedSlot[][] = [];
  return {
    calls,
    sendNotification: async (m: MatchedSlot[]) => {
      calls.push(m);
      if (impl) await impl(m);
    },
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cc-run-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function recordingLogger(): { logger: RunLogger; lines: string[] } {
  const lines: string[] = [];
  return {
    logger: {
      info: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(m),
      error: (m: string) => lines.push(m),
    },
    lines,
  };
}

class MemoryStateStore implements StateStore {
  private entries = new Map<string, StateEntry>();
  loadCalls = 0;
  saveCalls = 0;
  markNotifiedCalls: string[] = [];

  async load(): Promise<void> {
    this.loadCalls++;
  }
  has(key: string): boolean {
    return this.entries.has(key);
  }
  get(key: string): StateEntry | undefined {
    return this.entries.get(key);
  }
  markNotified(key: string, at: Date = new Date()): void {
    this.markNotifiedCalls.push(key);
    this.entries.set(key, { lastNotifiedAt: at.toISOString() });
  }
  async save(): Promise<void> {
    this.saveCalls++;
  }
}

function watch(id: string, parkName = 'Test Park'): ResolvedWatch {
  return {
    id,
    facilityId: 1,
    facilityName: parkName,
    facilityType: 'standard',
    dateRange: { start: '2026-09-04', end: '2026-09-07' },
    siteType: 'any',
  };
}

function fullyAvailableResponse(campsiteId: string, siteLabel: string): RawAvailabilityResponse {
  return {
    campsites: {
      [campsiteId]: {
        availabilities: {
          '2026-09-04T00:00:00Z': 'Available',
          '2026-09-05T00:00:00Z': 'Available',
          '2026-09-06T00:00:00Z': 'Available',
        },
        campsite_type: 'STANDARD NONELECTRIC',
        loop: 'A',
        site: siteLabel,
      },
    },
  };
}

function noAvailabilityResponse(): RawAvailabilityResponse {
  return {
    campsites: {
      '999': {
        availabilities: {
          '2026-09-04T00:00:00Z': 'Reserved',
          '2026-09-05T00:00:00Z': 'Reserved',
          '2026-09-06T00:00:00Z': 'Reserved',
        },
        campsite_type: 'STANDARD NONELECTRIC',
        loop: 'A',
        site: '999',
      },
    },
  };
}

function loadResolvedOf(
  resolved: ResolveResult['resolved'],
  failures: ResolveResult['failures'] = [],
  truncations: ResolveResult['truncations'] = []
) {
  return async (): Promise<ResolveResult> => ({ resolved, failures, truncations });
}

test('two watches, both fully available: checked=2, newMatches.length=2, two MATCH outcomes', async () => {
  const store = new MemoryStateStore();
  const { logger } = recordingLogger();
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([watch('w1'), watch('w2')]),
    fetchRange: async (facilityId) => [fullyAvailableResponse(`site-${facilityId}`, '001')],
    store,
    logger,
  };
  const summary = await run(deps);
  assert.equal(summary.checked, 2);
  assert.equal(summary.newMatches.length, 2);
  assert.equal(summary.outcomes.filter((o) => o.status === 'MATCH').length, 2);
});

test('a watch with no matching availability produces NO_MATCH and appears in summary.noMatch', async () => {
  const store = new MemoryStateStore();
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([watch('w1')]),
    fetchRange: async () => [noAvailabilityResponse()],
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  assert.deepEqual(summary.noMatch, ['w1']);
  assert.equal(summary.outcomes[0]!.status, 'NO_MATCH');
});

test('a watch whose fetch throws produces FAILED with non-empty reason, in summary.failed, not in noMatch', async () => {
  const store = new MemoryStateStore();
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([watch('w1')]),
    fetchRange: async () => {
      throw new Error('network boom');
    },
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.failed[0]!.watchId, 'w1');
  assert.ok(summary.failed[0]!.reason.length > 0);
  assert.equal(summary.noMatch.includes('w1'), false);
});

test('watch A fetch throws, watch B is still checked and can still MATCH (per-watch isolation)', async () => {
  const store = new MemoryStateStore();
  const w1 = { ...watch('w1'), facilityId: 11 };
  const w2 = { ...watch('w2'), facilityId: 22 };
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([w1, w2]),
    fetchRange: async (facilityId) => {
      if (facilityId === 11) throw new Error('boom for w1');
      return [fullyAvailableResponse('site-22', '001')];
    },
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  const w1Outcome = summary.outcomes.find((o) => o.watchId === 'w1')!;
  const w2Outcome = summary.outcomes.find((o) => o.watchId === 'w2')!;
  assert.equal(w1Outcome.status, 'FAILED');
  assert.equal(w2Outcome.status, 'MATCH');
});

test('a watch that failed to resolve appears in summary.failed and counts toward checked', async () => {
  const store = new MemoryStateStore();
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([watch('w2')], [{ watchId: 'w1', reason: 'no facility found' }]),
    fetchRange: async () => [fullyAvailableResponse('site-1', '001')],
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  assert.equal(summary.checked, 2);
  assert.ok(summary.failed.some((f) => f.watchId === 'w1'));
});

test('a match already present in state store is returned in suppressed, not newMatches', async () => {
  const store = new MemoryStateStore();
  const w = watch('w1');
  const key = dedupKey('w1', 'site-1', '2026-09-04', '2026-09-07');
  store.markNotified(key);
  store.markNotifiedCalls = []; // reset call tracking for the pre-seed
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([w]),
    fetchRange: async () => [fullyAvailableResponse('site-1', '001')],
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  assert.equal(summary.newMatches.length, 0);
  const outcome = summary.outcomes[0]!;
  assert.equal(outcome.status, 'MATCH');
  if (outcome.status === 'MATCH') {
    assert.equal(outcome.suppressed.length, 1);
    assert.equal(outcome.newMatches.length, 0);
  }
});

test('markNotified called with exactly dedupKey(...); store.save() called exactly once', async () => {
  const store = new MemoryStateStore();
  const w = watch('w1');
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([w]),
    fetchRange: async () => [fullyAvailableResponse('site-1', '001')],
    store,
    logger: recordingLogger().logger,
  };
  await run(deps);
  assert.deepEqual(store.markNotifiedCalls, [dedupKey('w1', 'site-1', '2026-09-04', '2026-09-07')]);
  assert.equal(store.saveCalls, 1);
});

test('running twice against a real FileStateStore: 1 new match then 0 new / 1 suppressed (OPS-01)', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'state.json');
    const w = watch('w1');
    const makeDeps = (): RunDeps => ({
      loadResolved: loadResolvedOf([w]),
      fetchRange: async () => [fullyAvailableResponse('site-1', '001')],
      store: new FileStateStore({ path }),
      logger: recordingLogger().logger,
    });

    const first = await run(makeDeps());
    assert.equal(first.newMatches.length, 1);

    const second = await run(makeDeps());
    assert.equal(second.newMatches.length, 0);
    const outcome = second.outcomes[0]!;
    assert.equal(outcome.status, 'MATCH');
    if (outcome.status === 'MATCH') {
      assert.equal(outcome.suppressed.length, 1);
    }
  });
});

test("watch A's state does not suppress watch B's identical site/date match (WATCH-02)", async () => {
  const store = new MemoryStateStore();
  const keyA = dedupKey('w1', 'site-1', '2026-09-04', '2026-09-07');
  store.markNotified(keyA);
  store.markNotifiedCalls = [];
  const w1 = watch('w1');
  const w2 = watch('w2');
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([w1, w2]),
    fetchRange: async () => [fullyAvailableResponse('site-1', '001')],
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  const w1Outcome = summary.outcomes.find((o) => o.watchId === 'w1')!;
  const w2Outcome = summary.outcomes.find((o) => o.watchId === 'w2')!;
  assert.equal(w1Outcome.status, 'MATCH');
  assert.equal(w2Outcome.status, 'MATCH');
  if (w1Outcome.status === 'MATCH') assert.equal(w1Outcome.newMatches.length, 0);
  if (w2Outcome.status === 'MATCH') assert.equal(w2Outcome.newMatches.length, 1);
});

test('one log line per watch, each starting with OK, NO MATCH, or FAILED and containing the watch id', async () => {
  const store = new MemoryStateStore();
  const { logger, lines } = recordingLogger();
  const w1 = { ...watch('w1'), facilityId: 11 };
  const w2 = { ...watch('w2'), facilityId: 22 };
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([w1, w2]),
    fetchRange: async (facilityId) => {
      if (facilityId === 11) return [noAvailabilityResponse()];
      throw new Error('boom');
    },
    store,
    logger,
  };
  await run(deps);
  assert.equal(lines.length, 2);
  assert.ok(lines.some((l) => l.startsWith('NO MATCH') && l.includes('w1')));
  assert.ok(lines.some((l) => l.startsWith('FAILED') && l.includes('w2')));
});

test('store.save() is still called when every watch failed', async () => {
  const store = new MemoryStateStore();
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([watch('w1'), watch('w2')]),
    fetchRange: async () => {
      throw new Error('boom');
    },
    store,
    logger: recordingLogger().logger,
  };
  await run(deps);
  assert.equal(store.saveCalls, 1);
});

test('run() never throws for per-watch errors; only propagates a fatal config-load error', async () => {
  const store = new MemoryStateStore();
  const deps: RunDeps = {
    loadResolved: async () => {
      throw new Error('fatal config error');
    },
    fetchRange: async () => [fullyAvailableResponse('site-1', '001')],
    store,
    logger: recordingLogger().logger,
  };
  await assert.rejects(() => run(deps), /fatal config error/);
});

test('two watches yielding 3 brand-new matches: notifier called exactly once with those 3 matches', async () => {
  const store = new MemoryStateStore();
  const notifier = recordingNotifier();
  const w1 = { ...watch('w1'), facilityId: 11 };
  const w2 = { ...watch('w2'), facilityId: 22 };
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([w1, w2]),
    fetchRange: async (facilityId) => {
      const nights = {
        '2026-09-04T00:00:00Z': 'Available',
        '2026-09-05T00:00:00Z': 'Available',
        '2026-09-06T00:00:00Z': 'Available',
      } as const;
      if (facilityId === 11) {
        return [
          {
            campsites: {
              'a1': { availabilities: { ...nights }, campsite_type: 'STANDARD NONELECTRIC', loop: 'A', site: '001' },
              'a2': { availabilities: { ...nights }, campsite_type: 'STANDARD NONELECTRIC', loop: 'A', site: '002' },
            },
          },
        ];
      }
      return [fullyAvailableResponse('a3', '003')];
    },
    store,
    logger: recordingLogger().logger,
    sendNotification: notifier.sendNotification,
  };
  const summary = await run(deps);
  assert.equal(notifier.calls.length, 1);
  assert.deepEqual(notifier.calls[0], summary.newMatches);
  assert.equal(summary.newMatches.length, 3);
});

test('all matches already suppressed: notifier is not called', async () => {
  const store = new MemoryStateStore();
  const key = dedupKey('w1', 'site-1', '2026-09-04', '2026-09-07');
  store.markNotified(key);
  store.markNotifiedCalls = [];
  const notifier = recordingNotifier();
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([watch('w1')]),
    fetchRange: async () => [fullyAvailableResponse('site-1', '001')],
    store,
    logger: recordingLogger().logger,
    sendNotification: notifier.sendNotification,
  };
  await run(deps);
  assert.equal(notifier.calls.length, 0);
});

test('all watches return NO_MATCH: notifier is not called', async () => {
  const store = new MemoryStateStore();
  const notifier = recordingNotifier();
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([watch('w1')]),
    fetchRange: async () => [noAvailabilityResponse()],
    store,
    logger: recordingLogger().logger,
    sendNotification: notifier.sendNotification,
  };
  await run(deps);
  assert.equal(notifier.calls.length, 0);
});

test('1 new + 1 suppressed match: notifier called once with only the new match', async () => {
  const store = new MemoryStateStore();
  const key = dedupKey('w1', 'site-1', '2026-09-04', '2026-09-07');
  store.markNotified(key);
  store.markNotifiedCalls = [];
  const notifier = recordingNotifier();
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([watch('w1')]),
    fetchRange: async () => {
      const a = fullyAvailableResponse('site-1', '001');
      const b = fullyAvailableResponse('site-2', '002');
      return [{ campsites: { ...a.campsites, ...b.campsites } }];
    },
    store,
    logger: recordingLogger().logger,
    sendNotification: notifier.sendNotification,
  };
  await run(deps);
  assert.equal(notifier.calls.length, 1);
  assert.equal(notifier.calls[0]!.length, 1);
  assert.equal(notifier.calls[0]![0]!.campsiteId, 'site-2');
});

test('a rejecting notifier leaves summary.failed empty and logs a notification failed line', async () => {
  const store = new MemoryStateStore();
  const { logger, lines } = recordingLogger();
  const notifier = recordingNotifier(async () => {
    throw new Error('resend down');
  });
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([watch('w1')]),
    fetchRange: async () => [fullyAvailableResponse('site-1', '001')],
    store,
    logger,
    sendNotification: notifier.sendNotification,
  };
  const summary = await run(deps);
  assert.deepEqual(summary.failed, []);
  assert.ok(lines.some((l) => l.includes('notification failed')));
});

test('notifier is invoked after store.save()', async () => {
  const store = new MemoryStateStore();
  let saveCallsAtNotify = -1;
  const notifier = recordingNotifier(async () => {
    saveCallsAtNotify = store.saveCalls;
  });
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([watch('w1')]),
    fetchRange: async () => [fullyAvailableResponse('site-1', '001')],
    store,
    logger: recordingLogger().logger,
    sendNotification: notifier.sendNotification,
  };
  await run(deps);
  assert.equal(saveCallsAtNotify, 1);
});

test('digest is sent for a new match and suppressed on the next cycle (NOTF-01/NOTF-03)', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'state.json');
    const notifier = recordingNotifier();
    const baseDeps = (responses: RawAvailabilityResponse[]): RunDeps => ({
      loadResolved: loadResolvedOf([watch('w1')]),
      fetchRange: async () => responses,
      store: new FileStateStore({ path }),
      logger: recordingLogger().logger,
      now: () => new Date('2026-08-22T00:00:00Z'),
      sendNotification: notifier.sendNotification,
    });

    // cycle 1
    await run(baseDeps([fullyAvailableResponse('12345', '012')]));
    // cycle 2 — identical input, new store instance reading the same file
    await run(baseDeps([fullyAvailableResponse('12345', '012')]));
    // cycle 3 — a second site appears
    const a = fullyAvailableResponse('12345', '012');
    const b = fullyAvailableResponse('12346', '013');
    await run(baseDeps([{ campsites: { ...a.campsites, ...b.campsites } }]));

    assert.equal(notifier.calls.length, 2);
    assert.equal(notifier.calls[0]!.length, 1);
    assert.equal(notifier.calls[0]![0]!.campsiteId, '12345');
    assert.equal(notifier.calls[1]!.length, 1);
    assert.equal(notifier.calls[1]![0]!.campsiteId, '12346');
    assert.equal(buildSubject(notifier.calls[0]!), '1 new campsite available: Test Park');
    assert.ok(buildBody(notifier.calls[0]!).includes('https://www.recreation.gov/camping/campsites/12345'));
  });
});

function areaFacility(id: string, facilityId: number, facilityName: string): ResolvedWatch {
  return {
    id,
    facilityId,
    facilityName,
    facilityType: 'standard',
    dateRange: { start: '2026-09-04', end: '2026-09-07' },
    siteType: 'any',
  };
}

test('three ResolvedWatch entries sharing id "sierra" produce exactly ONE outcome', async () => {
  const store = new MemoryStateStore();
  const sierra = [
    areaFacility('sierra', 1, 'Facility A'),
    areaFacility('sierra', 2, 'Facility B'),
    areaFacility('sierra', 3, 'Facility C'),
  ];
  const deps: RunDeps = {
    loadResolved: loadResolvedOf(sierra),
    fetchRange: async () => [noAvailabilityResponse()],
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  assert.equal(summary.outcomes.filter((o) => o.watchId === 'sierra').length, 1);
});

test('matches across a group\'s facilities aggregate into the single outcome, each retaining its own facility attribution', async () => {
  const store = new MemoryStateStore();
  const sierra = [
    areaFacility('sierra', 11, 'Facility A'),
    areaFacility('sierra', 22, 'Facility B'),
  ];
  const deps: RunDeps = {
    loadResolved: loadResolvedOf(sierra),
    fetchRange: async (facilityId) => [fullyAvailableResponse(`site-${facilityId}`, '001')],
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  const outcome = summary.outcomes.find((o) => o.watchId === 'sierra')!;
  assert.equal(outcome.status, 'MATCH');
  if (outcome.status === 'MATCH') {
    assert.equal(outcome.newMatches.length, 2);
    const facilityIds = outcome.newMatches.map((m) => m.facilityId).sort();
    assert.deepEqual(facilityIds, [11, 22]);
    const facilityNames = new Set(outcome.newMatches.map((m) => m.facilityName));
    assert.deepEqual([...facilityNames].sort(), ['Facility A', 'Facility B']);
  }
});

test('group members are polled in resolved order', async () => {
  const store = new MemoryStateStore();
  const calledOrder: number[] = [];
  const sierra = [
    areaFacility('sierra', 3, 'Facility C'),
    areaFacility('sierra', 1, 'Facility A'),
    areaFacility('sierra', 2, 'Facility B'),
  ];
  const deps: RunDeps = {
    loadResolved: loadResolvedOf(sierra),
    fetchRange: async (facilityId) => {
      calledOrder.push(facilityId);
      return [noAvailabilityResponse()];
    },
    store,
    logger: recordingLogger().logger,
  };
  await run(deps);
  assert.deepEqual(calledOrder, [3, 1, 2]);
});

test('a group where facility 2 of 3 rejects still yields MATCH from the others, plus facilityFailures', async () => {
  const store = new MemoryStateStore();
  const sierra = [
    areaFacility('sierra', 1, 'Facility A'),
    areaFacility('sierra', 2, 'Facility B'),
    areaFacility('sierra', 3, 'Facility C'),
  ];
  const deps: RunDeps = {
    loadResolved: loadResolvedOf(sierra),
    fetchRange: async (facilityId) => {
      if (facilityId === 2) throw new Error('boom for facility B');
      return [fullyAvailableResponse(`site-${facilityId}`, '001')];
    },
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  const outcome = summary.outcomes.find((o) => o.watchId === 'sierra')!;
  assert.equal(outcome.status, 'MATCH');
  if (outcome.status === 'MATCH') {
    assert.deepEqual(outcome.facilityFailures, [
      { facilityId: 2, facilityName: 'Facility B', reason: outcome.facilityFailures![0]!.reason },
    ]);
    assert.ok(outcome.facilityFailures![0]!.reason.length > 0);
  }
});

test('a group where facility 2 of 3 rejects and the others match nothing yields NO_MATCH with the same facilityFailures', async () => {
  const store = new MemoryStateStore();
  const sierra = [
    areaFacility('sierra', 1, 'Facility A'),
    areaFacility('sierra', 2, 'Facility B'),
    areaFacility('sierra', 3, 'Facility C'),
  ];
  const deps: RunDeps = {
    loadResolved: loadResolvedOf(sierra),
    fetchRange: async (facilityId) => {
      if (facilityId === 2) throw new Error('boom for facility B');
      return [noAvailabilityResponse()];
    },
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  const outcome = summary.outcomes.find((o) => o.watchId === 'sierra')!;
  assert.equal(outcome.status, 'NO_MATCH');
  if (outcome.status === 'NO_MATCH') {
    assert.equal(outcome.facilityFailures?.length, 1);
    assert.equal(outcome.facilityFailures?.[0]?.facilityId, 2);
  }
});

test('a group where ALL facilities reject yields FAILED with a reason and a facilityFailures entry per facility', async () => {
  const store = new MemoryStateStore();
  const sierra = [
    areaFacility('sierra', 1, 'Facility A'),
    areaFacility('sierra', 2, 'Facility B'),
  ];
  const deps: RunDeps = {
    loadResolved: loadResolvedOf(sierra),
    fetchRange: async () => {
      throw new Error('boom');
    },
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  const outcome = summary.outcomes.find((o) => o.watchId === 'sierra')!;
  assert.equal(outcome.status, 'FAILED');
  if (outcome.status === 'FAILED') {
    assert.ok(outcome.reason.length > 0);
    assert.equal(outcome.facilityFailures?.length, 2);
  }
});

test('an outcome with zero facility failures has no facilityFailures key', async () => {
  const store = new MemoryStateStore();
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([watch('w1')]),
    fetchRange: async () => [fullyAvailableResponse('site-1', '001')],
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  const outcome = summary.outcomes[0]!;
  assert.equal('facilityFailures' in outcome, false);
});

test('loadResolved returning truncations puts truncated on the matching outcome regardless of status', async () => {
  const store = new MemoryStateStore();
  const deps: RunDeps = {
    loadResolved: loadResolvedOf(
      [areaFacility('sierra', 1, 'Facility A')],
      [],
      [{ watchId: 'sierra', requested: 36, kept: 20 }]
    ),
    fetchRange: async () => [noAvailabilityResponse()],
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  const outcome = summary.outcomes.find((o) => o.watchId === 'sierra')!;
  assert.deepEqual(outcome.truncated, { requested: 36, kept: 20 });
});

test('a watch id present in truncations but absent from resolved still gets truncated on its FAILED outcome', async () => {
  const store = new MemoryStateStore();
  const deps: RunDeps = {
    loadResolved: loadResolvedOf(
      [],
      [{ watchId: 'sierra', reason: 'all areas failed to resolve' }],
      [{ watchId: 'sierra', requested: 36, kept: 20 }]
    ),
    fetchRange: async () => [noAvailabilityResponse()],
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  const outcome = summary.outcomes.find((o) => o.watchId === 'sierra')!;
  assert.equal(outcome.status, 'FAILED');
  assert.deepEqual(outcome.truncated, { requested: 36, kept: 20 });
});

test('a single-facility watch produces an outcome with no truncated and no facilityFailures keys', async () => {
  const store = new MemoryStateStore();
  const deps: RunDeps = {
    loadResolved: loadResolvedOf([watch('w1')]),
    fetchRange: async () => [fullyAvailableResponse('site-1', '001')],
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  const outcome = summary.outcomes[0]!;
  assert.equal('truncated' in outcome, false);
  assert.equal('facilityFailures' in outcome, false);
});

test('checked equals the number of distinct watches attempted, not the facility count', async () => {
  const store = new MemoryStateStore();
  const sierra = [
    areaFacility('sierra', 1, 'Facility A'),
    areaFacility('sierra', 2, 'Facility B'),
    areaFacility('sierra', 3, 'Facility C'),
  ];
  const deps: RunDeps = {
    loadResolved: loadResolvedOf(
      [...sierra, watch('w1')],
      [{ watchId: 'w2', reason: 'failed to resolve' }]
    ),
    fetchRange: async () => [noAvailabilityResponse()],
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  assert.equal(summary.checked, 3);
});

test('a suppressed match from facility A is not re-notified when facility B also reports it', async () => {
  const store = new MemoryStateStore();
  const key = dedupKey('sierra', 'shared-site', '2026-09-04', '2026-09-07');
  store.markNotified(key);
  store.markNotifiedCalls = [];
  const sierra = [
    areaFacility('sierra', 1, 'Facility A'),
    areaFacility('sierra', 2, 'Facility B'),
  ];
  const deps: RunDeps = {
    loadResolved: loadResolvedOf(sierra),
    fetchRange: async () => [fullyAvailableResponse('shared-site', '001')],
    store,
    logger: recordingLogger().logger,
  };
  const summary = await run(deps);
  const outcome = summary.outcomes.find((o) => o.watchId === 'sierra')!;
  assert.equal(outcome.status, 'MATCH');
  if (outcome.status === 'MATCH') {
    assert.equal(outcome.newMatches.length, 0);
    assert.equal(outcome.suppressed.length, 2);
  }
});

test('the NO_MATCH log line still reports a night count for a group watch', async () => {
  const store = new MemoryStateStore();
  const { logger, lines } = recordingLogger();
  const sierra = [
    areaFacility('sierra', 1, 'Facility A'),
    areaFacility('sierra', 2, 'Facility B'),
  ];
  const deps: RunDeps = {
    loadResolved: loadResolvedOf(sierra),
    fetchRange: async () => [noAvailabilityResponse()],
    store,
    logger,
  };
  await run(deps);
  assert.ok(lines.some((l) => l.startsWith('NO MATCH') && l.includes('sierra') && /checked \d+ nights/.test(l)));
});
