---
phase: 05-watch-management-write-path
plan: 08
subsystem: dashboard-verification
status: complete
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

### Task 3: End-to-end verification of the deployed write path (COMPLETE — user approved)

The user worked through the live UAT checklist against https://dashboard-drab-seven-94.vercel.app
and reported "approved." Along the way, this task surfaced and fixed four real bugs that no
unit test or prior automated check had caught — exactly the class of issue Task 3 exists to find:

**1. [Bug] RIDB area search was not relevance-ranked, burying real name matches**
- **Found during:** User's typeahead test — searching "White River National Forest" (a real,
  well-known National Forest) returned no results.
- **Root cause:** RIDB's `/recareas?query=` endpoint does fuzzy full-text matching across
  name/description/keywords, not a relevance-ranked name search. Querying "white river" returns
  63 total matches; the actual "White River National Forest" (RecAreaID 1055) never appeared in
  the original `limit=10` window because RIDB's own ordering isn't sorted by name relevance.
- **Fix:** `dashboard/lib/ridb.ts`'s `searchRecAreas()` now fetches `SEARCH_FETCH_LIMIT=50` results
  and client-side re-ranks (stable sort) so any result whose `RecAreaName` contains the query
  (case-insensitive) surfaces first, before trimming to `SEARCH_RESULT_LIMIT=10` for display.
  Added 3 new tests reproducing the live bug and covering case-insensitivity and the result cap.
- **Files:** `dashboard/lib/ridb.ts`, `dashboard/lib/ridb.test.ts`
- **Commit:** `09efc3a`
- **Verified:** live against real RIDB data (confirmed "White River National Forest" now ranks
  4th for query "white river"), 159/159 dashboard tests pass, clean typecheck/build, redeployed,
  user confirmed the fix worked in their browser.

**2. [Bug] `DASHBOARD_PASSPHRASE` was stored with a trailing newline, would have locked the user out**
- **Found during:** orchestrator retrieving the passphrase via `vercel env pull` to hand to the
  user for login (the user asked "what is the passphrase" since it was generated but never
  echoed, per instruction).
- **Root cause:** the value was piped into `vercel env add` via `echo "$VAR"`, which appends a
  trailing newline that got stored as part of the secret. A value typed into the browser's
  unlock form would never include that newline, so the exact-string comparison in
  `hasValidSession()` would always fail — the user would have been locked out of their own
  write path with a correctly-provisioned-looking secret.
- **Fix:** Removed the old value (`vercel env rm`, approved explicitly by the user after the
  orchestrator's session was blocked by the permission classifier) and re-added it via
  `printf '%s'` (no trailing newline), verified clean via `vercel env pull`, redeployed.
- **No code change** — this was purely a provisioning-step error, not a bug in `session.ts` or
  the plan's own scripts.

**3. [Critical process gap] Phase 4 and Phase 5 had never been pushed to GitHub**
- **Found during:** orchestrator manually triggering the poll workflow to verify it, ahead of
  waiting on GitHub's unreliable cron cadence — the run failed with
  `fatal: watches config at watches.json is invalid: 0.parkName: Invalid input: expected string,
  received undefined`.
- **Root cause:** all of Phase 4 and Phase 5's execution happened in the local git repo only;
  nothing had been pushed to `origin/main` since a commit that predates Phase 4's area-watch
  schema work. `vercel --prod` deploys directly from local files (not from git), which is why
  the *dashboard* had the new code while GitHub Actions — which checks out `origin/main` — was
  still running the old, pre-area-watch `src/config/schema.ts` with no `AreaWatchSchema` at all.
  Meanwhile `origin/main` had moved forward independently: 48 commits of the poller's own
  routine `runs.json`/`state.json` history, plus 4 real dashboard-authored `watches.json` commits
  from the user's own UAT session (2 deletes of real watches, 2 adds of test area watches).
- **Fix:** Confirmed the two histories touched disjoint files (local: all source/docs; origin:
  only `runs.json`/`watches.json`) — merged cleanly with zero conflicts (twice, since origin
  advanced again mid-merge from an in-flight poller run), then pushed. Re-triggered the poll
  workflow, which then succeeded, correctly parsing and resolving both area watches
  (`arapaho-uat` → 28 campgrounds capped to 20, `white-river-uat` → 33 campgrounds capped to 20).
- **Process fix going forward:** push to `origin/main` after each phase's execution completes,
  not just commit locally — this should have happened automatically as part of wave completion
  and was missed.

**4. [Data loss, recovered] Two real production watches were deleted during delete-flow testing**
- **Found during:** checking `watches.json`'s live content on GitHub (via `gh api`) while
  investigating the poll failure above.
- **Root cause:** the user's own delete-flow testing (Task 3 step F) deleted
  `upper-pines-labor-day` and `kirk-creek-october` — the two real watches from v1.0 — rather
  than a dedicated disposable test watch, leaving only two UAT test area watches
  (`arapaho-uat`, `white-river-uat`) live.
- **Fix:** Restored the original two facility watches from their last-known-good commit
  (`06c8efa`). Per the user's explicit choice, kept the two area watches rather than removing
  them (renamed `arapaho-uat` → `arapaho-roosevelt-pawnee`, `white-river-uat` →
  `white-river-national-forest`, dropping the `-uat` suffix since they're now real ongoing
  watches, not test artifacts). Validated the merged 4-watch file against
  `src/config/schema.ts`'s `WatchesFileSchema` before committing — passed. Pushed. Triggered one
  final poll run: all 4 watches (2 facility, 2 area) resolved and checked successfully with zero
  failures.
- **Commit:** `6a43786`

### User sign-off

User replied "approved" after working through the live checklist (unlock, typeahead — initially
failed, fixed and re-confirmed working — area preview, save, and the subsequent investigation
above). Steps D/E (validation conflict handling, edit) and the remainder of step F (delete
confirmation dialog copy) were not separately narrated back by the user, but the live production
system is now in a fully verified, healthy end state: real watches restored, test watches
retained as real ones by choice, poller successfully resolving all of them, dashboard fix
deployed and confirmed.

## Self-Check

- `dashboard/scripts/verify-auth-gate.sh` exists, is executable, and exits 0 with
  `all auth-gate checks passed` and zero `FAIL` lines — confirmed by direct execution.
- All three Vercel Production secrets confirmed present via `vercel env ls`, none `NEXT_PUBLIC_`.
- Live probes against https://dashboard-drab-seven-94.vercel.app confirm `/` → 200 and all
  mutation/RIDB endpoints → 401 without a session.
- `git log --oneline main | grep "via dashboard"` shows 4 commits (2 add, 2 delete) — confirms
  the write path really does commit through the GitHub Contents API end-to-end.
- Final poll run (`33032737377`) succeeded, checked all 4 current watches, 0 failures.
- `watches.json` on `main` contains only area criteria for both area watches (`{name, recAreaId}`)
  — no frozen facility list — confirming Anti-Pattern 1 from ARCHITECTURE.md was correctly
  avoided.

## Known Stubs

None.

## Threat Flags

- T-05-33 (over-scoped GitHub PAT) mitigated as specified — user created a fine-grained,
  single-repo-scoped token.
- New, not previously flagged: **secrets transmitted in plaintext through the chat channel**
  (the GitHub PAT and RIDB API key were pasted directly into the conversation so the orchestrator
  could provision them). User was advised to rotate the GitHub PAT as a hygiene measure. Not a
  code/architecture issue — a one-time operational exposure from this session's provisioning
  approach.

## TDD Gate Compliance

Not applicable — this plan is `type: execute`, not `type: tdd`.

## Self-Check: PASSED
