/** Shared retry/backoff + hardened JSON fetch helper for both Recreation.gov
 *  data sources (RIDB + the undocumented availability endpoint). This is the
 *  only module that constructs outbound requests to recreation.gov/ridb.
 *
 *  T-02-01 mitigation: fetchJson explicitly checks content-type BEFORE calling
 *  res.json(), so a WAF/CDN HTML error page never surfaces as an opaque
 *  SyntaxError — it's converted into a clearly-labelled BlockedError instead.
 */

import { HttpError, BlockedError } from '../errors.js';

/** Realistic browser headers — generic Node/fetch User-Agents are the top
 *  reported cause of silent 403s against the undocumented availability
 *  endpoint (RESEARCH Pitfall 2). */
export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Referer: 'https://www.recreation.gov/',
  Accept: 'application/json',
};

export interface RetryOptions {
  /** Max retry attempts after the initial call. Default 3 (D-05). */
  retries?: number;
  /** Base backoff in ms; delay = baseMs * 2 ** attempt. Default 1000 (1s/2s/4s). */
  baseMs?: number;
  /** Injectable sleep so tests run instantly. Default: real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable retryability classifier. Default: see defaultIsRetryable below. */
  isRetryable?: (err: unknown) => boolean;
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** RESEARCH Pitfall 4: retrying a 404 or other non-retryable 4xx just wastes
 *  time and muddies logs. Only retry things that might succeed on a later attempt. */
function defaultIsRetryable(err: unknown): boolean {
  if (err instanceof BlockedError) return false;
  if (err instanceof HttpError) {
    if (err.status === 429) return true;
    if (err.status >= 500) return true;
    return false; // other 4xx: not retryable
  }
  return true; // network errors, timeouts, etc.
}

/** D-05: up to 3 retries, exponential backoff 1s/2s/4s, with retryability
 *  classification so non-retryable errors (bad facility ID, WAF block) fail fast. */
export async function retryWithBackoff<T>(fn: () => Promise<T>, opts?: RetryOptions): Promise<T> {
  const retries = opts?.retries ?? 3;
  const baseMs = opts?.baseMs ?? 1000;
  const sleep = opts?.sleep ?? defaultSleep;
  const isRetryable = opts?.isRetryable ?? defaultIsRetryable;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries || !isRetryable(err)) break;
      await sleep(baseMs * 2 ** attempt); // 1000, 2000, 4000
    }
  }
  throw lastError;
}

/** One hardened request — no retry logic inside; callers wrap this in
 *  retryWithBackoff. Never logs or embeds request headers in thrown messages
 *  (threat T-02-02: an apikey header must never leak into an error string). */
export async function fetchJson(
  url: string,
  init?: { headers?: Record<string, string>; fetchImpl?: typeof fetch }
): Promise<unknown> {
  const doFetch = init?.fetchImpl ?? globalThis.fetch;
  const res = await doFetch(url, {
    headers: { ...BROWSER_HEADERS, ...init?.headers },
  });

  if (!res.ok) {
    throw new HttpError(`request failed: ${res.status} ${res.statusText}`, res.status, url);
  }

  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('json')) {
    throw new BlockedError(
      `expected JSON but got "${contentType}" from ${url} (likely User-Agent/WAF block)`,
      url
    );
  }

  try {
    return await res.json();
  } catch {
    throw new BlockedError(`malformed JSON body from ${url}`, url);
  }
}
