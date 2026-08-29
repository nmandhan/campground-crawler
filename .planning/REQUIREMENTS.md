# Requirements: Campground Crawler

**Defined:** 2026-08-29
**Core Value:** When a watched campsite becomes available on Recreation.gov, the user gets an email fast enough to actually book it before someone else does.

## v1.2 Requirements

Requirements for the Discovery & Polish milestone. Each maps to roadmap phases.

**Note — reversing a prior exclusion:** v1.1's REQUIREMENTS.md explicitly excluded "unbounded whole-catalog discovery mode" (rate-limit risk against RIDB and the poller's 5-min cron budget). This milestone reverses that, on the strength of a specific mitigation: availability data is fetched on-demand/paginated per result (DISC-02), never eager-loaded for an entire result set — the original rate-limit concern was about *unbounded* querying, not full-catalog *search* itself.

### Discovery Search

- [ ] **DISC-01**: User can search Recreation.gov's full campground catalog by name, state, and site type — not just their configured watches
- [ ] **DISC-02**: Search results show availability on-demand/paginated per result, never eager-loaded for the full result set at once, to protect the shared RIDB rate-limit budget
- [ ] **DISC-03**: User can create a watch directly from a search result, pre-filled with the facility/area and the search's date range/site type
- [ ] **DISC-04**: The discovery search page requires the same shared-secret session as watch management; it is not publicly accessible like the existing read-only views

### Map View

- [ ] **MAP-01**: User can see discovery search results plotted on a map
- [ ] **MAP-02**: User can see their active watches on the same map, visually distinguished from search results
- [ ] **MAP-03**: Map pins cluster in dense areas so the map stays readable
- [ ] **MAP-04**: A result with missing or invalid coordinates degrades gracefully — shown in the list, excluded from the map, never dropped or crashing the map

### Visual Redesign

- [ ] **UI-01**: The dashboard has an extended, consistent design-token system (color, spacing, shadows, motion, typography) applied across the landing page, discovery page, and map — not a component library, deepening the existing `globals.css` tokens
- [ ] **UI-02**: The dashboard is usable on a mobile viewport (responsive layout, standard breakpoints)
- [ ] **UI-03**: Discovery search results show an availability-at-a-glance visual indicator (which upcoming days have openings), not a binary available/unavailable badge

### Tech Debt (Phase 5 Code Review Follow-ups)

- [ ] **TECH-01**: Editing a facility watch preserves its `facilityId` override instead of silently dropping it
- [ ] **TECH-02**: An area watch cannot be saved with more areas than its own live preview validates (save schema cap matches the preview cap)
- [ ] **TECH-03**: `getWatchesFile()` validates the fetched `watches.json` with zod, consistent with every other API-response path
- [ ] **TECH-04**: Rapid chip add/remove in the area typeahead no longer drops a mutation (functional state update, not a stale-closure race)
- [ ] **TECH-05**: `previewAreas()` resolves areas in parallel instead of sequentially
- [ ] **TECH-06**: The auth gate (`proxy.ts`) has an automated check tying new API routes to protection, not just a hand-maintained allowlist
- [ ] **TECH-07**: `requireSession()` is a single shared export instead of being copy-pasted across route files

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Discovery Ecosystem

- **REVIEW-01**: Campsite reviews aggregated and shown alongside search results — deferred pending a research spike into whether a legitimate reviews API exists (no official Recreation.gov reviews API; scraping conflicts with the project's official-API-only data-source constraint)
- **TRAIL-01**: Nearby hiking trails shown alongside campsites — deferred pending a research spike into a dedicated trails data source (RIDB's trail/activity coverage is incomplete)

### Email Delivery (still open from v1.0)

- **NOTF-01, NOTF-02, NOTF-03**: Email delivery is code-complete and unit-tested but blocked on Resend domain verification. Explicitly deferred again this milestone — the user is not pursuing a Resend domain right now. Revisit whenever that changes; no new code is expected, only live re-verification.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Multi-user support / accounts / login | Single-user personal tool, unchanged from v1.0/v1.1 |
| Automated booking/reservation | Notification + "Watch this" only — booking sites generally prohibit automated checkout |
| Campsite reviews (this milestone) | No official API; deferred to v2 pending a research spike (see REVIEW-01) |
| Nearby hiking trails (this milestone) | RIDB coverage incomplete; deferred to v2 pending a research spike (see TRAIL-01) |
| Commercial-grade mapping (Mapbox paid tiers, 3D terrain, custom vector styling) | Disproportionate cost/complexity for a single-user tool; a free no-API-key map stack is sufficient |
| Real-time live-updating discovery/map (WebSocket push, sub-minute polling) | Duplicates the poller's existing 5-min cron infra against the same rate-sensitive endpoint; on-demand checks only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DISC-01 | Phase 8 | Pending |
| DISC-02 | Phase 7 | Pending |
| DISC-03 | Phase 8 | Pending |
| DISC-04 | Phase 8 | Pending |
| MAP-01 | Phase 9 | Pending |
| MAP-02 | Phase 9 | Pending |
| MAP-03 | Phase 9 | Pending |
| MAP-04 | Phase 9 | Pending |
| UI-01 | Phase 10 | Pending |
| UI-02 | Phase 10 | Pending |
| UI-03 | Phase 8 | Pending |
| TECH-01 | Phase 6 | Pending |
| TECH-02 | Phase 6 | Pending |
| TECH-03 | Phase 6 | Pending |
| TECH-04 | Phase 6 | Pending |
| TECH-05 | Phase 6 | Pending |
| TECH-06 | Phase 6 | Pending |
| TECH-07 | Phase 6 | Pending |

**Coverage:**
- v1.2 requirements: 18 total
- Mapped to phases: 18 (Phase 6: TECH-01..07, Phase 7: DISC-02, Phase 8: DISC-01/03/04 + UI-03, Phase 9: MAP-01..04, Phase 10: UI-01/02)
- Unmapped: 0

---
*Requirements defined: 2026-08-29*
*Last updated: 2026-08-29 after v1.2 roadmap creation (Phases 6-10)*
