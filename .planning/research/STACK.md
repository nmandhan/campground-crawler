# Stack Research: v1.2 Discovery & Polish

**Domain:** Additions to an existing Next.js 16 App Router dashboard (discovery/search page, map view, visual redesign)
**Researched:** 2026-08-29
**Confidence:** HIGH (map library choice, versions) / MEDIUM (redesign approach — judgment call grounded in stated project constraint, not an external "best practice")

## Context: What Already Exists

`dashboard/package.json` today has exactly 5 runtime deps: `next@16.3.2`, `react@19.2.8`, `react-dom@19.2.8`, `server-only`, `zod@^4.4.3`. No Tailwind, no component library (shadcn explicitly declined per PROJECT.md), no icon library, no date library. Design is entirely hand-rolled CSS custom properties in `dashboard/app/globals.css` (spacing scale, 4 font sizes, 2 weights, 60/30/10 color split) plus a `COPY` string-constants object in `dashboard/lib/copy.ts`. `dashboard/lib/ridb.ts` already wraps RIDB API calls (facility/recarea search) and `dashboard/lib/debounce.ts` already exists (used by the Phase 5 area typeahead). This "zero non-essential dependencies" posture has held through v1.0 and v1.1 as a deliberate choice, not an oversight — any new dependency needs a specific capability gap, not just convenience.

Three new capabilities are needed for v1.2: (1) a discovery page hitting RIDB's full catalog, (2) a map showing search results + watches, (3) a genuine visual redesign. Only (2) requires new runtime dependencies — the map is genuinely hard to hand-roll (projection math, pan/zoom gesture handling, tile loading/caching); (1) and (3) do not.

## Recommended Additions

### Map: `maplibre-gl`

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|------------------|
| `maplibre-gl` | `^6.6.0` | WebGL vector-tile map renderer | BSD-3, no API key, no vendor lock-in, no usage cap — pairs with free vector-tile hosts (see below). Bundled via npm, not loaded from a third-party `<script>` tag, so it fits a project that already vendors everything through npm rather than trusting external services at runtime beyond the two APIs (RIDB, availability endpoint) already in the architecture. |

**Do not add `react-map-gl`.** It's a thin React wrapper (`react-map-gl@8.1.2`, exposing `react-map-gl/maplibre`) that adds declarative JSX bindings on top of `maplibre-gl`'s imperative API. It's popular and well-maintained, but for a project whose stated constraint is "zero non-essential dependencies" and whose existing patterns (`area-typeahead.tsx`, `debounce.ts`) are already hand-rolled `useRef`/`useEffect` wrappers around imperative browser/fetch APIs, adding a second map dependency for JSX sugar isn't justified. Write a ~40-line `<Map>` client component wrapping `maplibre-gl`'s `Map`/`Marker`/`GeoJSONSource` classes directly in a `useEffect`, following the same pattern already used for the typeahead. This keeps the new dependency count at exactly one.

**Tile/style source: OpenFreeMap (`https://tiles.openfreemap.org/styles/liberty`).** No API key, no signup, no rate limit, free and CDN-hosted as of 2026, built on OpenStreetMap data. This avoids adding a MapTiler/Mapbox account + API key to the project's env-var surface (which today is just the GitHub PAT + Resend key + shared secret) for a single-user personal tool. If OpenFreeMap's reliability becomes a concern later, MapTiler's free tier (100k tile loads/mo, requires an API key) is the fallback — but start with zero-signup.

**Why not Leaflet/`react-leaflet`:** Leaflet (`1.9.4` / `react-leaflet@5.0.0`) is lighter-weight and simpler, and would also work fine here — pin markers on a raster basemap is well within its wheelhouse. It loses out for this specific milestone because (a) the explicit goal is "genuinely polished, beautiful UI," and MapLibre's vector-tile rendering gives smooth, modern, GPU-rendered basemaps (closer to the Google/Apple Maps look) versus Leaflet's raster-tile-plus-DOM-marker rendering, which reads more dated; (b) MapLibre has clustering (`GeoJSONSource` with `cluster: true`) built in via bundled supercluster, which the discovery page will likely need once RIDB search returns dozens of results in a region — Leaflet needs a separate plugin (`leaflet.markercluster`) for the same feature, which would mean 2 dependencies instead of 1.

### RIDB coordinate data quality — no library needed, app-level filtering required

RIDB facility records inconsistently populate `FacilityLatitude`/`FacilityLongitude` — some are `0, 0` (Null Island, a common "unset" sentinel from broken imports), some are `null`, and some are out-of-range or swapped lat/long. This is **not a map-library concern** — MapLibre will happily plot garbage coordinates. It has to be handled in application code, in whichever module assembles map data (likely a new `dashboard/lib/map-data.ts` alongside the existing `lib/ridb.ts`):

