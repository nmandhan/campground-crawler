/** Every user-visible string on the dashboard, verbatim from 03-UI-SPEC.md's Copywriting
 *  Contract. Changing a value here is a UI-SPEC change — update the spec first. */
export const COPY = {
  pageTitle: 'Campground Crawler — Status',

  sectionActiveMatches: 'Active Matches',
  sectionWatchStatus: 'Per-Watch Status',
  sectionRunTimeline: 'Run Timeline',

  bookCta: 'Book on Recreation.gov →',

  emptyActiveHeading: 'No active matches yet',
  emptyActiveBody:
    'None of your watches have found an open site yet. This page updates automatically after each poll cycle — check back in a few minutes.',

  emptyRunsHeading: 'No poll runs recorded yet',
  emptyRunsBody:
    "The poller hasn't completed a cycle since this dashboard went live. Check back shortly.",

  // UI-SPEC.md's Copywriting Contract does not specify a "no watches configured" state.
  // Added here as an explicit spec extension (watches.json can legitimately be an empty array)
  // rather than rendering a bare empty section.
  emptyWatchesHeading: 'No watches configured',
  emptyWatchesBody:
    'watches.json has no entries yet. Add a watch and the poller will pick it up on its next cycle.',

  errorHeading: 'Unable to load dashboard data',
  errorBody:
    "Couldn't fetch the latest data from GitHub just now. This is usually temporary — try refreshing in a minute.",

  /** Prefix for the freshness label; the timestamp is appended by lib/page-data.ts from the
   *  runs.json payload itself, never from render time (RESEARCH.md Pitfall 1). */
  dataAsOfPrefix: 'Data as of ',

  stillOpen: 'Still open in the latest run',
  notInLatestRun: 'Not seen in the latest run',
  noBookingLink: 'No booking link available',
} as const;
