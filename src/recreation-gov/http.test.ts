import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryWithBackoff, fetchJson, BROWSER_HEADERS } from './http.js';
import { HttpError, BlockedError } from '../errors.js';

// ---------- retryWithBackoff ----------

test('retryWithBackoff: succeeds on first call, calls fn exactly once', async () => {
  let calls = 0;
  const result = await retryWithBackoff(async () => {
    calls += 1;
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('retryWithBackoff: throws twice then succeeds, calls fn 3 times and returns value', async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await retryWithBackoff(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error('transient');
      return 'ok';
    },
    { sleep: async (ms) => { delays.push(ms); } }
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test('retryWithBackoff: always throws, calls fn 4 times (1 initial + 3 retries) and rethrows last error', async () => {
  let calls = 0;
  const delays: number[] = [];
  await assert.rejects(
    retryWithBackoff(
      async () => {
        calls += 1;
        throw new Error(`fail-${calls}`);
      },
      { sleep: async (ms) => { delays.push(ms); } }
    ),
    /fail-4/
  );
  assert.equal(calls, 4);
});

test('retryWithBackoff: sleep delays follow 1000ms, 2000ms, 4000ms', async () => {
  const delays: number[] = [];
  await assert.rejects(
    retryWithBackoff(
      async () => {
        throw new Error('always fails');
      },
      { sleep: async (ms) => { delays.push(ms); } }
    )
  );
  assert.deepEqual(delays, [1000, 2000, 4000]);
});

test('retryWithBackoff: HttpError with status 404 is NOT retried (called exactly once)', async () => {
  let calls = 0;
  await assert.rejects(
    retryWithBackoff(
      async () => {
        calls += 1;
        throw new HttpError('not found', 404, 'https://example.com');
      },
      { sleep: async () => {} }
    )
  );
  assert.equal(calls, 1);
});

test('retryWithBackoff: HttpError with status 429 IS retried', async () => {
  let calls = 0;
  await assert.rejects(
    retryWithBackoff(
      async () => {
        calls += 1;
        throw new HttpError('rate limited', 429, 'https://example.com');
      },
      { sleep: async () => {} }
    )
  );
  assert.equal(calls, 4);
});

test('retryWithBackoff: HttpError with status 503 IS retried', async () => {
  let calls = 0;
  await assert.rejects(
    retryWithBackoff(
      async () => {
        calls += 1;
        throw new HttpError('unavailable', 503, 'https://example.com');
      },
      { sleep: async () => {} }
    )
  );
  assert.equal(calls, 4);
});

test('retryWithBackoff: BlockedError is NOT retried', async () => {
  let calls = 0;
  await assert.rejects(
    retryWithBackoff(
      async () => {
        calls += 1;
        throw new BlockedError('blocked', 'https://example.com');
      },
      { sleep: async () => {} }
    )
  );
  assert.equal(calls, 1);
});

// ---------- fetchJson ----------

function fakeFetch(response: Response): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

test('fetchJson: a 200 response with content-type application/json returns the parsed body', async () => {
  const body = { hello: 'world' };
  const res = new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const result = await fetchJson('https://example.com/api', { fetchImpl: fakeFetch(res) });
  assert.deepEqual(result, body);
});

test('fetchJson: a 500 response throws HttpError with status === 500', async () => {
  const res = new Response('server error', { status: 500 });
  await assert.rejects(
    fetchJson('https://example.com/api', { fetchImpl: fakeFetch(res) }),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 500);
      return true;
    }
  );
});

test('fetchJson: a 200 response with content-type text/html throws BlockedError mentioning the URL', async () => {
  const res = new Response('<html>blocked</html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
  await assert.rejects(
    fetchJson('https://example.com/api', { fetchImpl: fakeFetch(res) }),
    (err: unknown) => {
      assert.ok(err instanceof BlockedError);
      assert.match(err.message, /https:\/\/example\.com\/api/);
      return true;
    }
  );
});

test('fetchJson: a 200 response with json content-type but unparseable body throws BlockedError/HttpError, not a raw SyntaxError', async () => {
  const res = new Response('not valid json{{{', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  await assert.rejects(
    fetchJson('https://example.com/api', { fetchImpl: fakeFetch(res) }),
    (err: unknown) => {
      assert.ok(err instanceof BlockedError || err instanceof HttpError);
      assert.ok(!(err instanceof SyntaxError));
      return true;
    }
  );
});

test('fetchJson: every outgoing request carries User-Agent, Referer, and Accept headers', async () => {
  let capturedHeaders: Headers | undefined;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    capturedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  await fetchJson('https://example.com/api', { fetchImpl });
  assert.ok(capturedHeaders);
  assert.equal(capturedHeaders!.get('User-Agent'), BROWSER_HEADERS['User-Agent']);
  assert.equal(capturedHeaders!.get('Referer'), 'https://www.recreation.gov/');
  assert.equal(capturedHeaders!.get('Accept'), 'application/json');
});
