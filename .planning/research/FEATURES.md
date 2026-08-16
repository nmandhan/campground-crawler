# Feature Research

**Domain:** Recreation.gov campsite availability watcher / "campsite sniper" tools
**Researched:** 2026-08-16
**Confidence:** MEDIUM

Research is based on publicly documented behavior of the two dominant patterns in this space:
1. **Commercial SaaS watchers** (Campnab, and similarly-positioned CampFlare/Schnerp/Campsite Notifier) — paid, SMS-first, sell "concurrent scans" as the product.
2. **Open-source CLI/self-hosted tools** (camply, banool/recreation-gov-campsite-checker, recbot) — free, run by the user, notification channel is pluggable.

Recreation.gov also shipped its own native "Campsite Availability Alerts" (Sept 2023) limited to 3 campgrounds at a time, frontcountry-only — this sets the baseline floor of what "good enough" looks like for casual users, and is a useful reference for table-stakes scope.

Note: exact internals of these tools (dedup logic, polling implementation) are not fully open/documented for the commercial products — findings there are inferred from FAQ/marketing copy (MEDIUM confidence) rather than source code. The open-source tools' behavior is more directly verifiable from source/docs but the fetched docs excerpts didn't expose full implementation detail either — flagged LOW/MEDIUM per item below.

## Feature Landscape

### Table Stakes (Users Expect These)

Features a v1 tool cannot ship without — missing these makes the tool useless or untrustworthy for its one job.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Define one or more watches (park/campground + date range + site/equipment type) | This is the entire product — every competitor (Campnab, camply, recreation.gov native alerts, recbot) is built around "tell me what you want, I'll watch for it" | LOW–MEDIUM | Config-file/env driven per PROJECT.md; commercial tools expose this via UI, but the underlying data model (park, campground, dates, site filters) is identical |
| Recurring automated polling against the real API, unattended | Users deliberately want to stop manually refreshing recreation.gov; if it requires manual triggering it isn't a "watcher" | LOW–MEDIUM | Recreation.gov exposes a public availability API (`/api/camps/availability/campground/{id}/month`) that all known tools (camply, banool/checker) use instead of scraping HTML |
| Notification the moment a matching site becomes available | Core value prop across every tool in this space — Campnab explicitly markets speed as the differentiator ("spots go quickly") | LOW | Timing (poll interval) is the actual lever, not the notify mechanism itself |
| Duplicate/spam suppression — don't re-alert every poll cycle for a still-open site | Campnab explicitly designed around "notify only on reserved→open transition"; users on forums complain about noisy tools that alert repeatedly for known-open sites | MEDIUM | Requires state tracking (last-known-availability per site+date) between poll runs — see Feature Dependencies below |
| Actionable notification content: campground/park name, specific site number/ID, date(s), and a direct booking link | Campnab's SMS format (park, campground, arrival date, duration, site number, direct link) is the proven pattern; without a direct link the user loses precious seconds navigating recreation.gov manually during a race against other campers | LOW | Recreation.gov site/campground pages are linkable by ID (`recreation.gov/camping/campsites/{siteId}`) so this is just URL templating, not scraping |
| Support for multiple concurrent/independent watches without cross-contamination | Every tool (Campnab tiers by "concurrent scans," camply accepts multiple park IDs, recreation.gov native caps at 3) treats "watch N things at once" as core, not a stretch feature | MEDIUM | Each watch needs its own dedup/state so one watch's "already notified" doesn't suppress a different watch's match on the same site |
| Reliable, unattended scheduling (cron/serverless cron) | If the poller silently stops, the entire value proposition (catching a sub-minute-window opening) fails silently and the user has no recourse | LOW–MEDIUM | Ties directly into the deployment decision (Vercel cron vs. scheduled script) flagged as open in PROJECT.md |
| Handles API errors/rate limits gracefully (retry, backoff) without crashing the schedule | Recreation.gov's API is unofficial/public but not a stable partner API — commercial tools throttle deliberately ("we deliberately don't scan faster than 1-4 min to avoid over-tasking the park systems") to avoid being blocked | LOW–MEDIUM | Also protects the user's own IP/API key from being rate-limited or blocked |

### Differentiators (Competitive Advantage)

