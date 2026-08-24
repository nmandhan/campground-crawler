# Campground Crawler

A single-user campsite availability watcher for Recreation.gov. It periodically
checks a configured list of watches (park/campground, date range, site type)
against Recreation.gov's live availability, so you don't have to manually
refresh the booking site while waiting for a site to open up.

## Setup

```bash
npm install
cp watches.example.json watches.json
```

Edit `watches.json` to list the campgrounds and date ranges you want watched.

## `watches.json` field reference

Each entry is one watch:

| Field | Meaning |
|-------|---------|
| `id` | Unique string. Used as part of the dedup state key — don't reuse an id across watches, and don't change an existing watch's `id` unless you want it to be treated as brand new. |
| `parkName` | Free-text campground name, resolved to a Recreation.gov facility via RIDB. Check the startup log line (`resolved "<name>" -> facility <id> (<FACILITY NAME>)`) to confirm it resolved to the campground you meant. |
| `facilityId` | Optional. Set this to override RIDB name resolution with an explicit facility id, e.g. if the resolved name is ambiguous or wrong. |
| `dateRange.start` | First night of the stay, `YYYY-MM-DD`. |
| `dateRange.end` | Checkout date, `YYYY-MM-DD`, **exclusive**. A watch for `start: 2026-09-04, end: 2026-09-07` requires the nights of 9/4, 9/5, and 9/6 to all be open on the same site. |
| `siteType` | One of `any`, `tent`, `rv`, `group`. |

## Running

One-shot (single check cycle, then exit):

```bash
npm start
```

Recurring, unattended (checks every 5 minutes until stopped with Ctrl-C):

```bash
npm start -- --loop --interval 300
```

`--interval` is in seconds and must be at least 60 — polling faster risks
getting the process's IP or RIDB key rate-limited/blocked by the undocumented
Recreation.gov availability endpoint.

## Environment variables

See `.env.example` for the file to copy locally. In production these are set
as GitHub repo Secrets (see "Scheduled deployment" below).

| Variable | Required | Purpose |
|----------|----------|---------|
| `RESEND_API_KEY` | Required | Email delivery. Create at https://resend.com/api-keys. Use a SEND-ONLY restricted key, not a full-access key. |
| `NOTIFY_EMAIL` | Required | Where alerts are delivered. |
| `NOTIFY_FROM` | Optional | Sender address. Defaults to `Campground Crawler <onboarding@resend.dev>`, Resend's shared TEST domain — alerts may land in spam. Set this to an address on a domain you have verified with Resend for reliable delivery. |
| `RIDB_API_KEY` | Optional | Raises RIDB rate limits AND is required for park-name -> facilityId resolution (RIDB returns HTTP 401 without it). Not needed if every watch in `watches.json` sets an explicit `facilityId`. Register at https://www.recreation.gov/manage-account/developer-api. |

## Output

Each watch produces exactly one line per cycle:

- `OK    <id> — N new, M already notified: <sites>` — availability found. `N`
  is newly discovered (not yet notified about), `M` is availability that was
  already seen on a previous run.
- `NO MATCH <id> — checked K nights, nothing available` — the watch was
  checked successfully; there just isn't a fully-open matching site right now.
- `FAILED <id> — <reason>` — the watch could **not** be checked (network
  error, RIDB/availability API error, blocked request, etc). This is
  different from `NO MATCH` — a `FAILED` watch's availability is unknown, not
  absent.

## State

Dedup/notification state lives in `state.json` in the project root. It tracks
which openings have already been reported so the same opening isn't reported
as "new" on every cycle. Deleting `state.json` resets this — every
currently-open matching site will be reported as new again on the next run.
In the deployed setup, resetting means committing an empty
`{"version":1,"entries":{}}` and pushing.

## Scheduled deployment (GitHub Actions)

`.github/workflows/poll.yml` runs the poller every 5 minutes on GitHub's
`schedule` trigger — no manual invocation needed once it's set up. The repo
must be **public** for unlimited free Actions minutes at this cadence.

Setup checklist:

1. Create a Resend account and a send-only API key.
2. Add `RESEND_API_KEY` and `NOTIFY_EMAIL` under repo Settings -> Secrets and
   variables -> Actions -> New repository secret.
3. Optionally add `NOTIFY_FROM` and `RIDB_API_KEY` the same way.
4. Trigger a manual run from the Actions tab via "Run workflow"
   (`workflow_dispatch`) to smoke-test before relying on the schedule.

The workflow commits `state.json` back to the repo after any cycle that
changed it — this is how dedup survives the ephemeral GitHub Actions runner.
That means the commit history will contain campsite dedup keys (site IDs and
dates), which is not sensitive.

Secrets must never be pasted into `watches.json`, a workflow `run:` step, or
a commit. GitHub redacts registered secret values from Actions logs, but only
for values injected through the `secrets` context.

## Repo layout (two projects)

This repo contains two independent projects:

- `src/` is the poller: Node 22 + `tsx`, no build step. Run `npm ci` / `npm start` / `npm test`
  from the **repo root**.
- `dashboard/` is the Next.js status dashboard, an independent project with its own
  `package.json`, `package-lock.json`, `tsconfig.json` and `node_modules`. Always
  `cd dashboard` before any `npm` command targeting it.

Adding a dependency from the wrong working directory is the failure mode to watch for: if a
root `npm ci` suddenly starts installing `next`/`react`, a dashboard dependency landed in the
root `package.json`.

Vercel deploys `dashboard/` only, via the project's **Root Directory** setting = `dashboard`.
