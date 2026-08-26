/** Server-side proxy for the Recreation Area typeahead (AREA-04).
 *
 *  This route exists for one reason: RIDB_API_KEY must never reach the browser
 *  (RESEARCH.md Pitfall 2, threat T-05-06). The typeahead is a 'use client' component and
 *  therefore cannot import lib/ridb.ts directly; it calls this route instead.
 *
 *  proxy.ts already gates /api/ridb/*, but the duplication here is deliberate — its failure
 *  mode is silent (RESEARCH.md Pitfall 1), and this endpoint is otherwise a free RIDB proxy
 *  backed by this project's API key (RESEARCH.md Open Question 2).
 */
import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, hasValidSession } from '@/lib/session';
import { searchRecAreas } from '@/lib/ridb';

async function requireSession(): Promise<Response | null> {
  const store = await cookies();
  if (!hasValidSession(store.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const query = new URL(request.url).searchParams.get('query')?.trim() ?? '';
  // Mirrors the client-side 2-char minimum (D-07). Enforced here too so a hand-crafted
  // request can't turn this into an unbounded RIDB scan (threat T-05-10).
  if (query.length < 2) return NextResponse.json({ ok: true, areas: [] });

  const result = await searchRecAreas(query);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  // Suggestions are name-only — no state/org field. RIDB's RecArea object has no US-state
  // field on it (that lives in a separate /recareaaddresses resource); D-08's fallback selects
  // name-only for this phase.
  return NextResponse.json({ ok: true, areas: result.areas });
}
