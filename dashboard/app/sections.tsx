/** Presentational Server Components for the three dashboard sections plus badge/empty/error
 *  states. No client directive, no interactive hooks, no event handlers, and no HTML-string
 *  injection (threat T-03-14). Every string comes from `COPY`; every value comes from
 *  already-formatted row fields — nothing here re-derives or reformats data.
 */
import { COPY } from '@/lib/copy';
import type { ActiveMatchRow } from '@/lib/derive-active-matches';
import type { WatchStatusRow, WatchStatus } from '@/lib/derive-status';
import type { TimelineRow } from '@/lib/derive-timeline';

const BADGE_CLASS: Record<WatchStatus, string> = {
  MATCH: 'badge badge--match', // #16A34A
  NO_MATCH: 'badge badge--no-match', // #6B7280
  FAILED: 'badge badge--failed', // #DC2626
  UNKNOWN: 'badge badge--unknown',
};

function StatusBadge({ status }: { status: WatchStatus }) {
  return <span className={BADGE_CLASS[status]}>{status}</span>;
}

function EmptyState({ heading, body }: { heading: string; body: string }) {
  return (
    <div>
      <p className="empty-heading">{heading}</p>
      <p className="empty-body">{body}</p>
    </div>
  );
}

export function ErrorState() {
  return (
    <section className="section error" aria-label={COPY.errorHeading}>
      <h2 className="error-heading">{COPY.errorHeading}</h2>
      <p className="error-body">{COPY.errorBody}</p>
    </section>
  );
}

export function ActiveMatchesSection({ rows }: { rows: ActiveMatchRow[] }) {
  return (
    <section className="section" aria-label={COPY.sectionActiveMatches}>
      <h2 className="section-heading">{COPY.sectionActiveMatches}</h2>
      {rows.length === 0 ? (
        <EmptyState heading={COPY.emptyActiveHeading} body={COPY.emptyActiveBody} />
      ) : (
        <ul className="rows">
          {rows.map((row) => (
            <li className="row" key={row.key}>
              <span className="row-main">
                {row.parkName} — site {row.campsiteId} — {row.dateRangeLabel}
              </span>
              <span className="row-meta">
                {row.notifiedRelative} — {row.stillOpenInLatestRun ? COPY.stillOpen : COPY.notInLatestRun}
              </span>
              {row.bookingUrl ? (
                <a
                  className="booking-link"
                  href={row.bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {COPY.bookCta}
                </a>
              ) : (
                <span className="row-meta">{COPY.noBookingLink}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function WatchStatusSection({ rows }: { rows: WatchStatusRow[] }) {
  return (
    <section className="section" aria-label={COPY.sectionWatchStatus}>
      <h2 className="section-heading">{COPY.sectionWatchStatus}</h2>
      {rows.length === 0 ? (
        <EmptyState heading={COPY.emptyWatchesHeading} body={COPY.emptyWatchesBody} />
      ) : (
        <ul className="rows">
          {rows.map((row) => (
            <li className="row" key={row.watchId}>
              <StatusBadge status={row.status} />
              <span className="row-main">
                {row.parkName} — {row.dateRangeLabel} — {row.siteType}
              </span>
              <span className="row-meta">
                {row.status === 'FAILED' ? (
                  <span className="failure-reason">{row.detail}</span>
                ) : (
                  row.detail
                )}
                {' — '}
                {row.observedRelative}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RunTimelineSection({ rows }: { rows: TimelineRow[] }) {
  return (
    <section className="section" aria-label={COPY.sectionRunTimeline}>
      <h2 className="section-heading">{COPY.sectionRunTimeline}</h2>
      {rows.length === 0 ? (
        <EmptyState heading={COPY.emptyRunsHeading} body={COPY.emptyRunsBody} />
      ) : (
        <ul className="rows">
          {rows.map((row) => (
            <li className="row" key={row.startedAt}>
              <span className="row-main">{row.startedRelative}</span>
              <span className="row-meta">{row.startedAbsolute}</span>
              <span className="row-meta">{row.summaryLabel}</span>
              {row.failures.length > 0 ? (
                <ul className="rows">
                  {row.failures.map((f) => (
                    <li key={f.watchId}>
                      <span className="failure-reason">
                        {f.watchId}: {f.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
