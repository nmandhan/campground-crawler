/** Route gate for every mutation and RIDB-proxy endpoint (MGMT-06, D-01/D-02).
 *
 *  FILENAME IS LOAD-BEARING: Next.js 16 renamed middleware.ts -> proxy.ts and the `middleware`
 *  export -> `proxy`. A file named middleware.ts is silently ignored at BUILD time with no error
 *  or warning — the gate would vanish and the write path would ship unauthenticated
 *  (RESEARCH.md "Next.js 16 middleware -> proxy Rename", threat T-05-12). Verified against the
 *  official Next.js 16 upgrade docs. Do not rename this file.
 *
 *  This gate is NOT the only check: every mutating Route Handler re-verifies the cookie itself
 *  (defense in depth), precisely because this file's failure mode is silent.
 *
 *  /api/ridb/* is gated too even though it only reads (RESEARCH.md Open Question 2): its only
 *  legitimate caller is the already-gated create/edit modal, and leaving it open would hand any
 *  anonymous visitor a free RIDB proxy backed by this project's API key.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, hasValidSession } from './lib/session';

export function proxy(request: NextRequest) {
  if (!hasValidSession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  // Read-only dashboard views (`/`, and the raw.githubusercontent.com fetches behind them)
  // are deliberately NOT matched — they stay public and unauthenticated (MGMT-06).
  //
  // /api/session is also deliberately NOT in this matcher: it is the endpoint that issues
  // the session cookie, so gating it on already having a session would be a deadlock.
  matcher: ['/api/watches/:path*', '/api/ridb/:path*'],
};
