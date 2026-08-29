# Pitfalls Research

**Domain:** Adding area-based Recreation.gov/RIDB search + a public write-back watch-management UI to an existing GitHub-Actions-cron + git-committed-JSON single-user tool
**Researched:** 2026-08-25
**Confidence:** MEDIUM-HIGH (rate limits and Contents API semantics verified via official docs/search; project-specific race/threat analysis is architectural reasoning from PROJECT.md, not third-party sources)

## Critical Pitfalls

### Pitfall 1: Area search blows the per-cycle request budget as watch count grows

**What goes wrong:**
v1.0's rate posture ("~1 req/sec, no aggressive retries") was sized for one `GET .../availability/campground/{id}/month` call per watch. An area watch resolves to N campgrounds in a region (a "Sequoia NF" or "Yosemite" region can easily be 20-50+ facilities). If the poller expands each area watch into one availability call per campground per 5-minute cycle, a handful of area watches multiplies request volume 20-50x, both against the undocumented availability endpoint (no published rate limit — the "~1 req/sec" convention is community-derived courtesy, not an enforced SLA) and against RIDB itself (verified: RIDB enforces 50 requests/minute per API key on `ridb.recreation.gov`). Blowing through either risks IP/key throttling or a ban that kills the *entire* tool, not just the area feature.

**Why it happens:**
The mental model "one watch = one API call" from v1.0 doesn't hold once a watch can mean "many campgrounds." It's easy to naively loop `for each campground in area: fetch availability` without re-deriving a request budget.

**How to avoid:**
- Resolve area → facility-ID list once via RIDB (cacheable, changes rarely) and cache it (e.g., re-resolve daily, not every poll cycle) rather than re-querying RIDB search on every 5-minute run.
- Cap facilities-per-area-watch (e.g., hard limit of 10-15) and/or de-duplicate facility IDs across overlapping area watches so the same campground isn't polled twice in one cycle.
- Stagger/batch availability calls with an explicit per-cycle request cap and a real minimum inter-request delay (not just "try to average ~1/sec" — literally `await sleep()` between calls), and fail closed (skip remaining campgrounds this cycle, pick up next cycle) rather than burst-retrying on failure.
- Consider polling area watches on a slower cadence than pinned single-campground watches (e.g., every 15-30 min instead of every 5) since area search is inherently lower-precision/lower-urgency than a pinned watch.

**Warning signs:**
Run history (`runs.json`) showing cycle duration climbing toward or past the 5-minute cron interval; availability-endpoint calls starting to return errors/429s/empty bodies that weren't seen in v1.0; GitHub Actions job duration creeping up.

**Phase to address:**
Area-search implementation phase (the phase that adds RIDB region resolution + expands watches into campground lists) — request budget must be designed in from the start, not bolted on after the feature works "in the demo."

---

### Pitfall 2: Area search repeats the v1.0 name-resolution bug, but multiplied across every campground in the region

**What goes wrong:**
v1.0 already hit this at 1x scale: an RIDB facility-name search resolved to "BANDIDO GROUP CAMPGROUND" instead of the intended "Upper Pines," requiring a manual `facilityId` pin. Area search removes the single override point entirely — instead of one name match to verify, it's an entire list of facilities RIDB returns for a geographic query, and RIDB facility data includes non-campground entries (visitor centers, group sites, day-use areas, boat ramps, ranger stations) mixed in with actual campgrounds. If the area resolver doesn't filter by facility type/reservable status, users get watches silently matching "sites" that were never bookable campsites, and never notice until a false-positive (or total silence) surfaces the bug — same failure class as v1.0, now undetectable-by-inspection because there's no single facility name to eyeball.

**Why it happens:**
RIDB's `/facilities` endpoint mixes facility types under one schema; a geo/region query returns everything in the bounding radius, not just "front-country individual campsites," and there's no obvious flag developers reliably filter on without reading FacilityTypeDescription/reservable fields carefully.

