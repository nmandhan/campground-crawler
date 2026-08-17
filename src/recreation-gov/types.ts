/** zod schemas for RIDB and availability API responses (Security Domain V5:
 *  validate at the boundary, fail loudly). */

import { z } from 'zod';

/** Allowlist of one (RESEARCH Pitfall 1 / A2): only this exact string counts as bookable. */
export const AVAILABLE_STATUS = 'Available';

export const CampsiteEntrySchema = z.object({
  campsite_id: z.union([z.string(), z.number()]).optional(),
  availabilities: z.record(z.string(), z.string()), // ISO datetime key -> status string
  campsite_type: z.string().default(''),
  type_of_use: z.string().optional(),
  loop: z.string().optional(),
  site: z.string().optional(),
  min_num_people: z.number().optional(),
  max_num_people: z.number().optional(),
});

export const AvailabilityResponseSchema = z.object({
  campsites: z.record(z.string(), CampsiteEntrySchema),
});

export const RidbFacilitySchema = z.object({
  FacilityID: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  FacilityName: z.string(),
  FacilityTypeDescription: z.string().optional(),
  Reservable: z.boolean().optional(),
  Enabled: z.boolean().optional(),
});

export const RidbFacilitySearchSchema = z.object({
  RECDATA: z.array(RidbFacilitySchema),
  METADATA: z.unknown().optional(),
});

export type RawAvailabilityResponse = z.infer<typeof AvailabilityResponseSchema>;
export type RidbFacility = z.infer<typeof RidbFacilitySchema>;
