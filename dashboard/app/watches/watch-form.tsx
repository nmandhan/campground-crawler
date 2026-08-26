'use client';

/** Create/edit watch modal (MGMT-02/MGMT-03, D-04/D-05).
 *
 *  A native <dialog>, not a route: editing a watch is a small focused decision, and a modal keeps
 *  the list it belongs to visible behind it (D-04). <dialog>.showModal() gives focus trapping and
 *  Escape-to-close with zero JS and zero dependencies, which is why the UI-SPEC picked it over a
 *  hand-rolled overlay.
 *
 *  ONE form for both union members (D-05). The Facility/Area toggle swaps ONLY the location
 *  section; the date-range and site-type fields keep their position when it flips, so the toggle
 *  never feels like it navigated somewhere else.
 *
 *  This component owns draft state and validation only. It does not fetch — `onSubmit` hands the
 *  assembled Watch up to watch-manager, which owns the POST/PATCH and the server's verdict.
 */
import { useEffect, useRef, useState } from 'react';
import { COPY } from '@/lib/copy';
import type { Watch, SiteType } from '@/lib/types';
import { AreaTypeahead, type AreaChip } from './area-typeahead';
import { AreaPreview } from './area-preview';

const SITE_TYPE_OPTIONS: Record<SiteType, string> = {
  any: 'Any site type',
  tent: 'Tent',
  rv: 'RV',
  group: 'Group',
};

export function WatchForm({
  open,
  initial,
  submitting,
  serverError,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  /** null = create, a Watch = edit that watch */
  initial: Watch | null;
  submitting: boolean;
  serverError: string | null;
  onSubmit: (watch: Watch) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<'facility' | 'area'>('facility');
  const [id, setId] = useState('');
  const [parkName, setParkName] = useState('');
  const [areas, setAreas] = useState<AreaChip[]>([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [siteType, setSiteType] = useState<SiteType>('any');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const ref = useRef<HTMLDialogElement>(null);

  // Re-seed on every open (and every `initial` change) — reusing one mounted dialog for
  // successive edits would otherwise show the previous watch's values.
  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (initial === null) {
      setKind('facility');
      setId('');
      setParkName('');
      setAreas([]);
      setStart('');
      setEnd('');
      setSiteType('any');
    } else if (initial.type === 'facility') {
      setKind('facility');
      setId(initial.id);
      setParkName(initial.parkName);
      setAreas([]);
      setStart(initial.dateRange.start);
      setEnd(initial.dateRange.end);
      setSiteType(initial.siteType);
    } else {
      setKind('area');
      setId(initial.id);
      setParkName('');
      setAreas(initial.areas);
      setStart(initial.dateRange.start);
      setEnd(initial.dateRange.end);
      setSiteType(initial.siteType);
    }
  }, [open, initial]);

  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (id.trim() === '') next.id = 'Watch ID is required.';
    if (kind === 'facility' && parkName.trim() === '') {
      next.parkName = 'Campground name is required.';
    }
    if (kind === 'area' && areas.length === 0) {
      next.areas = 'Add at least one Recreation Area.';
    }
    if (start === '' || end === '') {
      next.dates = 'Both dates are required.';
    } else if (start >= end) {
      next.dates = 'Check-out must be after check-in.';
    }
    return next;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const dateRange = { start, end };
    const watch: Watch =
      kind === 'facility'
        ? { type: 'facility', id: id.trim(), parkName: parkName.trim(), dateRange, siteType }
        : {
            type: 'area',
            id: id.trim(),
            areas: areas.map((a) => ({ name: a.name, recAreaId: a.recAreaId })),
            dateRange,
            siteType,
          };
    onSubmit(watch);
  }

  return (
    <dialog className="dialog" ref={ref} onClose={onCancel}>
      <h3 className="dialog-heading">{initial ? COPY.modalHeadingEdit : COPY.modalHeadingCreate}</h3>
      <form onSubmit={handleSubmit}>
        <div className="form-sections">
          {/* 1. Type toggle (D-05) */}
          <div className="toggle" role="group" aria-label={COPY.modalHeadingCreate}>
            <button
              type="button"
              className={kind === 'facility' ? 'btn toggle-option toggle-option--active' : 'btn toggle-option'}
              aria-pressed={kind === 'facility'}
              onClick={() => setKind('facility')}
            >
              {COPY.toggleFacility}
            </button>
            <button
              type="button"
              className={kind === 'area' ? 'btn toggle-option toggle-option--active' : 'btn toggle-option'}
              aria-pressed={kind === 'area'}
              onClick={() => setKind('area')}
            >
              {COPY.toggleArea}
            </button>
          </div>

          {/* 2. Location section — the ONLY part the toggle swaps */}
          {kind === 'facility' ? (
            <div className="form-fields">
              <div className="field">
                <label className="field-label" htmlFor="watch-park-name">Campground name</label>
                <input
                  id="watch-park-name"
                  className="field-input"
                  type="text"
                  value={parkName}
                  onChange={(e) => setParkName(e.target.value)}
                />
                {errors.parkName ? <p className="field-error">{errors.parkName}</p> : null}
              </div>
            </div>
          ) : (
            <div className="form-fields">
              <AreaTypeahead areas={areas} onChange={setAreas} />
              {errors.areas ? <p className="field-error">{errors.areas}</p> : null}
              <AreaPreview areas={areas} />
            </div>
          )}

          {/* 3. Shared fields — same position in both modes */}
          <div className="form-fields">
            <div className="field">
              <label className="field-label" htmlFor="watch-id">Watch ID</label>
              <input
                id="watch-id"
                className="field-input"
                type="text"
                value={id}
                onChange={(e) => setId(e.target.value)}
              />
              {errors.id ? <p className="field-error">{errors.id}</p> : null}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="watch-start">Check-in</label>
              <input
                id="watch-start"
                className="field-input"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="watch-end">Check-out</label>
              <input
                id="watch-end"
                className="field-input"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
              {errors.dates ? <p className="field-error">{errors.dates}</p> : null}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="watch-site-type">Site type</label>
              <select
                id="watch-site-type"
                className="field-input"
                value={siteType}
                onChange={(e) => setSiteType(e.target.value as SiteType)}
              >
                {(Object.keys(SITE_TYPE_OPTIONS) as SiteType[]).map((st) => (
                  <option key={st} value={st}>
                    {SITE_TYPE_OPTIONS[st]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {serverError ? (
          <p className="field-error" role="alert">
            {serverError}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button className="btn btn--ghost" type="button" onClick={onCancel}>
            {COPY.discardChanges}
          </button>
          <button className="btn btn--primary" type="submit" disabled={submitting}>
            {COPY.saveWatch}
          </button>
        </div>
      </form>
    </dialog>
  );
}