```typescript
function hasValidCoordinates(f: { latitude: number | null; longitude: number | null }): boolean {
  if (f.latitude == null || f.longitude == null) return false;
  if (f.latitude === 0 && f.longitude === 0) return false; // Null Island sentinel
  return f.latitude >= -90 && f.latitude <= 90 && f.longitude >= -180 && f.longitude <= 180;
}
```

Facilities failing this check should still appear in the discovery page's list view (they have valid names/availability, just no map pin) — filter them out of the map's GeoJSON source only, not out of search results. Surface this as a documented, deliberate behavior (not a silent drop) when writing the FEATURES/ARCHITECTURE docs for this milestone.

### Design/redesign: extend existing CSS tokens, do not add a component library

No new dependency recommended here. Reasoning:

- The project already declined shadcn (a copy-paste component source, not even an npm dependency) in a prior phase, which is a stronger signal against a full library (Radix, MUI, Chakra, etc.) than against shadcn specifically.
- `globals.css` already has a coherent, documented token system (4 space multiples, 4 font sizes, 2 weights, 60/30/10 color split) that Phase 5's UI additions (buttons, toggles, chips, dialogs, toasts) extended cleanly without inventing new primitives — the system has proven it scales to new UI surfaces without needing a library.
- "Genuinely polished" is achievable by (a) deepening the existing token system — adding elevation/shadow tokens, a richer color ramp (currently only 2 status colors + 1 accent + 1 destructive), motion/transition tokens, and consistent border-radius scale, all still hand-rolled CSS custom properties; (b) using `next/font` (already bundled with Next.js, zero new dependency) to move off the system-font stack (`-apple-system, ...`) to a deliberately chosen webfont if desired; (c) CSS Grid/Flexbox layout work for the map+list split-pane discovery layout — no library needed for that either.
- A component library would genuinely help if the team were building many more interactive primitives fast (comboboxes, popovers, complex forms) — but v1.2's new surfaces are a search form, a result list, and a map, all of which extend patterns (typeahead, cards/rows, badges) already hand-built in Phase 3–5.