**How to avoid:**
- Explicitly filter RIDB area-search results by facility type (campground-only, not general "recreation area") and by reservable status before ever expanding into availability polling.
- Surface the resolved campground list to the user in the watch-creation UI *before* saving the watch ("This area watch will check: X, Y, Z") — the same visibility gap that let BANDIDO ship undetected in v1.0 must be closed for area watches, where the blast radius of a bad match is larger.
- Persist the resolved facility ID list alongside the area watch definition (not just the area query itself) so a specific bad match can be excluded without re-running the whole region resolution, mirroring the manual-pin fix pattern already used in v1.0.
- Add a lightweight allowlist/denylist per watch so a user can exclude a specific facility ID that turns out to be wrong, without abandoning the area watch entirely.

**Warning signs:**
Area watch's resolved-campground list includes names containing "Group," "Day Use," "Visitor Center," "Boat," "Ranger Station," or facility types outside "Campground" when reviewed manually; watch notification volume dramatically higher or lower than expected for the region.

**Phase to address:**
Area-search implementation phase — the resolution-to-facility-list step needs a review/confirmation UX and type filtering built in, not added after a bad match ships (as happened in v1.0).

---

### Pitfall 3: UI write path races the poller's own 5-minute commit-back cycle

**What goes wrong:**
The poller already commits `state.json`/`runs.json` to `main` every ~5 minutes via GitHub Actions. If the new watch-management UI also writes to `main` (to update `watches.json`) via the GitHub Contents API, the two writers are uncoordinated. GitHub's Contents API requires the current file `sha` for updates and returns 409 on mismatch (verified — this is a real, well-documented GitHub API behavior). A user edit landing between the poller's read-state and its own commit-back can either (a) fail with a 409 if the UI's write happens to touch a file the poller is also mid-commit on, silently swallowed if not handled, or (b) succeed but get **overwritten**: if the poller's next cycle reads `watches.json` at the start of a run that started before the UI's edit landed, and later commits `state.json`/`runs.json` based on that stale watch list, the *watches* themselves aren't clobbered (poller doesn't write `watches.json`) — but the poller could act on a stale watch list for one cycle, or worse, if any future change makes the poller also rewrite `watches.json` (e.g., normalizing/annotating it), that's a direct collision with the UI writer.

**Why it happens:**
v1.0's git-write path was designed for exactly one writer (the poller, guarded by the workflow's `concurrency` setting per PROJECT.md). Adding a second writer (the dashboard UI, from a completely different runtime — Vercel serverless/edge, not GitHub Actions) breaks the single-writer assumption the `concurrency` guard was built around; that guard only prevents overlapping *poller* runs, it does nothing for a Vercel function writing at the same time.

