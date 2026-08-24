#!/usr/bin/env node
/** Thin trigger adapter — contains no business logic. The same run() function
 *  will be invoked identically from a GitHub Actions job in Phase 2.
 */
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { run } from './run.js';
import { writeRunSummaryFile } from './runSummaryFile.js';

const MIN_INTERVAL_SECONDS = 60;
const DEFAULT_INTERVAL_SECONDS = 300;

function parseCliArgs(argv: string[]): { loop: boolean; intervalSeconds: number } {
  const { values } = parseArgs({
    args: argv,
    options: {
      loop: { type: 'boolean', default: false },
      once: { type: 'boolean', default: false },
      interval: { type: 'string', default: String(DEFAULT_INTERVAL_SECONDS) },
    },
  });

  const intervalSeconds = Number(values.interval);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < MIN_INTERVAL_SECONDS) {
    console.error(
      `--interval must be at least ${MIN_INTERVAL_SECONDS} seconds (got ${values.interval}) — polling faster risks IP/key blocking on the undocumented availability endpoint`
    );
    process.exit(1);
  }

  return { loop: values.loop === true && values.once !== true, intervalSeconds };
}

async function runOnce(): Promise<number> {
  const summary = await run();
  // D-01: in CI the workflow sets RUN_SUMMARY_FILE and appends this file to runs.json.
  // Unset locally, so `npm start` writes nothing.
  await writeRunSummaryFile(summary, process.env.RUN_SUMMARY_FILE);
  console.log(`checked ${summary.checked} — ${summary.newMatches.length} new matches, ${summary.failed.length} failed`);
  return summary.failed.length === 0 ? 0 : 1;
}

async function runLoop(intervalSeconds: number): Promise<void> {
  let cycle = 0;
  let stopping = false;

  process.on('SIGINT', () => {
    console.log('stopping');
    stopping = true;
    process.exit(0);
  });

  for (;;) {
    if (stopping) return;
    cycle += 1;
    console.log(`--- cycle ${cycle} at ${new Date().toISOString()} ---`);
    try {
      await run();
    } catch (err) {
      console.error(`fatal error in cycle ${cycle}: ${(err as Error).message}`);
      process.exit(1);
    }
    if (stopping) return;
    await sleep(intervalSeconds * 1000);
  }
}

async function main(): Promise<void> {
  const { loop, intervalSeconds } = parseCliArgs(process.argv.slice(2));

  if (loop) {
    await runLoop(intervalSeconds);
  } else {
    const exitCode = await runOnce();
    process.exit(exitCode);
  }
}

main().catch((err) => {
  console.error(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
