/** Sole writer of watches.json (MGMT-02, D-01/D-02/D-03).
 *
 *  The poller became read-only on watches.json in this phase — the dashboard, via this
 *  route and its `[id]` sibling, is the only thing that ever commits to it now.
 *
 *  Response contract every client component codes against:
 *  200 { ok: true } | 401 Unauthorized | 400 malformed/invalid | 409 duplicate id | 502 GitHub failure.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, hasValidSession } from '@/lib/session';
import { commitWatches } from '@/lib/github-write';
import { parseStrictWatch, assertUniqueId } from '@/lib/schema';

/** Defense in depth. proxy.ts already gates this route, but its failure mode is SILENT
 *  (a filename typo makes it vanish with no build error — RESEARCH.md Pitfall 1), so every
 *  mutating handler re-checks the cookie itself. Never remove this "redundant" check. */
async function requireSession(): Promise<Response | null> {
  const store = await cookies();
  if (!hasValidSession(store.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request body' }, { status: 400 });
  }

  const parsed = parseStrictWatch(raw);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  const watch = parsed.data;

  let duplicate = false;
  const result = await commitWatches(
    (current) => {
      // Uniqueness check lives INSIDE the mutator, not before it: it must run against the
      // freshly-fetched array on the 409 retry too, or a concurrent create could slip a
      // duplicate id past it (T-05-15).
      if (!assertUniqueId(current, watch.id)) {
        duplicate = true;
        return { ok: false, error: `A watch with id "${watch.id}" already exists.` };
      }
      return { ok: true, next: [...current, watch] };
    },
    `chore(watches): add watch "${watch.id}" via dashboard`
  );
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: duplicate ? 409 : 502 });
  }
  return NextResponse.json({ ok: true });
}