Not required for v1, but where this tool could be noticeably better than the low end of the market (recreation.gov's native alerts) without matching the complexity of full commercial SaaS.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Fast poll interval (1–5 min) on hot dates | Campnab explicitly tiers pricing by poll speed (1-4 min = premium tier); faster polling = more likely to catch a fleeting opening before other watchers | LOW–MEDIUM | Mostly a scheduling/infra cost question, not a feature-complexity one — cron frequency vs. API load |
| Flexible/nearby-date matching (e.g. ±1–2 days around a preferred date) | Campnab's "Flexible Dates" is a named, marketed feature — widens the odds of a hit, especially for popular weekend dates | MEDIUM | Requires re-checking a small date window per watch instead of exact-match, more API calls per cycle |
| Re-notify after a cooldown if the site is still open (not just first-seen) | Campnab explicitly re-alerts a few minutes later if a "someone abandoned checkout" toggle occurs — useful because the first alert recipient may not have booked | MEDIUM | Needs a time-boxed re-notify rule (e.g. re-alert if still open after 10+ min and not marked "handled" by user) — balance against the anti-spam table-stakes requirement |
| Watching backcountry/wilderness permits (not just frontcountry campsites) | Campnab and camply both extend to permits — a real recreation.gov API surface distinct from campground availability, opens the tool to a wider use case | MEDIUM–HIGH | Different API endpoints/response shape than campsite availability; explicitly out of scope unless requested — note for future milestone |
| Rich digest/summary email when multiple matches land in one poll cycle | Avoids inbox flooding when several watches or several sites hit simultaneously (e.g. a whole loop opens up) | LOW–MEDIUM | Batch outgoing notifications per poll run instead of one email per matched site |
| Web dashboard for managing watches | Recreation.gov's native alerts and Campnab both use a UI; explicitly deferred in PROJECT.md for v1 but is the most obvious v1.x expansion once config-file watches are outgrown | HIGH | Requires DB + auth eventually — deliberately deferred |
| Multi-site coverage (ReserveCalifornia, state parks, Parks Canada, Yellowstone lodges) | Campnab covers this breadth; genuinely differentiates a hobby tool from a Recreation.gov-only script | HIGH | Each provider has a different API/data shape; explicitly deferred per PROJECT.md |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Auto-booking / automated checkout completion | "Just book it for me the instant it's open" feels like the logical endpoint of a watcher | Recreation.gov's terms of service prohibit automated reservation completion; this is the well-documented "campsite bot" controversy (KQED, forum threads on "bots stealing campsites") that has drawn public/agency scrutiny; also creates real liability (charging a user's card without final confirmation) and account-ban risk | Notify-only with a direct deep link, matching PROJECT.md's explicit decision; user completes checkout manually |
| SMS/push notifications for v1 | Commercial leaders (Campnab, Campsite Notifier) are SMS-first because speed matters and SMS is more immediate than email | Adds a paid third-party SMS provider, phone number handling, and delivery-reliability surface area for a single-user hobby tool where email is "fast enough" per PROJECT.md's stated constraint | Email via a transactional provider (Resend/SendGrid); SMS/push deferred to v1.x if email proves too slow |
| Multi-user accounts / login / billing | Natural next step if this were productized like Campnab | Massive scope increase (auth, tenancy, billing) for a tool whose whole point is "I built this for myself" | Config-file/env-var watches, single deployment per user, as already decided in PROJECT.md |
| Scraping recreation.gov HTML instead of using its availability API | Might seem more "complete" (captures anything a human sees) | Fragile to markup changes, more likely to trip anti-bot defenses, contradicts PROJECT.md's explicit constraint to use the official/public API | Use recreation.gov's public JSON availability API (used by camply, banool/checker, and reportedly Campnab itself) |
| Polling as fast as technically possible (sub-minute, no backoff) | "Faster polling = better odds of catching the opening" | Risks IP/API-key throttling or blocking, and Campnab explicitly caps even its premium tier at 1-4 min to avoid "over-tasking" recreation.gov's systems — a single-user tool has even less excuse to hammer the API | Tiered/reasonable interval (e.g. 2–5 min default), with backoff on errors; treat sub-minute polling as a stretch/last-resort optimization, not a default |
| Alerting on every poll cycle while a site remains open | Feels "thorough" but is the #1 complained-about failure mode of naive watchers | Destroys trust/usefulness of email — user starts ignoring notifications (alert fatigue), defeating the tool's purpose | State-tracked dedup: notify once per (watch, site, date-range) newly-available transition, per table stakes above |

## Feature Dependencies

