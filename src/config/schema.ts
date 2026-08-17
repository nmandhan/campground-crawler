/** zod schema for watches.json (D-01). */

import { z } from 'zod';
import type { Watch } from '../types.js';

export const SiteTypeSchema = z.enum(['any', 'tent', 'rv', 'group']);

export const WatchSchema = z.object({
  id: z.string().min(1),
  parkName: z.string().min(1),
  facilityId: z.number().int().positive().optional(), // explicit override, RESEARCH Pitfall 3
  dateRange: z
    .object({
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
    })
    .refine((r) => r.start < r.end, {
      message: 'dateRange.start must be before dateRange.end (end is the exclusive checkout date)',
    }),
  siteType: SiteTypeSchema,
});

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
