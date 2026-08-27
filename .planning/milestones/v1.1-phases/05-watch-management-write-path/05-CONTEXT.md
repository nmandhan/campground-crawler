# Phase 5: Watch-Management Write Path - Context

**Gathered:** 2026-08-26
**Status:** Ready for planning

<domain>
## Phase Boundary

The dashboard gains a shared-secret-gated write path: create, edit, and delete watches (facility or area type) through the UI, including Recreation Area typeahead search and a live preview of which campgrounds an area watch resolves to before saving. Existing read-only dashboard views stay public/unauthenticated — only the new mutation surface requires the secret. Writes land in `watches.json` via the GitHub Contents API and are picked up by the poller on its next ≤5-min cron tick; the dashboard never resolves/freezes area→facility expansion into the persisted watch (that stays the poller's job, at poll time).

</domain>

<decisions>
## Implementation Decisions

### Shared-Secret Auth

- **D-01:** One-time login, not per-action re-entry. A passphrase form sets a short-lived-looking but actually long-lived (~30 day) httpOnly session cookie server-side; once unlocked, all create/edit/delete actions in that browser session proceed without re-prompting.
- **D-02:** The unlock prompt is inline on the watches page itself ("Unlock to manage watches"), not a separate `/login` route. Unauthenticated visitors still see the full read-only watch list; only the management controls are gated.
- **D-03:** Session cookie validity: ~30 days. Single named user on their own browser — optimize for not re-entering the secret often, not for minimizing exposure window.
- Consistent with research (`ARCHITECTURE.md`, `PITFALLS.md`): the secret is validated server-side only, the GitHub PAT never reaches the client bundle, and this is a deliberate "minimum viable gate," not a real accounts system.

### Create/Edit Form

- **D-04:** Create/edit opens as a modal/panel over the watch list, not a dedicated page/route.
- **D-05:** One form handles both watch types, with a Facility/Area toggle at the top that swaps the location-picker section (single-campground typeahead vs. multi-area chip picker) while date range and site type stay shared below — mirrors the `Watch` discriminated union directly.
- **D-06:** Multi-area watches: a typeahead search box finds a Recreation Area by name; selecting one adds it as a removable chip. Repeat to add more areas to the same watch (maps directly to the `areas[]` array in `AreaWatchSchema`).

### Area Typeahead

- **D-07:** Debounced live-suggestions dropdown (e.g. ~300ms debounce, 2-3 char minimum) — not an explicit search button. Calls RIDB's `/recareas?query=` search as the user types.
- **D-08:** Each suggestion shows the Recreation Area name plus disambiguating context (state/parent org, e.g. "Los Padres National Forest — CA") so the user can tell apart similarly-named areas.
  - **Open verification item for research/planning:** the live `RidbRecAreaSchema` captured in Phase 4 (`src/recreation-gov/types.ts`) currently only parses `RecAreaID` and `RecAreaName` — no state/org field was captured or verified against a live response. Researcher must confirm the actual field name(s) RIDB returns for state/parent-org (likely something like `RecAreaState`/`RecAreaFullDescription`/`AdminOrg` — unverified) before this schema can be extended and the disambiguating context can render. If no such field exists or is unreliable, fall back to name-only display for that suggestion.

### Area Preview (MGMT-05)

- **D-09:** Auto-fetch: the preview refreshes automatically whenever an area chip is added or removed — no separate "Preview" button. Costs one extra RIDB round trip per add/remove, accepted for the responsiveness.
- **D-10:** Preview shows the full resolved campground list (not just a count), each tagged standard vs. group (reusing Phase 4's D-05 tag), plus a truncation warning (e.g. "showing 20 of 34") if the combined areas will hit the shared 20-facility cap from Phase 4 (D-07/D-10 of `04-CONTEXT.md`).
- **Architectural note carried into canonical_refs below:** `ARCHITECTURE.md`'s "Anti-Pattern 1" warns against the write path resolving area→facility and *freezing* that list into `watches.json` — that guidance still holds (the persisted watch keeps only area criteria, resolved fresh by the poller every cycle). It does **not** forbid the dashboard from making a live, read-only RIDB call purely to render this preview. This means the dashboard needs its own small RIDB client (hand-duplicated into `dashboard/lib/`, consistent with the project's existing no-shared-import convention between `src/` and `dashboard/`) exposing area search + facility listing for typeahead/preview only — never used to write the frozen list.

### Delete & Save Feedback

- **D-11:** Delete requires a confirmation dialog ("Delete this watch? This can't be undone") before the DELETE call fires — deletion is destructive/irreversible from the UI's perspective (git history is the only real undo).
- **D-12:** After a successful save (create or edit), show a toast/banner: "Saved — live within ~5 min" — sets correct expectations that the change isn't reflected in poll history until the next GitHub Actions cron tick, per `ARCHITECTURE.md`'s propagation-delay note.

### Claude's Discretion

- Exact Route Handler structure (`dashboard/app/api/watches/route.ts` vs `[id]/route.ts` split), the GitHub Contents API sha-read/PUT/409-retry implementation details, and the new hand-duplicated RIDB client's exact module shape in `dashboard/lib/` — architecture direction is already well-specified in `ARCHITECTURE.md`/`PITFALLS.md`/`STACK.md`.
- Exact toast/banner component choice, modal implementation (native `<dialog>` vs a small custom component) — no existing UI library beyond plain Tailwind/React per `dashboard/package.json`; keep consistent with that zero-dependency-by-default posture unless the form genuinely needs `react-hook-form` (per `STACK.md`'s conditional recommendation).
- Whether the write-path validation schema (`dashboard/lib/schema.ts`, stricter `.min(1)`/unique-id rules per `ARCHITECTURE.md`'s file table) lives alongside the existing read schemas or in a new file.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & stack (milestone-level research, written before Phase 4/5 split)
- `.planning/research/ARCHITECTURE.md` — "Feature 2: Watch-Management Write Path" section (GitHub Contents API write path, mutation auth, new/modified file table, data flow diagram, Anti-Pattern 1/2/3). **Note the narrow clarification above:** Anti-Pattern 1 forbids *persisting* a frozen area→facility expansion, not a live *read-only* RIDB call for the MGMT-05 preview — the dashboard needs a small new RIDB client for search/preview, contradicting this doc's framing of "dashboard has no existing RIDB client at all today" as a reason to avoid RIDB calls entirely.
- `.planning/research/PITFALLS.md` — Pitfall 3 (write/poller race, sha-based concurrency), Pitfall 4 (unauthenticated write endpoint) — directly informs D-01/D-02 auth decisions and the GitHub write implementation.
- `.planning/research/STACK.md` — GitHub REST Contents API choice (plain `fetch`, no SDK), conditional `react-hook-form` recommendation, "no database/auth framework" constraint.
- `.planning/research/SUMMARY.md` — Overall Feature 2 delivery summary and sequencing rationale (Phase A before Phase B, already satisfied — Phase 4 is Phase A, this is Phase B).
- `.planning/research/FEATURES.md` — Typeahead requirement framing (table-stakes vs. rejected map/radius picker), confirms typeahead is the intended UX, not free text or geo-picker.

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — AREA-04, MGMT-01 through MGMT-06 (this phase's scope).
- `.planning/ROADMAP.md` — Phase 5 goal, success criteria, dependency on Phase 4 (finalized `Watch` union).

### Existing code (ground truth for patterns to mirror)
- `dashboard/lib/github.ts` — existing read-path pattern (`fetchJson`, allowlisted `DataFile` type, discriminated result, module-doc-comment conventions) — `github-write.ts` should follow the same house style (never throws, explicit result types, doc comments explaining *why*).
- `dashboard/lib/schema.ts` / `dashboard/lib/types.ts` — existing hand-duplicated `Watch`/`AreaWatch`/`FacilityWatch` shapes and the explicit "never import across `src/`↔`dashboard/`" convention documented in `types.ts`'s file header — the new write-path validation and the new RIDB client must both follow this same hand-duplication convention, not introduce a shared package.
- `src/recreation-gov/client.ts` / `src/recreation-gov/types.ts` — `resolveArea()`/`RidbRecAreaSchema` from Phase 4, the pattern to mirror (not import) when building the dashboard's own typeahead/preview RIDB client.
- `src/config/schema.ts` — `AreaWatchSchema`/`FacilityWatchSchema` — the stricter validation rules (`.min(1)`, unique-id refine) that the write path must also enforce per `ARCHITECTURE.md`'s file table.
- `.github/workflows/poll.yml` — confirms the poller only ever reads `watches.json` (via `actions/checkout`) — unaffected by this phase, no changes needed there.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `dashboard/lib/github.ts`'s `fetchJson`/`DataFile` allowlist pattern — direct style reference for the new `github-write.ts` module (GET+sha, PUT with 409 retry).
- `dashboard/lib/schema.ts` / `dashboard/lib/types.ts` — existing `Watch`/`AreaWatch`/`FacilityWatch` shapes already mirror the poller's discriminated union; the write path's stricter validation layer extends these, doesn't replace them.
- `src/recreation-gov/client.ts`'s `resolveArea()` and retry/fetch/zod-parse pipeline — the pattern (not the code) to hand-duplicate into a new dashboard-side RIDB client for typeahead + preview.

### Established Patterns
- Every dashboard `lib/` module: safeParse-based loaders, non-throwing discriminated results, doc comments citing rationale (RESEARCH.md/threat IDs) rather than restating what the code does.
- Zero UI dependencies today (`next`, `react`, `react-dom`, `zod` only) — plain Tailwind/React controlled components; only add `react-hook-form` if the form genuinely outgrows plain `useState` (per `STACK.md`).
- File-ownership invariant: one writer per committed JSON file (poller writes `state.json`/`runs.json`; this phase makes the dashboard the sole writer of `watches.json`).

### Integration Points
- `dashboard/app/api/watches/route.ts` (new) — `POST` create; `dashboard/app/api/watches/[id]/route.ts` (new) — `PATCH` edit, `DELETE` delete.
- `dashboard/lib/github-write.ts` (new) — GitHub Contents API GET-sha/PUT-with-409-retry.
- A new dashboard-side RIDB client module (new, name TBD by planner, e.g. `dashboard/lib/ridb.ts`) — area search (typeahead) + facility listing (preview), read-only, never used to persist a frozen expansion.
- `dashboard/middleware.ts` or equivalent (new) — session-cookie check gating only the `/api/watches/*` mutation routes.
- `dashboard/app/page.tsx` / `dashboard/app/sections.tsx` — existing read-only watch list rendering; gains the inline unlock prompt + management controls (create/edit/delete buttons) per D-02.

</code_context>

<specifics>
## Specific Ideas

- User wants to actually *see* which specific campgrounds an area search will match before committing — not just trust a name match — hence the "full list, not just a count" decision (D-10), directly echoing the Phase 4 concern about group-vs-standard campground confusion.
- Disambiguating typeahead suggestions by state/parent org (D-08) came from the user directly asking "how do I know I'm selecting the right campground/area" — the RIDB field to power this is unverified and flagged for the researcher.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Per-facility exclusion within an area watch is already v2-deferred as MGMT-07 in REQUIREMENTS.md; lat/long+radius search is already v2-deferred as AREA-06.)

</deferred>

---

*Phase: 05-watch-management-write-path*
*Context gathered: 2026-08-26*
