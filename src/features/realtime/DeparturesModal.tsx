import { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import { RealtimeMap, type MapPin } from './RealtimeMap';
import { LocationField, type EndpointValue } from './LocationField';
import { stationDepartures } from './api';
import { formatClock } from './time';
import type { Departure } from './types';

/** Live station departure board; the station can be preselected or searched. */
export function DeparturesModal({
  onClose,
  initialStation
}: {
  onClose: () => void;
  initialStation: EndpointValue | null;
}) {
  const [station, setStation] = useState<EndpointValue | null>(initialStation);
  const [departures, setDepartures] = useState<Departure[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the board whenever the chosen station changes.
  useEffect(() => {
    if (!station) return;
    if (!station.id) {
      setError('Pick a stop from the suggestions to load departures.');
      setDepartures([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    stationDepartures(station.id, { name: station.name, lat: station.lat, lon: station.lon }, controller.signal)
      .then((res) => {
        setDepartures(res.departures);
        if (res.departures.length === 0) setError('No upcoming departures.');
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Departures request failed.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [station?.id, station?.name, station?.lat, station?.lon]);

  const pins = useMemo<MapPin[]>(
    () => (station ? [{ id: 'station', lat: station.lat, lon: station.lon, kind: 'active', title: station.name }] : []),
    [station]
  );

  return (
    <Modal title="Departures" subtitle={station?.name ?? 'Live station board'} onClose={onClose}>
      <div className="rt-split">
        <RealtimeMap pins={pins} hint="Live station board" />
        <div className="rt-panel">
          <div className="rt-fields">
            <LocationField placeholder="Search a stop" value={station} onSelect={setStation} />
          </div>
          {error && <div className="rt-error">{error}</div>}
          <div className="rt-list">
            {!station && <div className="rt-list-empty">Search for a stop to see live departures.</div>}
            {loading && <div className="rt-list-empty">Loading departures…</div>}
            {departures.map((departure) => (
              <div key={departure.id} className={`rt-item ${departure.cancelled ? 'cancelled' : ''}`}>
                <div className="rt-item-title">
                  <span>
                    <span className="rt-badge rt-line">{departure.line}</span> {departure.destination}
                  </span>
                  <span className="rt-badge">
                    {departure.cancelled
                      ? 'Cancelled'
                      : typeof departure.countdownMinutes === 'number'
                        ? departure.countdownMinutes <= 0
                          ? 'now'
                          : `${departure.countdownMinutes} min`
                        : formatClock(departure.estimatedTime ?? departure.plannedTime)}
                  </span>
                </div>
                <div className="rt-item-sub">
                  {formatClock(departure.plannedTime)}
                  {departure.estimatedTime && departure.estimatedTime !== departure.plannedTime && (
                    <span className="rt-delay"> → {formatClock(departure.estimatedTime)}</span>
                  )}
                  {departure.platform && ` · Pl. ${departure.platform}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
