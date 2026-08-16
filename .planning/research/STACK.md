# Stack Research

**Domain:** Scheduled polling + transactional email notification service (single-user, no UI)
**Researched:** 2026-08-16
**Confidence:** MEDIUM-HIGH (deployment/scheduling and email findings are HIGH confidence, verified against current docs/changelogs; the campsite-availability data source itself is MEDIUM confidence because the only endpoint that returns real per-day availability is undocumented)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22.x LTS (24.x LTS also fine) | Runtime for the poller script | Matches GitHub Actions' default `ubuntu-latest` runner tooling, first-class `fetch`, no build step needed for a script this small. HIGH confidence. |
| TypeScript | 5.7+ | Type safety for API response shapes, watch config | RIDB/undocumented availability responses are easy to get wrong (nested date maps, enum-like status strings); types catch this at edit time instead of 3am when a watch silently stops matching. HIGH confidence. |
| tsx | 4.x | Run TypeScript directly in CI without a compile step | Simplest way to execute a `.ts` script inside a GitHub Actions job — no `tsc` build artifact to manage for a script-only project. HIGH confidence. |
| GitHub Actions (`schedule` trigger) | n/a (hosted) | Recurring job runner ("every few minutes") | See full comparison below — this is the deployment recommendation. HIGH confidence. |
| Resend | `resend` npm package (current major: 6.x, e.g. `resend@6.20.0`) | Transactional email delivery | Best-in-class DX for a single triggered email per event, generous free tier (3,000 emails/mo, 100/day), official typed Node SDK, minutes to set up. HIGH confidence. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | 3.x / 4.x | Validate watch config (env vars / JSON file) and RIDB/availability API responses at runtime | Always — config typos and upstream API shape drift are the two most likely silent-failure modes for this project. |
| `dotenv` | 16.x | Load `.env` for local dev only | Local development runs; not needed in GitHub Actions (use encrypted repo Secrets instead). |
| `p-limit` | 6.x | Cap concurrent outbound requests when polling multiple watches/campgrounds | Only if a user configures many watches (5+) hitting the availability endpoint in the same run — keeps you under the informal ~1 req/sec courtesy limit (see Pitfalls). |
| `date-fns` (or plain `Intl`) | 4.x | Date-range math for watches (nights, month boundaries) | The availability endpoint is queried per-calendar-month, so watches spanning month boundaries need 2+ fetches — a date library keeps that logic readable. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| GitHub encrypted Secrets | Store `RECREATION_GOV_API_KEY` (optional), `RESEND_API_KEY`, `NOTIFY_EMAIL`, watch config | Set via repo Settings → Secrets and variables → Actions. Never commit these. |
| GitHub Actions `concurrency` group | Prevent overlapping runs if a job takes longer than the schedule interval | Set `concurrency: { group: poller, cancel-in-progress: false }` on the workflow so a slow run doesn't race a new one and corrupt the state file. |
| ESLint + Prettier (optional) | Basic lint/format | Not load-bearing for a script this size, but cheap to add if you want CI to fail fast on obvious mistakes. |

## Installation

```bash
# Core
npm install resend zod

# Dev / runtime helpers
npm install -D typescript tsx @types/node

# Optional, only if you have many watches or want date-range helpers
npm install date-fns p-limit
```

## The Data Source: RIDB vs. the actual availability endpoint

This is the most important finding of this research and directly shapes the architecture:

**RIDB (Recreation Information Database) API** — `https://ridb.recreation.gov/api/v1/` — is the *official, documented* API. It covers facility/campground/campsite **metadata** (names, IDs, locations, amenities) across NPS, USFS, BLM, USACE, BOR, and FWS. An API key is optional (free, self-serve at recreation.gov/use-our-data) and only raises rate limits — it is not required for basic metadata lookups. **Confidence: HIGH** (official docs).

**RIDB does not expose real-time per-day campsite availability.** The actual "is site X open on date Y" data comes from an **undocumented internal endpoint** that recreation.gov's own website JavaScript calls:

```
GET https://www.recreation.gov/api/camps/availability/campground/{campground_id}/month?start_date=YYYY-MM-01T00:00:00.000Z
```

