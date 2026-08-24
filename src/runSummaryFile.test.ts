import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeRunSummaryFile } from './runSummaryFile.js';
import type { RunSummary } from './types.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'runsummary-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function buildSummary(): RunSummary {
  return {
    startedAt: '2026-08-24T10:00:00.000Z',
    finishedAt: '2026-08-24T10:00:05.000Z',
    checked: 3,
    outcomes: [
      {
        watchId: 'kirk-creek',
        status: 'MATCH',
        newMatches: [
          {
            watchId: 'kirk-creek',
            campsiteId: '12345',
            siteLabel: '001',
            loop: 'Loop A',
            siteType: 'tent',
            facilityId: 232447,
            facilityName: 'Kirk Creek Campground',
            startDate: '2026-10-05',
            endDate: '2026-10-07',
            bookingUrl: 'https://www.recreation.gov/camping/campsites/12345',
          },
        ],
        suppressed: [],
      },
      { watchId: 'upper-pines-labor-day', status: 'NO_MATCH' },
      { watchId: 'broken-watch', status: 'FAILED', reason: 'RIDB request timed out' },
    ],
    newMatches: [
      {
        watchId: 'kirk-creek',
        campsiteId: '12345',
        siteLabel: '001',
        loop: 'Loop A',
        siteType: 'tent',
        facilityId: 232447,
        facilityName: 'Kirk Creek Campground',
        startDate: '2026-10-05',
        endDate: '2026-10-07',
        bookingUrl: 'https://www.recreation.gov/camping/campsites/12345',
      },
    ],
    failed: [{ watchId: 'broken-watch', reason: 'RIDB request timed out' }],
    noMatch: ['upper-pines-labor-day'],
  };
}

test('writeRunSummaryFile writes a file whose parsed content deep-equals the summary', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'run-summary.json');
    const summary = buildSummary();
    await writeRunSummaryFile(summary, path);
    const content = await readFile(path, 'utf8');
    assert.deepEqual(JSON.parse(content), summary);
  });
});

test('writeRunSummaryFile writes with trailing newline and 2-space indentation', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'run-summary.json');
    await writeRunSummaryFile(buildSummary(), path);
    const content = await readFile(path, 'utf8');
    assert.ok(content.endsWith('\n'), 'expected trailing newline');
    assert.ok(content.includes('\n  "startedAt"'), 'expected 2-space indentation');
  });
});

test('writeRunSummaryFile leaves no .tmp file after a successful write', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'run-summary.json');
    await writeRunSummaryFile(buildSummary(), path);
    assert.equal(existsSync(`${path}.tmp`), false);
  });
});

test('writeRunSummaryFile resolves without creating a file when path is undefined', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'run-summary.json');
    await writeRunSummaryFile(buildSummary(), undefined);
    assert.equal(existsSync(path), false);
  });
});

test('writeRunSummaryFile resolves without creating a file when path is empty string', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'run-summary.json');
    await writeRunSummaryFile(buildSummary(), '');
    assert.equal(existsSync(path), false);
  });
});

test('writeRunSummaryFile creates not-yet-existing nested directories', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'nested', 'deep', 'run-summary.json');
    const summary = buildSummary();
    await writeRunSummaryFile(summary, path);
    const content = await readFile(path, 'utf8');
    assert.deepEqual(JSON.parse(content), summary);
  });
});
