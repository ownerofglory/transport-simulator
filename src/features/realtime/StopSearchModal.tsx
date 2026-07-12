import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { RealtimeMap, type MapPin, type MapPoint } from './RealtimeMap';
import { LocationField, type EndpointValue } from './LocationField';
import { nearbyLocations } from './api';
import type { RealtimeLocation } from './types';

const RADII = [500, 700, 1000, 1500];

/** Stop search: choose a point (typed or on the map), list nearby stops, visualize, open departures. */
export function StopSearchModal({
  onClose,
  onOpenDepartures
}: {
  onClose: () => void;
  onOpenDepartures: (station: EndpointValue) => void;
}) {
  const [center, setCenter] = useState<EndpointValue | null>(null);
  const [radiusM, setRadiusM] = useState(700);
  const [stops, setStops] = useState<RealtimeLocation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = (point: EndpointValue, radius = radiusM) => {
    setLoading(true);
    setError(null);
    setSelectedId(null);
    nearbyLocations(point.lat, point.lon, radius)
      .then((locations) => {
        setStops(locations);
        if (locations.length === 0) setError('No stops found near this point.');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Nearby search failed.'))
      .finally(() => setLoading(false));
  };

  const setPoint = (value: EndpointValue) => {
    setCenter(value);
    search(value);
  };

  const onMapClick = (point: MapPoint) => {
    setPoint({ name: `Pin ${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`, lat: point.lat, lon: point.lon });
  };

  const pins = useMemo<MapPin[]>(() => {
    const list: MapPin[] = [];
    if (center) list.push({ id: 'center', lat: center.lat, lon: center.lon, kind: 'origin', title: center.name });
    for (const stop of stops) {
      list.push({
        id: stop.id || `${stop.lat},${stop.lon}`,
        lat: stop.lat,
        lon: stop.lon,
        kind: stop.id === selectedId ? 'active' : 'stop',
        title: stop.name,
        onClick: () => setSelectedId(stop.id)
      });
    }
    return list;
  }, [center, stops, selectedId]);

  return (
    <Modal title="Stop search" subtitle="Stops near a point" onClose={onClose}>
      <div className="rt-split">
        <RealtimeMap pins={pins} onMapClick={onMapClick} hint="Click the map to search nearby stops" />
        <div className="rt-panel">
          <div className="rt-fields">
            <LocationField placeholder="Address, POI, or stop" value={center} onSelect={setPoint} />
            <div className="rt-radius">
              <select aria-label="Search radius" value={radiusM} onChange={(e) => setRadiusM(Number(e.target.value))}>
                {RADII.map((r) => (
                  <option key={r} value={r}>Within {r} m</option>
                ))}
              </select>
              <button className="primary" onClick={() => center && search(center)} disabled={!center || loading}>
                {loading ? 'Searching…' : 'Search here'}
              </button>
            </div>
          </div>
          {error && <div className="rt-error">{error}</div>}
          <div className="rt-list">
            {stops.length === 0 && !error && <div className="rt-list-empty">Pick a point to find stops nearby.</div>}
            {stops.map((stop) => (
              <div key={stop.id || `${stop.lat},${stop.lon}`} className={`rt-item ${stop.id === selectedId ? 'selected' : ''}`}>
                <div className="rt-item-title">
                  <span>{stop.name}</span>
                  <span className="rt-badge">{stop.type}</span>
                </div>
                <div className="rt-item-actions">
                  <button onClick={() => setSelectedId(stop.id)}>Show on map</button>
                  <button onClick={() => onOpenDepartures({ id: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon })}>
                    Departures
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
