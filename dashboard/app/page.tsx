import { cookies } from 'next/headers';
import { fetchJson } from '@/lib/github';
import { buildDashboardModel } from '@/lib/page-data';
import { COPY } from '@/lib/copy';
import { SESSION_COOKIE, hasValidSession } from '@/lib/session';
import { parseWatches } from '@/lib/schema';
import {
  ActiveMatchesSection,
  WatchStatusSection,
  RunTimelineSection,
  ErrorState,
} from './sections';
import { WatchManager } from './watches/watch-manager';

// Deliberately no dynamic-rendering opt-out here — that would bypass the
// `next: { revalidate: 30 }` Data Cache window in lib/github.ts (RESEARCH.md Anti-Patterns).

export default async function Page() {
  const [watches, state, runs] = await Promise.all([
    fetchJson('watches.json'),
    fetchJson('state.json'),
    fetchJson('runs.json'),
  ]);

  const model = buildDashboardModel({ watches, state, runs }, new Date());

  // Reading cookies() opts this route into dynamic rendering. That is fine and is NOT the thing
  // the comment above warns about: the fetch-level Data Cache (`next: { revalidate: 30 }` in
  // lib/github.ts) is independent of render mode and still absorbs repeat traffic to
  // raw.githubusercontent.com. What must stay absent is a route-level dynamic-rendering opt-out
  // or a `cache: 'no-store'` on those fetches, either of which WOULD defeat the window.
  const cookieStore = await cookies();
  const unlocked = hasValidSession(cookieStore.get(SESSION_COOKIE)?.value);

  // Parsed separately from buildDashboardModel: the manager needs the raw Watch[] to edit,
  // not the derived status rows the read-only sections consume.
  const parsedWatches = watches.ok ? parseWatches(watches.data) : null;
  const watchList = parsedWatches?.ok ? parsedWatches.data : [];

  return (
    <main className="page">
      <h1 className="page-title">{COPY.pageTitle}</h1>
      {model.ok && model.dataAsOfLabel ? <p className="freshness">{model.dataAsOfLabel}</p> : null}
      <div className="sections">
        {model.ok ? (
          <>
            <WatchManager watches={watchList} unlocked={unlocked} />
            <ActiveMatchesSection rows={model.activeMatches} />
            <WatchStatusSection rows={model.watchStatuses} />
            <RunTimelineSection rows={model.timeline} />
          </>
        ) : (
          <ErrorState />
        )}
      </div>
    </main>
  );
}
