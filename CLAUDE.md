<!-- GSD:project-start source:PROJECT.md -->
## Project

**Campground Crawler** — a single-user campsite availability watcher for Recreation.gov. It periodically checks a configured list of watches (park/campground, date range, site type) against Recreation.gov's live availability, and emails the user as soon as a matching campsite opens up.

**Core value:** When a watched campsite becomes available on Recreation.gov, the user gets an email fast enough to actually book it before someone else does.

See `.planning/PROJECT.md` for full context, requirements, and key decisions.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->
## Technology Stack

- **Runtime**: Node.js 22.x LTS + TypeScript 5.7+, run via `tsx` (no build step)
- **Data source**: RIDB API (`ridb.recreation.gov`) for campground/facility metadata (official, documented) + Recreation.gov's undocumented `GET /api/camps/availability/campground/{id}/month` endpoint for live per-day availability (used by every community tool in this space — send a realistic User-Agent, respect ~1 req/sec, no aggressive retries)
- **Scheduling/deployment**: GitHub Actions `schedule` trigger (5-min minimum granularity, free on public repos) — chosen over Vercel Cron because Vercel's Hobby plan caps cron at once/day
- **Email**: Resend (`resend` npm package, v6.x) — free tier (3,000/mo, 100/day) is ample for a single-user tool
- **Validation**: `zod` for watch config and API response shapes
- **Persistence**: dedup/notification state as a JSON file committed back to the repo after each run (GitHub Actions runners are ephemeral — no local DB). Use a `concurrency` guard in the workflow to avoid overlapping runs corrupting state.

Full rationale: `.planning/research/STACK.md`. Full findings: `.planning/research/SUMMARY.md`.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Pipeline shape: config loader → RIDB/availability API client → matcher → persisted dedup state → email sender, triggered by a scheduler. Design the core pipeline as one deployment-agnostic function with a thin trigger adapter, so it works the same whether invoked by a GitHub Actions job or run locally via CLI.

Full detail: `.planning/research/ARCHITECTURE.md`.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` — do not edit manually.
<!-- GSD:profile-end -->
