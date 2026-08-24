/** Serialises a completed cycle's RunSummary to disk for the CI run-history log (D-01).
 *
 *  Deliberately NOT part of run() — run()'s signature and return shape stay untouched
 *  (precedent: src/types.ts "Phase 2 wires email off this without changing run()'s shape").
 *  src/cli.ts, the thin trigger adapter, calls this when RUN_SUMMARY_FILE is set.
 */
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RunSummary } from './types.js';

/** Atomic write (tmp + rename), matching src/state/fileStore.ts's save() convention so a
 *  killed process can never leave a half-written JSON file for jq to choke on.
 *  A falsy `path` is a deliberate no-op: local `npm start` writes nothing. */
export async function writeRunSummaryFile(summary: RunSummary, path: string | undefined): Promise<void> {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  await rename(tmp, path);
}
