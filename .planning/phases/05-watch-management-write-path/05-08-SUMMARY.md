---
phase: 05-watch-management-write-path
plan: 08
subsystem: dashboard-verification
status: paused-at-checkpoint-task-3
tags: [auth-gate, production-build, vercel, verification]
dependency-graph:
  requires: ["05-07"]
  provides: ["dashboard/scripts/verify-auth-gate.sh"]
  affects: ["dashboard write path go-live"]
tech-stack:
  added: []
  patterns:
    - "Production-build (`next build` + `next start`) probing instead of `next dev`, because Next.js 16 silently ignores a misnamed middleware/proxy file with no build error"
key-files:
  created:
    - dashboard/scripts/verify-auth-gate.sh
  modified: []
decisions:
  - "SameSite=Lax check made case-insensitive: Next.js's Set-Cookie serializer emits lowercase `samesite=lax`, which is spec-equivalent (RFC 6265) to `SameSite=Lax` — not a security regression"
  - "Reworded a code comment from the plan's literal script body to avoid the substring 'next dev', which the plan's own acceptance criteria forbids appearing in the committed script"
metrics:
  duration: "~25 min (partial — Task 1 only)"
  completed: "2026-08-26 (Task 1 of 3)"
---

# Phase 5 Plan 08: Production Auth-Gate Probe + Live Verification Summary

**One-liner:** Wrote and ran `dashboard/scripts/verify-auth-gate.sh`, proving the proxy.ts gate rejects every unauthenticated mutation/RIDB request with 401 against a real `next build`/`next start`. Task 2 (provisioning production Vercel secrets) was completed by the orchestrator directly in the main session — the sandboxed worktree agent correctly refused to act on a relayed claim of user authorization and paused instead. Paused before Task 3, which requires an actual human clicking through the live deployed UI.

## What Was Done

### Task 1: Production-build auth-gate probe (COMPLETE)

Created `dashboard/scripts/verify-auth-gate.sh` per the plan's exact structure: builds the dashboard
with `next build`, starts it with `next start --port 3999`, then probes with a fresh anonymous
`curl` client (no cookie jar):

- `GET /` → 200 (public, MGMT-06)
- `POST /api/watches`, `PATCH /api/watches/probe-id`, `DELETE /api/watches/probe-id`,
  `GET /api/ridb/recareas`, `POST /api/ridb/preview` → all 401
- `POST /api/session` with wrong passphrase → 401; with correct passphrase → 200
- Session cookie carries `HttpOnly`, `Secure`, `SameSite=Lax`
- No secret name (`GITHUB_WRITE_TOKEN`, `RIDB_API_KEY`, `DASHBOARD_PASSPHRASE`) or the passphrase
  value itself appears anywhere in `.next/static`
- Structural rename-trap checks: no `middleware.ts`/`middleware.js` exists, and `proxy.ts` exports
  `proxy()`

Ran it end-to-end against a real production build. Final output:

```
PASS  GET / -> 200
PASS  POST /api/watches -> 401
PASS  PATCH /api/watches/probe-id -> 401
PASS  DELETE /api/watches/probe-id -> 401
PASS  GET /api/ridb/recareas?query=los -> 401
PASS  POST /api/ridb/preview -> 401
PASS  POST /api/session -> 401
PASS  POST /api/session -> 200
PASS  session cookie has HttpOnly
PASS  session cookie has Secure
PASS  session cookie has SameSite=Lax
PASS  no passphrase in client bundle
PASS  GITHUB_WRITE_TOKEN absent from client bundle
PASS  RIDB_API_KEY absent from client bundle
PASS  DASHBOARD_PASSPHRASE absent from client bundle
PASS  no middleware.ts (proxy.ts is the correct Next.js 16 name)
PASS  proxy.ts exports proxy()
---
all auth-gate checks passed
```

Exit code 0, zero `FAIL` lines. Committed at `44b1817`.

### Automation attempted for Task 2 (before pausing)

Per the plan's "automate first" instruction:
- `npx vercel@latest whoami` → confirmed the CLI is already authenticated as `nmandhan`
- `npx vercel@latest link --yes` → succeeded, linked this worktree to `nmandhans-projects/dashboard`
- `npx vercel@latest env ls` → confirmed **zero** environment variables currently exist for the
  project (all three are genuinely unprovisioned)
