#!/usr/bin/env -S npx tsx
/**
 * Captures one live RIDB facility search and one live availability-month
 * fetch, writing raw JSON to src/recreation-gov/fixtures/.
 *
 * Usage:
 *   npx tsx scripts/capture-fixtures.ts "Upper Pines Campground" 2026-09-01
 *
 * RIDB_API_KEY env var is optional but recommended (the live RIDB search
 * endpoint returns HTTP 401 without one, as of this writing).
 *
 * If a live call fails (no network, 403, DNS, missing key), this script logs
 * the failure and exits non-zero without overwriting existing fixtures —
 * hand-built fixtures following RESEARCH.md's documented shapes are an
 * acceptable fallback per the phase plan; this script is a convenience for
 * validating assumptions A1/A2/A3, not a hard requirement to run.
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolveFacility, fetchMonthAvailability } from '../src/recreation-gov/client.js';

const fixturesDir = fileURLToPath(new URL('../src/recreation-gov/fixtures/', import.meta.url));

async function main(): Promise<void> {
  const [parkName, monthStart] = process.argv.slice(2);
  if (!parkName || !monthStart) {
    console.error('Usage: npx tsx scripts/capture-fixtures.ts "<parkName>" <YYYY-MM-DD>');
    process.exit(1);
  }

  const ridbApiKey = process.env.RIDB_API_KEY;
  if (!ridbApiKey) {
    console.warn('RIDB_API_KEY not set — the live RIDB facility search will likely return 401.');
  }

  console.log(`Resolving facility for "${parkName}" via RIDB...`);
  let facilityId: number;
  try {
    const resolved = await resolveFacility(parkName, { ridbApiKey });
    facilityId = resolved.facilityId;
    console.log(`Resolved: ${resolved.facilityName} (facilityId=${resolved.facilityId})`);
    if (resolved.alternatives.length > 0) {
      console.log(`Other candidates seen: ${resolved.alternatives.join(', ')}`);
    }

    const ridbRaw = { RECDATA: [resolved], METADATA: { note: 'captured via resolveFacility' } };
    await writeFile(`${fixturesDir}ridb-facilities.json`, JSON.stringify(ridbRaw, null, 2));
    console.log('Wrote ridb-facilities.json');
  } catch (err) {
    console.error('RIDB facility search failed live:', err);
    console.error('Falling back: leaving existing ridb-facilities.json fixture untouched.');
    facilityId = -1;
  }

  if (facilityId === -1) {
    console.error('Cannot fetch availability without a resolved facilityId. Exiting.');
    process.exit(1);
  }

  console.log(`Fetching ${monthStart} availability for facilityId=${facilityId}...`);
  try {
    const availability = await fetchMonthAvailability(facilityId, monthStart);
    await writeFile(
      `${fixturesDir}availability-month.json`,
      JSON.stringify(availability, null, 2)
    );
    console.log('Wrote availability-month.json');
    const campsiteCount = Object.keys(availability.campsites).length;
    console.log(`Captured ${campsiteCount} campsites.`);
  } catch (err) {
    console.error('Availability fetch failed live:', err);
    console.error('Falling back: leaving existing availability-month.json fixture untouched.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
