import { useEffect, useRef, useState } from 'react';
import { Live3DScene } from './Live3DScene';
import { LiveModePanel } from './LiveModePanel';
import { LiveVehicleCard } from './LiveVehicleCard';
import type { LiveVehicleStore } from './LiveVehicleStore';
import type { LatLon } from './liveProjection';
import type { LiveMode, LiveVehicle } from './liveTypes';
import type { LiveSummary } from './useLiveVehicles';
import type { BBox } from './viewport';
import type { CameraMode } from '../../world/CameraController';

const CAMERA_MODE_LABEL: Record<CameraMode, string> = {
  chase: 'Chase',
  passenger: 'Passenger',
  cab: 'Driver'
};

/**
 * Full-screen 3D free-flight view (milestone 1). Mounts {@link Live3DScene},
 * reuses the slim HUD, and adds a "Map view" control. The scene reads the shared
 * {@link LiveVehicleStore}, so vehicles carry over from the map with no refetch.
 */
export function Live3DView({
  store,
  origin,
  summary,
  userModes,
  onToggleMode,
  onViewport,
  onBackToMap,
  onExitLive,
  selectedVehicle,
  following,
  onSelect,
  onToggleFollow,
  onStopFollow,
  onDepartures,
  onCloseSelection
}: {
  store: LiveVehicleStore;
  origin: LatLon;
  summary: LiveSummary;
  userModes: Set<LiveMode>;
  onToggleMode: (mode: LiveMode) => void;
  onViewport: (bbox: BBox, zoom: number) => void;
  onBackToMap: () => void;
  onExitLive: () => void;
  selectedVehicle: LiveVehicle | null;
  following: boolean;
  onSelect: (runId: string) => void;
  onToggleFollow: () => void;
  onStopFollow: () => void;
  onDepartures: () => void;
  onCloseSelection: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onViewportRef = useRef(onViewport);
  onViewportRef.current = onViewport;
  const onBackRef = useRef(onBackToMap);
  onBackRef.current = onBackToMap;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onStopFollowRef = useRef(onStopFollow);
  onStopFollowRef.current = onStopFollow;
  const sceneRef = useRef<Live3DScene | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase');
  const setCameraModeRef = useRef(setCameraMode);
  setCameraModeRef.current = setCameraMode;

  // Origin is fixed for the scene's lifetime; a new origin means a fresh mount.
  const originKey = `${origin.lat.toFixed(5)},${origin.lon.toFixed(5)}`;

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new Live3DScene(containerRef.current, {
      store,
      origin,
      onViewport: (bbox, zoom) => onViewportRef.current(bbox, zoom),
      onExitToMap: () => onBackRef.current(),
      onSelect: (runId) => onSelectRef.current(runId),
      onStopFollow: () => onStopFollowRef.current(),
      onCameraModeChange: (mode) => setCameraModeRef.current(mode)
    });
    sceneRef.current = scene;
    return () => {
      sceneRef.current = null;
      scene.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, originKey]);

  useEffect(() => {
    sceneRef.current?.setFollowRunId(following && selectedVehicle?.runId ? selectedVehicle.runId : null);
  }, [following, selectedVehicle?.runId]);

  return (
    <div className="lv-3d-root">
      <div ref={containerRef} className="lv-3d-canvas" />
      <LiveModePanel summary={summary} userModes={userModes} onToggleMode={onToggleMode} onExit={onExitLive} />
      <div className="lv-3d-bar">
        <button className="lv-3d-back" onClick={onBackToMap}>
          ↩ Map view
        </button>
        {following && (
          <button
            className="lv-3d-back"
            onClick={() => sceneRef.current?.cycleCameraMode()}
            title="Switch view (C)"
          >
            View: {CAMERA_MODE_LABEL[cameraMode]}
          </button>
        )}
        <span className="lv-3d-hint">
          {following ? 'C to switch view · drag to leave follow' : 'drag to pan · scroll to zoom · right-drag to rotate'}
        </span>
      </div>
      {selectedVehicle && (
        <LiveVehicleCard
          vehicle={selectedVehicle}
          following={following}
          onToggleFollow={onToggleFollow}
          onDepartures={onDepartures}
          onClose={onCloseSelection}
        />
      )}
    </div>
  );
}