- Attempted to generate `DASHBOARD_PASSPHRASE` with `openssl rand -base64 32` and add it via
  `vercel env add DASHBOARD_PASSPHRASE production` — **blocked by the Claude Code auto-mode
  permission classifier** ("Blocked by classifier"). Writing production secrets to Vercel is
  correctly gated behind explicit human approval; this agent does not have that permission and did
  not attempt to work around it.
- Confirmed `RIDB_API_KEY`'s existing value is **not** retrievable via any automation available
  here: `gh secret list` only returns secret names and update timestamps, never values (GitHub
  Actions secrets are write-only by design), and no local `.env` file contains it. The plan's
  assumption that this value could be "reused" from GitHub Actions secrets does not hold — it must
  come from the user (or be re-registered at recreation.gov if lost).
- `GITHUB_WRITE_TOKEN` (fine-grained PAT) has no creation API at all — human-only regardless, as
  the plan already anticipated.

No production Vercel state was changed by the worktree agent. `dashboard/.env.local` and
`dashboard/.vercel/` were created locally by `vercel link` (both already gitignored via
`.env*` / `.vercel`) and left in place — no secrets were written anywhere by that agent.

### Task 2: Provision the three dashboard secrets in Vercel (COMPLETE)

Completed by the orchestrator directly in the main session (not the sandboxed worktree), after
the user explicitly supplied the GitHub PAT and RIDB API key values in chat and directed the
orchestrator to run the CLI commands itself:

- `vercel env add DASHBOARD_PASSPHRASE production` — value generated via `openssl rand -base64 32`, never echoed or logged
- `vercel env add GITHUB_WRITE_TOKEN production` — user-supplied fine-grained PAT
- `vercel env add RIDB_API_KEY production` — user-supplied key
- `vercel env ls` confirmed all three present under Production, none `NEXT_PUBLIC_`-prefixed
- `vercel --prod` redeployed; aliased to https://dashboard-drab-seven-94.vercel.app
- Live probes against the redeployed production URL:
  - `GET /` → 200
  - `POST /api/watches` (no body/session) → 401
  - `DELETE /api/watches/test` → 401
  - `GET /api/ridb/recareas?query=yosemite` → 401
  - `POST /api/ridb/preview` → 401
  - `POST /api/session` (wrong passphrase) → 401
  - Rendered `/` HTML grepped for all three secret names/values → 0 matches

All Task 2 acceptance criteria met. **Reminder logged for the user:** rotate the GitHub PAT at
some point, since it was transmitted in plaintext through the chat channel to get it into Vercel;
also record the PAT's expiration date somewhere visible, per the plan's acceptance criteria.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Script's `SameSite=Lax` check was case-sensitive and produced a false FAIL**
- **Found during:** Task 1, first run of the script
- **Issue:** Next.js's `cookies().set(...)` serializes `sameSite: 'lax'` as `SameSite=lax`
  (lowercase). RFC 6265 treats SameSite values as case-insensitive, so this is not a security
  regression, but the plan's literal `case *"SameSite=Lax"*` match failed on it.
- **Fix:** Changed the check to `grep -qi` (case-insensitive) with an inline comment explaining why.
- **Files modified:** `dashboard/scripts/verify-auth-gate.sh`
- **Commit:** `44b1817`

**2. [Rule 1 - Bug] Plan's own script text contained the literal substring "next dev", violating its own acceptance criteria**
- **Found during:** Task 1, acceptance-criteria check
- **Issue:** The plan's mandated comment block explains why `next dev` isn't acceptable evidence,
  but literally includes the substring `next dev` — which the plan's acceptance criteria
  (`grep -c "next dev\|npm run dev" ... returns 0`) forbids.
- **Fix:** Reworded the comment to "the development server" instead of the literal phrase, keeping
  the explanation intact.
- **Files modified:** `dashboard/scripts/verify-auth-gate.sh`
- **Commit:** `44b1817`

### Deferred / Not Applicable

None — no out-of-scope issues encountered.

## Self-Check

- `dashboard/scripts/verify-auth-gate.sh` exists, is executable, and exits 0 with
  `all auth-gate checks passed` and zero `FAIL` lines — confirmed by direct execution above.
- Commit `44b1817` exists in `git log`.

## Known Stubs

None.

## Threat Flags

None — this plan only added a verification script; no new production surface was introduced.

## TDD Gate Compliance

Not applicable — this plan is `type: execute`, not `type: tdd`.

## Self-Check: PASSED
