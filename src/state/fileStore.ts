/** Durable JSON-file dedup state store (OPS-01). The ONLY place in the codebase
 *  that reads or writes the state file — do not add a KV implementation, that is
 *  explicitly deferred (see CONTEXT.md).
 */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { StateStore, StateEntry, StateFile } from './store.js';

export const DEFAULT_STATE_PATH = 'state.json';

export interface FileStateStoreOptions {
  path?: string; // default DEFAULT_STATE_PATH
  logger?: { warn: (msg: string) => void }; // default console
}

function isStateEntry(value: unknown): value is StateEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).lastNotifiedAt === 'string'
  );
}

/** Structurally validate parsed JSON as a StateFile, dropping individual
 *  malformed entries rather than the whole file where that is unambiguous.
 *  Returns null if the overall shape is unrecognizable (treated as corrupt).
 */
function parseStateFile(data: unknown): Map<string, StateEntry> | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (obj.version !== 1) return null;
  if (typeof obj.entries !== 'object' || obj.entries === null) return null;

  const entries = new Map<string, StateEntry>();
  for (const [key, value] of Object.entries(obj.entries as Record<string, unknown>)) {
    if (isStateEntry(value)) {
      entries.set(key, { lastNotifiedAt: value.lastNotifiedAt });
    }
    // Malformed individual entries are silently dropped.
  }
  return entries;
}

export class FileStateStore implements StateStore {
  private readonly path: string;
  private readonly logger: { warn: (msg: string) => void };
  private entries = new Map<string, StateEntry>();

  constructor(opts?: FileStateStoreOptions) {
    this.path = opts?.path ?? DEFAULT_STATE_PATH;
    this.logger = opts?.logger ?? console;
  }

  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // Normal first run — no warning.
        this.entries = new Map();
        return;
      }
      this.entries = new Map();
      this.logger.warn(
        `state file at ${this.path} was unreadable (${(err as Error).message}); starting from empty state — a duplicate alert is possible this cycle`
      );
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.entries = new Map();
      this.logger.warn(
        `state file at ${this.path} was unreadable (${(err as Error).message}); starting from empty state — a duplicate alert is possible this cycle`
      );
      return;
    }

    const entries = parseStateFile(parsed);
    if (entries === null) {
      this.entries = new Map();
      this.logger.warn(
        `state file at ${this.path} was unreadable (unexpected shape); starting from empty state — a duplicate alert is possible this cycle`
      );
      return;
    }

    this.entries = entries;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): StateEntry | undefined {
    return this.entries.get(key);
  }

  markNotified(key: string, at: Date = new Date()): void {
    this.entries.set(key, { lastNotifiedAt: at.toISOString() });
  }

  async save(): Promise<void> {
    const file: StateFile = {
      version: 1,
      entries: Object.fromEntries([...this.entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    };
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(file, null, 2) + '\n', 'utf8');
    await rename(tmp, this.path);
  }
}

export function createFileStateStore(opts?: FileStateStoreOptions): FileStateStore {
  return new FileStateStore(opts);
}