**How to avoid:**
- Keep `watches.json` writes exclusively owned by the UI/API route; never have the poller write to it (read-only from the poller's side) — this avoids the two-writer-same-file problem for the file that matters most.
- On write, always re-fetch the current `sha` immediately before commit and handle 409 with a bounded retry (re-fetch sha, re-apply the diff, retry once or twice) rather than failing silently or blindly overwriting.
- Treat the UI's write and the poller's read as eventually consistent — the poller already fetches `watches.json` fresh each cycle (per the deployment-agnostic pipeline shape), so a watch edited mid-cycle is simply picked up next cycle; document this latency (~≤5 min) in the UI so users aren't surprised a saved watch doesn't poll instantly.
- Do not have the UI write to `state.json` or `runs.json` under any circumstances — those remain poller-owned; keep a hard file-ownership boundary (UI owns `watches.json`, poller owns `state.json`/`runs.json`) to eliminate an entire class of races by construction rather than by locking.

**Warning signs:**
Watch edits that appear to "revert" or disappear after a poll cycle; 409s in Vercel function logs; a watch add/delete not reflected in the next dashboard poll-result view within one cron interval.

**Phase to address:**
Watch-management UI phase (the write-path implementation) — file ownership boundaries and 409-retry handling must be designed before the write endpoint ships, since this is the phase that introduces the second writer.

---

### Pitfall 4: Unauthenticated write endpoint on a public URL — assuming "single-user" means "no one else can find it"

**What goes wrong:**
The dashboard is public, no-auth, at a guessable/indexed Vercel URL (per PROJECT.md, already live at a public `.vercel.app` address). Adding a write path (create/edit/delete watch) to that same public, unauthenticated surface means *any internet user* who discovers the URL — via search engine crawl, Vercel's public deployment listing, a shared link, or simple guessing — can create, modify, or delete the owner's watches. Because `watches.json` lives in a public GitHub repo and controls what the poller does, this is a real (if low-probability) vector for someone to grief the tool: silently deleting all watches (denial of the tool's entire purpose), or spamming it with junk watches that burn the RIDB/availability rate budget from Pitfall 1, or — most concerning — pointing a watch's email-notification target if that ever becomes user-configurable (currently it isn't, per constraints, but this is exactly the kind of unauthenticated write endpoint that gets extended carelessly later).

**Why it happens:**
"Single-user tool" gets conflated with "not attacked" — but public URL + public repo + write endpoint = attackable by anyone, regardless of how many people are the *intended* user. v1.0's read-only dashboard was safe to leave unauthenticated because reads have no blast radius; adding *any* write endpoint changes that calculus even for a single-user tool, since the write endpoint doesn't know who "the" user is.

**How to avoid:**
- Do not ship an unauthenticated write endpoint. At minimum, gate writes behind a shared secret (e.g., a password/token stored as a Vercel env var, checked server-side, not exposed to the client) even for a "just me" tool — this is the minimum viable control, not full auth/accounts (which PROJECT.md explicitly keeps out of scope).
- Never let a client-side-only check (e.g., a password field with client-side comparison) gate the actual GitHub write — the write must happen server-side (Vercel API route/server action) with the secret validated server-side, since GitHub Contents API credentials (a PAT with `contents: write` on the repo) must never be shipped to the browser.
- Rate-limit or otherwise bound the write endpoint itself (e.g., max N watch-writes per hour) as defense in depth against a compromised/leaked secret or a scripted abuse attempt, independent of the RIDB-facing rate limiting in Pitfall 1.
- Scope the GitHub token used by the write endpoint as narrowly as possible (fine-grained PAT limited to this one repo, contents-only permission) so a leaked token's blast radius is capped to this repo, not the user's whole GitHub account.

**Warning signs:**
Any watch appearing in `watches.json` history (git log) that the user doesn't recognize creating; a spike in poll cycle duration or RIDB call volume uncorrelated with the user's own activity; the write endpoint accessible via a GET-turned-POST from browser devtools without any credential prompt.

**Phase to address:**
Watch-management UI phase, specifically the write-endpoint design step — auth-gating must be a first-class requirement of that phase's plan, not an afterthought discovered during review. This is a MUST-fix before merge, not a "nice to have" deferred item, given the write endpoint directly controls a script that commits to a public repo on a schedule.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Re-resolve area → facility list on every poll cycle instead of caching | Simpler code, always "fresh" | Multiplies RIDB calls 288x/day per area watch for data that rarely changes | Never at 5-min cadence; acceptable only if area resolution is moved to a much slower cadence (e.g., daily) |
| Let poller silently continue polling a resolved-but-now-deleted campground in a region until next re-resolution | Avoids extra RIDB calls | Wastes availability-endpoint budget on stale facilities; user may get notified about a campground that's actually closed/decommissioned | Acceptable short-term if re-resolution runs at least weekly and stale entries expire automatically |
| Skip 409-retry logic on the UI write path ("it'll rarely collide") | Faster to ship | Silent data loss on the (rare but real) cycle where a write lands mid-poller-commit; hard to debug after the fact since git history won't show a clean story | Never — retry-on-409 is cheap to add and the failure mode is a lost user edit |
| Password-gate the write endpoint instead of building real auth | Fast, matches "single user, no accounts" constraint | Shared secret can leak (browser history, screen share, committed by accident); no per-action audit trail | Acceptable for v1.1 given explicit no-multi-user-accounts constraint in PROJECT.md, provided secret is server-side only and rotatable |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|-------------------|
| RIDB `/facilities` geo search | Treating all returned facilities as "campgrounds" without filtering FacilityTypeDescription/reservable flags — repeats the v1.0 BANDIDO mismatch at region scale | Filter to campground-type, reservable facilities only; surface resolved list to user before saving watch |
| RIDB `/facilities` geo search | Re-querying RIDB on every poll cycle to re-resolve an area, burning into the 50 req/min RIDB limit alongside any concurrent poll activity | Cache the area → facility-ID resolution (daily or on-demand "refresh area" action), not every cron cycle |
| Recreation.gov undocumented availability endpoint | Assuming the "~1 req/sec" v1.0 convention scales linearly just by adding more calls per cycle without re-budgeting for area watches | Explicitly cap max campgrounds polled per cycle and stagger calls with real delays; treat this endpoint as *more* fragile under higher volume, not less, since it's undocumented and unrateilimited by contract |
| GitHub Contents API (new write path) | Writing without re-fetching `sha` immediately before the PUT, causing spurious 409s under any concurrent activity (including the poller's own unrelated commits to other files, which still advance the repo's HEAD) | Always fetch current file sha right before write; handle 409 with fetch-and-retry, not a hard failure surfaced to the user as "watch save failed" with no recovery |
| GitHub Contents API (new write path) | Shipping the GitHub PAT to the client/browser bundle (e.g., using it in a client component instead of a server action/API route) | All GitHub writes happen server-side only (Vercel API route/server action); token lives in Vercel env vars, never in client bundle |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| One availability call per campground per area watch per cycle, no cap | Cycle duration creeping toward/past 5 min; runs.json showing longer durations over time | Hard cap on facilities-per-area-watch + de-dup across watches + explicit inter-request delay | Breaks almost immediately with 2-3 area watches covering typical multi-campground regions (20-50 facilities each) |
| Re-resolving RIDB area search every poll cycle | RIDB call volume scales with poll frequency (288/day per area watch) instead of with region-data staleness | Cache resolution with a TTL (e.g., 24h), independent of the 5-min availability poll cadence | Breaks once more than a couple of area watches exist alongside pinned watches, competing for the same 50 req/min RIDB budget |
| Unbounded watch count from an open write endpoint (Pitfall 4) compounding with Pitfall 1's per-watch cost | Cycle duration and RIDB/availability call volume grow with any additions to `watches.json`, authorized or not | Cap total watches (and total resolved facilities across all watches) enforced server-side in the write endpoint, not just client-side UI validation | Breaks once total resolved-facility count across all watches exceeds what fits in the 5-min budget at the ~1 req/sec convention (roughly 300 calls/cycle ceiling, likely much lower in practice given RIDB's 50/min cap for resolution calls too) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Shipping the watch write endpoint with no auth gate at all, reasoning "it's a single-user tool" | Anyone with the public dashboard URL can delete/modify all watches, or spam junk watches that burn the RIDB rate budget and drown real notifications | Server-side shared-secret gate at minimum, validated in the API route, never in client-side JS |
| Embedding the GitHub PAT (contents:write) in client-visible code or a public env var (Vercel `NEXT_PUBLIC_*`) | Full repo write access leaks to anyone who opens devtools/view-source | Keep the token in a server-only Vercel env var, used only inside API routes/server actions, never `NEXT_PUBLIC_` |
| Using a broadly-scoped PAT (full account access) for the write endpoint out of convenience | A leaked token compromises far more than `watches.json` | Use a fine-grained PAT scoped to this one repo, contents permission only |
| No upper bound on watch count / resolved facilities accepted by the write endpoint | An abusive or accidental bulk-write (scripted, or even a UI bug) inflates poll cost past the RIDB/availability budget, degrading or breaking the tool for the real user | Server-side validation caps (max watches, max facilities per area watch) enforced in the write endpoint, independent of any client-side UI limits |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Saving an area watch without showing which campgrounds it resolved to | User can't tell if RIDB matched the wrong facility type (v1.0's BANDIDO bug repeats, invisibly) until a wrong/missing notification surfaces it | Show the resolved campground list (names + facility type) in the UI before/after save, with an option to exclude specific ones |
| UI implies watch edits take effect "instantly" | User assumes an edit is live, but poller only re-reads `watches.json` on its next 5-min cycle | Show "last polled" / "next poll in ~X min" status so the ≤5-min propagation delay is visible, not surprising |
| Write endpoint fails silently on a 409 (poller/UI race) | User's edit appears to save (200 in the browser) but is actually lost, with no indication | Surface write failures/retries clearly in the UI; only show "Saved" after a confirmed successful commit, not optimistically |

## "Looks Done But Isn't" Checklist

- [ ] **Area search:** Often missing facility-type/reservable filtering — verify the resolved list contains only actual reservable campgrounds, not visitor centers/day-use/group sites
- [ ] **Area search:** Often missing a request budget check — verify total resolved facilities across all active watches stays within a documented per-cycle cap before shipping
- [ ] **Watch write endpoint:** Often missing server-side auth — verify the write route rejects requests without the shared secret even if called directly (curl/devtools), not just hidden from the UI
- [ ] **Watch write endpoint:** Often missing 409/sha-conflict handling — verify a forced concurrent write (simulate poller commit + UI save at the same moment) doesn't silently lose the user's edit
- [ ] **Watch write endpoint:** Often missing server-side validation caps — verify the endpoint itself (not just the UI form) rejects an unreasonable watch count/facility count, since the UI's client-side limits are trivially bypassable

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|-----------------|------------------|
| Area watch resolved to wrong/irrelevant facilities (Pitfall 2) | LOW | Exclude the bad facility ID via the per-watch allowlist/denylist; no code change needed if that mechanism exists |
| RIDB/availability rate budget exceeded, requests start failing (Pitfall 1) | MEDIUM | Reduce area-watch facility cap, increase poll interval for area watches, or temporarily disable area watches via `watches.json` while re-tuning the cap |
| Lost watch edit due to git write race (Pitfall 3) | LOW-MEDIUM | Git history on `watches.json` preserves prior commits — the pre-loss state is recoverable from git log even if the write endpoint didn't retry; re-apply the edit manually if needed |
| Unauthorized write occurred (Pitfall 4) | MEDIUM | Git history shows exactly what changed and when; revert the offending commit on `watches.json`, rotate the shared secret and the GitHub PAT immediately |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|--------------------|----------------|
| Area search request-budget blowout | Area-search implementation phase | Load-test with a realistic multi-campground region watch; confirm cycle duration stays well under 5 min and RIDB/availability call counts are logged and capped |
| Area search name/type-resolution ambiguity | Area-search implementation phase | Manually review resolved facility list for at least one real region watch before merge; confirm facility-type filter excludes non-campground entries |
| Poller/UI git-write race on `watches.json` | Watch-management UI phase | Simulate a write during an in-flight poller commit (or review the 409-retry code path directly); confirm no silent data loss |
| Unauthenticated write endpoint | Watch-management UI phase | Attempt to call the write endpoint directly (no browser, no secret) and confirm it's rejected; confirm PAT is not present in any client-shipped bundle |

## Sources

- [RIDB API 1.0.0 OAS 3.0 (official docs)](https://ridb.recreation.gov/docs) — rate limit (50 req/min), facilities geo-search parameters
- [RIDB API documentation (usda.github.io/RIDB)](https://usda.github.io/RIDB/) — facility schema/type fields
- [GitHub Contents API 409 Conflict discussion](https://github.com/orgs/community/discussions/62198) — sha-mismatch conflict behavior under repeated/concurrent updates
- [google/go-github issue #2707 — Unable to update existing file, 409](https://github.com/google/go-github/issues/2707) — confirms sha-refetch-and-retry is the standard fix pattern
- `.planning/PROJECT.md` — v1.0 BANDIDO name-resolution bug, existing `~1 req/sec` convention, public-repo/no-auth constraints, single-writer `concurrency` guard on the poller workflow
- `.planning/milestones/v1.0-phases/03-status-dashboard/03-REVIEW.md` (referenced in PROJECT.md) — known v1.0 tech debt relevant to dashboard write-path additions (not read directly in this research pass; recommend reviewing before the UI phase starts)

---
*Pitfalls research for: Area-based campground search + watch-management write UI on an existing git-backed poller/dashboard system*
*Researched: 2026-08-25*
