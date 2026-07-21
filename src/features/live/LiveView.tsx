import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeparturesModal } from '../realtime/DeparturesModal';
import { searchLocations, nearbyLocations } from '../realtime/api';
import type { EndpointValue } from '../realtime/LocationField';
import { LiveMap } from './LiveMap';
import { LiveModePanel } from './LiveModePanel';
import { LiveVehicleCard } from './LiveVehicleCard';
import { ALL_LIVE_MODES, type LiveMode, type LiveVehicle } from './liveTypes';
import type { LatLon } from './liveProjection';
import type { BBox } from './viewport';
import { useLiveVehicles } from './useLiveVehicles';

// The 3D scene pulls in Three.js + the OSM streamer, so it is code-split and
// loaded only when the user actually zooms into the 3D view.
const Live3DView = lazy(() => import('./Live3DView').then((m) => ({ default: m.Live3DView })));

// Map zoom at/above which the map hands off to the 3D free-flight view, and the
// zoom the map restores to when the 3D view hands back (just below the trigger
// so returning doesn't immediately re-enter 3D).
const ENTER_3D_ZOOM = 16;
const RETURN_MAP_ZOOM = 15;

/** Resolves a stop *name* (all a LiveVehicle carries) to a full station via the
 * existing locations API, using the vehicle position to disambiguate. */
async function resolveStop(name: string, near: { lat: number; lon: number }): Promise<EndpointValue | null> {
  try {
    const byName = await searchLocations(name);
    const exact = byName.find((l) => l.name.toLowerCase() === name.toLowerCase()) ?? byName[0];
    if (exact) return { id: exact.id, name: exact.name, lat: exact.lat, lon: exact.lon };
  } catch {
    // fall through to a positional lookup
  }
  try {
    const near1 = await nearbyLocations(near.lat, near.lon, 900);
    const match = near1.find((l) => l.name.toLowerCase().includes(name.toLowerCase())) ?? near1[0];
    if (match) return { id: match.id, name: match.name, lat: match.lat, lon: match.lon };
  } catch {
    // ignore
  }
  return null;
}

/**
 * The full-screen Live workspace (map-based). Composes the viewport-tier polling
 * hook with the map renderer, the slim HUD, the selection card, and the existing
 * departures board. Rendered lazily and only for Stuttgart with live enabled.
 */
