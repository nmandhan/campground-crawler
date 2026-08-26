/** The shared-secret session contract (D-01/D-02/D-03, MGMT-06).
 *
 *  Deliberately minimal, per PITFALLS.md and CONTEXT.md D-01: a single named user on their own
 *  browser, not an accounts system. No JWT, no signing scheme, no user table — the cookie value
 *  IS the shared secret, and it never leaves the httpOnly boundary the server set it in.
 *
 *  Extracted into its own module (rather than inlined in the Route Handler) for exactly one
 *  reason: dashboard/proxy.ts and every mutating Route Handler must agree on the cookie name and
 *  the comparison rule. A mismatch between them is a silent auth bypass (RESEARCH.md Pitfall 1).
 */
export const SESSION_COOKIE = 'session';

/** ~30 days (D-03). Single user on their own browser — optimize for not re-entering the
 *  passphrase, not for minimizing the exposure window. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function sessionCookieOptions() {
  return {
    httpOnly: true, // never readable from document.cookie
    secure: true,
    sameSite: 'lax' as const,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
  };
}

/** Fails closed. If DASHBOARD_PASSPHRASE is unset or empty in the deployment environment,
 *  NO cookie value is valid — "no secret configured" must never mean "everyone is authorized"
 *  (threat T-05-07). Uses a length-then-XOR compare so a wrong-length guess and a wrong-value
 *  guess cost the same; the timing side channel is negligible at this threat model but the
 *  hardening is free.
 */
export function hasValidSession(
  cookieValue: string | undefined,
  expected = process.env.DASHBOARD_PASSPHRASE
): boolean {
  if (!expected) return false;
  if (!cookieValue) return false;
  if (cookieValue.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= cookieValue.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