```
Recurring automated polling (unattended)
    └──requires──> Config-driven watch definitions (park, dates, site type)

Duplicate/spam suppression
    └──requires──> Persisted state per (watch, site, date) — "last known status"
                       └──requires──> Some durable storage between poll runs (file/DB/KV)

Multiple concurrent watches without cross-contamination
    └──requires──> Duplicate/spam suppression (state must be scoped per-watch)

Actionable notification content (direct link, site #, dates)
    └──requires──> Recreation.gov API response mapping (campground ID, site ID → URL)

Re-notify after cooldown (differentiator)
    └──enhances──> Duplicate/spam suppression (adds a time-boxed exception to "notify once")

Flexible/nearby-date matching (differentiator)
    └──enhances──> Config-driven watch definitions (adds a date-window param)

Fast poll interval
    └──conflicts──> Reasonable-rate-limiting anti-feature guardrail (tune, don't max out)
```

### Dependency Notes

- **Duplicate/spam suppression requires persisted state:** Without storing "did I already alert for this exact site+date combination," every poll cycle would re-notify for anything still open. This is the single most load-bearing piece of infrastructure in the whole system — even a simple JSON file or SQLite table works for a single-user tool, but *something* durable must survive between scheduled runs.
- **Multiple concurrent watches requires per-watch-scoped state:** If state is tracked globally instead of per-watch, two watches on the same campground with different date ranges could suppress each other's legitimate first-time alerts. State keys should be `(watch_id, site_id, date)` at minimum.
- **Re-notify-after-cooldown enhances (and slightly complicates) dedup:** The table-stakes rule is "notify once per new opening." The differentiator adds "...unless it's been open for N+ minutes and might have been missed by the first recipient." This should be implemented as an explicit, separate rule layered on top of the base dedup logic, not baked into it, so v1 can ship with the simpler rule and add this later.
- **Fast poll interval conflicts with the rate-limiting anti-feature guardrail:** These are in tension by design. The resolution (per Campnab's own stated behavior) is to pick a deliberately-throttled default (minutes, not seconds) rather than polling as fast as infrastructure allows.

## MVP Definition

### Launch With (v1)

Matches PROJECT.md's Active requirements almost exactly — confirmed as genuinely minimal by this research, not scope-padded.

- [ ] Config-file/env-driven watch definitions (park/campground, date range, site type) — the whole product hinges on this
- [ ] Scheduled polling against recreation.gov's public availability API — table stakes, no viable alternative
- [ ] Per-watch, per-site, per-date state tracking to suppress duplicate alerts — without this the tool is actively worse than doing nothing (alert fatigue)
- [ ] Email notification with campground/park name, site number, date(s), and a direct link to the site on recreation.gov — link is what makes it "actionable," not just "informative"
- [ ] Graceful handling of API errors/rate limits (retry/backoff) so the schedule doesn't silently die

### Add After Validation (v1.x)

- [ ] Re-notify after a cooldown window if a site remains open — add once you've observed the "first alert wasn't fast enough" failure mode firsthand
- [ ] Flexible/nearby-date matching (±1-2 days) — add once exact-date watches feel too narrow in practice
- [ ] Digest/batched emails when multiple sites match in one poll cycle — add once you experience an inbox-flooding poll run
- [ ] Faster polling tier for specific high-value watches — add once you know which watches actually matter most

### Future Consideration (v2+)

- [ ] Web dashboard for managing watches — defer until config-file management becomes the actual bottleneck (explicitly out of scope in PROJECT.md)
- [ ] Backcountry/wilderness permit watching — defer, different API surface, not requested yet
- [ ] Multi-provider support (ReserveCalifornia, Parks Canada, state parks) — defer, explicitly out of scope in PROJECT.md
- [ ] SMS/push notifications — defer until email proves too slow in practice; explicitly deferred in PROJECT.md
- [ ] Multi-user/accounts — defer indefinitely; this is a personal tool, not a product, per PROJECT.md

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Config-driven watch definitions | HIGH | LOW | P1 |
| Scheduled unattended polling | HIGH | LOW–MEDIUM | P1 |
| Recreation.gov availability API integration | HIGH | LOW–MEDIUM | P1 |
| Dedup/state tracking to avoid spam | HIGH | MEDIUM | P1 |
| Actionable email content (link, site #, dates) | HIGH | LOW | P1 |
| Multi-watch support (scoped state) | HIGH | MEDIUM | P1 |
| API error handling / backoff | MEDIUM | LOW–MEDIUM | P1 |
| Re-notify after cooldown | MEDIUM | MEDIUM | P2 |
| Flexible/nearby-date matching | MEDIUM | MEDIUM | P2 |
| Digest/batched notifications | LOW–MEDIUM | LOW–MEDIUM | P2 |
| Web dashboard | LOW (for single user) | HIGH | P3 |
| Backcountry permits | LOW (not requested) | MEDIUM–HIGH | P3 |
| Multi-provider support | LOW (not requested) | HIGH | P3 |
| SMS/push | LOW (email deemed sufficient) | MEDIUM | P3 |
| Auto-booking | N/A — explicitly rejected | N/A | Never (anti-feature) |

## Competitor Feature Analysis

| Feature | Campnab (commercial SaaS) | camply (open-source CLI) | This project |
|---------|---------------------------|---------------------------|---------------|
| Watch definition | UI-based scan config (park, campground, dates, filters), tiered by # of concurrent scans | CLI flags/config: recreation area, date range, campgrounds/campsites, `--search-forever` | Config file/env vars, no UI, matches camply's model more than Campnab's |
| Notification channel | SMS primary, email available | Pluggable: email, Slack, SMS (Twilio), Pushover, Pushbullet, Ntfy, Telegram, Apprise, webhook | Email only for v1 (deliberate scope cut per PROJECT.md) |
| Dedup behavior | Notify on reserved→open transition; deliberate re-notify a few min later on abandoned-checkout toggles | Not explicitly documented in available docs; likely relies on user re-running or persistent process state (LOW confidence — unverified) | Explicit per-watch/site/date state tracking, "notify once on new opening" as table stakes, cooldown re-notify deferred to v1.x |
| Poll frequency | Tiered: 10-15 min (low tier) to 1-4 min (premium); deliberately capped to avoid overloading recreation.gov | User/infra-controlled (cron-driven or `--search-forever` loop); no documented enforced floor | Deliberately throttled default (minutes, not seconds), per anti-feature guardrail |
| Notification content | Park, campground, arrival date, duration, site number, direct link (SMS); email variant available | Notification content not fully documented in fetched sources (LOW confidence) | Explicit table-stakes requirement: park/campground, site #, dates, direct booking link |
| Booking | None — notify only, user books manually (matches ToS) | None — notify only | None — notify only (matches PROJECT.md decision and industry norm) |
| Scope of sites covered | Recreation.gov + Yellowstone lodges + several Canadian/state park systems | Recreation.gov, plus other providers (Reserve America, Yellowstone, etc. per its multi-provider architecture) | Recreation.gov only for v1; multi-provider explicitly deferred |

## Sources

- [Campnab FAQ — scan tiers, dedup behavior, pricing, polling frequency](https://campnab.com/faq) — MEDIUM confidence (vendor-published FAQ, not independently verified against actual system behavior)
- [Outdoorithm — Free Campsite Cancellation Alerts, Campnab/CampFlare alternatives (2026)](https://outdoorithm.com/campground-alerts) — MEDIUM confidence, current-year source
- [Happiest Outdoors — Campnab vs. Schnerp cancellation app comparison](https://happiestoutdoors.ca/camping-cancellation-apps/) — MEDIUM confidence, third-party comparison
- [Backpacking Light forum — campsite availability notifications discussion](https://backpackinglight.com/forums/topic/campsite-availability-notifications-in-recreation-gov/) — LOW confidence, community anecdote, useful for pain points (e.g. recreation.gov's native 3-campground alert limit)
- [GitHub — juftin/camply](https://github.com/juftin/camply) — MEDIUM-HIGH confidence, open-source, notification channel list directly verifiable from repo
- [GitHub — banool/recreation-gov-campsite-checker](https://github.com/banool/recreation-gov-campsite-checker) — MEDIUM confidence, open-source reference implementation of API-based (not scraping) availability checking, cron-driven pattern
- [KQED — "Why Can't You Get That Camping Spot?" (bots controversy)](https://www.kqed.org/news/11450483/cant-get-that-camping-spot-it-could-be-bots) — MEDIUM confidence, supports the anti-feature rationale against auto-booking
- [recbot.site — free desktop scanner, explicitly notify-only positioning](http://recbot.site/) — LOW confidence, single vendor page, but reinforces industry norm of "notify, don't auto-book"

---
*Feature research for: Recreation.gov campsite availability watcher*
*Researched: 2026-08-16*
