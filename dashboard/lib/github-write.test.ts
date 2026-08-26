import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getWatchesFile, putWatchesFile, commitWatches } from './github-write';
import type { Watch } from './types';

const sampleWatches: Watch[] = [
  {
    type: 'facility',
    id: 'kirk-creek',
    parkName: 'Kirk Creek Campground',
    dateRange: { start: '2026-09-01', end: '2026-09-03' },
    siteType: 'any',
  },
];

function b64(s: string): string {
  return Buffer.from(s).toString('base64');
}

function fakeResponse(status: number, jsonBody: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => jsonBody,
  } as unknown as Response;
}

describe('getWatchesFile', () => {
  it('returns { ok: true, watches, sha } on a 200 response', async () => {
    const content = b64(JSON.stringify(sampleWatches));
    const fetchImpl = (async () => fakeResponse(200, { sha: 'abc123', content, encoding: 'base64' })) as unknown as typeof fetch;
    const result = await getWatchesFile({ fetchImpl, token: 'test-token' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.sha, 'abc123');
      assert.deepEqual(result.watches, sampleWatches);
    }
  });

  it('returns { ok: false, error } on HTTP 404 and does not throw', async () => {
    const fetchImpl = (async () => fakeResponse(404, {})) as unknown as typeof fetch;
    const result = await getWatchesFile({ fetchImpl, token: 'test-token' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, 'GET watches.json: HTTP 404');
    }
  });

  it('returns { ok: false, error } when decoded content is not a JSON array', async () => {
    const content = b64(JSON.stringify({ not: 'an array' }));
    const fetchImpl = (async () => fakeResponse(200, { sha: 'abc123', content, encoding: 'base64' })) as unknown as typeof fetch;
    const result = await getWatchesFile({ fetchImpl, token: 'test-token' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error.length > 0);
    }
  });

  it('returns { ok: false, error } on a thrown network error and does not throw', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const result = await getWatchesFile({ fetchImpl, token: 'test-token' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error.length > 0);
    }
  });
});

describe('putWatchesFile', () => {
  it('returns { ok: true } on 200', async () => {
    const fetchImpl = (async () => fakeResponse(200, {})) as unknown as typeof fetch;
    const result = await putWatchesFile(sampleWatches, 'sha1', 'msg', { fetchImpl, token: 'test-token' });
    assert.deepEqual(result, { ok: true });
  });

  it('returns { ok: false, conflict: true, error: "sha mismatch" } on 409', async () => {
    const fetchImpl = (async () => fakeResponse(409, {})) as unknown as typeof fetch;
    const result = await putWatchesFile(sampleWatches, 'sha1', 'msg', { fetchImpl, token: 'test-token' });
    assert.deepEqual(result, { ok: false, conflict: true, error: 'sha mismatch' });
  });

  it('returns { ok: false, conflict: false, error } on 403', async () => {
    const fetchImpl = (async () => fakeResponse(403, {})) as unknown as typeof fetch;
    const result = await putWatchesFile(sampleWatches, 'sha1', 'msg', { fetchImpl, token: 'test-token' });
    assert.deepEqual(result, { ok: false, conflict: false, error: 'PUT watches.json: HTTP 403' });
  });

  it('sends a base64 body that decodes to JSON.stringify(watches, null, 2) + "\\n"', async () => {
    let capturedBody: string | undefined;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return fakeResponse(200, {});
    }) as unknown as typeof fetch;
    await putWatchesFile(sampleWatches, 'sha1', 'msg', { fetchImpl, token: 'test-token' });
    assert.ok(capturedBody);
    const parsedBody = JSON.parse(capturedBody!) as { content: string };
    const decoded = Buffer.from(parsedBody.content, 'base64').toString('utf8');
    assert.equal(decoded, JSON.stringify(sampleWatches, null, 2) + '\n');
  });
});

describe('commitWatches', () => {
  it('retries once on a 409, calling GET twice / mutate twice / PUT twice, returning ok', async () => {
    let getCalls = 0;
    let putCalls = 0;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        getCalls += 1;
        return fakeResponse(200, {
          sha: `sha-${getCalls}`,
          content: b64(JSON.stringify(sampleWatches)),
          encoding: 'base64',
        });
      }
      putCalls += 1;
      if (putCalls === 1) return fakeResponse(409, {});
      return fakeResponse(200, {});
    }) as unknown as typeof fetch;

    let mutateCalls = 0;
    const mutate = (current: Watch[]) => {
      mutateCalls += 1;
      return { ok: true as const, next: [...current] };
    };

    const result = await commitWatches(mutate, 'msg', { fetchImpl, token: 'test-token' });
    assert.deepEqual(result, { ok: true });
    assert.equal(getCalls, 2);
    assert.equal(putCalls, 2);
    assert.equal(mutateCalls, 2);
  });

  it('makes exactly 2 PUT attempts on a repeated 409 and returns a concurrent-change error', async () => {
    let putCalls = 0;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return fakeResponse(200, {
          sha: 'sha-x',
          content: b64(JSON.stringify(sampleWatches)),
          encoding: 'base64',
        });
      }
      putCalls += 1;
      return fakeResponse(409, {});
    }) as unknown as typeof fetch;

    const mutate = (current: Watch[]) => ({ ok: true as const, next: [...current] });
    const result = await commitWatches(mutate, 'msg', { fetchImpl, token: 'test-token' });
    assert.equal(putCalls, 2);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /concurrent|changed while saving/);
    }
  });

  it('short-circuits when mutate returns { ok: false, error }: PUT never called', async () => {
    let putCalls = 0;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return fakeResponse(200, {
          sha: 'sha-x',
          content: b64(JSON.stringify(sampleWatches)),
          encoding: 'base64',
        });
      }
      putCalls += 1;
      return fakeResponse(200, {});
    }) as unknown as typeof fetch;

    const mutate = () => ({ ok: false as const, error: 'duplicate id' });
    const result = await commitWatches(mutate, 'msg', { fetchImpl, token: 'test-token' });
    assert.deepEqual(result, { ok: false, error: 'duplicate id' });
    assert.equal(putCalls, 0);
  });
});
