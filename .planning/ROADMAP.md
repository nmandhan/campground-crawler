# Roadmap: Campground Crawler

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3 (shipped 2026-08-25)
- ✅ **v1.1 Area Search** — Phases 4-5 (shipped 2026-08-27)
- 🚧 **v1.2 Discovery & Polish** — Phases 6-10 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-3) — SHIPPED 2026-08-25</summary>

- [x] Phase 1: Core Polling Engine (4/4 plans) — completed 2026-08-22
- [x] Phase 2: Notification Delivery & Deployment (3/4 plans) — completed 2026-08-25 (02-04 blocked on Resend domain verification, see MILESTONES.md Known Gaps)
- [x] Phase 3: Status Dashboard (5/5 plans) — completed 2026-08-25

Full details archived: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>✅ v1.1 Area Search (Phases 4-5) — SHIPPED 2026-08-27</summary>

- [x] Phase 4: Area-Based Search (6/6 plans) — completed 2026-08-26
- [x] Phase 5: Watch-Management Write Path (8/8 plans) — completed 2026-08-27

Full details archived: `.planning/milestones/v1.1-ROADMAP.md`

</details>

### 🚧 v1.2 Discovery & Polish (In Progress)

**Milestone Goal:** Turn the dashboard from a watch-management tool into a genuinely polished, one-stop-shop for discovering and watching campsites — searchable/browsable beyond the user's configured watches, with a map view — while paying down Phase 5's known tech debt.

- [ ] **Phase 6: Tech Debt & Route-Coverage Hardening** - Fix Phase 5's 7 known issues and add an automated auth-gate coverage check before new discovery routes are added
- [ ] **Phase 7: RIDB Discovery Data Layer** - Cached, budgeted, session-gated full-catalog RIDB query layer, verified against live rate-limit/coordinate data
- [ ] **Phase 8: Discovery Search UI + Watch This** - Standalone search page over the full RIDB catalog with a "Watch this" action into the existing watch-creation form
- [ ] **Phase 9: Map View** - MapLibre GL map layering search results and active watches, with clustering and graceful bad-coordinate handling
- [ ] **Phase 10: Visual Redesign** - Extended design-token system and mobile-responsive layout applied across landing, discovery, and map screens

## Phase Details

### Phase 6: Tech Debt & Route-Coverage Hardening
**Goal**: Existing watch-management code is correct and safe, and the auth gate is automatically verified, before any new discovery/map routes are added on top of it
**Depends on**: Phase 5 (complete)
**Requirements**: TECH-01, TECH-02, TECH-03, TECH-04, TECH-05, TECH-06, TECH-07
**Success Criteria** (what must be TRUE):
  1. Editing a facility watch through the dashboard preserves its `facilityId` override after save and reload
  2. An area watch cannot be saved with more areas than its own live preview validated — save is rejected with a clear error if it exceeds the cap
  3. A malformed or invalid `watches.json` is rejected with a validation error everywhere it's read, and session-checking behaves identically across all routes since `requireSession()` is now a single shared implementation
  4. Rapid add/remove clicks in the area typeahead never leave the chip list out of sync with what was clicked
  5. Multi-area preview resolves noticeably faster than before (parallel, not sequential), and an automated check fails if any new API route touching `RIDB_API_KEY` isn't covered by the auth gate
**Plans**: TBD

### Phase 7: RIDB Discovery Data Layer
**Goal**: A cached, rate-budgeted, session-gated full-catalog RIDB query layer exists and its two riskiest assumptions (rate limit, coordinate field shape) are confirmed against live data, so search/map UI can build on it safely
**Depends on**: Phase 6
**Requirements**: DISC-02
**Success Criteria** (what must be TRUE):
  1. The new `/api/ridb/facilities` data layer returns validated, cached results; a repeat request within the cache window does not issue a new RIDB call
  2. Availability for a facility is fetched on-demand/per-result, never eager-loaded for an entire result set — confirmed by request count staying flat as result-list size grows
  3. RIDB's actual rate limit and coordinate field shape have been confirmed against a live response, and a request-budget guard enforces the confirmed limit
  4. Coordinates are validated (missing/zero/out-of-range) against fixture-based tests before any UI consumes them
**Plans**: TBD

### Phase 8: Discovery Search UI + Watch This
**Goal**: User can search RIDB's full campground catalog from a standalone, session-gated page and create a watch directly from a result
**Depends on**: Phase 7
**Requirements**: DISC-01, DISC-03, DISC-04, UI-03
**Success Criteria** (what must be TRUE):
  1. User can search RIDB's full catalog by name, state, and site type from a standalone discovery page and see matching results
  2. Each result shows an availability-at-a-glance visual indicator (which upcoming days have openings), not just a binary available/unavailable badge
  3. User can click "Watch this" on a result and arrive at the watch-creation form pre-filled with the facility/area, date range, and site type
  4. Visiting the discovery page without a valid session prompts for the shared secret, same as watch management — it is not publicly accessible
**Plans**: TBD
**UI hint**: yes

### Phase 9: Map View
**Goal**: User can see discovery search results and their active watches plotted spatially, distinguished from each other, without the map breaking on bad location data
**Depends on**: Phase 8
**Requirements**: MAP-01, MAP-02, MAP-03, MAP-04
**Success Criteria** (what must be TRUE):
  1. Discovery search results are plotted as pins on a map alongside the result list
  2. Active watches appear on the same map, visually distinguished from search results
  3. Pins cluster in dense areas and expand on zoom/click, keeping the map readable
  4. A result with missing or invalid coordinates still appears in the list (labeled "location unavailable") but is excluded from the map without crashing it
**Plans**: TBD
**UI hint**: yes

### Phase 10: Visual Redesign
**Goal**: The dashboard has a genuinely polished, consistent, mobile-usable visual design across the landing, discovery, and map screens
**Depends on**: Phase 9
**Requirements**: UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. Landing, discovery, and map pages share one consistent, extended design-token system (color ramp, spacing, shadow/elevation, motion, typography) — no inline hex/px values bypassing tokens
  2. All three pages are usable on a mobile viewport at standard breakpoints — no broken layout, no horizontal scroll, tap targets appropriately sized
  3. The discovery and map screens visually read as part of the same product as the landing page, not a bolted-on prototype
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|-----------------|--------|-----------|
| 1. Core Polling Engine | v1.0 | 4/4 | Complete | 2026-08-22 |
| 2. Notification Delivery & Deployment | v1.0 | 3/4 | Complete (known gap) | 2026-08-25 |
| 3. Status Dashboard | v1.0 | 5/5 | Complete | 2026-08-25 |
| 4. Area-Based Search | v1.1 | 6/6 | Complete | 2026-08-26 |
| 5. Watch-Management Write Path | v1.1 | 8/8 | Complete | 2026-08-27 |
| 6. Tech Debt & Route-Coverage Hardening | v1.2 | 0/TBD | Not started | - |
| 7. RIDB Discovery Data Layer | v1.2 | 0/TBD | Not started | - |
| 8. Discovery Search UI + Watch This | v1.2 | 0/TBD | Not started | - |
| 9. Map View | v1.2 | 0/TBD | Not started | - |
| 10. Visual Redesign | v1.2 | 0/TBD | Not started | - |
