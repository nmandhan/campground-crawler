# Deferred Items — Phase 04 (Area-Based Search)

Items discovered during execution that are out of scope for the current plan and were not fixed.

## dashboard/tsconfig.json: `baseUrl` removed in newer TypeScript

`npx tsc --noEmit` in `dashboard/` fails with `TS5102: Option 'baseUrl' has been removed`.
Pre-existing since the dashboard scaffold commit (`2199d88`, plan 03-02), unrelated to any
file touched by plan 04-06. `dashboard/tsconfig.json` was not modified by this plan.
`npm test` in `dashboard/` passes (88/88); this is a type-check-only config issue.
