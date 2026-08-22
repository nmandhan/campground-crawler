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

## Optional: `RIDB_API_KEY`

Set the `RIDB_API_KEY` environment variable to raise RIDB's rate limits for
facility-name resolution. Not required to run the tool.

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

## What's not here yet

Phase 1 is console output only. Email delivery and scheduled/unattended
deployment (e.g. via GitHub Actions) arrive in Phase 2.
