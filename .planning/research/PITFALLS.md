# Pitfalls Research

**Domain:** Scheduled polling of a third-party (Recreation.gov) API + transactional email alerts, run unattended on serverless/cron infrastructure
**Researched:** 2026-08-16
**Confidence:** MEDIUM (Recreation.gov's undocumented "month availability" endpoint is well-covered by community tools like `camply` and `recreation-gov-campsite-checker`, but there is no official ToS/rate-limit doc for that specific endpoint — see notes below. RIDB metadata API rate limits are HIGH confidence.)

## Critical Pitfalls

### Pitfall 1: Using the wrong Recreation.gov endpoint (RIDB vs. undocumented availability endpoint) and hitting a wall on real-time data

**What goes wrong:**
Teams start with the official RIDB API (`ridb.recreation.gov/api/v1`) because it's documented and has a free API key, then discover it does not expose live per-site, per-night availability — it only has facility/campsite metadata (names, IDs, amenities, GPS). Real-time availability comes from a separate, undocumented JSON endpoint (`www.recreation.gov/api/camps/availability/campground/{id}/month?start_date=...`) that every community tool (`camply`, `banool/recreation-gov-campsite-checker`) actually uses. This endpoint has no published ToS, no published rate limit, no versioning guarantee, and can change shape without notice.

**Why it happens:**
The official-looking, documented RIDB API is the obvious starting point, but it doesn't cover the actual use case (live availability). Developers only discover the real endpoint via reverse-engineering the recreation.gov website network traffic or copying it from open-source projects.

**How to avoid:**
Use RIDB only for static facility/campsite lookup (resolving human-readable park names to facility IDs, listing campsite IDs within a campground). Use the `/api/camps/availability/campground/{id}/month` endpoint for live availability, treat it as an unofficial/undocumented dependency, and isolate it behind an adapter/interface so a schema change or endpoint swap only requires touching one module.

**Warning signs:**
Availability checks return empty/malformed data with no RIDB error; response JSON shape differs from what example code expects; site suddenly returns HTML instead of JSON (usually means blocked or redirected).

**Phase to address:**
Phase 1 (core polling engine) — isolate the availability-fetch behind an adapter from day one.

---

### Pitfall 2: Treating API/network errors as "no availability" and going silently dark, or alerting on every poll failure

**What goes wrong:**
Two opposite failure modes are both common: (a) a fetch error (timeout, 5xx, malformed JSON) is caught and swallowed, the watch loop just moves on, and the user never finds out the tool has effectively stopped working for days; (b) every transient error (a single 502, a DNS blip) immediately fires a "something's wrong" email, training the user to ignore alerts (alert fatigue) — which is exactly as bad as going dark when a real match happens.

**Why it happens:**
Polling error handling is usually an afterthought bolted on late. Developers focus on the happy path (found availability → email) and treat errors as edge cases rather than a first-class outcome that needs its own alerting policy.

**How to avoid:**
Distinguish "no availability found" (successful check, real answer) from "check failed" (couldn't get an answer) at the type level — never conflate them. For check failures: retry with backoff within the same run; only escalate to the user after N consecutive failed poll *cycles* (e.g., 3 cycles in a row, not 3 single requests), and send at most one "polling has been failing" digest email per incident (not one per cycle) with a cooldown before re-alerting for the same ongoing incident. Log every poll outcome (success/fail/match) somewhere durable so failures are diagnosable after the fact even without an email.

**Warning signs:**
No alert in weeks despite a park you know has churn; alert emails about errors arriving every 5 minutes; inability to answer "when did this last successfully run?" without checking logs manually.

**Phase to address:**
Phase 1–2 (polling engine + notification logic) — build the success/failure/match state machine before adding more watches or polish.

---

### Pitfall 3: Duplicate/spam emails because "match" state isn't persisted between runs

**What goes wrong:**
Each poll run is a fresh serverless invocation with no memory of prior runs. Without persisted state, the naive approach ("email whenever a watch finds an available site") re-sends an email every single poll cycle for as long as the site stays available — which, for a popular last-minute cancellation, could be a several-hour window and 40+ duplicate emails at a 5-10 minute cadence.

**Why it happens:**
Serverless/cron functions are stateless by default; it's easy to prototype against "does this watch currently have availability" and forget that "currently" needs to be diffed against "last known state," which requires external persistence (DB, KV store, or even a flat file/blob) that survives between invocations.

**How to avoid:**
Persist last-known-match state per watch (e.g., a hash of matched site IDs + dates, or a "last notified at" timestamp) in a durable store (SQLite file on a persistent volume, or a hosted KV/Postgres if going serverless). On each poll, diff current matches against persisted state: only email for *newly* appearing matches, and support an explicit re-notify cadence (e.g., "if still available after 6 hours, remind me once") rather than every cycle. Design this from the start — retrofitting dedup logic after users are already receiving spam is a trust-destroying bug to ship.

**Warning signs:**
Inbox getting 5+ near-identical emails for the same watch in an hour; no persisted state file/table exists in the architecture; state only lives in serverless function memory (resets every cold start).

**Phase to address:**
Phase 1 (core polling engine) — this is core to the "avoids duplicate/spammy alerts" requirement already in PROJECT.md; needs a persistence layer chosen before the polling loop is built, not bolted on later.

---

### Pitfall 4: Serverless function timeout when polling many watches sequentially

**What goes wrong:**
A single scheduled function that loops over N watches, each requiring 1+ HTTP calls to recreation.gov (potentially multiple months per watch if the date range spans month boundaries), can exceed the platform's execution timeout as watch count grows. Vercel Hobby caps functions at 10s (up to ~60s serverless / 300s Pro depending on plan); if the loop is sequential and each fetch takes 1-3s plus retries, a handful of watches with wide date ranges can blow the budget, causing silent partial failures (some watches never get checked that cycle) with no alert (cron invocations are fire-and-forget — a timeout or non-2xx doesn't page anyone by default).

**Why it happens:**
Works fine in dev/testing with 1-2 watches; nobody load-tests the scheduled function against a realistic watch count and date-range span before shipping.

**How to avoid:**
Fetch watches concurrently (with a bounded concurrency limit to stay under Recreation.gov's rate limit — see Pitfall 5) rather than sequentially. Cache/reuse a single month-fetch across watches that target the same campground+month instead of re-fetching per watch. Keep per-invocation work bounded and set an explicit internal deadline (e.g., abort remaining work at 80% of the platform timeout) so a slow watch doesn't starve the rest. If using Vercel Hobby, be aware cron can only fire once per day on Hobby — a "few minutes" cadence requires Pro or a non-Vercel scheduler (GitHub Actions cron, a VPS with cron, Railway/Fly.io scheduled jobs, etc.); factor this into the deployment-target decision explicitly.
Note also that Vercel cron invocations are "fire-and-forget" with no built-in failure alerting on lower tiers — pair the scheduled job with its own external heartbeat/dead-man's-switch (e.g., a healthcheck ping service) so a systemic failure to run doesn't go unnoticed indefinitely.

**Warning signs:**
Function logs show timeouts or truncated execution; some watches consistently never get an alert even for parks known to have openings; adding a new watch measurably increases run time; Hobby-plan cron silently only running once daily instead of every few minutes.

**Phase to address:**
Phase 1 (core polling engine, deployment choice) — the deployment-target decision (Vercel cron vs. self-hosted script) explicitly called out in PROJECT.md should be resolved with this timeout/cadence math in hand, not after the fact.

---

### Pitfall 5: Getting rate-limited or IP-blocked by Recreation.gov from over-aggressive or poorly-distributed polling

**What goes wrong:**
The RIDB metadata API enforces ~50 requests/minute (documented; raised with a free API key). The undocumented month-availability endpoint has no published limit, but community reports and forum discussion confirm recreation.gov actively pushes back on bot-like traffic (rate limiting, temporary blocks, occasional CAPTCHAs) especially around high-demand release windows. A tool that fans out many concurrent requests per poll cycle (one per watch, one per month in range) without any throttling can trip this, causing 429/403 responses that — per Pitfall 2 — must not be misread as "no availability."

**Why it happens:**
It's tempting to just fire all watch checks in parallel for speed, especially once Pitfall 4 pushes toward concurrency. Nobody budgets for backoff/jitter until they get blocked in production.

**How to avoid:**
Add a global rate limiter/queue in front of all outbound recreation.gov requests (bounded concurrency, e.g., 2-5 in flight, with small random jitter between requests) shared across all watches in a run, not per-watch. Send a legitimate `User-Agent` identifying the tool (not impersonating a browser) and, where available, use the free RIDB API key even though it's not strictly required for the availability endpoint — it signals good-faith registered usage. Implement exponential backoff on 429/5xx with a cap, and treat sustained rate-limiting as a "check failed" outcome (Pitfall 2), not a false "no availability."

**Warning signs:**
429/403 responses appearing in logs; availability checks that used to take 1-2s starting to hang or fail during known high-traffic windows (e.g., midnight when 6-month release windows open); IP-based temporary blocks correlating with poll cycles.

**Phase to address:**
Phase 1-2 (polling engine hardening) — build the rate limiter alongside the initial fetch adapter; don't wait until watch count grows.

---

### Pitfall 6: Transactional alert emails landing in spam, so the "fast enough to book it" promise silently fails

**What goes wrong:**
The entire value proposition of this project is "email fast enough to act." If the alert lands in spam/promotions or is delayed by greylisting, the user finds out too late — the core value silently fails without the system ever knowing (email services report "delivered" even when the destination places it in spam). Sending from an unauthenticated/unverified domain, using a shared low-reputation "from" address, or triggering spam heuristics (urgent subject lines like "AVAILABLE NOW!!", link-heavy body) compounds the risk. About 17% of a major provider's transactional email volume has been reported landing in spam even post-"delivery."

**Why it happens:**
For a single-user personal tool, it's tempting to skip domain verification/DKIM/SPF setup and just use the email provider's default sending domain or a quick "send from noreply@provider-shared-domain.com" — it works in testing (test inbox has no spam history) but degrades once the sending pattern looks automated over time.

**How to avoid:**
Verify a custom sending domain with the transactional provider (Resend/SendGrid) and set up SPF, DKIM, and ideally DMARC records before relying on it. Keep the email content simple, personal, and low-urgency-language (plain text or minimal HTML, clear subject like "Campsite open: {park} {dates}" rather than clickbait). Since it's single-recipient, explicitly whitelist the sending address in the destination inbox (Gmail filter: "never send to spam") as a belt-and-suspenders step — cheap insurance for a single-user tool. Consider a secondary/redundant delivery signal (e.g., also log matches somewhere checkable) so a missed email isn't a total loss.

**Warning signs:**
Test emails landing in spam/promotions during development; no SPF/DKIM configured on the sending domain; using the provider's shared/default domain instead of a verified custom one.

**Phase to address:**
Phase 2 (notification delivery) — set up domain auth and inbox whitelisting as part of "email sending" work, not as a later polish item.

---

### Pitfall 7: Hardcoding or loosely handling secrets (API keys, email service keys) in a scheduled/serverless context

**What goes wrong:**
Single-user tools often skip proper secrets hygiene because "it's just me" — committing a `.env` with real keys to a public GitHub repo (common for personal project portfolios), logging full request/response payloads that include the email API key in headers, or using the same email-provider API key with full account permissions instead of a scoped/sending-only key. On serverless platforms, secrets set as plain environment variables are visible to anyone with dashboard/CI access and can leak into build logs if not marked "sensitive."

**Why it happens:**
Fast personal-project iteration deprioritizes secret scoping; committing example `.env.example` files sometimes accidentally becomes committing real `.env`.

**How to avoid:**
Never commit `.env` (verify `.gitignore` from the first commit); use the deployment platform's encrypted/sensitive env var storage (Vercel "Sensitive" env vars, GitHub Actions Secrets); scope the email provider API key to "send only" permissions if the provider supports scoped keys; avoid logging full HTTP headers/bodies in error logs (redact Authorization headers); rotate keys if a repo was ever public with a real key committed, even briefly.

**Warning signs:**
`git log` shows a `.env` file was ever tracked; logs contain `Authorization:` header values; the email API key used has full account access (contacts, domains, billing) rather than send-only scope.

**Phase to address:**
Phase 0/1 (project setup) — establish `.gitignore`, secret scoping, and env var conventions before the first real API key is generated.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|-----------------|
| Storing watch/match state in an in-memory object or plain file on ephemeral serverless storage | Ships faster, no DB setup | State lost on cold start/redeploy → duplicate emails resurface (Pitfall 3) | Never for the match-dedup state; acceptable only for truly disposable caches |
| Polling every watch sequentially instead of building a rate-limited queue | Simpler code, one loop | Timeout risk grows linearly with watch count (Pitfall 4); no backpressure against Recreation.gov (Pitfall 5) | OK for v1 with 1-3 watches and a wide time budget; must be revisited before adding many watches |
| Sending from provider's default/shared domain instead of verifying a custom domain | Zero DNS setup, works immediately | Higher spam-folder risk over time as sending patterns look automated (Pitfall 6) | Acceptable only during initial dev/testing, not for the live alerting path |
| Catching all fetch errors and just `console.log`-ing them | Fast to write, doesn't crash the function | Silent dark periods with no user awareness (Pitfall 2) | Never beyond a throwaway prototype |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|-------------------|
| Recreation.gov RIDB API | Assuming RIDB exposes live per-site availability | Use RIDB only for facility/campsite metadata; use the separate undocumented `/api/camps/availability/campground/{id}/month` endpoint for live availability |
| Recreation.gov availability endpoint | Treating an empty/error response as "no availability" | Explicitly distinguish HTTP/parse errors from a valid "0 sites available" response |
| Vercel Cron | Assuming cron fires exactly on schedule and alerts on failure | Cron timing can drift up to the next hour boundary; invocations are fire-and-forget with no default failure alert — add an external heartbeat check |
| Resend/SendGrid | Using default sending domain, no SPF/DKIM | Verify custom domain, configure SPF/DKIM/DMARC before relying on delivery |
| Serverless env vars | Storing API keys as plain (non-sensitive) env vars visible in dashboard/logs | Use platform's encrypted/sensitive secret storage; scope keys to minimum required permission |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Sequential per-watch fetching | Run time grows linearly with watch count; timeouts start appearing | Bounded-concurrency fetch queue, dedupe fetches by campground+month across watches | Around 5-10 watches with multi-month date ranges on a 10-60s serverless timeout |
| Re-fetching the whole month's data every poll cycle even when nothing changed | Wasted requests, higher rate-limit exposure | Cache last-fetched month payload with a short TTL if polling faster than data actually changes upstream | High-frequency polling (sub-5-min) against a source that doesn't update that fast |
| One email send per poll cycle per matched watch | Provider send-rate limits/costs climb, inbox spam risk climbs | Dedup via persisted match state (Pitfall 3), batch multiple new matches across watches into one digest email per cycle | Multiple simultaneous watches all matching around the same time |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Committing `.env` with real API keys to a (possibly public) repo | Key theft, abuse of email-sending quota, exposure of personal watch config | `.gitignore` from first commit; verify with `git status`/`git log` before pushing; rotate immediately if ever exposed |
| Using a full-access email API key instead of a scoped "send-only" key | Compromise of the key exposes contacts/domains/billing, not just sending | Create a scoped key limited to transactional sending if the provider supports it |
| Logging full HTTP request/response including Authorization headers on error | Secrets end up in log storage/observability tooling with looser access control | Redact sensitive headers before logging; log status/body only |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Alert email doesn't include a direct booking link or is missing key details (site number, dates) | User has to manually search recreation.gov again, losing the speed advantage the whole tool exists for | Include a direct deep link to the specific campground/date on recreation.gov, plus site ID/number and dates in the email body and subject |
| Silent failure mode with no way to check "is this even running" | User loses trust, assumes tool is broken or stops checking email | Provide a lightweight heartbeat/status signal (e.g., a periodic "still watching, no changes" digest at a much lower frequency, or a status endpoint/log the user can check) |
| Generic subject line for all alerts | Easy to miss in a busy inbox, gets buried, or gets auto-filtered | Distinct, specific subject per match: park + dates, so it's scannable and less likely to look automated/spammy |

## "Looks Done But Isn't" Checklist

- [ ] **Duplicate suppression:** Often missing persisted state between invocations — verify by running two consecutive poll cycles against a known-available site and confirming only one email is sent
- [ ] **Error vs. no-match distinction:** Often conflated — verify by simulating a network failure (e.g., point at an invalid host temporarily) and confirming it does NOT produce a "no availability" false negative silently, and does NOT spam an error email per cycle
- [ ] **Deployment cadence match:** Often overlooked — verify the chosen scheduler actually supports the "every few minutes" cadence in PROJECT.md (Vercel Hobby cron does not; Pro or an alternative scheduler does)
- [ ] **Email deliverability:** Often skipped for personal tools — verify SPF/DKIM pass and the test alert lands in Primary/Inbox, not Spam, on the actual destination account
- [ ] **Rate-limit resilience:** Often untested until it breaks in production — verify behavior under a simulated 429 (backoff, escalation only after sustained failure, no false "no availability")
- [ ] **Secrets hygiene:** Often assumed fine for "just me" projects — verify `.env` was never committed and API keys are stored as sensitive/encrypted platform secrets

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|-----------------|
| Duplicate email spam already shipped to users | LOW | Add persisted match-state store, backfill a migration to seed initial "already notified" state so existing matches don't re-fire on deploy |
| API key committed to a public repo | MEDIUM | Rotate the key immediately at the provider, scrub git history (`git filter-repo` or BFG) if repo must stay public, treat any usage in the interim as compromised |
| Emails landing in spam after launch | MEDIUM | Verify custom domain + SPF/DKIM/DMARC retroactively, ask user to whitelist sender, consider domain warm-up period with low volume before relying on it fully |
| Function silently failing/timing out for weeks unnoticed | LOW-MEDIUM | Add an external heartbeat/dead-man's-switch monitor immediately; backfill logging so future silent failures are diagnosable |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| Wrong/undocumented endpoint reliance | Phase 1 (core polling engine) | Adapter module isolates availability-fetch logic; RIDB used only for metadata |
| Errors mistaken for "no availability" / silent dark periods / error-spam | Phase 1-2 (polling engine + notifications) | Simulated failure test shows correct 3-state handling (match/no-match/check-failed) and single incident email, not per-cycle |
| Duplicate/spam emails on repeat matches | Phase 1 (core polling engine — persistence layer) | Two consecutive poll cycles against a known match produce exactly one email |
| Serverless timeout with many watches | Phase 1 (polling engine + deployment choice) | Load test with realistic watch count stays well under platform timeout; deployment platform's cadence limits confirmed to meet "every few minutes" requirement |
| Rate-limited/blocked by Recreation.gov | Phase 1-2 (polling engine hardening) | Concurrency-limited queue with backoff exists; 429 handling verified not to cause false negatives |
| Alert emails in spam | Phase 2 (notification delivery) | Domain verified, SPF/DKIM pass, test alert confirmed in destination Inbox |
| Secrets mishandling | Phase 0/1 (project setup) | `.gitignore` covers `.env`; secrets stored as platform-encrypted vars; email key scoped to send-only if supported |

## Sources

- [Recreation Information Database API — PublicAPI](https://publicapi.dev/recreation-information-database-api) (RIDB rate limits, ~50 req/min, optional API key) — MEDIUM confidence
- [GitHub - banool/recreation-gov-campsite-checker](https://github.com/banool/recreation-gov-campsite-checker) — community reference implementation showing use of the undocumented availability endpoint — MEDIUM confidence
- [camply on PyPI](https://pypi.org/project/camply/) — established open-source campsite availability monitor, confirms notify-only (no auto-book) pattern — MEDIUM confidence
- [No, "bots" didn't steal your campsite - Here & There](https://www.hereandthere.club/p/no-bots-probably-didnt-take-your) — community/press discussion of campsite notifier bots and Recreation.gov's stance — LOW-MEDIUM confidence
- [Troubleshooting Vercel Cron Jobs | Vercel Knowledge Base](https://vercel.com/kb/guide/troubleshooting-vercel-cron-jobs) — official, fire-and-forget behavior, timing imprecision — HIGH confidence
- [Vercel cron jobs limit: Hobby plan caps and how to beat them](https://crontap.com/blog/vercel-cron-hourly-limit-and-how-to-beat-it) — Hobby plan once-daily cron limitation — MEDIUM confidence
- [Best Practices Learned from Production Use of Vercel Cron](https://zenn.dev/asoventure/articles/2026-06-28-vercel-cron-best-practices?locale=en) — timeout/queue pattern recommendations — MEDIUM confidence
- [SendGrid Email Deliverability: The Real Truth for B2B Cold Senders (2026)](https://www.mailreach.co/blog/sendgrid-email-deliverability) — ~17% spam-folder rate stat, shared-stream reputation issue — MEDIUM confidence
- [Transactional Email for Bootstrapped SaaS: Resend vs SendGrid vs Postmark vs Mailgun in 2026](https://f3fundit.com/transactional-email-bootstrapped-saas-resend-sendgrid-postmark-mailgun-2026/) — provider comparison, domain auth guidance — MEDIUM confidence

---
*Pitfalls research for: Recreation.gov campsite availability watcher (scheduled polling + email alerts)*
*Researched: 2026-08-16*
