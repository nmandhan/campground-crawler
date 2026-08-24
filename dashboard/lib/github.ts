/** Request-time fetch of the poller's committed JSON from GitHub raw content (D-03).
 *
 *  raw.githubusercontent.com, not the Contents API: CDN-backed, no base64 decode step, and not
 *  subject to the 60 req/hr unauthenticated Contents API cap. The repo is public (D-04) so no
 *  token is involved — this module must never read a credential.
 */
export const RAW_BASE = 'https://raw.githubusercontent.com/nmandhan/campground-crawler/main';

/** Files this dashboard is allowed to fetch. An allowlist, not a free-form path parameter, so a
 *  future caller can't turn fetchJson into a general-purpose GitHub proxy (threat T-03-05). */
export type DataFile = 'watches.json' | 'state.json' | 'runs.json';

export type FetchResult = { ok: true; data: unknown } | { ok: false; error: string };

/** Never throws. Returns a discriminated result so page.tsx renders the UI-SPEC "Unable to load
 *  dashboard data" copy instead of 500-ing the whole page (RESEARCH.md Security Domain, V5). */
export async function fetchJson(file: DataFile): Promise<FetchResult> {
  try {
    const res = await fetch(`${RAW_BASE}/${file}`, {
      // 30s Data Cache window: current enough for a 5-minute poll cadence, and a cheap hedge
      // against unexpected traffic hammering raw.githubusercontent.com. Do NOT disable the
      // fetch cache here, and do NOT set `export const dynamic = 'force-dynamic'` in the page —
      // either would defeat this window (RESEARCH.md Pattern 1 / Anti-Patterns).
      next: { revalidate: 30 },
    });
    if (!res.ok) {
      return { ok: false, error: `${file}: HTTP ${res.status}` };
    }
    return { ok: true, data: (await res.json()) as unknown };
  } catch (err) {
    // Mirrors src/errors.ts describeFailure: one safe line, no stack, no request internals.
    return { ok: false, error: `${file}: ${err instanceof Error ? err.message : String(err)}` };
  }
}
