#!/usr/bin/env -S npx tsx
/**
 * Captures live RIDB RecArea search + RecArea facilities responses, writing
 * raw JSON to src/recreation-gov/fixtures/ and printing the field-list
 * diagnostics that answer RESEARCH.md Open Question 1 (Assumption A2):
 * does GET /recareas/{id}/facilities return full Facility records or a
 * compact stub?
 *
 * Usage:
 *   RIDB_API_KEY=<key> npx tsx scripts/capture-recarea-fixtures.ts \
 *     "Sequoia National Forest" "Yosemite National Park"
 *
 * Accepts 1..N RecArea names. Only the FIRST supplied area's raw responses
 * are written to the committed fixture files — subsequent names are
 * diagnostics-only, run to enumerate FacilityTypeDescription values across
 * diverse parks (RESEARCH.md Open Question 2).
 *
 * RIDB_API_KEY is required (RIDB returns HTTP 401 without it). If it is
 * missing, this script exits non-zero WITHOUT writing or truncating any
 * fixture file.
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { RIDB_BASE } from '../src/recreation-gov/client.js';
import { fetchJson, retryWithBackoff } from '../src/recreation-gov/http.js';

const fixturesDir = fileURLToPath(new URL('../src/recreation-gov/fixtures/', import.meta.url));

interface RawRecord {
  [key: string]: unknown;
}

function resolveRecAreaId(record: RawRecord): unknown {
  return record['RecAreaID'] ?? record['RecAreaId'] ?? record['recAreaId'];
}

async function main(): Promise<void> {
  const areaNames = process.argv.slice(2);
  if (areaNames.length === 0) {
    console.error(
      'Usage: npx tsx scripts/capture-recarea-fixtures.ts "<RecAreaName>" ["<RecAreaName2>" ...]'
    );
    process.exit(1);
  }

  const apikey = process.env.RIDB_API_KEY;
  if (!apikey) {
    console.error('RIDB_API_KEY not set — RIDB returns HTTP 401 without it. Export it and re-run.');
    process.exit(1);
  }

  for (let i = 0; i < areaNames.length; i++) {
    const areaName = areaNames[i]!;

    const searchUrl = new URL(`${RIDB_BASE}/recareas`);
    searchUrl.searchParams.set('query', areaName);
    searchUrl.searchParams.set('limit', '10');

    const searchRaw = (await retryWithBackoff(() =>
      fetchJson(searchUrl.toString(), { headers: { apikey } })
    )) as { RECDATA?: RawRecord[] };

    const searchRecords = searchRaw.RECDATA ?? [];
    const first = searchRecords[0];

    if (!first) {
      console.error(`No RecArea found for "${areaName}" — skipping.`);
      continue;
    }

    const recAreaId = resolveRecAreaId(first);
    const recAreaName = first['RecAreaName'] ?? first['RecAreaId'] ?? '(unknown name)';
    console.log(`Resolved: ${JSON.stringify({ id: recAreaId, name: recAreaName })}`);
    console.log(`SEARCH KEYS (${areaName}): ${Object.keys(first).sort().join(', ')}`);

    const facilitiesUrl = new URL(`${RIDB_BASE}/recareas/${encodeURIComponent(String(recAreaId))}/facilities`);
    facilitiesUrl.searchParams.set('limit', '50');

    const facilitiesRaw = (await retryWithBackoff(() =>
      fetchJson(facilitiesUrl.toString(), { headers: { apikey } })
    )) as { RECDATA?: RawRecord[] };

    const facilityRecords = facilitiesRaw.RECDATA ?? [];
    const firstFacility = facilityRecords[0] ?? {};

    console.log(`FACILITY KEYS (${areaName}): ${Object.keys(firstFacility).sort().join(', ')}`);
    console.log(`HAS FacilityTypeDescription: ${'FacilityTypeDescription' in firstFacility}`);
    console.log(`HAS Reservable: ${'Reservable' in firstFacility}`);
    console.log(`FACILITY COUNT: ${facilityRecords.length}`);
    console.log(
      `OBSERVED FacilityTypeDescription VALUES: ${[
        ...new Set(facilityRecords.map((f) => f['FacilityTypeDescription']).filter(Boolean)),
      ]
        .sort()
        .join(' | ')}`
    );

    if (i === 0) {
      await writeFile(`${fixturesDir}ridb-recareas.json`, JSON.stringify(searchRaw, null, 2));
      console.log('Wrote ridb-recareas.json');
      await writeFile(`${fixturesDir}ridb-recarea-facilities.json`, JSON.stringify(facilitiesRaw, null, 2));
      console.log('Wrote ridb-recarea-facilities.json');
    }

    if (i < areaNames.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
