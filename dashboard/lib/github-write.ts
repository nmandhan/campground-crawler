/** Authenticated writes of watches.json through the GitHub Contents API.
 *
 *  The Contents API, not raw.githubusercontent.com (which lib/github.ts uses for reads):
 *  raw content is read-only and has no sha/optimistic-concurrency story. A PUT here needs
 *  the fine-grained PAT, so this module — unlike its read-path sibling — DOES read a
 *  credential, and must therefore never be imported from a 'use client' component
 *  (RESEARCH.md Security Domain: PAT must not reach the client bundle, threat T-05-04).
 *
 *  The path is hardcoded, not a parameter, for the same reason github.ts uses a DataFile
 *  allowlist: this must never become a general-purpose GitHub write proxy.
 */

import 'server-only';
import type { Watch } from './types';

// Hardcoded, not built from a caller-supplied path parameter (T-05-01): this must never
// become a general-purpose repo-write proxy.
const CONTENTS_URL = 'https://api.github.com/repos/nmandhan/campground-crawler/contents/watches.json';

export interface WriteOptions {
  /** Injected for tests; defaults to global fetch. Mirrors ClientOptions.fetchImpl in
   *  src/recreation-gov/client.ts so this module is unit-testable without a network. */
  fetchImpl?: typeof fetch;
  token?: string;
}

export type GetWatchesResult =
  | { ok: true; watches: Watch[]; sha: string }
  | { ok: false; error: string };

export type PutWatchesResult =
  | { ok: true }
  | { ok: false; conflict: boolean; error: string };

export type CommitResult = { ok: true } | { ok: false; error: string };

/** Applies the create/edit/delete diff. Returns a non-throwing result so a business-rule
 *  failure (duplicate id, watch not found) short-circuits before any PUT is attempted. */
export type WatchesMutator = (
  current: Watch[]
) => { ok: true; next: Watch[] } | { ok: false; error: string };

function headers(opts?: WriteOptions): Record<string, string> {
  const token = opts?.token ?? process.env.GITHUB_WRITE_TOKEN ?? '';
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export async function getWatchesFile(opts?: WriteOptions): Promise<GetWatchesResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(CONTENTS_URL, {
      headers: headers(opts),
      // Never serve a stale sha for a write path.
      cache: 'no-store',
    });
    if (!res.ok) {
      return { ok: false, error: `GET watches.json: HTTP ${res.status}` };
    }
    const body = (await res.json()) as { sha: string; content: string; encoding: string };
    const decoded = Buffer.from(body.content, 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    if (!Array.isArray(parsed)) {
      return { ok: false, error: 'watches.json is not a JSON array' };
    }
    return { ok: true, watches: parsed as Watch[], sha: body.sha };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function putWatchesFile(
  watches: Watch[],
  sha: string,
  message: string,
  opts?: WriteOptions
): Promise<PutWatchesResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  try {
    const content = Buffer.from(JSON.stringify(watches, null, 2) + '\n').toString('base64');
    const res = await fetchImpl(CONTENTS_URL, {
      method: 'PUT',
      headers: headers(opts),
      body: JSON.stringify({ message, content, sha }),
    });
    if (res.status === 409) {
      return { ok: false, conflict: true, error: 'sha mismatch' };
    }
    if (!res.ok) {
      return { ok: false, conflict: false, error: `PUT watches.json: HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      conflict: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Bounded at exactly two attempts. A 409 means the poller (or another tab) changed
 *  watches.json between our GET and our PUT; the fix is to re-read the fresh array and
 *  RE-APPLY the diff to it — never to force-push our stale array, which would silently
 *  drop the other change (PITFALLS.md Pitfall 3). No unbounded loop: a second collision
 *  surfaces to the user instead of spinning. */
export async function commitWatches(
  mutate: WatchesMutator,
  message: string,
  opts?: WriteOptions
): Promise<CommitResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await getWatchesFile(opts);
    if (!current.ok) return { ok: false, error: current.error };
    const mutated = mutate(current.watches);
    if (!mutated.ok) return { ok: false, error: mutated.error };
    const put = await putWatchesFile(mutated.next, current.sha, message, opts);
    if (put.ok) return { ok: true };
    if (!put.conflict) return { ok: false, error: put.error };
  }
  return { ok: false, error: 'watches.json changed while saving. Nothing was written — try again.' };
}
