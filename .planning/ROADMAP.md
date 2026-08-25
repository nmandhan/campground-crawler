# Roadmap: Campground Crawler

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3 (shipped 2026-08-25)
- 🚧 **v1.1 Area Search** — Phases 4-5 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-3) — SHIPPED 2026-08-25</summary>

- [x] Phase 1: Core Polling Engine (4/4 plans) — completed 2026-08-22
- [x] Phase 2: Notification Delivery & Deployment (3/4 plans) — completed 2026-08-25 (02-04 blocked on Resend domain verification, see MILESTONES.md Known Gaps)
- [x] Phase 3: Status Dashboard (5/5 plans) — completed 2026-08-25

Full details archived: `.planning/milestones/v1.0-ROADMAP.md`

</details>

### 🚧 v1.1 Area Search (In Progress)

**Milestone Goal:** Let the user search a broad geographic area for available campsites instead of pre-identifying one specific campground, and manage watches through the dashboard UI instead of hand-editing `watches.json`.

- [ ] **Phase 4: Area-Based Search** - Poller can watch a whole Recreation Area, safely resolving and capping the campgrounds within it
- [ ] **Phase 5: Watch-Management Write Path** - Dashboard gains a shared-secret-gated UI to create/edit/delete watches, including area lookup by name

## Phase Details

### Phase 4: Area-Based Search
**Goal**: A watch can target one or more named Recreation Areas instead of a single pinned campground, with the poller safely resolving each area to its constituent campgrounds — filtered, capped, and attributed correctly at match time.
**Depends on**: Phase 3 (builds on the existing poller pipeline and dashboard match display)
**Requirements**: AREA-01, AREA-02, AREA-03, AREA-05
**Success Criteria** (what must be TRUE):
  1. User can add an area-based watch (one or more named Recreation Areas) to `watches.json`, and the poller checks availability across every campground in those areas
  2. Area watch facility resolution automatically excludes non-campground facility types (visitor centers, boat ramps, group day-use areas), preventing a wrong-match failure at region scale
  3. Area watches are capped at a maximum combined facility count (~15-25), with a truncation indicator shown when the cap is hit
  4. When an area watch matches an available site, the notification/dashboard output identifies the specific campground(s) that matched, not just the area name
**Plans**: 6 plans

Plans:
- [ ] 04-01-PLAN.md — Capture live RIDB `/recareas` + `/recareas/{id}/facilities` shapes, land the two response schemas
- [ ] 04-02-PLAN.md — `Watch` becomes a `FacilityWatch | AreaWatch` discriminated union (types + config schema, backward compatible)
- [ ] 04-03-PLAN.md — `resolveArea()` / `listAreaFacilities()` with the campground allowlist, group tagging, and bounded hydration
- [ ] 04-04-PLAN.md — Mirror the union into the dashboard; area labels, per-campground match attribution, truncation display
- [ ] 04-05-PLAN.md — `resolveWatches()` area branch: per-run cache, dedup, shared 20-facility cap, truncation bookkeeping
- [ ] 04-06-PLAN.md — `run.ts` group-by-watch-id aggregation, per-facility failure isolation, `[GROUP]` tag in the digest

### Phase 5: Watch-Management Write Path
**Goal**: User can fully manage watches — including area watches discoverable by name — through the dashboard UI, without hand-editing `watches.json`, with write actions gated behind a shared secret while existing read-only views stay public.
**Depends on**: Phase 4 (targets the finalized area-or-facility `Watch` type)
**Requirements**: AREA-04, MGMT-01, MGMT-02, MGMT-03, MGMT-04, MGMT-05, MGMT-06
**Success Criteria** (what must be TRUE):
  1. User can view a list of all configured watches on the dashboard
  2. User can search for a Recreation Area by name (typeahead) and create a new watch (area or single campground) with date range and site type, without hand-editing `watches.json`
  3. User can edit an existing watch and delete a watch through the dashboard UI
  4. Before saving an area watch, the user sees a preview of which actual campgrounds it resolves to across all selected areas
  5. Write actions (create/edit/delete) require a valid shared secret and are rejected without one, while existing read-only dashboard views remain public and unauthenticated
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 4 → 5

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|-----------------|--------|-----------|
| 1. Core Polling Engine | v1.0 | 4/4 | Complete | 2026-08-22 |
| 2. Notification Delivery & Deployment | v1.0 | 3/4 | Complete (known gap) | 2026-08-25 |
| 3. Status Dashboard | v1.0 | 5/5 | Complete | 2026-08-25 |
| 4. Area-Based Search | v1.1 | 0/6 | Planned | - |
| 5. Watch-Management Write Path | v1.1 | 0/TBD | Not started | - |
</content>
