import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { searchStations } from '../realtime/api';
import type { RealtimeStation } from '../realtime/types';
import type { LatLon } from './liveProjection';
import { groundDistanceM } from './stationFocus';

// The backend rejects shorter queries, and typing pauses this long before we
// spend a request — station search shares the backend's TRIAS budget.
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;
const MAX_RESULTS = 8;

/** Distance label; stop names repeat nationwide, so this is what tells them apart. */
function distanceLabel(station: RealtimeStation, near: LatLon | null): string | null {
  if (!near) return null;
  const km = groundDistanceM(near, station) / 1000;
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/**
 * Station name box for Live mode. Debounced lookups against `/api/v1/stations`,
 * with arrow-key/Enter selection; picking a station hands it to `onPick`, which
 * flies the 3D camera there.
 *
 * The endpoint searches nationwide, so hits are ordered by distance from the
 * current view — `getNear` is a getter rather than a prop so a panning camera
 * does not re-render the HUD.
 */
export function LiveStationSearch({
  onPick,
  getNear
}: {
  onPick: (station: RealtimeStation) => void;
  getNear?: () => LatLon | null;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RealtimeStation[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  // Picking a station writes its name into the box; that must not re-open the
  // list with a fresh search for the name we just resolved.
  const pickedRef = useRef<string | null>(null);
  const [near, setNear] = useState<LatLon | null>(null);
  const getNearRef = useRef(getNear);
  getNearRef.current = getNear;

  // One in-flight request at a time: a newer keystroke always wins.
  useEffect(() => {
    const trimmed = query.trim();
    if (pickedRef.current === trimmed) return;
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const stations = await searchStations(trimmed, controller.signal);
        if (controller.signal.aborted) return;
        // Snapshot the view centre with the results, so the ordering and the
        // distance labels shown to the user always agree.
        const origin = getNearRef.current?.() ?? null;
        const ordered = origin
          ? [...stations].sort((a, b) => groundDistanceM(origin, a) - groundDistanceM(origin, b))
          : stations;
        setNear(origin);
        setResults(ordered.slice(0, MAX_RESULTS));
        setHighlight(0);
        setError(null);
        setOpen(true);
      } catch (err) {
        if (controller.signal.aborted) return;
        setResults([]);
        setError(err instanceof Error ? err.message : 'Search failed');
        setOpen(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  // A click anywhere else dismisses the result list.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const pick = useCallback(
    (station: RealtimeStation) => {
      pickedRef.current = station.name.trim();
      setQuery(station.name);
      setOpen(false);
      onPick(station);
    },
    [onPick]
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open || results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((i) => (i + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const station = results[highlight];
      if (station) pick(station);
    }
  };

  const showList = open && (results.length > 0 || (!loading && !!error));

  return (
    <div className="lv-search" ref={rootRef}>
      <input
        className="lv-search-input"
        type="search"
        value={query}
        placeholder="Find a station…"
        aria-label="Find a station"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-activedescendant={showList && results[highlight] ? `${listboxId}-option-${highlight}` : undefined}
        autoComplete="off"
        onChange={(e) => {
          pickedRef.current = null;
          setQuery(e.target.value);
        }}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {loading && <span className="lv-search-spin" aria-hidden="true" />}
      {showList && (
        <ul id={listboxId} className="lv-search-list" role="listbox" aria-label="Station results">
          {error && !results.length ? (
            <li className="lv-search-empty">{error}</li>
          ) : (
            results.map((station, i) => (
              <li key={station.id}>
                <button
                  type="button"
                  id={`${listboxId}-option-${i}`}
                  role="option"
                  aria-selected={i === highlight}
                  className={`lv-search-item ${i === highlight ? 'on' : ''}`}
                  onPointerEnter={() => setHighlight(i)}
                  onClick={() => pick(station)}
                >
                  <span className="lv-search-name">{station.name}</span>
                  {distanceLabel(station, near) && (
                    <span className="lv-search-dist">{distanceLabel(station, near)}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
