import { fetchJson } from '@/lib/github';
import { buildDashboardModel } from '@/lib/page-data';
import { COPY } from '@/lib/copy';
import {
  ActiveMatchesSection,
  WatchStatusSection,
  RunTimelineSection,
  ErrorState,
} from './sections';

// Deliberately no dynamic-rendering opt-out here — that would bypass the
// `next: { revalidate: 30 }` Data Cache window in lib/github.ts (RESEARCH.md Anti-Patterns).

export default async function Page() {
  const [watches, state, runs] = await Promise.all([
    fetchJson('watches.json'),
    fetchJson('state.json'),
    fetchJson('runs.json'),
  ]);

  const model = buildDashboardModel({ watches, state, runs }, new Date());

  return (
    <main className="page">
      <h1 className="page-title">{COPY.pageTitle}</h1>
      {model.ok && model.dataAsOfLabel ? <p className="freshness">{model.dataAsOfLabel}</p> : null}
      <div className="sections">
        {model.ok ? (
          <>
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
