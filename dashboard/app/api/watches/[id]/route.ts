/** Edit (PATCH) and delete (DELETE) of a single watch by id (MGMT-03/MGMT-04, D-01/D-02/D-03).
 *
 *  Same response contract as the sibling create route:
 *  200 { ok: true } | 401 Unauthorized | 400 malformed/invalid | 404 not found |
 *  409 duplicate id or last-watch delete | 502 GitHub failure.
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

/** PATCH body is the COMPLETE replacement watch object, not a partial patch — the modal always
 *  submits every field, and a partial merge across a discriminated union is a bug factory. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request body' }, { status: 400 });
  }

  const parsed = parseStrictWatch(raw);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  const watch = parsed.data;

  let notFound = false;
  let duplicate = false;
  const result = await commitWatches(
    (current) => {
      const idx = current.findIndex((w) => w.id === id);
      if (idx === -1) {
        notFound = true;
        return { ok: false, error: `No watch with id "${id}".` };
      }
      // Rename-onto-an-existing-id case: allow keeping this watch's own id via `ignoreId`.
      if (!assertUniqueId(current, watch.id, id)) {
        duplicate = true;
        return { ok: false, error: `A watch with id "${watch.id}" already exists.` };
      }
      const next = [...current];
      next[idx] = watch;
      return { ok: true, next };
    },
    `chore(watches): update watch "${id}" via dashboard`
  );
  if (!result.ok) {
    const status = notFound ? 404 : duplicate ? 409 : 502;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  let notFound = false;
  let lastWatch = false;
  const result = await commitWatches(
    (current) => {
      if (!current.some((w) => w.id === id)) {
        notFound = true;
        return { ok: false, error: `No watch with id "${id}".` };
      }
      // The poller's WatchesFileSchema has .min(1, 'watches.json must contain at least one watch').
      // Committing an empty array would fail its TOP-LEVEL parse and silently stop every watch,
      // not just this one (threat T-05-03). Refuse rather than break the poller.
      if (current.length <= 1) {
        lastWatch = true;
        return {
          ok: false,
          error:
            'This is the last watch. watches.json must contain at least one watch or the poller stops.',
        };
      }
      return { ok: true, next: current.filter((w) => w.id !== id) };
    },
    `chore(watches): delete watch "${id}" via dashboard`
  );
  if (!result.ok) {
    const status = notFound ? 404 : lastWatch ? 409 : 502;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
