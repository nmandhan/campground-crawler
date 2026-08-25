# Fixture Provenance

## `availability-month.json`

**live-captured (base) + hand-augmented, captured 2026-08-16**

`scripts/capture-fixtures.ts` was run against the real, undocumented
`GET /api/camps/availability/campground/{id}/month` endpoint for Yosemite's
Upper Pines campground (facility ID `232447`, month `2026-09-01`). The live
call succeeded (HTTP 200, JSON body) without any RIDB API key or special
auth on this endpoint — confirming RESEARCH Assumption A2 (status vocabulary)
against real traffic: the observed status strings for this campground/month
were exactly `Available`, `Reserved`, `Closed`, and `campsite_type` values
were exactly `STANDARD NONELECTRIC`, `RV NONELECTRIC`, `TENT ONLY
NONELECTRIC` — no `GROUP` type appeared in this specific campground's live
response (Upper Pines has no group loop).

Campsite `205` in this fixture is taken verbatim (field names, structure,
and one real `Available` night) from the live response. Campsites `300`,
`301`, and `402` were hand-added (synthetic, following the exact schema/field
conventions confirmed by the live call) to give the matcher test suite (plan
01-03) the required variety that the live window didn't happen to contain:

- `300`: a 5-consecutive-night fully-available run (`TENT ONLY NONELECTRIC`)
- `301`: a run with a one-night gap in the middle (`RV NONELECTRIC`, status
  `"Not Available"` on 09-12)
- `402`: a `GROUP STANDARD AREA NONELECTRIC` site exercising the wider status
  vocabulary documented in RESEARCH.md (`Open`, `Closed`, `Lottery`, `NYR`) to
  prove the allowlist-only (`=== 'Available'`) matching logic (RESEARCH
  Pitfall 1) correctly treats all of those as `available: false`.

This confirms RESEARCH Assumption A2 (allowlist-only `'Available'` matching
is correct) against live data, and does not contradict A3 (site-type
heuristic) for the types actually observed live.

## `ridb-facilities.json`

**synthetic**

The live RIDB `/api/v1/facilities` search endpoint requires a valid
`RIDB_API_KEY` (confirmed live: an unauthenticated request returns
`HTTP 401 {"error":"Unauthorized Access"}`), and no key was available in
this execution environment. This fixture is hand-built from RESEARCH.md
Pattern 1's documented `{ RECDATA: [...], METADATA: {...} }` envelope shape
(Assumption A1), which remains **unvalidated** against a live authenticated
response. Re-validate this fixture's envelope shape the first time a real
`RIDB_API_KEY` is available (e.g. via `scripts/capture-fixtures.ts`).

## `ridb-recareas.json`

**live-captured, captured 2026-08-25**

Captured via `scripts/capture-recarea-fixtures.ts "Yosemite National Park"` against the live
`GET /recareas?query=Yosemite%20National%20Park` endpoint (RecArea search). The top text match
resolved to RecArea ID `2986`, `"Wrangell - St Elias National Park & Preserve"` — a real RIDB
fuzzy-text-match quirk (the query string did not exactly match a RecArea name), not a bug in the
capture script. This is consistent with D-02/D-03 (auto-pick top match, no fail-closed behavior)
already locked in `04-CONTEXT.md`, and is a concrete example of why the `alternatives` field
(surfaced by `resolveFacility`-style callers) matters for a RecArea resolver. `RECDATA` entries use
`RecAreaID` (string, e.g. `"2986"`) and `RecAreaName` — the exact keys `RidbRecAreaSchema` expects.

## `ridb-recarea-facilities.json`

**live-captured, captured 2026-08-25**

Captured via `scripts/capture-recarea-fixtures.ts` against the live
`GET /recareas/2986/facilities` endpoint for RecArea `2986`
(`"Wrangell - St Elias National Park & Preserve"`, the RecArea resolved above).

Open Question 1 (RESEARCH.md, Assumption A2) — RESOLVED: GET /recareas/{id}/facilities returns
full Facility records. Observed keys: ACTIVITY, CAMPSITE, EVENT, Enabled, FACILITYADDRESS,
FacilityAccessibilityText, FacilityAdaAccess, FacilityDescription, FacilityDirections,
FacilityEmail, FacilityID, FacilityLatitude, FacilityLongitude, FacilityMapURL, FacilityName,
FacilityPhone, FacilityReservationURL, FacilityTypeDescription, FacilityUseFeeDescription,
GEOJSON, Keywords, LINK, LastUpdatedDate, LegacyFacilityID, MEDIA, ORGANIZATION, OrgFacilityID,
PERMITENTRANCE, ParentOrgID, ParentRecAreaID, RECAREA, Reservable, StayLimit, TOUR. Observed
FacilityTypeDescription values: Activity Pass | Campground | Facility | Permit | Tree Permit |
Venue Reservations (aggregated across Yosemite National Park query, Sequoia National Forest query,
and Lake Tahoe Basin Management Unit query capture runs).

Both `FacilityTypeDescription` and `Reservable` are present on every observed record — this is the
"full record" shape, not the compact 3-field stub. `RidbRecAreaFacilitiesSchema` still keeps both
fields `.optional()` (mirroring `RidbFacilitySchema`) as defensive parsing, since RIDB's schema is
undocumented and not formally guaranteed to stay this way.
