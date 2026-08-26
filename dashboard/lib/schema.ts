/** zod schemas + safeParse-based loaders for the three JSON files this dashboard consumes.
 *
 *  Conventions carried over from the poller's `config/schema.ts`: one exported schema per
 *  consumed file, the non-throwing safeParse variant at every call site (never the throwing
 *  one), and a compile-time
 *  `_assert` line per schema tying it back to its `lib/types.ts` interface so the two can
 *  never silently drift apart.
 */

import { z } from 'zod';
import type {
  Watch,
  MatchedSlot,
  WatchOutcome,
  RunSummary,
  StateEntry,
  StateFile,
  RunLogEntry,
} from './types';

export const SiteTypeSchema = z.enum(['any', 'tent', 'rv', 'group']);
export const ResolvedSiteTypeSchema = z.enum(['tent', 'rv', 'group', 'unknown']);
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const FacilityWatchSchema = z.object({
  type: z.literal('facility'),
  id: z.string().min(1),
  parkName: z.string().min(1),
  facilityId: z.number().int().positive().optional(),
  dateRange: z.object({ start: DateStr, end: DateStr }),
  siteType: SiteTypeSchema,
});

export const AreaWatchSchema = z.object({
  type: z.literal('area'),
  id: z.string().min(1),
  // No .min(1) here, deliberately: the dashboard is a read-only viewer and must
  // display whatever is committed, not gate-keep it (same reasoning as WatchesSchema below).
  areas: z.array(z.object({ name: z.string(), recAreaId: z.number().int().positive().optional() })),
  dateRange: z.object({ start: DateStr, end: DateStr }),
  siteType: SiteTypeSchema,
});

/** Backward-compatible migration: v1.0 watches.json entries have no `type` field.
 *  Any object without one is treated as the original single-campground shape, mirroring
 *  the poller's config/schema.ts preprocess guard. */
export const WatchSchema = z.preprocess((val) => {
  if (val !== null && typeof val === 'object' && !Array.isArray(val) && !('type' in val)) {
    return { ...(val as Record<string, unknown>), type: 'facility' };
  }
  return val;
}, z.discriminatedUnion('type', [FacilityWatchSchema, AreaWatchSchema]));
// No .min(1) and no unique-id refine here, unlike the poller's config schema: the dashboard is
// a read-only viewer and must display whatever is committed, not gate-keep it.
export const WatchesSchema = z.array(WatchSchema);

const _assertWatch: Watch = {} as z.infer<typeof WatchSchema>;
void _assertWatch;

export const MatchedSlotSchema = z.object({
  watchId: z.string(),
  campsiteId: z.string(),
  siteLabel: z.string(),
  loop: z.string(),
  siteType: ResolvedSiteTypeSchema,
  facilityId: z.number(),
  facilityName: z.string(),
  facilityType: z.enum(['standard', 'group']).default('standard'),
  startDate: DateStr,
  endDate: DateStr,
  bookingUrl: z.string(),
});

const _assertMatchedSlot: MatchedSlot = {} as z.infer<typeof MatchedSlotSchema>;
void _assertMatchedSlot;

const TruncatedSchema = z.object({ requested: z.number(), kept: z.number() }).optional();
const FacilityFailuresSchema = z
  .array(z.object({ facilityId: z.number(), facilityName: z.string(), reason: z.string() }))
  .optional();

export const WatchOutcomeSchema = z.discriminatedUnion('status', [
  z.object({
    watchId: z.string(),
    status: z.literal('MATCH'),
    newMatches: z.array(MatchedSlotSchema),
    suppressed: z.array(MatchedSlotSchema),
    truncated: z.object({ requested: z.number(), kept: z.number() }).optional(),
    facilityFailures: FacilityFailuresSchema,
  }),
  z.object({
    watchId: z.string(),
    status: z.literal('NO_MATCH'),
    truncated: TruncatedSchema,
    facilityFailures: FacilityFailuresSchema,
  }),
  z.object({
    watchId: z.string(),
    status: z.literal('FAILED'),
    reason: z.string(),
    truncated: TruncatedSchema,
    facilityFailures: FacilityFailuresSchema,
  }),
]);

const _assertWatchOutcome: WatchOutcome = {} as z.infer<typeof WatchOutcomeSchema>;
void _assertWatchOutcome;

export const RunSummarySchema = z.object({
  startedAt: z.string(),
  finishedAt: z.string(),
  checked: z.number(),
  outcomes: z.array(WatchOutcomeSchema),
  newMatches: z.array(MatchedSlotSchema),
  failed: z.array(z.object({ watchId: z.string(), reason: z.string() })),
  noMatch: z.array(z.string()),
});

