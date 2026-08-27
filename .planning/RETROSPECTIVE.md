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

## Milestone: v1.1 — Area Search

**Shipped:** 2026-08-27
**Phases:** 2 | **Plans:** 14/14

### What Was Built
- Area-based watches (`FacilityWatch | AreaWatch` discriminated union): a single watch can target one or more named Recreation Areas, resolved to real, filtered, capped campground lists at poll time via RIDB's RecArea entity.
- Per-campground match attribution and group-vs-standard tagging, so an area watch's match output names the exact campground that opened, plus a shared 20-facility cap with truncation surfaced in both match output and run history.
- A full dashboard write path: shared-secret session-cookie auth gate (`proxy.ts` + defense-in-depth per-route checks), GitHub Contents API write module (sha-based optimistic concurrency), and a create/edit/delete UI with a Recreation Area typeahead and live campground preview.
- End-to-end live verification against production — real dashboard-authored commits, a real poll run resolving real area watches on GitHub Actions, and a full human UAT walkthrough of the deployed write path.

### What Worked
- Running phase-specific research even when milestone-level research already existed paid off directly: it caught the Next.js 16 `middleware.ts`→`proxy.ts` silent-rename trap before any code was written, which would have shipped the entire auth gate as a silent no-op.
- The UI-SPEC gate (blocking `/gsd-plan-phase` until a design contract existed) worked as intended — the UI researcher needed zero user questions because CONTEXT.md and RESEARCH.md were already sufficiently prescriptive, and the checker caught one real generic-CTA-label violation before planning began.
- Wave-based parallel worktree execution across 5 waves (8 plans) had zero real merge conflicts — only trivial three-way collisions on a shared `deferred-items.md` doc file (independently discovered the same pre-existing bug from three different plans), never on source code.
- Treating the final wave's live human-verify checkpoint as genuinely load-bearing (not a formality) caught real bugs that no unit test could: a RIDB search-relevance bug, a passphrase-provisioning trailing-newline bug, and — most importantly — that two entire phases had never been pushed to GitHub.

### What Was Inefficient
- **The single biggest process failure this milestone: Phase 4 and Phase 5's entire execution history was never pushed to `origin/main`.** Every wave merged worktree branches locally and committed, but nothing was ever `git push`ed to the remote. This went undetected for the whole of Phase 5 because `vercel --prod` deploys directly from local files, not from git — so the *deployed dashboard* worked throughout, masking that the *poller* (which checks out `origin/main` via GitHub Actions) was still running pre-Phase-4 code. It was only caught by chance, because the orchestrator manually triggered a poll run during final verification instead of waiting on GitHub's cron. Had that manual trigger not happened, this would have shipped completely broken with no signal until the user's actual watches silently stopped being checked in production.
- A code-review pass run at the very end of the phase (after live UAT had already passed) surfaced 8 real findings, including a data-loss bug (editing a facility watch drops its `facilityId` override) that would have been cheaper to catch and fix mid-phase, before the UI/API contract solidified across three later plans.
- The orchestrator's own git-push discipline was the root cause above — committing locally after every wave was treated as "done," when the actual finish line for shared-repo work is the remote, not the local `HEAD`.

### Patterns Established
- **Verify a "silent failure mode" flagged by research with an actual reproduction, not just a code read.** The `proxy.ts` rename trap was confirmed by a committed script that runs a real `next build && next start` and curls it — this is what actually proved the fix worked, not reading the file and confirming the name looked right.
- **When a phase's final wave includes a live human-verify checkpoint, treat every bug the user reports during it as first-class phase output, not "the phase is basically done, this is cleanup."** Two of the four bugs found during Phase 5's live UAT were more severe than anything the automated verification had caught.
- **After merging worktree branches for a wave, push to the remote before considering the wave — or the phase — actually finished.** Local `git merge` + commit is not the same as "this work exists somewhere durable and is what CI/production will actually run."

### Key Lessons
1. **A deployment path that bypasses git (like `vercel --prod` deploying from local files) can hide an arbitrarily large git-sync gap indefinitely** — the dashboard "working" is not evidence that the repo is in a consistent, pushed state. Any project with more than one deploy mechanism should treat "is this pushed to the remote?" as a standing verification step, not an assumption.
2. **Milestone-level research done before a phase split (research written for "both Phase A and Phase B" before either was planned) can go stale on exactly the boundary between the two phases** — this milestone's `ARCHITECTURE.md` correctly warned against resolving area→facility in the write path, but didn't anticipate that the *typeahead and preview* features (added in the later phase) would need their own read-only RIDB client, creating a plausible-sounding but incomplete "anti-pattern" warning that phase-specific research had to correctly narrow.
3. **A live production UAT checkpoint is worth its wall-clock cost even after all automated checks pass** — this milestone's most severe bugs (data-loss-adjacent facilityId drop, the entire git-push gap) were only found because a human actually used the deployed feature, not because a test suite grew large enough.

### Cost Observations
- Sessions: 1 long session covering Phase 5 discussion through milestone close (Phase 4 measured separately, not repeated here)
- Notable: Phase 5's 5-wave, 8-plan execution used parallel worktree agents for waves with 2+ plans (Waves 1 and 3) and solo worktree agents for single-plan waves (2, 4, 5) — post-merge test/build gates caught zero cross-plan regressions across all 5 waves.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 1 (measured) | 3 | Established the deployment-agnostic-core pattern in Phase 1; validated it paid off when Phase 3 added an entirely independent dashboard project with zero poller changes |
| v1.1 | 1 (measured) | 2 | Discovered that local git commits are not equivalent to shipped work — two phases executed and merged locally without ever being pushed to `origin/main`, undetected until a manual poll-run trigger during final verification |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|---------------------|
| v1.0 | 229 (161 poller + 68 dashboard) | Not measured | resend, zod (poller); next, zod (dashboard, independent project) |
| v1.1 | 375 (216 poller + 159 dashboard) | Not measured | none — dashboard write path built with zero new dependencies beyond next/react/zod |

### Top Lessons (Verified Across Milestones)

1. Check a diff's behavior change against the phase's locked `*-CONTEXT.md` decisions before calling it a regression.
2. Local `git commit` is not "done" for shared-repo work — push to the remote after every wave/phase, and treat "is this actually on `origin/main`?" as a standing verification step, especially when a second deploy path (e.g. `vercel --prod` from local files) can mask the gap indefinitely.
3. A live human-verify checkpoint against the real deployed system, run after all automated checks pass, reliably surfaces the most severe bugs a milestone will find — budget for it, don't treat it as a formality.
