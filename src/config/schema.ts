/** zod schema for watches.json (D-01). */

import { z } from 'zod';
import type { Watch } from '../types.js';

export const SiteTypeSchema = z.enum(['any', 'tent', 'rv', 'group']);

const DateRangeSchema = z
  .object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  })
  .refine((r) => r.start < r.end, {
    message: 'dateRange.start must be before dateRange.end (end is the exclusive checkout date)',
  });

export const FacilityWatchSchema = z.object({
  type: z.literal('facility'),
  id: z.string().min(1),
  parkName: z.string().min(1),
  facilityId: z.number().int().positive().optional(), // explicit override, RESEARCH Pitfall 3
  dateRange: DateRangeSchema,
  siteType: SiteTypeSchema,
});

export const AreaWatchSchema = z.object({
  type: z.literal('area'),
  id: z.string().min(1),
  areas: z
    .array(
      z.object({
        name: z.string().min(1),
        recAreaId: z.number().int().positive().optional(), // D-02 override
      })
    )
    .min(1, 'an area watch must list at least one area'),
  dateRange: DateRangeSchema,
  siteType: SiteTypeSchema,
});

/** Backward-compatible migration: v1.0 watches.json entries have no `type` field.
 *  Any object without one is treated as the original single-campground shape, so
 *  the deployed poller keeps running unchanged after this phase ships. */
export const WatchSchema = z.preprocess((val) => {
  if (val !== null && typeof val === 'object' && !Array.isArray(val) && !('type' in val)) {
    return { ...(val as Record<string, unknown>), type: 'facility' };
  }
  return val;
}, z.discriminatedUnion('type', [FacilityWatchSchema, AreaWatchSchema]));

export const WatchesFileSchema = z
  .array(WatchSchema)
  .min(1, 'watches.json must contain at least one watch')
  .refine((ws) => new Set(ws.map((w) => w.id)).size === ws.length, {
    message: 'watch ids must be unique',
  });

// Compile-time shape check: schema output must be assignable to the shared Watch type
// so config/schema.ts can never silently drift from src/types.ts.
const _assert: Watch = {} as z.infer<typeof WatchSchema>;
void _assert;
