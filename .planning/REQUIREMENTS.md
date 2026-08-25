# Requirements: Campground Crawler

**Defined:** 2026-08-25
**Core Value:** When a watched campsite becomes available on Recreation.gov, the user gets an email fast enough to actually book it before someone else does.

## v1.1 Requirements

Requirements for the Area Search milestone. Each maps to roadmap phases.

### Area-Based Search

**Scope note:** Recreation.gov/RIDB only catalogs federal recreation land (National Parks, National Forests, BLM, Army Corps, etc.) — the same federal-only scope v1.0 already committed to. City-run and private campgrounds are not in this data source at all and are not addressed by any requirement below; expanding to non-federal data sources is a separate, larger scope decision, not part of v1.1.

- [ ] **AREA-01**: User can define a watch for one or more named Recreation Areas (park/forest) instead of one specific campground, and the system checks availability across every campground in the selected area(s)
- [ ] **AREA-02**: Area watches are capped at a maximum combined number of facilities across all selected areas (~15-25) with a truncation indicator, protecting the existing rate-limit budget
- [ ] **AREA-03**: Area watch facility resolution filters out non-campground facility types (visitor centers, boat ramps, group day-use areas, etc.) to avoid a wrong-match failure at region scale (the v1.0 "BANDIDO" bug class)
- [ ] **AREA-04**: User can find a Recreation Area by name (typeahead search) rather than needing to already know its numeric RIDB ID
- [ ] **AREA-05**: When an area watch matches, the notification/dashboard shows which specific campground(s) within the area(s) matched, not just the area name

### Watch Management UI

- [ ] **MGMT-01**: User can view a list of all configured watches on the dashboard
- [ ] **MGMT-02**: User can create a new watch (one or more areas, or a single campground, plus date range and site type) through the dashboard UI, without hand-editing `watches.json`
- [ ] **MGMT-03**: User can edit an existing watch through the dashboard UI
- [ ] **MGMT-04**: User can delete a watch through the dashboard UI
- [ ] **MGMT-05**: Before saving an area watch, the user sees a preview of which actual campgrounds it resolves to across all selected areas, catching bad matches before the watch goes live
- [ ] **MGMT-06**: Write actions (create/edit/delete) are gated behind a minimal server-side shared-secret check; existing read-only dashboard views remain public and unauthenticated

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Area Search Enhancements

- **AREA-06**: Lat/long + radius search as an alternative to named-area search (deferred — RIDB lat/long data is inconsistently populated, unreliable without further investigation)
- **AREA-07**: Hybrid watch model — an area watch with an explicit single-campground fallback/pin

### Watch Management Enhancements

- **MGMT-07**: Per-facility opt-out/exclusion list within an area watch

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Map/visual area picker UI | High build cost, low incremental value for a single user who already knows their target parks by name — named-area typeahead covers the same need |
| Unbounded "search everything" / whole-state discovery mode | Explodes request volume against RIDB's rate limits and the poller's 5-min cron budget; produces noisy, low-value results for a single-user, notify-only tool |
| Full auth system (OAuth/accounts) for the write UI | Single named user, not multi-tenant — a shared-secret gate is sufficient per PROJECT.md's existing no-multi-user constraint |
| GitHub App for the write path | Solves a multi-tenant/multi-repo problem this single-user, single-repo tool doesn't have; a fine-grained PAT is sufficient |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AREA-01 | TBD | Pending |
| AREA-02 | TBD | Pending |
| AREA-03 | TBD | Pending |
| AREA-04 | TBD | Pending |
| AREA-05 | TBD | Pending |
| MGMT-01 | TBD | Pending |
| MGMT-02 | TBD | Pending |
| MGMT-03 | TBD | Pending |
| MGMT-04 | TBD | Pending |
| MGMT-05 | TBD | Pending |
| MGMT-06 | TBD | Pending |

**Coverage:**
- v1.1 requirements: 11 total
- Mapped to phases: 0 (pending roadmap creation)
- Unmapped: 11 ⚠️ (expected before roadmap step)

---
*Requirements defined: 2026-08-25*
*Last updated: 2026-08-25 after milestone v1.1 requirements definition*