This returns, per campsite, a map of date → status (`Available`, `Reserved`, `Not Available`, etc.) for that calendar month. It is the endpoint used by essentially every community campsite-availability tool (`camply`, `recreation-gov-campsite-checker`, `recgov_daemon`, and the various Apify scrapers). **Confidence: MEDIUM** — verified through multiple independent open-source implementations and community write-ups, not through official Recreation.gov documentation, because none exists for this endpoint. Treat it as stable-but-unofficial: it has been consistent for years, but Recreation.gov could change or block it without notice.

**Practical implications for the roadmap:**
- Use RIDB (documented, official) to resolve a human-entered park/campground name to a `campground_id` — do this once, not on every poll.
- Use the undocumented `/api/camps/availability/campground/{id}/month` endpoint for the actual polling loop.
- Send a realistic browser `User-Agent` header on requests to the availability endpoint — requests with generic HTTP-library user agents are the most commonly reported cause of 403s in community trackers.
- Respect an informal ~1 request/second pace and keep concurrent requests low; the community norm for personal-use polling is roughly every 5 minutes per campground, not tighter. This project's "every few minutes" cadence fits that norm — going much tighter (e.g. every 30s across many campgrounds) risks getting blocked.
- No official rate-limit numbers are published for the unofficial endpoint (there wouldn't be — it's not a public API). Design the poller to back off and log on non-200s rather than retry aggressively.

## Deployment/Scheduling Recommendation: GitHub Actions over Vercel Cron

This was the central open question and the research gives a clear answer.

**Recommendation: GitHub Actions scheduled workflow (`on: schedule`).**

| Option | Verdict | Why |
|--------|---------|-----|
| **GitHub Actions scheduled workflow** | ✅ Recommended | Minimum interval is 5 minutes (matches "every few minutes" requirement exactly). Free and effectively unlimited on a **public** repo; on a private repo, free tier is 2,000 Linux minutes/month — a ~30–60s script run every 5 min is ~2,600–5,200 min/month, which **exceeds the private-repo free tier**. Two fixes: (a) make the repo public (config lives in GitHub Secrets, not the repo, so no credentials are exposed) and get unlimited minutes, or (b) poll every 10–15 min instead of 5 to stay within the private-repo budget. Either way, zero servers to manage, and state can be persisted by committing a file back to the repo (see Persistence below). |
| **Vercel Cron (Hobby/free plan)** | ❌ Not viable | Hobby plan caps cron jobs at **once per day**, with timing only guaranteed within the hour. This directly fails the "every few minutes" requirement — confirmed via Vercel's own docs/changelog. |
| **Vercel Cron (Pro plan)** | ⚠️ Viable but costs money for no added benefit | Pro plan supports per-minute cron cadence. Works, but costs $20/month minimum for a single-user hobby project that GitHub Actions does for free. Only makes sense if the user already pays for Vercel Pro for other reasons and wants everything in one dashboard. |
| **Self-hosted node-cron (always-on process)** | ❌ Not recommended for v1 | Requires a server/VPS that's always running (Fly.io, Railway, a Raspberry Pi, etc.) — adds real infrastructure (uptime, restarts, OS patching) for a workload that a free hosted scheduler already solves. Only reconsider if polling needs get much more frequent (sub-minute) or stateful in ways serverless can't support. |

