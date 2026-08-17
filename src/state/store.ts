/** StateStore interface + dedup key builder (D-08/D-09). */

export interface StateEntry {
  lastNotifiedAt: string; // ISO timestamp (D-09)
}

export interface StateFile {
  version: 1;
  entries: Record<string, StateEntry>;
}

export interface StateStore {
  load(): Promise<void>;
  has(key: string): boolean;
  get(key: string): StateEntry | undefined;
  markNotified(key: string, at?: Date): void;
  save(): Promise<void>;
}

/** D-08: `${watchId}:${campsiteId}:${startDate}:${endDate}` */
export function dedupKey(watchId: string, campsiteId: string, startDate: string, endDate: string): string {
  return `${watchId}:${campsiteId}:${startDate}:${endDate}`;
}
