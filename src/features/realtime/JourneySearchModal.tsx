import { useMemo, useState } from 'react';
import { useAppState } from '../../app/useAppState';
import { Modal } from './Modal';
import { RealtimeMap, type MapPin, type MapPoint } from './RealtimeMap';
import { LocationField, type EndpointValue } from './LocationField';
import { searchJourneys } from './api';
import { buildRealtimeRoute, legModeToTransportMode, type RealtimeStation } from './buildRealtimeRoute';
import { formatClock, parseTimeMs, secondsBetween } from './time';
import type { Journey } from './types';

type Endpoint = EndpointValue | null;

// A stop boundary along a journey, positioned along the straight origin→destination
// line by its share of the total travel time (the backend gives no leg geometry).
function journeyStations(journey: Journey, origin: EndpointValue, destination: EndpointValue): RealtimeStation[] {
  const depMs = parseTimeMs(journey.departureTime) ?? parseTimeMs(journey.legs[0]?.originTime);
  const arrMs = parseTimeMs(journey.arrivalTime) ?? parseTimeMs(journey.legs.at(-1)?.destinationTime);
  const total = depMs !== null && arrMs !== null ? Math.max(1, arrMs - depMs) : null;

  const boundaries: { name: string; ms: number | null }[] = [
    { name: journey.legs[0]?.originName ?? origin.name, ms: parseTimeMs(journey.legs[0]?.originTime) ?? depMs }
  ];
  for (const leg of journey.legs) boundaries.push({ name: leg.destinationName, ms: parseTimeMs(leg.destinationTime) });

  return boundaries.map((b, i) => {
    const fraction = total && depMs !== null && b.ms !== null
      ? Math.min(1, Math.max(0, (b.ms - depMs) / total))
      : i / Math.max(1, boundaries.length - 1);
    return {
      name: b.name,
      lat: origin.lat + (destination.lat - origin.lat) * fraction,
      lon: origin.lon + (destination.lon - origin.lon) * fraction,
      scheduledS: total && depMs !== null && b.ms !== null ? Math.round((b.ms - depMs) / 1000) : Math.round(fraction * 600)
    };
  });
}

/** Journey search: pick origin/destination (typed or on the map), list trips, visualize, simulate. */
export function JourneySearchModal({ onClose }: { onClose: () => void }) {
  const { dispatch } = useAppState();
  const [origin, setOrigin] = useState<Endpoint>(null);
  const [destination, setDestination] = useState<Endpoint>(null);
  const [picking, setPicking] = useState<'origin' | 'destination' | null>(null);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
    () => (selected && origin && destination ? [{ lat: origin.lat, lon: origin.lon }, { lat: destination.lat, lon: destination.lon }] : null),
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
      .then((res) => {
        setJourneys(res.journeys);
        if (res.journeys[0]) setSelectedId(res.journeys[0].id);
        if (res.journeys.length === 0) setError('No journeys found for these points.');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Journey search failed.'))
      .finally(() => setLoading(false));
  };

  const simulate = () => {
    if (!selected || !origin || !destination) return;
    const transit = selected.legs.find((leg) => leg.mode !== 'walk');
    const route = buildRealtimeRoute({
      id: `rt-journey-${selected.id}`,
      line: transit?.line ?? 'Trip',
      destination: destination.name,
      description: selected.summary ?? `${origin.name} → ${destination.name}`,
      transportMode: legModeToTransportMode(transit?.mode ?? 'stadtbahn'),
      waypoints: [{ lat: origin.lat, lon: origin.lon }, { lat: destination.lat, lon: destination.lon }],
      stations: journeyStations(selected, origin, destination)
    });
    dispatch({ type: 'realtime-route-simulated', route });
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
            <button className="primary" onClick={simulate} disabled={!selected}>
              Simulate this journey
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