**Bottom line:** GitHub Actions is free, requires no infrastructure, matches the required polling cadence natively (5-min minimum granularity vs. Vercel Hobby's 1-day minimum), and the project already needs a git repo for config/code — there's no separate platform to provision. Vercel's Hobby tier is disqualified by its cron frequency floor; Vercel Pro works but costs money the project doesn't need to spend.

**Caveat (MEDIUM confidence):** GitHub Actions scheduled workflows are best-effort, not real-time — community reports document 5–30 minute delays during peak GitHub load, and (rarely) a scheduled run can be silently skipped entirely under queue pressure. For a "grab it before someone else does" use case this matters somewhat, but it's a tradeoff every free scheduler shares (Vercel Hobby is far worse — 1x/day). If reliability becomes a real problem in practice, the mitigation is upgrading to a paid, guaranteed scheduler (Vercel Pro cron, or a dedicated cron-monitoring service that pings the workflow) rather than switching architectures.

## Transactional Email: Resend

**Recommendation: Resend**, via the official `resend` npm package.

- **Free tier:** 3,000 emails/month, capped at 100/day, one verified sending domain. Vastly more than a single-user watch-notification tool needs (even checking every 5 minutes across several watches, actual *notification* emails — only sent on new matches — will be a tiny fraction of poll runs).
- **Setup basics:**
  1. Sign up at resend.com, verify a sending domain (or use their shared testing domain for initial dev) via DNS records (SPF/DKIM).
  2. Generate an API key, store as `RESEND_API_KEY` in GitHub Actions Secrets.
  3. `npm install resend`, then:
     ```ts
     import { Resend } from 'resend';
     const resend = new Resend(process.env.RESEND_API_KEY);
     await resend.emails.send({
       from: 'watcher@yourdomain.com',
       to: process.env.NOTIFY_EMAIL!,
       subject: 'Campsite available: <site name>',
       text: '...',
     });
     ```
  4. No SMTP server, no queue infrastructure — a single synchronous API call per notification, well suited to a short-lived Actions job.
- Confidence: HIGH — verified via npm package page (current major v6.x) and Resend's own docs/changelog for 2026 feature set and pricing.

## Minimal Persistence: Avoiding Duplicate Notifications

The project needs to remember "have I already emailed about this specific opening?" across runs. Given the GitHub Actions recommendation, the simplest options, in order of preference:

1. **Commit a small JSON state file back to the repo after each run** (recommended for v1).
   - The workflow, after checking availability and sending any emails, writes a `notified-state.json` (e.g. `{ "campgroundId:campsiteId:date": timestampNotified }`) and does a `git commit` + `git push` as the final step using the built-in `GITHUB_TOKEN`.
   - Zero external services, zero extra credentials, fully inspectable/auditable via git history, works within the free GitHub Actions minutes already budgeted.
   - Tradeoffs: adds a commit to the repo on every run that has state changes (fine — can prune/squash later, or `.gitignore` the file's history noise isn't a real cost for a personal tool); requires the `concurrency` guard mentioned above to avoid two overlapping runs both trying to push.
2. **Upstash Redis (free tier), accessed via REST API** — reasonable alternative if the git-commit approach feels awkward.
   - Serverless-friendly (HTTP-based, no persistent connection), generous free tier (500K commands/month far exceeds this project's needs), works identically whether the poller runs in GitHub Actions or Vercel.
   - Adds one more external service/credential vs. option 1's zero-additional-infra approach — only worth it if the project later grows beyond a single JSON blob's worth of state.
3. **SQLite file / local database** — ❌ not viable as the sole store. GitHub Actions runners (and Vercel serverless functions) are ephemeral — nothing written to local disk survives past the end of the run unless explicitly persisted elsewhere (git commit, external DB, or a cache action). Only useful as an in-memory/scratch structure during a single run, not for cross-run dedupe state.

**Recommendation: option 1 (commit JSON state to the repo)** for v1 — it requires no new accounts, no new secrets, and is trivially debuggable (state history is git history). Revisit Upstash Redis only if commit-noise or race conditions become an actual problem.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| GitHub Actions scheduled workflow | Vercel Cron (Pro plan, $20/mo) | User already pays for Vercel Pro and wants scheduling/deploys/logs unified in one dashboard; willing to spend $20/mo for guaranteed per-minute cadence and better run-time guarantees than GH Actions' best-effort scheduler. |
| GitHub Actions scheduled workflow | Always-on VPS + node-cron/PM2 | Polling needs to go sub-minute, or the project grows to need a long-running process (e.g. websocket/stream-based checking) that a short-lived scheduled job architecture can't support. |
| Commit JSON state file to repo | Upstash Redis (free tier) | Commit-based state starts to feel noisy/racy, or state needs to be shared with a future web UI/dashboard outside of git. |
| Resend | Amazon SES | Already deep in AWS infra and want to minimize vendor count; SES is cheaper at high volume but has rougher DX (manual DKIM/domain verification, sandbox mode by default) — not worth the setup friction for a low-volume single-user tool. |
| Resend | SendGrid | Legacy choice with more enterprise features; DX and free-tier generosity are worse than Resend for this scale of project — no reason to choose it new in 2026 for a project this size. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| Vercel Cron on the Hobby (free) plan | Hard-capped at once/day, with only hour-level timing precision — cannot satisfy an "every few minutes" polling requirement at all, regardless of code quality. | GitHub Actions `schedule` trigger (5-min minimum granularity, free). |
| Web scraping recreation.gov's rendered HTML/booking pages directly (e.g. headless browser automation) | Far more fragile than calling the same JSON endpoint the site's own frontend calls; heavier (needs a browser runtime), slower, and more likely to trip anti-bot defenses than a plain `fetch` with a realistic User-Agent. Also explicitly what the project's own constraints want to avoid ("must use official/public API rather than scraping HTML"). | Direct `fetch` calls to RIDB (metadata) + the availability JSON endpoint (per-day status), which is what the project's data actually needs. |
| SQLite/local file as the *only* persistence layer on a serverless or Actions-runner deployment | Ephemeral compute — local disk writes vanish at the end of every run, so "already notified" state silently resets and users get duplicate/spam emails on every single run. | Commit state back to the git repo (v1) or Upstash Redis (if it grows). |
| A generic SMTP library (e.g. Nodemailer) against a personal Gmail account | Personal Gmail SMTP is rate-limited, prone to being flagged as spam/suspicious sign-in, and not designed for programmatic sending — brittle for an unattended service that must reliably deliver time-sensitive alerts. | Resend (or any dedicated transactional email API) with a verified sending domain. |

## Stack Patterns by Variant

**If the user already pays for Vercel Pro for other projects:**
- Use Vercel Cron (per-minute cadence) + a Vercel KV/Upstash-backed state store instead of GitHub Actions.
- Because the marginal cost is $0 (already paying) and it consolidates deploys/logs/cron in one dashboard, with better timing guarantees than GH Actions' best-effort scheduler.

**If watch count grows large (dozens of campgrounds) or polling needs to tighten below 5 minutes:**
- Move off GitHub Actions' scheduled-workflow model entirely toward an always-on lightweight worker (e.g. Fly.io machine, Railway cron/worker) running `node-cron` or a simple `setInterval` loop.
- Because GitHub Actions' 5-minute schedule floor and per-run cold-start overhead become limiting factors, and a long-running process can rate-limit/queue requests more gracefully across many watches.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `resend@6.x` | Node.js 18+ (Node 22/24 recommended) | Uses native `fetch`; no extra HTTP client needed. |
| `tsx@4.x` | Node.js 18+ | Used only to execute the script in CI; no bundling/build step required for a single-file or small-module poller. |
| GitHub Actions `ubuntu-latest` runner | Node.js pinned via `actions/setup-node` | Pin an explicit Node version (e.g. `node-version: '22'`) rather than relying on the runner's default, since the default image's bundled Node version changes over time. |

## Sources

- Vercel Cron Jobs official docs (`vercel.com/docs/cron-jobs`, `vercel.com/docs/limits`) — Hobby once/day cap, Pro per-minute cadence, hour-level timing precision on Hobby. HIGH confidence.
- Vercel changelog, "Cron jobs now support 100 per project on every plan" — per-project job count limits. HIGH confidence.
- GitHub Actions official docs / community discussions on `schedule` trigger — 5-minute minimum interval, best-effort timing, occasional skipped runs under load. MEDIUM-HIGH confidence (behavior corroborated by multiple independent community reports, not just one source).
- GitHub Actions pricing pages (cicdcalculator.com, cicdcost.com, github.blog changelog Dec 2025/Jan 2026) — public repos free/unlimited, private repos 2,000 free Linux minutes/month, Jan 2026 per-minute rate cuts. MEDIUM-HIGH confidence (consistent across multiple current sources).
- RIDB API (`ridb.recreation.gov`) — official documented metadata API, optional API key only raises rate limits. HIGH confidence for existence/purpose; endpoint-level rate-limit numbers not independently confirmed from an official source in this pass — treat specific "requests/minute" figures as MEDIUM confidence pending a direct read of the RIDB developer portal.
- Community open-source campsite-availability tools (`banool/recreation-gov-campsite-checker`, `juftin/camply`, `rmjacobson/recgov_daemon`) — corroborate the undocumented `www.recreation.gov/api/camps/availability/campground/{id}/month` endpoint pattern and the ~5-minute personal-use polling norm. MEDIUM confidence (multiple independent implementations agree, but no official documentation exists for this endpoint by nature).
- Resend npm package page (npmjs.com/package/resend) and resend.com/changelog — current major version (6.x), free-tier limits (3,000/mo, 100/day). HIGH confidence.

---
*Stack research for: Recreation.gov campsite availability watcher (scheduled polling + email notification)*
*Researched: 2026-08-16*
