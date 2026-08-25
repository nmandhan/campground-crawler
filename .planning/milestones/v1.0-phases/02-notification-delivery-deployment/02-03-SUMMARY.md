---
phase: 02-notification-delivery-deployment
plan: 03
subsystem: infra
tags: [github-actions, cron, deployment, secrets, dedup-state]

# Dependency graph
requires:
  - phase: 01-core-polling-engine
    provides: "FileStateStore atomic-write dedup state, cli.ts exit-code contract, npm start entrypoint"
provides:
  - "Scheduled GitHub Actions workflow (.github/workflows/poll.yml) running npm start every 5 minutes"
  - "Concurrency-guarded, never-cancelled poller runs"
  - "Conditional state.json commit-back gated on git status --porcelain"
  - "Tracked, seeded state.json enabling durable dedup across ephemeral runners"
  - ".env.example documenting all four env vars"
  - "README deployment + secrets setup documentation"
affects: [02-04-deployment-smoke-test]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "git status --porcelain (not git diff --quiet) for detecting untracked-or-modified state file changes"
    - "Atomic state write temp sibling (state.json.tmp) excluded from git, real state.json tracked"

key-files:
  created:
    - .github/workflows/poll.yml
    - state.json
    - .env.example
  modified:
    - .gitignore
    - README.md

key-decisions:
  - "state.json tracked in git (not ignored) — commit-back is the only durability mechanism across ephemeral GitHub Actions runners"
  - "git status --porcelain used instead of git diff --quiet to correctly detect an untracked file changing to tracked-with-content"
  - "concurrency.cancel-in-progress left false to avoid interrupting a run between email send and state commit"
  - "RIDB_API_KEY injected as an optional secret even though D-02/D-03 scoped secrets to email creds, since Phase 1 found RIDB 401s without it"

requirements-completed: [OPS-02, OPS-03]

# Metrics
duration: 12min
completed: 2026-08-23
---

# Phase 02 Plan 03: Unattended Deployment Surface Summary

**GitHub Actions workflow polling every 5 minutes with a concurrency guard, conditional dedup-state commit-back, and secrets-only credential injection**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-23T21:12:00Z
- **Completed:** 2026-08-23T21:24:21Z
- **Tasks:** 3
- **Files modified:** 5 (.gitignore, state.json, .github/workflows/poll.yml, .env.example, README.md)

## Accomplishments
- Un-ignored and seeded `state.json` so commit-back has a tracked baseline to diff against
- Created `.github/workflows/poll.yml`: 5-min cron + `workflow_dispatch`, `concurrency: { group: poller, cancel-in-progress: false }`, `permissions: contents: write`, secrets injected via `env:` only, and a `git status --porcelain`-gated, `set -euo pipefail`-protected state commit-back
- Documented all four environment variables in `.env.example` and a new README "Environment variables" table, plus a full "Scheduled deployment (GitHub Actions)" setup guide

## Task Commits

Each task was committed atomically:

1. **Task 1: Un-ignore and seed the dedup state file** - `111ad12` (chore)
2. **Task 2: Create the scheduled GitHub Actions poller workflow** - `402db9a` (feat)
3. **Task 3: Document deployment env vars and secrets setup** - `a7e53c6` (docs)

_Note: this plan ran as a parallel worktree executor; STATE.md/ROADMAP.md are not touched here and the plan-metadata commit is limited to SUMMARY.md per worktree convention._

## Files Created/Modified
- `.gitignore` - Removed `state.json` ignore rule, added `state.json.tmp` (atomic-write temp sibling)
- `state.json` - Tracked, seeded with `{"version":1,"entries":{}}`
- `.github/workflows/poll.yml` - Scheduled poller workflow with concurrency guard, secrets injection, conditional commit-back
- `.env.example` - All four env vars documented with empty values
- `README.md` - New "Environment variables" table and "Scheduled deployment (GitHub Actions)" section; replaced stale "What's not here yet" section; added state-reset note

## Decisions Made
- `state.json` MUST be tracked in git (not gitignored) because it's the only durability mechanism across GitHub Actions' ephemeral runners — this was the plan's core blocking discovery and is preserved exactly as specified.
- Used `git status --porcelain -- state.json` rather than `git diff --quiet` in the commit-back step, since `git diff` reports no change for an untracked file and would silently disable commit-back if tracking ever regressed.
- Kept `cancel-in-progress: false` — a cancelled run could be interrupted between email send and state commit, producing a duplicate alert.

## Deviations from Plan

None - plan executed exactly as written. `pyyaml` was not pre-installed locally; installed it via `pip3 install --user pyyaml` to run the specified YAML verification command (no code change, tooling-only, not a deviation from plan content).

## Issues Encountered
None.

## User Setup Required

Deployment secrets (`RESEND_API_KEY`, `NOTIFY_EMAIL`, optionally `NOTIFY_FROM` and `RIDB_API_KEY`) must be added under repo Settings -> Secrets and variables -> Actions before the workflow can send real emails. This is documented in README's "Scheduled deployment" section and is expected to be verified in the next plan's smoke test (02-04).

## Next Phase Readiness
- `.github/workflows/poll.yml` is ready to run on push to the default branch (schedule triggers only fire on the default branch) — repo must be public for unlimited free Actions minutes at 5-min cadence, per plan/README.
- Plan 02-04 can now use `workflow_dispatch` to smoke-test the deployed poller end-to-end.
- No blockers identified.

---
*Phase: 02-notification-delivery-deployment*
*Completed: 2026-08-23*

## Self-Check: PASSED

All created files verified present: `.github/workflows/poll.yml`, `state.json`, `.env.example`, `.gitignore`, `README.md`, `02-03-SUMMARY.md`. All task commits (`111ad12`, `402db9a`, `a7e53c6`) verified present in `git log`.
