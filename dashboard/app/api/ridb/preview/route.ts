/** POST for a read-only operation, deliberately: the preview needs the FULL set of selected area
 *  chips in one call, because dedup and the 20-campground cap are computed ACROSS all of them
 *  (D-10). Splitting it into one GET per area would let the client compute a cap that disagrees
 *  with the poller's. A body-carrying GET is not portable, so POST it is — nothing is persisted
 *  here (ARCHITECTURE.md Anti-Pattern 1: the resolved list is UI state, never written to
 *  watches.json).
 *
 *  Also exists to keep RIDB_API_KEY off the browser (RESEARCH.md Pitfall 2, threat T-05-06),
 *  the same reason as the sibling recareas route. proxy.ts already gates /api/ridb/*, but this
 *  handler re-checks the session itself too (Pitfall 1's silent-failure mode).
 */
import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE, hasValidSession } from '@/lib/session';
import { previewAreas, AREA_FACILITY_CAP } from '@/lib/ridb';

async function requireSession(): Promise<Response | null> {
  const store = await cookies();
  if (!hasValidSession(store.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

// .max(10) is a DoS guard (threat T-05-10) — 10 chips already blows past the 20-campground cap.
const PreviewRequestSchema = z.object({
  areas: z
    .array(
      z.object({
        name: z.string().min(1).optional(),
        recAreaId: z.number().int().positive().optional(),
      })
    )
    .max(10),
});

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request body' }, { status: 400 });
  }

  const parsed = PreviewRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Malformed request body' }, { status: 400 });
  }

  // previewAreas never returns ok: false — per-area failures come back in areaErrors and the
  // UI renders them alongside whatever did resolve, so there is no 502 branch here.
  const result = await previewAreas(parsed.data.areas);
  return NextResponse.json({
    ok: true,
    facilities: result.facilities,
    truncated: result.truncated,
    areaErrors: result.areaErrors,
    cap: AREA_FACILITY_CAP,
  });
}