**Icons:** avoid an icon library (`lucide-react`, `react-icons`, etc.) for the same reason — the existing dashboard uses zero icons today (text labels, `→` arrow glyph for the booking CTA). If the redesign wants icons (map pin glyph, search icon), inline SVG (hand-written or copy-pasted from a source like Heroicons/Lucide's raw SVG, not the npm package) keeps the dependency count at zero for this concern, consistent with how `--color-accent` etc. are hand-authored rather than pulled from a design-token package.

### Discovery search — no new library needed

- **Debouncing:** reuse `dashboard/lib/debounce.ts`, already built and tested for the Phase 5 area typeahead. Same pattern applies directly to a discovery search input.
- **RIDB catalog search:** reuse/extend `dashboard/lib/ridb.ts`. RIDB's `/facilities` endpoint already supports `query`, `state`, `activity`, and `latitude`/`longitude`/`radius` params for browsing beyond named-area lookup — this is additive to the existing RIDB client, not a new integration surface.
- **Filter UI (site type, state, date range):** plain controlled `<select>`/`<input>` elements styled with the existing `.field`/`.field-input`/`.toggle` token classes from `globals.css` — no headless-UI library needed for basic filters at this scale (single-user tool, not a public-facing filter-heavy e-commerce app).

## Installation

```bash
cd dashboard
npm install maplibre-gl@^6.6.0
```

That's the only new runtime dependency for the entire milestone. No dev-dependency additions needed — `maplibre-gl` ships its own TypeScript types, and `dashboard/tsconfig.json`'s existing strict settings apply to the new wrapper component without extra config.

**Note on SSR:** `maplibre-gl` touches `window`/`WebGL` at module init, so the wrapping component must be a Client Component (`"use client"`) and the map instance created inside a `useEffect`, never during render — consistent with how `area-typeahead.tsx` already isolates browser-only interactivity from server-rendered shell. No `next/dynamic({ ssr: false })` workaround is needed the way Leaflet requires, because MapLibre's `Map` constructor is only invoked inside the effect, not at import/module-eval time — but importing MapLibre's CSS (`maplibre-gl/dist/maplibre-gl.css`) still needs to happen in a client-safe location (`app/layout.tsx` global import is fine, same as `globals.css` today).

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|--------------|-------------|--------------------------|
| `maplibre-gl` (raw) | `react-map-gl` + `maplibre-gl` | If the map surface grows complex (many interactive layers, popovers-on-hover, multiple synced maps) — the declarative JSX bindings pay for themselves once imperative `useEffect` wiring gets unwieldy. Not justified for a single map+markers+clusters view. |
| `maplibre-gl` | `leaflet` + `react-leaflet` | If the "polish" goal is dropped or the map is a minor/secondary feature rather than a headline deliverable — Leaflet is lighter (~40KB vs MapLibre's ~200KB+ gzipped) and has zero WebGL dependency, which matters if targeting very old devices/browsers. Not a concern here (single user, modern browser). |
| OpenFreeMap tiles | MapTiler free tier | If OpenFreeMap's uptime/reliability proves inadequate in practice — MapTiler's free tier (100k loads/mo) is the standard fallback, requires an API key added to Vercel env vars. |
| Hand-rolled CSS tokens | A lightweight headless UI lib (Radix Primitives, Ark UI) | If the redesign needs complex accessible primitives (menus, comboboxes with full ARIA) beyond what the existing typeahead/dialog patterns already hand-built cover. Not justified for this milestone's scope. |
| Inline SVG icons | `lucide-react` or similar | If icon usage becomes extensive (10+ distinct icons across many components) — at that point maintaining hand-copied SVGs becomes more error-prone than a tree-shakeable icon package. v1.2's icon needs (search glyph, map pin, maybe a couple filter icons) don't clear that bar. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| Mapbox GL JS | Requires an API key + paid usage tiers beyond a free quota; MapLibre is the API-compatible, license-free fork with no such requirement for a personal single-user tool | `maplibre-gl` |
| `react-leaflet` for a "genuinely polished" redesign goal | Raster tiles + DOM markers read visually dated next to vector-tile renderers; also needs a separate clustering plugin | `maplibre-gl` with built-in `cluster: true` GeoJSON source |
| shadcn/ui, MUI, Chakra, Ant Design | Already explicitly declined in Phase 5; pulls in a large surface of components/opinions when the existing hand-rolled token system already handles the needed surfaces (buttons, toggles, chips, dialogs, forms) | Extend `dashboard/app/globals.css` tokens |
| Tailwind CSS | Would require restructuring every existing component's className usage (currently semantic classes like `.section`, `.row`, `.btn--primary`) for no functional gain — this is a redesign of the existing token system, not a rewrite | Continue CSS custom properties in `globals.css` |
| A date-range picker library (react-datepicker etc.) | Existing watch-creation form already handles date range with plain `<input type="date">` elements per Phase 5; discovery search filters can follow the same pattern | Native `<input type="date">` |
| `next/dynamic({ ssr: false })` wrapper for the map | Not needed for MapLibre specifically (see SSR note above) — this is a Leaflet-specific workaround pattern that gets copy-pasted reflexively; MapLibre only needs the `Map` constructor deferred to `useEffect`, which a plain `"use client"` component already achieves | Plain Client Component with map init in `useEffect` |

## Version Compatibility

| Package | Compatible With | Notes |
|---------|------------------|-------|
| `maplibre-gl@6.6.0` | React 19.2.8, Next.js 16.3.2 | No React/Next peer dependency at all — it's framework-agnostic vanilla JS/WebGL, wrapped manually. No compatibility risk from Next 16's React 19 usage. |
| `maplibre-gl@6.6.0` | TypeScript 5.9.x (existing devDependency) | Ships its own `.d.ts` types; no `@types/maplibre-gl` needed (that package is deprecated/unnecessary for v2+). |

## Sources

- OpenFreeMap Quick Start Guide — https://openfreemap.org/quick_start/ — verified no-API-key, free vector tile hosting claim (MEDIUM confidence, single source, but corroborated by community GitHub discussion)
- MapLibre GL JS discussion on OpenFreeMap integration — https://github.com/maplibre/maplibre-gl-js/discussions/4736 — corroborates OpenFreeMap as a recommended free tile source for MapLibre (MEDIUM confidence)
- MapLibre GL JS official docs/homepage — https://maplibre.org/maplibre-gl-js/docs/ , https://maplibre.org/projects/gl-js/ — HIGH confidence, official source
- react-maplibre (visgl fork of react-map-gl) — https://visgl.github.io/react-maplibre/ — confirms `react-map-gl/maplibre` export exists as the wrapper alternative considered and rejected
- npm registry version checks (`npm view maplibre-gl version`, `npm view react-map-gl version`, `npm view leaflet version`, `npm view react-leaflet version`) — HIGH confidence, live registry query on 2026-08-29: `maplibre-gl@6.6.0`, `react-map-gl@8.1.2`, `leaflet@1.9.4`, `react-leaflet@5.0.0`
- MapLibre GL JS vs. Leaflet comparison — https://blog.jawg.io/maplibre-gl-vs-leaflet-choosing-the-right-tool-for-your-interactive-map/ — MEDIUM confidence, third-party blog, used only for the general vector-vs-raster/clustering tradeoff framing, not as sole basis for the decision
- Direct inspection of `dashboard/package.json`, `dashboard/app/globals.css`, `dashboard/lib/copy.ts`, `dashboard/lib/debounce.ts`, `dashboard/lib/ridb.ts`, and `dashboard/app/watches/*` — HIGH confidence, ground truth for what already exists in this codebase

---
*Stack research for: Campground Crawler v1.2 Discovery & Polish milestone (dashboard additions only)*
*Researched: 2026-08-29*
