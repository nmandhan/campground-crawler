'use client';

/** Recreation Area picker (AREA-04, D-06/D-07).
 *
 *  Debounced live suggestions, not a search button: the user should never need to know an area's
 *  numeric RIDB id, and a button turns "browse until it looks right" into a chore.
 *
 *  Fetches go through /api/ridb/recareas, never straight to Recreation.gov's RIDB host — RIDB_API_KEY
 *  is a secret and a direct call from this 'use client' file would put it in the browser bundle
 *  (RESEARCH.md Pitfall 2, threat T-05-06).
 *
 *  Fully controlled: `areas` and `onChange` are owned by the parent form, because the chip array
 *  IS the AreaWatch.areas[] field being edited.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { COPY } from '@/lib/copy';
import { debounce } from '@/lib/debounce';

export interface AreaChip { name: string; recAreaId?: number; }

interface Suggestion { recAreaId: number; recAreaName: string; }

export function AreaTypeahead({
  areas,
  onChange,
}: {
  areas: AreaChip[];
  onChange: (next: AreaChip[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);

  const requestSeq = useRef(0);
  const runSearch = useMemo(
    () =>
      debounce(async (q: string) => {
        // Monotonic sequence guard: fetches can resolve out of order, and a slow response for
        // "los" must never overwrite a fast response for "los padres" (threat T-05-25).
        const seq = ++requestSeq.current;
        try {
          const res = await fetch(`/api/ridb/recareas?query=${encodeURIComponent(q)}`);
          const body = (await res.json().catch(() => ({}))) as { ok?: boolean; areas?: Suggestion[] };
          if (seq !== requestSeq.current) return;
          if (res.ok && body.ok && body.areas) { setSuggestions(body.areas); setFailed(false); }
          else { setSuggestions([]); setFailed(true); }
        } catch {
          if (seq === requestSeq.current) { setSuggestions([]); setFailed(true); }
        } finally {
          if (seq === requestSeq.current) setLoading(false);
        }
      }, 300),
    []
  );
  useEffect(() => () => runSearch.cancel(), [runSearch]);

  useEffect(() => {
    setFailed(false);
    if (query.trim().length < 2) {
      runSearch.cancel();
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    runSearch(query.trim());
  }, [query, runSearch]);

  function addChip(s: Suggestion) {
    const chip: AreaChip = { name: s.recAreaName, recAreaId: s.recAreaId };
    if (areas.some((a) => a.recAreaId === chip.recAreaId && chip.recAreaId !== undefined)) return; // no duplicates
    onChange([...areas, chip]);
    setQuery('');
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      // Required — this component lives inside a <form>, and without preventDefault Enter
      // would submit the whole watch form.
      e.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) addChip(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="field">
      <label className="field-label" htmlFor="area-search">{COPY.areaSearchPlaceholder}</label>
      <div className="typeahead">
        <input
          id="area-search"
          className="field-input"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls="area-suggestions"
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={COPY.areaSearchPlaceholder}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIndex(-1); }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
        />
        {open ? (
          <ul id="area-suggestions" className="typeahead-list" role="listbox">
            {query.trim().length < 2 ? (
              <li className="typeahead-hint">{COPY.areaSearchMinChars}</li>
            ) : failed ? (
              <li className="typeahead-hint">{COPY.areaSearchFailed}</li>
            ) : loading ? (
              <li className="typeahead-hint">{COPY.previewLoading}</li>
            ) : suggestions.length === 0 ? (
              <li className="typeahead-hint">{COPY.areaSearchNoResults.replace('{query}', query.trim())}</li>
            ) : (
              suggestions.map((s, i) => (
                <li
                  key={s.recAreaId}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={i === activeIndex ? 'typeahead-option typeahead-option--active' : 'typeahead-option'}
                  onMouseDown={() => addChip(s)}
                >
                  {s.recAreaName}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
      <ul className="chips">
        {areas.map((a, i) => (
          <li className="chip" key={`${a.recAreaId ?? 'n'}-${a.name}-${i}`}>
            {a.name}
            <button
              className="chip-remove"
              type="button"
              aria-label={COPY.areaChipRemoveLabel.replace('{area}', a.name)}
              onClick={() => onChange(areas.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