export function LiveView({ onExit }: { onExit: () => void }) {
  const [userModes, setUserModes] = useState<Set<LiveMode>>(() => new Set(ALL_LIVE_MODES));
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [followRunId, setFollowRunId] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<LiveVehicle | null>(null);
  const [departuresStation, setDeparturesStation] = useState<EndpointValue | null>(null);
  const [departuresOpen, setDeparturesOpen] = useState(false);

  // Map ↔ 3D workspace. `origin` fixes the 3D projection at hand-off; `returnView`
  // restores the map camera when coming back.
  const [mode, setMode] = useState<'map' | '3d'>('map');
  const [origin, setOrigin] = useState<LatLon | null>(null);
  const [returnView, setReturnView] = useState<{ lat: number; lon: number; zoom: number } | undefined>(undefined);
  const focus3DRef = useRef<LatLon | null>(null);

  const onFollowEnded = useCallback(() => setFollowRunId(null), []);
  const { store, summary, onViewportChange } = useLiveVehicles({
    enabled: true,
    userModes,
    followRunId,
    onFollowEnded
  });

  // Map viewport: feed polling, and hand off to 3D once zoomed in far enough.
  const handleMapViewport = useCallback(
    (bbox: BBox, zoom: number) => {
      onViewportChange(bbox, zoom);
      if (zoom >= ENTER_3D_ZOOM) {
        setOrigin({ lat: (bbox.latMin + bbox.latMax) / 2, lon: (bbox.lonMin + bbox.lonMax) / 2 });
        setSelectedRunId(null);
        setMode('3d');
      }
    },
    [onViewportChange]
  );

  // 3D viewport: feed polling and remember the focus for the return trip.
  const handle3DViewport = useCallback(
    (bbox: BBox, zoom: number) => {
      onViewportChange(bbox, zoom);
      focus3DRef.current = { lat: (bbox.latMin + bbox.latMax) / 2, lon: (bbox.lonMin + bbox.lonMax) / 2 };
    },
    [onViewportChange]
  );

  const backToMap = useCallback(() => {
    const f = focus3DRef.current;
    if (f) setReturnView({ lat: f.lat, lon: f.lon, zoom: RETURN_MAP_ZOOM });
    setMode('map');
  }, []);

  // Keep the selection card in step with incoming snapshots / follow patches.
  useEffect(() => {
    if (!selectedRunId) {
      setSelectedVehicle(null);
      return;
    }
    const read = () => {
      const tracked = store.get(selectedRunId);
      if (tracked) setSelectedVehicle(tracked.data);
    };
    read();
    const id = setInterval(read, 1000);
    return () => clearInterval(id);
  }, [selectedRunId, store, summary]);

  // A selected run that leaves the store closes the card and any follow.
  useEffect(() => {
    if (selectedRunId && !store.get(selectedRunId) && !selectedVehicle) {
      setSelectedRunId(null);
      setFollowRunId((f) => (f === selectedRunId ? null : f));
    }
  }, [summary, selectedRunId, selectedVehicle, store]);

  const toggleMode = useCallback((mode: LiveMode) => {
    setUserModes((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      // Never allow an empty filter — the API requires at least one mode.
      return next.size ? next : prev;
    });
  }, []);

  const handleSelect = useCallback((runId: string | null) => {
    setSelectedRunId(runId);
  }, []);

  const toggleFollow = useCallback(() => {
    setFollowRunId((f) => (f === selectedRunId ? null : selectedRunId));
  }, [selectedRunId]);

  const openDepartures = useCallback(async () => {
    if (!selectedVehicle?.nextStop) return;
    const station = await resolveStop(selectedVehicle.nextStop, {
      lat: selectedVehicle.lat ?? 48.7827,
      lon: selectedVehicle.lon ?? 9.18
    });
    setDeparturesStation(station);
    setDeparturesOpen(true);
  }, [selectedVehicle]);

  const emptyHint = useMemo(
    () => mode === 'map' && summary.lastUpdatedMs !== null && summary.count === 0 && !summary.error,
    [mode, summary]
  );

  if (mode === '3d' && origin) {
    return (
      <Suspense fallback={<div className="lv-3d-root" />}>
        <Live3DView
          store={store}
          origin={origin}
          summary={summary}
          userModes={userModes}
          onToggleMode={toggleMode}
          onViewport={handle3DViewport}
          onBackToMap={backToMap}
          onExitLive={onExit}
          selectedVehicle={selectedVehicle}
          following={followRunId === selectedRunId}
          onSelect={handleSelect}
          onToggleFollow={toggleFollow}
          onStopFollow={() => setFollowRunId(null)}
          onDepartures={openDepartures}
          onCloseSelection={() => setSelectedRunId(null)}
        />
      </Suspense>
    );
  }

  return (
    <div className="lv-root">
      <LiveMap
        store={store}
        onViewportChange={handleMapViewport}
        onSelect={handleSelect}
        selectedRunId={selectedRunId}
        followRunId={followRunId}
        initialView={returnView}
      />
      <LiveModePanel summary={summary} userModes={userModes} onToggleMode={toggleMode} onExit={onExit} />
      {emptyHint && <div className="lv-empty">No vehicles in view — zoom out or check the mode filters.</div>}
      {selectedVehicle && (
        <LiveVehicleCard
          vehicle={selectedVehicle}
          following={followRunId === selectedRunId}
          onToggleFollow={toggleFollow}
          onDepartures={openDepartures}
          onClose={() => setSelectedRunId(null)}
        />
      )}
      {departuresOpen && (
        <DeparturesModal onClose={() => setDeparturesOpen(false)} initialStation={departuresStation} />
      )}
    </div>
  );
}
