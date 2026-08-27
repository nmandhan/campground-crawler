# Phase 5: Watch-Management Write Path - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-26
**Phase:** 05-watch-management-write-path
**Areas discussed:** Shared-secret login UX, Create/edit form flow, Area preview interaction, Delete/edit confirmation & save feedback, Area typeahead UX

---

## Shared-Secret Login UX

| Option | Description | Selected |
|--------|-------------|----------|
| One-time login, session cookie | Single passphrase field sets a short-lived-looking httpOnly session cookie; writes proceed without re-entry | ✓ |
| Re-enter secret every write | No session state, passphrase required on every create/edit/delete | |
| Secret baked into a bookmarked URL | Query-param/path token gates write UI visibility | |

**User's choice:** One-time login, session cookie.

| Option | Description | Selected |
|--------|-------------|----------|
| Inline on the watches page | "Unlock to manage watches" prompt on the existing list page, no separate route | ✓ |
| Dedicated /login page | Separate route, redirects back on success | |

**User's choice:** Inline on the watches page.

| Option | Description | Selected |
|--------|-------------|----------|
| Long-lived (e.g. 30 days) | Optimize for not re-entering the secret often | ✓ |
| Short-lived (e.g. 1 day / browser session) | Re-enter more often, smaller exposure window | |

**User's choice:** Long-lived (~30 days).

---

## Create/Edit Form Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated page | e.g. /watches/new, /watches/[id]/edit | |
| Modal/panel on the list page | Create/edit opens inline over the watch list | ✓ |

**User's choice:** Modal/panel on the list page.

| Option | Description | Selected |
|--------|-------------|----------|
| Typeahead search + "add" chips | Search finds a Recreation Area by name, adds as a removable chip; repeat for more areas | ✓ |
| Single area per watch in the UI | Only one area per watch in the UI even though schema allows more | |

**User's choice:** Typeahead search + "add" chips.

| Option | Description | Selected |
|--------|-------------|----------|
| One form, type toggle at top | Facility/Area toggle swaps the location-picker section, shared date/site-type fields below | ✓ |
| Separate 'New facility watch' / 'New area watch' entry points | Two distinct buttons/flows, each its own modal | |

**User's choice:** One form, type toggle at top.

---

## Area Preview Interaction (MGMT-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-fetch after each area is added | Preview refreshes automatically on chip add/remove | ✓ |
| Explicit 'Preview campgrounds' button | User adds all areas, then clicks to fetch once | |

**User's choice:** Auto-fetch after each area is added.

| Option | Description | Selected |
|--------|-------------|----------|
| Full list with standard/group tags + truncation warning | Every resolved campground, tagged standard/group, plus cap warning | ✓ |
| Just a count + cap warning | e.g. "18 campgrounds across 2 areas", no per-campground list | |

**User's choice:** Full list with standard/group tags + truncation warning.

---

## Delete/Edit Confirmation & Save Feedback

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, confirm dialog | "Delete this watch? This can't be undone" before DELETE fires | ✓ |
| No, delete fires immediately | Delete button removes the watch with no extra step | |

**User's choice:** Yes, confirm dialog.

| Option | Description | Selected |
|--------|-------------|----------|
| Toast/banner: "Saved — live within ~5 min" | Brief success message states propagation delay | ✓ |
| No explicit messaging, just close/refresh | Modal closes and list refreshes, no timing copy | |

**User's choice:** Toast/banner: "Saved — live within ~5 min".

---

## Area Typeahead UX

*(User-raised follow-up question: "How will the search for an area be validated? Will I get suggestions as I am typing so I know that I am selecting the right campground/area?")*

| Option | Description | Selected |
|--------|-------------|----------|
| Debounced live suggestions dropdown | Suggestions appear as you type (~300ms debounce, 2-3 char min) from RIDB /recareas search | ✓ |
| Explicit search button, results list below | Type full query, click Search, results appear below | |

**User's choice:** Debounced live suggestions dropdown.

| Option | Description | Selected |
|--------|-------------|----------|
| Name + parent org/state | e.g. "Los Padres National Forest — CA" for disambiguation | ✓ |
| Name only | Just the RIDB-returned Recreation Area name | |

**User's choice:** Name + parent org/state.
**Notes:** Flagged in CONTEXT.md as an open verification item — the live `RidbRecAreaSchema` from Phase 4 only captures `RecAreaID`/`RecAreaName` today; the researcher must confirm RIDB actually returns a state/org field before this can render, with a name-only fallback if not.

---

## Claude's Discretion

- Exact Route Handler file structure, GitHub Contents API sha-read/PUT/409-retry implementation
- New dashboard-side RIDB client's exact module shape
- Toast/modal component implementation choice (plain Tailwind/React vs. adding a library)
- Where the stricter write-path validation schema lives within `dashboard/lib/`

## Deferred Ideas

None — discussion stayed within phase scope.
