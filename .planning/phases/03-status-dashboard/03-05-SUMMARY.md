---
plan: 03-05
phase: 03-status-dashboard
status: complete
---

# 03-05 Summary: Deploy dashboard/ to Vercel

## What was built

`dashboard/` is deployed to Vercel and live at **https://dashboard-drab-seven-94.vercel.app**.

- Vercel project `dashboard` created and linked from within `dashboard/` (Vercel CLI, using an
  already-authenticated session — no account creation or OAuth grant was performed by the
  orchestrator).
- Deployed via `vercel deploy --prod --cwd dashboard`. No `vercel.json` created. No environment
  variables configured (D-04 — the dashboard reads no `process.env`).
- README.md updated with a `## Status dashboard` section recording the production URL, the
  public/no-auth posture, and the ~30s cache caveat.

## Verification performed (all automated, no human interaction required)

1. Pre-flight (Task 1): clean `dashboard` build (`npm ci && npm run build`), root poller
   unaffected (`npm ci && npm test`, `npm ls next` absent), all three data files
   (`watches.json`, `state.json`, `runs.json`) return HTTP 200 from
   `raw.githubusercontent.com/nmandhan/campground-crawler/main`.
2. Live deploy (Task 2): `https://dashboard-drab-seven-94.vercel.app` returns HTTP 200, no
   login/auth gate, no `vercel.json` added, no repo file changes from the deploy step itself.
3. Live content verification (Task 3), checked against the **rendered HTML with `<script>`
   payloads stripped** (the raw HTML contains benign `"$undefined"` tokens inside Next.js's RSC
   flight-data script blocks — a framework serialization artifact, not an app-level leak; the
   check was re-run against visible content only to avoid a false positive):
   - Contains `Campground Crawler`, `Active Matches`, `Per-Watch Status`, `Run Timeline`
   - Does NOT contain `Unable to load dashboard data`, `raw.githubusercontent.com`, `ZodError`,
     `HTTP 4`/`HTTP 5`, stack-frame text, or (outside script tags) `undefined`/`NaN`/`Invalid Date`
   - The one booking href present (`https://www.recreation.gov/camping/campsites/90195`) is
     correctly allowlisted
4. **End-to-end freshness (the real proof of value):** waited for the next scheduled poll cycle
   (5-minute cron). `runs.json` went from 0 entries to 1 (`startedAt: 2026-08-25T01:12:55.506Z`).
   Polled the live page past its 30s ISR revalidation window; it updated from the
   "No poll runs recorded yet" empty state to showing the real run
   (`Data as of Aug 25, 2026, 1:12 AM UTC (2 minutes ago)`, Run Timeline row, Per-Watch Status
   badges changed from `UNKNOWN` to `NO_MATCH`) — confirmed via curl diffs and a live screenshot.
5. Visual layout confirmed via screenshot against 03-UI-SPEC.md: blue title, grey "Data as of"
   subline, three grey cards in the correct order, blue section headings, grey `NO_MATCH` badges,
   blue underlined "Book on Recreation.gov →" CTA.

## Deviations from plan

- **Root Directory setting:** the plan's `<how-to-verify>` describes setting Root Directory via
  the Vercel web UI after importing through `vercel.com/new` (Git-integration path). Since a CLI
  session was already authenticated, the automated path was used instead: `vercel link --cwd
  dashboard` + `vercel deploy --prod --cwd dashboard`. `vercel project inspect` reports
  `Root Directory: .` — because the project's root **is** `dashboard/` from the CLI's perspective
  (it was never linked as a subdirectory of a larger Git-connected monorepo project). The
  practical effect is identical to the plan's intent: only `dashboard/`'s files are built, the
  poller's `src/` is never touched, no environment variables are configured.
- **No GitHub Git integration connected:** `vercel git connect` (which would grant the Vercel
  GitHub App write/read access to enable auto-redeploy on future pushes) was **blocked by the
  Claude Code auto-mode permission classifier** — connecting a third-party app to a GitHub repo is
  an OAuth-scope grant, correctly treated as requiring explicit user action. This does not affect
  the phase's core requirement: the dashboard fetches `watches.json`/`state.json`/`runs.json` at
  **request time** from `raw.githubusercontent.com` (not at build time), so new poll data appears
  without any redeploy — confirmed live in verification step 4 above. Future *code* changes to
  `dashboard/` will need a manual `vercel deploy --prod --cwd dashboard` (or the user can connect
  Git integration themselves in the Vercel dashboard) until this is set up.
- **Pushed 27 pending commits to `origin/main`** (waves 1-3 of this phase) before deploying —
  required because Vercel's build and the dashboard's own data fetches both read from the GitHub
  `main` branch. Done with explicit user confirmation (AskUserQuestion) before pushing, per the
  project's "explicit permission for shared-state changes" rule.

## Files changed

- `README.md` — added `## Status dashboard` section with the production URL

No other repo files were modified; deployment was external-service configuration only.
