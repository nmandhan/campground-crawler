'use client';

/** Resolved-campground preview for an area watch (MGMT-05, D-09/D-10).
 *
 *  Auto-refetches on every chip add/remove (D-09) — no Preview button. One extra RIDB round trip
 *  per chip change is the accepted cost of the modal feeling live.
 *
 *  Shows the FULL list, not a count (D-10): the user asked for this specifically because an area
 *  name matching is not proof the right campgrounds are behind it — the group-vs-standard
 *  distinction is exactly the confusion this catches.
 *
 *  READ ONLY. Nothing rendered here is ever saved into the watch. watches.json keeps only the area
 *  criteria; the poller re-resolves them every cycle (ARCHITECTURE.md Anti-Pattern 1).
 */
import { useEffect, useRef, useState } from 'react';
import { COPY } from '@/lib/copy';
import type { AreaChip } from './area-typeahead';

interface PreviewFacility { facilityId: number; facilityName: string; facilityType: 'standard' | 'group'; }
interface PreviewResponse {
  ok?: boolean;
  facilities?: PreviewFacility[];
  truncated?: { requested: number; kept: number };
  areaErrors?: Array<{ area: string; error: string }>;
  cap?: number;
}

export function AreaPreview({ areas }: { areas: AreaChip[] }) {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const requestSeq = useRef(0);
  // Stable serialization of the chips, not the array identity — keying on `areas` directly
  // would refetch on every parent re-render, since a new array literal is a new reference each
  // time, firing a RIDB call per keystroke elsewhere in the form.
  const key = areas.map((a) => `${a.recAreaId ?? ''}:${a.name}`).join('|');

  useEffect(() => {
    if (areas.length === 0) {
      setData(null);
      setLoading(false);
      setFailed(false);
      return;
    }

    const seq = ++requestSeq.current;
    setLoading(true);
    setFailed(false);

    (async () => {
      try {
        const res = await fetch('/api/ridb/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ areas: areas.map((a) => ({ name: a.name, recAreaId: a.recAreaId })) }),
        });
        const body = (await res.json().catch(() => ({}))) as PreviewResponse;
        if (seq !== requestSeq.current) return;
        if (res.ok && body.ok) {
          setData(body);
          setFailed(false);
        } else {
          setData(null);
          setFailed(true);
        }
      } catch {
        if (seq === requestSeq.current) {
          setData(null);
          setFailed(true);
        }
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="preview">
      <h4 className="preview-heading">{COPY.previewHeading}</h4>
      {areas.length === 0 ? <p className="empty-body">{COPY.previewEmpty}</p> : null}
      {loading ? <p className="empty-body">{COPY.previewLoading}</p> : null}
      {failed ? (
        <p className="field-error" role="alert">
          {COPY.areaSearchFailed}
        </p>
      ) : null}
      {!loading && !failed && data?.facilities ? (
        <ul className="preview-list">
          {data.facilities.map((f) => (
            <li key={f.facilityId}>
              {f.facilityName}
              {f.facilityType === 'group' ? <span className="preview-tag">{COPY.groupTag}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {data?.truncated ? (
        <p className="preview-truncated" role="status">
          {COPY.previewTruncated
            .replace('{kept}', String(data.truncated.kept))
            .replace('{requested}', String(data.truncated.requested))
            .replace('{cap}', String(data.cap ?? data.truncated.kept))}
        </p>
      ) : null}
      {data?.areaErrors?.length ? (
        <ul className="preview-list">
          {data.areaErrors.map((e) => (
            <li className="field-error" key={e.area}>
              {e.area}: {e.error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
