# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-08-25
**Phases:** 3 | **Plans:** 12/13 (02-04 blocked, see Known Gaps in MILESTONES.md)

### What Was Built
- A deployment-agnostic poller core (`run()`) that resolves campgrounds via RIDB, fetches live Recreation.gov availability, matches against config-driven watches, and persists dedup state atomically — live-verified end to end.
- Injectable, non-throwing email digest notifications (code-complete, unit-tested) wired into the poller with a failure-isolated `sendNotification` seam.
- Unattended GitHub Actions scheduling (5-minute cron) with a public repo, secrets-only credentials, and durable state commit-back — confirmed running in production.
- A public, no-auth Next.js status dashboard on Vercel, reading the poller's committed JSON at request time, live-verified with a real poll cycle appearing within its 30s cache window.

### What Worked
- The "deployment-agnostic core + thin trigger adapter" architecture (locked in Phase 1) paid off directly in Phase 3: the dashboard could be added as a completely independent npm project with zero poller code changes, because `run()` never assumed how or where it would be invoked.
- Wave-based parallel execution (worktrees) on Phase 3's independent plans (03-01 poller-side, 03-02 dashboard scaffold) cut wall-clock time with no merge conflicts — the plans' `files_modified` lists genuinely didn't overlap.
- Pivoting from "blocked on Resend domain" to "ship a dashboard instead" mid-milestone was the right call — it delivered real, live-verified user value instead of stalling on a third-party dependency the user declined to unblock.
- Automating the entire Vercel deploy checkpoint (Task 2 of 03-05) via an already-authenticated CLI session, rather than walking the user through vercel.com/new by hand, turned a "human-action" checkpoint into a fully verified, zero-friction step.

### What Was Inefficient
- The code-review agent's first-pass framing of the `poll.yml` commit-cadence change as a "regression" was wrong — it hadn't cross-checked the phase's own locked design decision (D-01) before flagging it. Cost: a round of user back-and-forth to correct course, and a near-miss where I could have shipped a "fix" that broke the dashboard's freshness guarantee. Lesson below.
- `gsd-sdk query state.begin-phase --phase X --name Y --plans Z` silently mis-parsed its own flags and wrote literal `--phase`/`--name` strings into STATE.md — required manual cleanup mid-phase. Worth a bug report against the GSD CLI itself.
- `gsd-sdk query roadmap.update-plan-progress` returned `"no matching checkbox found"` for all 5 phase-03 plans — never diagnosed, just worked around by letting `phase.complete` handle the roadmap update holistically. Minor, but means per-plan roadmap checkboxes may have gone stale during execution.

### Patterns Established
- **Verify code-review findings against locked phase decisions (CONTEXT.md), not just the diff, before presenting them as regressions.** A behavior change that matches a `D-XX` decision is not a bug — flag it as intentional-but-worth-double-checking instead of "confirmed regression," or verify against CONTEXT.md before making the claim at all.
- **When a checkpoint plan names a specific external service action (e.g., "create a Vercel project"), check for an already-authenticated CLI session before presenting the manual how-to-verify steps to the user.** Turned a multi-step human checkpoint into a two-command automated deploy.
- **Strip `<script>` payload noise before grepping rendered HTML for diagnostic leaks (`undefined`, `NaN`, etc.).** Next.js RSC flight data legitimately contains `"$undefined"` tokens as a serialization artifact — a raw string search over full HTML produces false positives on any RSC-based app.

### Key Lessons
1. A locked decision in `*-CONTEXT.md` (like D-01: "commit every cycle so the dashboard shows every run") should be checked before characterizing a diff's behavior change as a defect — the same evidence that looks like a bug in isolation can be a deliberately-paid-for feature.
2. Waiting for a real, external, timed event (a 5-minute cron cycle) to verify an end-to-end freshness claim is worth the wall-clock cost — it caught nothing wrong here, but it's the only way "the dashboard actually updates" is a verified fact rather than an inferred one.
3. Public-repo + GitHub Secrets + free-tier GitHub Actions cron is a genuinely sufficient combo for a single-user, always-on polling workload — no paid infra was needed anywhere in this milestone except the (still-unverified) email domain.

### Cost Observations
- Sessions: 1 long session covering Phase 3 execution through milestone close (plus prior sessions for Phases 1-2, not measured here)
- Notable: Phase 3's 4-wave execution used parallel worktree agents for Wave 1 (2 plans) and sequential agents for Waves 2-4 (1 plan each) — no wasted parallelism, no merge conflicts across any wave.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 1 (measured) | 3 | Established the deployment-agnostic-core pattern in Phase 1; validated it paid off when Phase 3 added an entirely independent dashboard project with zero poller changes |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|---------------------|
| v1.0 | 229 (161 poller + 68 dashboard) | Not measured | resend, zod (poller); next, zod (dashboard, independent project) |

### Top Lessons (Verified Across Milestones)

1. Check a diff's behavior change against the phase's locked `*-CONTEXT.md` decisions before calling it a regression.
