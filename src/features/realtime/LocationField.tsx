import { useEffect, useRef, useState } from 'react';
import { searchLocations } from './api';
import type { RealtimeLocation } from './types';

// A chosen endpoint: either a resolved TRIAS location or a raw coordinate pin.
export type EndpointValue = { id?: string; name: string; lat: number; lon: number };

/**
 * Debounced location autocomplete input. Emits the picked location, and offers a
 * "pick on map" affordance the parent wires to its map's click handler.
 */
export function LocationField({
  placeholder,
  value,
  picking,
  onSelect,
  onPickOnMap
}: {
  placeholder: string;
  value: EndpointValue | null;
  picking?: boolean;
  onSelect: (value: EndpointValue) => void;
  onPickOnMap?: () => void;
}) {
  const [text, setText] = useState(value?.name ?? '');
  const [results, setResults] = useState<RealtimeLocation[]>([]);
  const [open, setOpen] = useState(false);
  const skipNextSearch = useRef(false);

  // Reflect externally set values (e.g. a map pick) into the input text.
  useEffect(() => {
    skipNextSearch.current = true;
    setText(value?.name ?? '');
    setOpen(false);
  }, [value?.name, value?.lat, value?.lon]);

  // Debounced query; skips the fire that a programmatic text change triggers.
  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    const query = text.trim();
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchLocations(query, controller.signal)
        .then((locations) => {
          setResults(locations.slice(0, 8));
          setOpen(true);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [text]);

  return (
    <div className="rt-field">
      <input
        type="text"
        placeholder={picking ? 'Click the map to place a point…' : placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {onPickOnMap && (
        <button
          type="button"
          className={`rt-pick-btn ${picking ? 'active' : ''}`}
          title="Pick on map"
          onClick={onPickOnMap}
        >
          ⌖
        </button>
      )}
      {open && results.length > 0 && (
        <div className="rt-suggestions">
          {results.map((loc) => (
            <button
              key={loc.id || `${loc.lat},${loc.lon}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect({ id: loc.id, name: loc.name, lat: loc.lat, lon: loc.lon });
                setOpen(false);
              }}
            >
              {loc.name}
              <span className="rt-suggestion-type"> · {loc.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
