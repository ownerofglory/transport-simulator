import { useMemo, useState } from 'react';
import { useAppState } from '../../app/useAppState';
import { Modal } from './Modal';
import { RealtimeMap, type MapPin, type MapPoint } from './RealtimeMap';
import { LocationField, type EndpointValue } from './LocationField';
import { searchJourneys } from './api';
import { buildJourneyRoute, journeyPath, journeyStations } from './journeyRoute';
import { enrichRouteFromTerrain } from './catalogTerrain';
import { formatClock, secondsBetween } from './time';
import type { Journey } from './types';

type Endpoint = EndpointValue | null;

/** Journey search: pick origin/destination (typed or on the map), list trips, visualize, simulate. */
export function JourneySearchModal({ onClose }: { onClose: () => void }) {
  const { dispatch } = useAppState();
  const [origin, setOrigin] = useState<Endpoint>(null);
  const [destination, setDestination] = useState<Endpoint>(null);
  const [picking, setPicking] = useState<'origin' | 'destination' | null>(null);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = journeys.find((j) => j.id === selectedId) ?? null;

  const stops = useMemo(
    () => (selected && origin && destination ? journeyStations(selected, origin, destination) : []),
    [selected, origin, destination]
  );

  const pins = useMemo<MapPin[]>(() => {
    const list: MapPin[] = [];
    if (origin) list.push({ id: 'origin', lat: origin.lat, lon: origin.lon, kind: 'origin', title: `From: ${origin.name}` });
    if (destination) list.push({ id: 'dest', lat: destination.lat, lon: destination.lon, kind: 'destination', title: `To: ${destination.name}` });
    for (const s of stops.slice(1, -1)) list.push({ id: `stop-${s.name}-${s.scheduledS}`, lat: s.lat, lon: s.lon, kind: 'stop', title: s.name });
    return list;
  }, [origin, destination, stops]);

  const path = useMemo<MapPoint[] | null>(
    () => (selected && origin && destination ? journeyPath(selected, origin, destination) : null),
    [selected, origin, destination]
  );

  const onMapClick = (point: MapPoint) => {
    if (!picking) return;
    const value: EndpointValue = { name: `Pin ${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`, lat: point.lat, lon: point.lon };
    if (picking === 'origin') setOrigin(value);
    else setDestination(value);
    setPicking(null);
  };

  const runSearch = () => {
    if (!origin || !destination) return;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    searchJourneys({
      origin: { id: origin.id, name: origin.name, lat: origin.lat, lon: origin.lon },
      originId: origin.id,
      destination: { id: destination.id, name: destination.name, lat: destination.lat, lon: destination.lon },
      destinationId: destination.id
    })
      .then((results) => {
        setJourneys(results);
        if (results[0]) setSelectedId(results[0].id);
        if (results.length === 0) setError('No journeys found for these points.');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Journey search failed.'))
      .finally(() => setLoading(false));
  };

  const simulate = async () => {
    if (!selected || !origin || !destination) return;
    setPreparing(true);
    const route = buildJourneyRoute(selected, origin, destination);
    // Match every vehicle leg independently so transfers keep their own
    // geometry, terrain profile, tunnel data, and vehicle type.
    try {
      await Promise.all([route, ...(route.journeyLegs ?? [])].map((leg) => enrichRouteFromTerrain(leg)));
    } catch {
      // Keep the un-enriched route.
    }
    dispatch({ type: 'realtime-route-simulated', route, journey: { origin, destination, journey: selected } });
    onClose();
  };

  return (
    <Modal title="Journey search" subtitle="Live VVS / TRIAS routing" onClose={onClose}>
      <div className="rt-split">
        <RealtimeMap pins={pins} path={path} onMapClick={onMapClick} hint={picking ? `Click to set ${picking}` : 'Pin ⌖ to pick on map'} />
        <div className="rt-panel">
          <div className="rt-fields">
            <LocationField
              placeholder="From (stop or address)"
              value={origin}
              picking={picking === 'origin'}
              onSelect={setOrigin}
              onPickOnMap={() => setPicking((p) => (p === 'origin' ? null : 'origin'))}
            />
            <LocationField
              placeholder="To (stop or address)"
              value={destination}
              picking={picking === 'destination'}
              onSelect={setDestination}
              onPickOnMap={() => setPicking((p) => (p === 'destination' ? null : 'destination'))}
            />
            <button className="primary" onClick={runSearch} disabled={!origin || !destination || loading}>
              {loading ? 'Searching…' : 'Search journeys'}
            </button>
          </div>
          {error && <div className="rt-error">{error}</div>}
          <div className="rt-list">
            {journeys.length === 0 && !error && <div className="rt-list-empty">Pick a start and finish, then search.</div>}
            {journeys.map((journey) => {
              const transit = journey.legs.filter((leg) => leg.mode !== 'walk');
              const duration = journey.durationMinutes ?? Math.round(secondsBetween(journey.departureTime, journey.arrivalTime) / 60);
              return (
                <button
                  key={journey.id}
                  className={`rt-item ${journey.id === selectedId ? 'selected' : ''}`}
                  onClick={() => setSelectedId(journey.id)}
                >
                  <div className="rt-item-title">
                    <span>{formatClock(journey.departureTime)} → {formatClock(journey.arrivalTime)}</span>
                    <span className="rt-badge">{duration} min</span>
                  </div>
                  <div className="rt-item-sub">
                    {journey.summary ?? (transit.map((l) => l.line).filter(Boolean).join(' · ') || 'Walk')}
                    {typeof journey.interchanges === 'number' && ` · ${journey.interchanges} change${journey.interchanges === 1 ? '' : 's'}`}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="rt-actions">
            <button className="primary" onClick={() => void simulate()} disabled={!selected || preparing}>
              {preparing ? 'Preparing journey…' : 'Simulate journey'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