const _assertRunSummary: RunSummary = {} as z.infer<typeof RunSummarySchema>;
void _assertRunSummary;

export const RunLogSchema = z.array(RunSummarySchema);

const _assertRunLogEntry: RunLogEntry = {} as z.infer<typeof RunSummarySchema>;
void _assertRunLogEntry;

export const StateEntrySchema = z.object({ lastNotifiedAt: z.string() });

const _assertStateEntry: StateEntry = {} as z.infer<typeof StateEntrySchema>;
void _assertStateEntry;

export const StateFileSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), StateEntrySchema),
});

const _assertStateFile: StateFile = {} as z.infer<typeof StateFileSchema>;
void _assertStateFile;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Same issue-formatting as the poller's watches loader, but returned rather than thrown so the
 *  page can render a per-section fallback instead of erroring out entirely. */
function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

export function parseWatches(raw: unknown): ParseResult<Watch[]> {
  const result = WatchesSchema.safeParse(raw);
  if (!result.success) return { ok: false, error: formatIssues(result.error) };
  return { ok: true, data: result.data };
}

export function parseStateFile(raw: unknown): ParseResult<StateFile> {
  const result = StateFileSchema.safeParse(raw);
  if (!result.success) return { ok: false, error: formatIssues(result.error) };
  return { ok: true, data: result.data };
}

/** Entry-by-entry so one malformed run never blanks the whole timeline. */
export function parseRunLog(raw: unknown): ParseResult<RunLogEntry[]> & { skipped?: number } {
  const outer = z.array(z.unknown()).safeParse(raw);
  if (!outer.success) return { ok: false, error: formatIssues(outer.error) };
  const data: RunLogEntry[] = [];
  let skipped = 0;
  for (const item of outer.data) {
    const parsed = RunSummarySchema.safeParse(item);
    if (parsed.success) {
      data.push(parsed.data);
    } else {
      skipped += 1;
    }
  }
  return { ok: true, data, skipped };
}

/** Write-path validation (MGMT-02/03). Hand-duplicated from the poller's
 *  `src/config/schema.ts` — NOT imported (dashboard/lib/types.ts header: never import
 *  across the src/ <-> dashboard/ boundary). The loose schemas above stay loose on
 *  purpose: the read path must display whatever is committed. This one must produce
 *  data the poller's own WatchesFileSchema would accept, or the next poll run fails
 *  its top-level parse and every watch stops (RESEARCH.md Pitfall 3). */
const StrictDateRangeSchema = z
  .object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  })
  .refine((r) => r.start < r.end, {
    message: 'dateRange.start must be before dateRange.end (end is the exclusive checkout date)',
  });

export const StrictFacilityWatchSchema = z.object({
  type: z.literal('facility'),
  id: z.string().min(1),
  parkName: z.string().min(1),
  facilityId: z.number().int().positive().optional(),
  dateRange: StrictDateRangeSchema,
  siteType: SiteTypeSchema,
});

export const StrictAreaWatchSchema = z.object({
  type: z.literal('area'),
  id: z.string().min(1),
  areas: z
    .array(
      z.object({
        name: z.string().min(1),
        recAreaId: z.number().int().positive().optional(),
      })
    )
    .min(1, 'an area watch must list at least one area'),
  dateRange: StrictDateRangeSchema,
  siteType: SiteTypeSchema,
});

/** No `preprocess` legacy-migration wrapper here, unlike the loose WatchSchema above:
 *  the write UI always sends an explicit `type`, so an untyped payload is a bug, not
 *  a v1.0 leftover to be tolerated. */
export const StrictWatchSchema = z.discriminatedUnion('type', [
  StrictFacilityWatchSchema,
  StrictAreaWatchSchema,
]);

const _assertStrictWatch: Watch = {} as z.infer<typeof StrictWatchSchema>;
void _assertStrictWatch;

export function parseStrictWatch(raw: unknown): ParseResult<Watch> {
  const result = StrictWatchSchema.safeParse(raw);
  if (!result.success) return { ok: false, error: formatIssues(result.error) };
  return { ok: true, data: result.data };
}

/** Uniqueness can't be a zod refine here: the write path validates ONE watch object,
 *  not the whole array. The Route Handler checks the candidate against the freshly
 *  fetched watches[] instead (mirrors WatchesFileSchema's unique-id refine in
 *  src/config/schema.ts). `ignoreId` lets an edit keep its own id. */
export function assertUniqueId(watches: Watch[], candidateId: string, ignoreId?: string): boolean {
  return !watches.some((w) => w.id === candidateId && w.id !== ignoreId);
}
