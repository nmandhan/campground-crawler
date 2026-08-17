import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStateStore, FileStateStore, DEFAULT_STATE_PATH } from './fileStore.js';
import { dedupKey } from './store.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cc-state-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function recordingLogger() {
  const warnings: string[] = [];
  return { logger: { warn: (m: string) => warnings.push(m) }, warnings };
}

test('DEFAULT_STATE_PATH is state.json', () => {
  assert.equal(DEFAULT_STATE_PATH, 'state.json');
});

test('load() on a nonexistent path leaves the store empty and does not throw', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'nope.json');
    const store = createFileStateStore({ path });
    await assert.doesNotReject(() => store.load());
    const key = dedupKey('watch-a', '123', '2026-09-01', '2026-09-04');
    assert.equal(store.has(key), false);
  });
});

test('load() on invalid JSON leaves the store empty, does not throw, and logs a warning', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'state.json');
    await writeFile(path, '{ not valid json', 'utf8');
    const { logger, warnings } = recordingLogger();
    const store = createFileStateStore({ path, logger });
    await assert.doesNotReject(() => store.load());
    assert.equal(warnings.length, 1);
    const key = dedupKey('watch-a', '123', '2026-09-01', '2026-09-04');
    assert.equal(store.has(key), false);
  });
});

test('load() on JSON that does not match StateFile shape behaves like corrupt (empty + logged)', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'state.json');
    await writeFile(path, JSON.stringify({ foo: 'bar' }), 'utf8');
    const { logger, warnings } = recordingLogger();
    const store = createFileStateStore({ path, logger });
    await store.load();
    assert.equal(warnings.length, 1);
    assert.equal(store.has('any-key'), false);
  });
});

test('markNotified(key) then has(key) is true; has(other) is false', async () => {
  await withTempDir(async (dir) => {
    const store = createFileStateStore({ path: join(dir, 'state.json') });
    await store.load();
    const key = dedupKey('watch-a', '123', '2026-09-01', '2026-09-04');
    store.markNotified(key);
    assert.equal(store.has(key), true);
    assert.equal(store.has('other'), false);
  });
});

test('markNotified sets lastNotifiedAt to an ISO 8601 string; an explicit Date is used verbatim', async () => {
  await withTempDir(async (dir) => {
    const store = createFileStateStore({ path: join(dir, 'state.json') });
    await store.load();
    const key = dedupKey('watch-a', '123', '2026-09-01', '2026-09-04');
    const explicit = new Date('2026-01-01T00:00:00.000Z');
    store.markNotified(key, explicit);
    assert.equal(store.get(key)?.lastNotifiedAt, explicit.toISOString());
  });
});

test('save() then a fresh store load() from the same path returns has(key) === true', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'state.json');
    const key = dedupKey('watch-a', '123', '2026-09-01', '2026-09-04');

    const store1 = createFileStateStore({ path });
    await store1.load();
    store1.markNotified(key);
    await store1.save();

    const store2 = createFileStateStore({ path });
    await store2.load();
    assert.equal(store2.has(key), true);
  });
});

test('the persisted file matches the StateFile shape, pretty-printed with a trailing newline', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'state.json');
    const key = dedupKey('watch-a', '123', '2026-09-01', '2026-09-04');
    const store = createFileStateStore({ path });
    await store.load();
    store.markNotified(key, new Date('2026-01-01T00:00:00.000Z'));
    await store.save();

    const raw = await readFile(path, 'utf8');
    assert.ok(raw.endsWith('\n'));
    assert.equal(raw, JSON.stringify(raw.length ? JSON.parse(raw) : {}, null, 2) + '\n');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.version, 1);
    assert.deepEqual(parsed.entries[key], { lastNotifiedAt: '2026-01-01T00:00:00.000Z' });
  });
});

test('keys for two watchIds with the same campsiteId and dates coexist independently (WATCH-02)', async () => {
  await withTempDir(async (dir) => {
    const store = createFileStateStore({ path: join(dir, 'state.json') });
    await store.load();
    const keyA = dedupKey('watch-a', '123', '2026-09-01', '2026-09-04');
    const keyB = dedupKey('watch-b', '123', '2026-09-01', '2026-09-04');
    store.markNotified(keyA);
    assert.equal(store.has(keyA), true);
    assert.equal(store.has(keyB), false);
  });
});

test('keys for the same watch+site but different date ranges coexist independently (D-08)', async () => {
  await withTempDir(async (dir) => {
    const store = createFileStateStore({ path: join(dir, 'state.json') });
    await store.load();
    const key1 = dedupKey('watch-a', '123', '2026-09-01', '2026-09-04');
    const key2 = dedupKey('watch-a', '123', '2026-10-01', '2026-10-04');
    store.markNotified(key1);
    assert.equal(store.has(key1), true);
    assert.equal(store.has(key2), false);
  });
});

test('save() creates parent directories if they do not exist', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'nested', 'deeper', 'state.json');
    const store = createFileStateStore({ path });
    await store.load();
    store.markNotified(dedupKey('watch-a', '123', '2026-09-01', '2026-09-04'));
    await assert.doesNotReject(() => store.save());
    const raw = await readFile(path, 'utf8');
    assert.ok(raw.length > 0);
  });
});

test('save() writes atomically via a .tmp file + rename', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'state.json');
    const store = createFileStateStore({ path });
    await store.load();
    store.markNotified(dedupKey('watch-a', '123', '2026-09-01', '2026-09-04'));
    await store.save();
    // The .tmp file must not remain after a successful save.
    await assert.rejects(() => readFile(path + '.tmp', 'utf8'));
  });
});

test('two sequential save() calls produce a valid file both times', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'state.json');
    const store = createFileStateStore({ path });
    await store.load();
    store.markNotified(dedupKey('watch-a', '123', '2026-09-01', '2026-09-04'));
    await store.save();
    store.markNotified(dedupKey('watch-b', '123', '2026-09-01', '2026-09-04'));
    await store.save();

    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(Object.keys(parsed.entries).length, 2);
  });
});

test('FileStateStore is exported as a class type', () => {
  const store = new FileStateStore();
  assert.ok(typeof store.load === 'function');
});
