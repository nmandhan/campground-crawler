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

  // --- Phase 5: watch management write path (05-UI-SPEC.md Copywriting Contract) ---

  // Not in the UI-SPEC Copywriting Contract table verbatim, but implied by its Interaction
  // Notes (a management section, "Create Watch"/"Edit Watch" headings) — added here as
  // documented spec extensions, matching how `emptyWatchesHeading` above documents itself.
  sectionManageWatches: 'Manage Watches',
  modalHeadingCreate: 'Create Watch',
  modalHeadingEdit: 'Edit Watch',

  addWatch: '+ Add Watch',
  saveWatch: 'Save Watch',
  discardChanges: 'Discard Changes',

  toggleFacility: 'Single Campground',
  toggleArea: 'Recreation Area(s)',

  areaSearchPlaceholder: 'Search Recreation Areas by name…',
  /** `{query}` is replaced at render time with the user's current input. */
  areaSearchNoResults: 'No Recreation Areas found for "{query}"',
  areaSearchMinChars: 'Type at least 2 characters to search',
  /** `{area}` is replaced with the chip's area name. */
  areaChipRemoveLabel: 'Remove {area}',

  previewHeading: 'Resolves to these campgrounds',
  previewLoading: 'Checking which campgrounds match…',
  previewEmpty: 'Add a Recreation Area above to see which campgrounds this watch will check.',
  /** `{kept}`, `{requested}`, `{cap}` are replaced from the /api/ridb/preview response. */
  previewTruncated: 'Showing {kept} of {requested} campgrounds — this watch is at the {cap}-campground limit.',
  /** Appended to a campground name when facilityType === 'group'. Standard campgrounds get no
   *  tag. Matches derive-active-matches.ts's existing [GROUP] suffix convention exactly. */
  groupTag: '[GROUP]',

  unlockHeading: 'Unlock to manage watches',
  unlockBody: 'Enter the shared passphrase to create, edit, or delete watches. Read-only viewing never requires this.',
  unlockPlaceholder: 'Passphrase',
  unlockSubmit: 'Unlock Watches',
  unlockError: 'That passphrase didn’t match. Try again.',

  /** `{reason}` is replaced with the API's error string, or dropped entirely when unknown. */
  saveFailed: 'Couldn’t save this watch. {reason} — nothing was changed. Try again.',
  areaSearchFailed: 'Couldn’t search Recreation Areas right now. Try again in a moment.',

  deleteConfirm: 'Delete this watch? This can’t be undone.',
  deleteConfirmYes: 'Delete',
  deleteConfirmNo: 'Keep Watch',

  savedToast: 'Saved — live within ~5 min',
  deletedToast: 'Deleted — live within ~5 min',

  /** `{watch}` is replaced with the watch id. */
  editWatchLabel: 'Edit watch: {watch}',
  deleteWatchLabel: 'Delete watch: {watch}',
} as const;
