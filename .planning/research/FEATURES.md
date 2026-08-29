# Feature Research

**Domain:** Campsite/outdoor-recreation discovery — search, map view, visual design for a personal availability-watcher tool
**Researched:** 2026-08-29
**Confidence:** MEDIUM (competitor UX patterns verified via multiple sources; RIDB data-shape limitations verified against project's existing PROJECT.md tech-debt notes; no Context7 library docs needed for this domain, WebSearch cross-verified across 3+ sources per finding)

## Scope Note

This research covers only the three v1.2 target features: **discovery/browse page**, **map view**, **visual redesign**. Reviews and hiking trails are explicitly out of scope (deferred to backlog per PROJECT.md) and are not discussed here except as anti-features to avoid scope creep. This is a single-user personal tool, not a commercial product — features that only make sense at scale (accounts, social, ads, monetization, offline-first mobile) are called out as anti-features even where competitors do them well.

## Feature Landscape

### Table Stakes (Users Expect These)

Features that, if missing, make a "discovery page" feel broken relative to what any campsite-finder product (including Recreation.gov itself) already does.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Text/name search across the full catalog (not just watched campgrounds) | This is the explicit milestone goal — "anything I can find on Recreation.gov, I want to find here." Recreation.gov, The Dyrt, and Campflare all lead with a search bar. | MEDIUM | RIDB exposes a `/facilities` search endpoint with name/state/activity filters; the existing area-watch typeahead (Phase 4) already proves this pattern against RecAreas — extend it to Facilities. |
| Filter by state/region and site type | Every competitor (Recreation.gov, Dyrt, Campflare) supports narrowing by geography and by site type (tent/RV/cabin) as a baseline. Without it, browsing "the full catalog" is unusable — RIDB has 3,000+ campgrounds. | LOW–MEDIUM | Can reuse RIDB's existing facility metadata (state, activity type) already fetched for area-watch resolution; mostly a UI filter, not new data plumbing. |
| Availability shown at a glance per result (not per-click) | This is called out explicitly in the milestone ("availability shown at a glance"). Users abandon a search UX that requires opening each result individually to learn if it's even worth watching — Recreation.gov's own search list already does this (badge/date preview). | MEDIUM–HIGH | Requires calling the undocumented per-campground `/availability/campground/{id}/month` endpoint for every visible result, which the poller already knows how to do — but doing it for N search results (vs. M configured watches) multiplies request volume against a ~1req/sec informal rate limit. Needs batching/pagination or "check availability" as an on-demand action per row rather than eager-loading for all results. |
| "Watch this" action directly from a search result | Explicitly required by the milestone. Removes the friction of the current flow (user must already know the facility/area to create a watch). | LOW | Pure UI wiring — reuses the existing watch-creation write path (Phase 5) with the facility/area ID pre-filled from the search result. No new backend capability needed. |
| Graceful "no data" / "not on Recreation.gov" states | RIDB's catalog includes facilities with no reservable campsites, missing coordinates, or missing availability data (already known from area-watch work — filtered to "reservable campgrounds" only). A discovery page that dead-ends or crashes on these is worse than the current watch-only dashboard. | LOW–MEDIUM | Mirrors the existing area-watch resolution filtering logic (exclude visitor centers/boat ramps/day-use) — extend the same exclusion rules to discovery results. |
| Map view showing pins for search results, distinguishable from active watches | Explicitly required by milestone. Every serious competitor (Recreation.gov, The Dyrt, Campflare) treats the map as a first-class view, not an afterthought — Campflare in particular differentiates almost entirely on its map. | MEDIUM–HIGH | See Map View section below — main complexity is RIDB's inconsistent lat/long coverage (already flagged as a known risk in the milestone description), which must be handled without silently dropping results. |
| Responsive/mobile-usable layout | Camping trip planning frequently happens on a phone (in the field, checking for last-minute openings). The existing dashboard is already public/no-auth and likely to be checked from mobile. | LOW–MEDIUM | Standard responsive CSS/breakpoints; more of a redesign concern than a new feature. |
| Visually coherent design system (consistent spacing, type scale, color palette) | Explicitly requested ("look beautiful and polished," "not just functional screens"). The current dashboard is plain CSS (`globals.css`, no framework) — competitors all invest visibly in this (Recreation.gov's 2020s redesign, The Dyrt's app polish). | MEDIUM | This is an infrastructure decision, not a per-page feature — see Architecture-adjacent note below: adopting a component/utility system (e.g., Tailwind + a small component set) up front makes every subsequent screen cheaper, vs. hand-rolling CSS per page. |

### Differentiators (Competitive Advantage)

Features that go beyond "checkbox parity" with competitors and align with the project's core value (fast, reliable alerting on a specific watched site) rather than trying to out-build a commercial product.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Map showing *both* search results and the user's active watches, visually distinguished (e.g., different pin color/icon) | No competitor combines "here's everything available" with "here's what I'm personally tracking" on one map — this is unique to a personal tool that already has a watch list. Directly serves the "one stop shop" vision without needing reviews/trails. | MEDIUM | Composes two data sources the app already has (RIDB facility list + existing `watches.json`) onto one map component — no new external dependency beyond the map library itself. |
| Availability-at-a-glance via a compact calendar-heatmap style indicator (e.g., a small strip of colored dots/bars per result showing which of the next N days have openings) rather than a binary "available/unavailable" badge | Recreation.gov's own per-campground page uses a color-coded month calendar; competitors that reduce availability to a single boolean lose useful signal (a user planning a specific weekend cares which days, not just "some day this month"). | MEDIUM | Reuses the existing per-day availability data shape the poller already parses from the month endpoint — this is a rendering choice, not new data. Keep it lightweight (a sparkline-like strip, not a full calendar) to avoid the eager-load cost noted above. |
| "Watch this" pre-fills date range/site type intelligently from the discovery search filters | Reduces friction further than a generic "watch this campground" — if the user searched "Sequoia, tent sites, next weekend," the resulting watch should default to those same parameters. | LOW | Pure UI state threading between the search form and the existing watch-creation form (Phase 5). |
| Clustering on the map for dense regions (e.g., many campgrounds in one national forest) | Prevents the map from becoming an unreadable pile of overlapping pins in popular areas (a known failure mode called out for naive map implementations) — Dyrt/Campflare both handle this. | MEDIUM | Standard feature of common map libraries (see Stack notes) — not custom logic, just enabling a built-in clustering layer. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that a "one-stop-shop" vision might imply but that are explicitly wrong for a single-user personal tool at this stage, or that were already deferred in PROJECT.md.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Campsite reviews / ratings | Stated in the long-term vision; every commercial competitor (Dyrt, Recreation.gov, Hipcamp) has them | No official Recreation.gov reviews API exists; sourcing means scraping third-party sites, which conflicts with the project's official-API-only data constraint (already flagged, explicitly deferred pending a research spike) | Link out to Recreation.gov's own listing page (which does show reviews) for a given campground, rather than building review aggregation |
| Nearby hiking trails | Stated in the long-term vision, mirrors AllTrails-style "recreation ecosystem" products | RIDB's trail/activity data coverage is incomplete (already flagged in PROJECT.md); building on incomplete data risks silently wrong/missing results, undermining trust in a tool whose core value is reliability | Already correctly deferred pending a dedicated trails-data-source research spike |
| Eager-loading availability for every result on every search (calendar previews rendered by default for all 50+ results on screen) | Feels like the "best" UX — see everything immediately | Multiplies calls to the undocumented per-campground availability endpoint far beyond the informal ~1req/sec courtesy rate the poller already respects; risks the discovery page getting the account/IP rate-limited or banned, which would also break the poller | On-demand availability fetch (expand-to-check, or fetch only for the visible/first-page results with debounced pagination), or a cached/batched summary rather than live per-result queries |
| User accounts / saved searches / social sharing of watches | "One stop shop" framing nudges toward multi-user product thinking | This is explicitly out of scope per PROJECT.md ("Multi-user support / accounts / login... single-user personal tool") — adding any of this contradicts an existing, deliberate constraint | Keep the existing shared-secret session-cookie gate for writes; discovery/search reads stay public like the rest of the dashboard |
| Full commercial-grade mapping stack (e.g., Mapbox with paid tiers, custom vector tile styling, 3D terrain) | Competitors like The Dyrt/Campflare use polished branded map styles | Adds a paid dependency and styling complexity disproportionate to a single-user tool's needs; Mapbox GL's free tier has usage caps that don't matter at 1 user but add operational surface area (API key management, billing risk) for no real benefit here | Use a free, no-API-key raster/vector base (e.g., Leaflet + OpenStreetMap tiles, or MapLibre GL with a free tile source) — sufficient for pins + clustering + zoom/pan, avoids billing/key management |
| Booking/checkout integration on the discovery page | Natural next step once a user finds an open site | Already explicitly out of scope in PROJECT.md ("Automated booking/reservation... notification only") — booking sites generally prohibit automated checkout | Keep "Watch this" and manual booking via a link to the real Recreation.gov reservation page |
| Real-time live-updating map/search (WebSocket push, sub-minute refresh) | "Real-time everything" often feels like a natural fit for an availability tool | The poller already runs on a 5-minute cron against committed JSON state; a discovery page with its own faster polling loop duplicates infra, multiplies API load against the same rate-sensitive endpoint, and creates two sources of truth for availability | Discovery page availability checks are on-demand (user-triggered) or read from the same cached/committed state where possible; live "is this open right now" checks are opt-in per result, not ambient |

## Feature Dependencies

```
Discovery/search page (RIDB facility search)
    └──requires──> RIDB facility-search capability
                       └──builds on──> existing area-watch RIDB resolution logic (Phase 4)

"Watch this" action
    └──requires──> Discovery/search page (need a result to act on)
    └──requires──> Existing watch-creation write path (Phase 5)

Availability-at-a-glance per result
    └──requires──> Discovery/search page (need result rows to annotate)
    └──requires──> Existing per-campground availability fetch logic (poller's core capability)
    └──conflicts-with──> Eager-loading for every result (rate-limit risk) — must be on-demand/paginated

Map view
    └──requires──> Discovery/search page results (to plot as pins)
    └──requires──> Existing watches list (to plot as a second pin layer)
    └──requires──> Map library + tile source decision (new dependency)
    └──requires──> Lat/long fallback handling (RIDB coordinate gaps)

Visual redesign
    └──enhances──> Discovery/search page, Map view, existing watch-management UI
    └──should precede──> building new UI (cheaper to build discovery/map pages against a design system than retrofit)
```

### Dependency Notes

- **Discovery page requires RIDB facility-search capability:** the app currently only resolves RecAreas → Facilities (area watches) or a single known Facility ID (facility watches). Browsing "the full catalog by name/area/state" needs a new facility-level search/list query against RIDB, distinct from the existing area-resolution flow, though it can reuse the same client/auth/rate-limit handling.
- **"Watch this" requires the discovery page and the existing write path:** no new backend write logic — this is UI composition between a search result and the Phase-5 watch-creation form.
- **Availability-at-a-glance conflicts with eager-loading:** this is the most important dependency/ordering constraint for the roadmap — the phase that builds "availability shown at a glance" must design the fetch pattern (on-demand, paginated, or cached) up front, not bolt on rate-limiting after building an eager version.
- **Map view depends on discovery results AND the existing watches list:** the differentiator (showing both layers together) means the map phase can't be built in isolation before both the discovery-search data and the existing watch data are available to compose.
- **Visual redesign should precede new-page construction where sequencing allows:** the dashboard has no design system today (plain `globals.css`, no Tailwind/component library). Establishing tokens/components before or alongside the first new page (discovery) avoids building the discovery UI once in ad hoc CSS and then reworking it during the redesign pass. If sequencing requires discovery/map to land first, treat their initial UI as intentionally provisional.

## MVP Definition

### Launch With (v1.2)

Minimum viable scope for this milestone — matches PROJECT.md's stated Active requirements.

- [ ] Standalone discovery page: search/browse RIDB facilities by name/area/state — core "find anything on Recreation.gov" value
- [ ] Availability-at-a-glance on discovery results (on-demand or paginated, not eager for the whole catalog) — makes browsing actionable, not just a facility directory
- [ ] "Watch this" action from a discovery result — connects discovery to the app's existing core value (get notified)
- [ ] Map view layering discovery results + active watches, with graceful handling of missing/bad lat-long — explicit milestone requirement, also the strongest differentiator
- [ ] Visual redesign of at least the new discovery/map surfaces (and ideally retrofitted onto existing watch-management screens) — explicit milestone requirement

### Add After Validation (v1.x)

- [ ] Map clustering for dense regions — add once real usage shows pin-overlap is actually a problem (likely yes in popular areas like Sequoia/Yosemite, but confirm before over-building)
- [ ] Calendar-heatmap-style availability strip (vs. simple badge) — upgrade once basic at-a-glance availability is proven useful
- [ ] Filter refinement (price, amenities, ADA, vehicle length) beyond state/site-type — add based on what the user actually wants to filter by once browsing real results

### Future Consideration (v2+)

- [ ] Campsite reviews — pending research spike into a legitimate data source
- [ ] Nearby hiking trails — pending research spike into a trails data source
- [ ] Drive-time-based search ("show me campsites within 3 hours") — valuable pattern seen in The Dyrt, but needs a geocoding/routing dependency the project doesn't have yet; defer until core discovery is proven

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|----------------------|----------|
| Discovery/search page (RIDB facility search) | HIGH | MEDIUM | P1 |
| Availability-at-a-glance (on-demand) | HIGH | MEDIUM–HIGH | P1 |
| "Watch this" action | HIGH | LOW | P1 |
| Map view (results + watches, bad-coordinate handling) | HIGH | MEDIUM–HIGH | P1 |
| Visual redesign / design system | HIGH (stated explicitly by user) | MEDIUM | P1 |
| Map clustering | MEDIUM | LOW–MEDIUM | P2 |
| Calendar-heatmap availability strip | MEDIUM | MEDIUM | P2 |
| Extended filters (price/amenities/ADA) | LOW–MEDIUM | LOW–MEDIUM | P2 |
| Drive-time search | MEDIUM | HIGH (new geocoding dependency) | P3 |
| Reviews | HIGH (long-term vision) but blocked | HIGH / blocked on data source | P3 (backlog, pending spike) |
| Hiking trails | MEDIUM (long-term vision) but blocked | HIGH / blocked on data source | P3 (backlog, pending spike) |

## Competitor Feature Analysis

| Feature | Recreation.gov | The Dyrt | Campflare | Our Approach |
|---------|-----------------|----------|-----------|--------------|
| Search | Name/destination search bar, personalized recommendations, filters by price/amenities/site type | Search + filters by site features, price, air quality; "Drive Time" search by driving radius | Availability alerts search by park/campground | Name/state/area search over RIDB facilities, reusing existing typeahead pattern from area watches; skip drive-time and personalization (out of scope for a single-user tool) |
| Map | Interactive map, switches seamlessly between map and list results | Map with clickable pins showing cost/amenities/reviews/photos; offline map downloads | Interactive map with topo/satellite/public-land layers, no paywall, no signup required | Interactive map with result + watch pins, clustering for dense areas; skip offline maps, topo/satellite layer richness, and photos (no photo data source) |
| Availability display | Color-coded month calendar per campground, list badges | Availability shown via booking integration/partner links | Real-time scan across reservation systems, alerts via email/text | At-a-glance strip/badge per result computed from the existing month-availability endpoint, fetched on-demand to respect rate limits |
| Alerts | None natively (third-party tools fill this gap) | None (browse/book only) | Free real-time email/text alerts on cancellations, no paywall | This is the app's existing core value (poller + email/dashboard) — discovery's job is to make it easy to *create* a watch, not to duplicate Campflare's always-on scanning of arbitrary sites |
| Reviews/photos | Yes (own listings) | Yes, user-generated, central selling point | No | Deferred — link out to Recreation.gov's own listing rather than build |
| Design polish | Government site, functional but visually plain historically, improved in recent redesigns | Polished consumer app, strong visual identity | Simple, utilitarian, no-paywall philosophy reflected in minimal design | Aim for consumer-app-level polish (Dyrt-tier) given explicit "beautiful and polished" requirement, but scoped to the discovery/map/watch screens a single user actually touches — not a marketing site |

## Sources

- [The Dyrt PRO Review 2026](https://www.parkedinparadise.com/dyrt-pro-review/) — map/search/filter/offline-map features
- [The Dyrt: New PRO Maps](https://thedyrt.com/magazine/gear/new-pro-maps-are-here-just-in-time-for-summer/) — map feature investment
- [The Dyrt Unveils Instant Campsite Finding Solution (Drive Time)](https://rv-pro.com/news/the-dyrt-unveils-instant-campsite-finding-solution/)
- [Campflare](https://campflare.com/) and [Campflare Map](https://campflare.com/map) — no-paywall map, real-time alerts, topo/satellite/public-land layers
- [Campflare API & Data](https://campflare.com/api)
- [Recreation.gov Search](https://www.recreation.gov/search) and [Recreation.gov App Store listing](https://apps.apple.com/us/app/recreation-gov/id1440487780) — search bar, personalized recommendations, filters, map/list switching, color-coded calendar
- [Campnab](https://campnab.com/?parkID=goWjR96nj5c2RFoC8) and [Campnab: How to Receive Availability Notifications](https://campnab.com/blog/how-to-receive-availability-notifications-for-a-sold-out-campground) — filter/scan model, flexible-arrival-date pattern (P2 filter idea)
- [Retool: Best React Map Libraries](https://retool.com/blog/react-map-library) — react-map-gl vs react-leaflet tradeoffs
- [PkgPulse: Mapbox vs Leaflet vs MapLibre GL JS (2026)](https://www.pkgpulse.com/guides/mapbox-vs-leaflet-vs-maplibre-interactive-maps-2026) — free/no-API-key tile source rationale
- [UX Patterns for Developers: Calendar View](https://uxpatterns.dev/patterns/data-display/calendar) and general calendar-heatmap pattern sources — availability-at-a-glance UI pattern
- Project's own `.planning/PROJECT.md` — confirms RIDB lat/long inconsistency, existing area-watch RIDB resolution logic, existing write-path/session-gate architecture, and explicit out-of-scope items (reviews, trails, multi-user, booking)

---
*Feature research for: campsite/outdoor-recreation discovery, map, and visual design (v1.2 Discovery & Polish milestone)*
*Researched: 2026-08-29*
