# Feature Research

**Domain:** Campsite availability trackers — area-based search + self-service watch management (v1.1 scope)
**Researched:** 2026-08-25
**Confidence:** MEDIUM (WebSearch-verified across multiple community tools; no direct Context7/official RIDB docs access — RIDB endpoint shapes confirmed via multiple independent secondary sources, not the primary swagger doc itself)

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Search "area" = a named Recreation Area (park/forest unit), not a free-form map draw | This is how every major tool in this space (camply, recgov_daemon, RIDB itself) models the domain. RIDB's own hierarchy is `RecreationArea` → `Facility` (campground) → `Campsite`. camply's primary and most-used search mode is `--rec-area <RecAreaID>`, which returns every campground facility under that park/forest. Users already think in terms of "Yosemite," "Big Sur," "Glacier NP" — not coordinates. | LOW–MEDIUM | Maps directly onto existing RIDB client: add a `FacilitiesForRecArea` (or equivalent `/recareas/{id}/facilities`) call layered on top of the existing single-facility lookup. No new geo/radius math needed. |
| Result cap on "search all campgrounds in an area" | Recreation Areas can contain dozens of campgrounds (e.g., large national forests). Unbounded fan-out breaks the ~1 req/sec availability-API courtesy rate already established in this project and blows up run time on a 5-min cron. | LOW | A hard cap (e.g., 20–30 facilities per watch, or all facilities with a documented soft warning past that) is standard practice — camply and recgov_daemon both implicitly bound scope by requiring you to pick one rec-area or a small radius, not "search everything." Reasonable default: cap at ~25 campgrounds/watch; surface a "N campgrounds, showing first 25" note in the UI if truncated. |
| Site-type filter still applies at area scope | Same filter (tent/RV/group/etc.) that exists in v1.0's single-campground watch; users expect it to compose with area search, not be dropped. | LOW | Filter logic already exists; only the fan-out (which campgrounds to check) is new. |
| Watch list view (see all watches, current status) | Table stakes for any "manage watches through the dashboard" feature — this already exists in v1.0's read-only dashboard; extending it to be editable is the whole point of this milestone. | LOW (dashboard read path exists) | Extend existing dashboard data model, don't rebuild it. |
| Create watch form: pick area OR single campground, start date, end date, site type | Minimum viable form for watch creation. Every competitor tool requires exactly these 3–4 inputs (location, dates, site type/party size). Nothing less is usable; nothing more is expected. | MEDIUM | Area picker is a searchable dropdown/typeahead over RIDB RecreationAreas (and/or Facilities), not free text — free text risks unmatched names silently failing. |
| Edit / delete a watch | Users will get dates or areas wrong and need to fix without re-creating from scratch; delete is needed to stop watches once booked or no longer wanted. | LOW–MEDIUM | Straightforward CRUD over the existing `watches.json`-equivalent store; main complexity is wiring dashboard writes back to whatever config store is used (see Dependencies below). |
| Inline validation (dates, area exists, site type valid) | Users editing via a form expect immediate feedback (e.g., end date before start date, area not found) rather than a cryptic failure on the next poll cycle 5 minutes later. | LOW–MEDIUM | zod schemas already exist for watch config in v1.0 (`src/`) — reuse/share validation rules between dashboard form and poller rather than re-deriving them (this is called out as existing tech debt: validation logic is currently duplicated between `src/` and `dashboard/`; this milestone makes that duplication worse if not addressed). |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Typeahead search over RIDB Recreation Areas by name (e.g., "Big Sur" → matches Los Padres NF / specific state parks) | Removes the single biggest friction point competitors like camply have: users must already know the numeric RecAreaID and look it up via recreation.gov's own search UI first. Solving name → RecAreaID *inside* the product is a real differentiator over CLI-only tools. | MEDIUM | Needs an RIDB search-by-query call plus a lightweight local cache/index (RIDB's own free-text search across ~possibly ambiguous naming can return noisy results); worth caching RecArea metadata since it changes rarely. |
| Combined watch = area + explicit fallback to single campground (hybrid model) | Lets a user narrow to "just Kirk Creek" without losing the option to widen later — smooth upgrade path from v1.0's exact-facility watches to v1.1's area watches, and matches how real users actually search (start broad, narrow once they see options). | MEDIUM | This is the natural generalization of the existing watch schema: `facilityIds: string[]` (populated either directly or by area expansion) rather than a hard fork between "area watch" and "campground watch" types. |
| Per-campground breakdown in match emails/dashboard within an area watch (which specific campground + site opened, not just "something in Yosemite") | Table-stakes at the *notification* level even though area search itself is a differentiator — CampFlare and camply both report the specific campground/site, not just the region, because that's what's actionable for booking. | LOW (mostly a data-shape / formatting concern, reuses existing match/email code) | Not really optional — folding this into "differentiator" only because it depends on the new area-search feature existing at all; once area search exists, this level of detail is expected. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Map/radius picker (draw a circle or drop a pin on a map) for defining "area" | Feels more precise/visual than picking a named park; competitors like Campnab/CampFlare hint at "map your public lands" so it looks like table stakes | High implementation cost (map library, geocoding, lat/long UI) for a single-user tool where the user already knows the parks they care about by name; RIDB's own lat/long radius search is also unreliable because many facilities have blank lat/long fields, so radius search silently under-returns results | Named Recreation Area / Facility typeahead (see Table Stakes above) covers the real use case; only add radius search later if a specific gap surfaces (e.g., searching a sprawling area with no single RecAreaID) |
| "Search everything, all parks, all dates" unbounded discovery mode | Sounds appealing — "just tell me what's available anywhere" | Explodes the number of availability-API calls per poll cycle far past the community-respected ~1 req/sec courtesy limit already documented in this project's stack decisions; also produces noisy, low-value emails for a single user with specific trips in mind | Keep watches scoped (one area or one campground, one date range, one site type) — this is consistent with the project's existing notify-only, single-user philosophy |
| Full account/auth system for the watch-management UI (multi-user login, RBAC) | "Management UI" naturally suggests a real app with auth | Explicitly out of scope per PROJECT.md ("Multi-user support / accounts / login — single-user personal tool") and adds real infra (session store, auth provider) for zero benefit to a single user | Keep the dashboard as it is today: public/no-auth, since it holds no sensitive data (already a documented decision in PROJECT.md's Key Decisions) |
| Real-time/live-updating watch list (websockets, polling every few seconds in the browser) | "Feels responsive" | The underlying poller only runs every 5 minutes on a GitHub Actions cron — sub-minute UI refresh creates a false impression of freshness and adds unnecessary infra (websocket server, or aggressive client polling against the GitHub raw content host) | Dashboard already reads from committed JSON with a cache window (v1.0 pattern) — keep that model; a manual refresh button or a "last checked" timestamp is sufficient |
| Auto-expanding an area watch to *every* campground on Recreation.gov within a state (no park-level scoping) | Users might think "just watch all of California" is more convenient than picking parks one by one | RIDB has no small, stable "state facilities" index designed for this; results would run into the thousands, blowing past rate limits and result caps described above, and produce an unusable number of matches | Scope area watches to one RecreationArea (or a small, explicit list of Facility IDs) at a time; users can create multiple area watches if they want multi-park coverage |

## Feature Dependencies

```
Area-based search (RecArea → Facility fan-out)
    └──requires──> Existing single-facility RIDB client + availability poller (v1.0)
                       └──extends──> Watch schema: facilityId (single) → facilityIds (list), populated by area expansion or direct pick

Watch-management UI (create/edit/delete)
    └──requires──> Area typeahead / RecreationArea search (to populate the "area" field without hand-typed IDs)
    └──requires──> Shared validation rules (zod schemas) between dashboard and poller
                       └──addresses existing tech debt──> validation/formatting logic currently duplicated between src/ and dashboard/ (per PROJECT.md Context)
    └──requires──> A writable watch store reachable from the dashboard (Next.js app on Vercel) that the poller (GitHub Actions on a separate schedule) also reads
                       └──open architectural question──> v1.0's state files are committed back to the repo by the poller's own GitHub Actions job; the dashboard has so far been read-only. Writing watches.json *from* the dashboard means either (a) the dashboard commits to the repo via GitHub API/token, or (b) watch config moves to a small external store (e.g., a KV/DB) that both the poller and dashboard read/write — this is a real design decision for the roadmap phase that implements the UI, not something to hand-wave.

Per-campground breakdown in notifications ──enhances──> Area-based search (meaningless without it; area search must know which specific facility/site matched)

Map/radius picker ──conflicts with──> Result-cap / rate-limit discipline (anti-feature; drop unless a concrete gap emerges)
```

### Dependency Notes

- **Watch-management UI requires area typeahead:** Without name-based search over RIDB Recreation Areas, the "create watch" form would force users back to hand-finding numeric RecAreaIDs on recreation.gov — defeating the purpose of a UI at all.
- **Watch-management UI requires a writable, poller-visible store:** This is the highest-risk dependency for the roadmap. v1.0's architecture assumes the poller (GitHub Actions) is the sole writer of state back to the repo, and the dashboard (Vercel) is a read-only consumer of raw.githubusercontent.com. Adding user-driven writes from the dashboard breaks that one-writer assumption and needs an explicit decision (repo-commit-via-API vs. external store) before implementation — flag this for roadmap phase sequencing and possibly its own research/design spike.
- **Area-based search extends, not replaces, the existing watch model:** The cleanest path is generalizing `facilityId: string` to `facilityIds: string[]` (or `{ recAreaId } | { facilityIds }`), so v1.0's already-validated single-campground watches keep working unchanged and area watches are just "many facilities under one watch." This avoids a breaking schema migration.
- **Per-campground breakdown enhances area search:** Once a watch spans multiple facilities, the matcher/notifier must already know and surface *which* facility/site matched — this isn't extra scope, it's a required consequence of the area feature, not an optional add-on.

## MVP Definition

### Launch With (v1.1)

- [ ] Area watch = one RecreationArea ID, expanded server-side to its constituent campground Facility IDs at poll time (or watch-creation time, cached) — why essential: this is the core new capability requested and the dominant pattern across community tools
- [ ] Result cap (~25 facilities) per area watch, with an explicit "truncated" indicator if exceeded — why essential: protects the existing rate-limit discipline and cron time budget
- [ ] Dashboard form: create watch with area-or-campground typeahead, start date, end date, site type — why essential: this is the stated milestone goal ("manage watches through the dashboard UI instead of hand-editing watches.json")
- [ ] Edit and delete watch from dashboard — why essential: without edit/delete, "management" is really just "add," which isn't the full ask
- [ ] Inline validation reusing existing zod schemas (shared, not duplicated) — why essential: prevents the current src/dashboard validation-drift tech debt from compounding as a second copy is added for the new area field

### Add After Validation (v1.x)

- [ ] Recently-used / favorited areas for faster re-entry — trigger: once the user has a handful of real watches and re-picking the same park repeatedly becomes friction
- [ ] Per-facility opt-out within an area watch (e.g., "watch all of Yosemite Valley except X campground") — trigger: if a specific real trip surfaces this need; not worth building speculatively

### Future Consideration (v2+)

- [ ] Lat/long + radius search as an alternative to named RecArea — why defer: RIDB lat/long data is inconsistently populated per-facility (many blank), making radius search unreliable without more investigation; named-area search covers the stated use cases (Big Sur, Yosemite Valley, a park unit) already
- [ ] Map-based visual picker — why defer: high build cost, low incremental value for a single user who already knows target parks by name; revisit only if named search proves insufficient in practice

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| RecArea → Facility fan-out area search | HIGH | MEDIUM | P1 |
| Result cap / truncation handling | HIGH (risk mitigation) | LOW | P1 |
| Area/campground typeahead in UI | HIGH | MEDIUM | P1 |
| Create/edit/delete watch UI | HIGH | MEDIUM | P1 |
| Shared validation (dashboard + poller) | MEDIUM (mostly reduces tech debt) | LOW–MEDIUM | P1 |
| Writable watch store design (repo-commit vs external store) | HIGH (blocking dependency) | MEDIUM–HIGH | P1 (must resolve before P1 UI work lands) |
| Per-campground breakdown in notifications | MEDIUM | LOW | P2 |
| Recently-used areas | LOW | LOW | P3 |
| Per-facility opt-out within area watch | LOW–MEDIUM | MEDIUM | P3 |
| Lat/long radius search | LOW (data-quality risk) | HIGH | P3 |
| Map picker | LOW | HIGH | P3 (anti-feature unless a gap emerges) |

## Competitor Feature Analysis

| Feature | camply (CLI) | CampFlare (hosted, free) | Our Approach |
|---------|--------------|---------------------------|--------------|
| Area definition | `--rec-area <RecAreaID>` (numeric ID user must look up on recreation.gov first) | Named search/map browsing across multiple reservation systems (Recreation.gov, ReserveCalifornia, more) | Named RecArea typeahead inside our own UI — closes camply's "look up the ID yourself" gap without building CampFlare's full multi-provider scope |
| Result scope per search | All facilities under the given RecAreaID (no explicit cap documented) | Effectively unbounded across providers, backed by their own infra checking every ~45s | Capped fan-out (~25 facilities/watch) to respect this project's single-user, courtesy-rate-limited, cron-based architecture |
| Site-type / campsite filtering | Yes, via campsite equipment/site-type filters | Yes, via alert criteria | Reuse existing v1.0 site-type filter, apply across the expanded facility list |
| Watch/alert management | CLI flags only, no persistent UI (config file / re-run CLI) | Full hosted UI (app + web) | This milestone's core ask: bring camply's capability into a UI, at CampFlare's usability level, scoped to Recreation.gov only (per PROJECT.md's explicit out-of-scope: other booking sites deferred) |
| Notification channel | Email, Pushover, Pushbullet, Telegram | Email, text, webhook | Stay email-only per existing constraint; no change needed for this milestone |

