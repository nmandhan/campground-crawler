/** Issues the shared-secret session cookie (D-01/D-02/D-03, MGMT-06).
 *
 *  Deliberately NOT covered by proxy.ts's matcher: this is the endpoint that grants the
 *  session, so gating it on having a session would be a deadlock.
 *
 *  The passphrase is compared server-side only and never echoed back — a wrong guess gets a
 *  bare 401 with no hint about length, prefix, or whether the secret is even configured
 *  (threat T-05-13).
 */
import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionCookieOptions, hasValidSession } from '@/lib/session';

export async function POST(request: Request) {
  let passphrase: unknown;
  try {
    const body = (await request.json()) as { passphrase?: unknown };
    passphrase = body.passphrase;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (typeof passphrase !== 'string' || !hasValidSession(passphrase)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, passphrase, sessionCookieOptions());
  return NextResponse.json({ ok: true });
}

/** Lets the client clear its session without knowing the secret. */
export async function DELETE() {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return NextResponse.json({ ok: true });
}