## Sources

- [camply GitHub (juftin/camply)](https://github.com/juftin/camply) — primary reference for `--rec-area` search pattern and RecArea/Facility/Campsite hierarchy
- [camply Command Line Usage docs](https://juftin.com/camply/command_line_usage/)
- [camply Recreation.gov provider docs](https://juftin.com/camply/recreationdotgov/)
- [recgov_daemon GitHub (rmjacobson/recgov_daemon)](https://github.com/rmjacobson/recgov_daemon) — lat/long + radius search variant, and note on blank lat/long fields in RIDB data
- [Campflare homepage](https://campflare.com/) and [Campflare API/Help pages](https://campflare.com/api) — competitor UX for hosted, multi-provider alerting
- [Free Campsite Tracker Alternatives to Campnab](https://campnab.com/blog/free-campsite-tracker-alternatives-to-campnab) — landscape overview of competing tools
- Project's own `.planning/PROJECT.md` — existing v1.0 architecture, constraints (rate limits, single-user, notify-only, dashboard read-only-so-far), and stated tech debt (validation duplication between src/ and dashboard/)

**Confidence caveat:** RIDB endpoint parameter names (radius, query, pagination limits) were not verified against the primary RIDB Swagger/API doc directly (WebFetch on ridb.recreation.gov returned only the marketing homepage, not API docs). The RecArea → Facility hierarchy and the "named area over radius search" recommendation are corroborated by multiple independent community tools, so treat that conclusion as MEDIUM confidence; treat exact RIDB query-parameter names as needing verification during implementation (LOW confidence, verify against `https://ridb.recreation.gov/landing` API docs or the OpenAPI spec directly before coding the fan-out client).

---
*Feature research for: Area-based campground search + watch-management UI (Campground Crawler v1.1)*
*Researched: 2026-08-25*
