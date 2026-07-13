import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { routeMode, type DemoRoute } from '../route';
import { transportModeLabel } from '../domain/transport';
import { SimulatorCommandsContext } from '../features/simulation/useSimulatorRuntime';
import { SimulatorViewport } from '../features/simulation/SimulatorViewport';
import { SimulatorSnapshotStore, useSimulatorSnapshot } from '../features/simulation/SimulatorSnapshotStore';
import { SelectionPanel } from '../features/selection/SelectionPanel';
import { RealtimePanel } from '../features/realtime/RealtimePanel';
import { SimulatorHud } from '../features/simulation/SimulatorHud';
import { DriverControls } from '../features/simulation/DriverControls';
import { MiniMapPanel } from '../features/minimap/MiniMapPanel';
import { RouteDiagramPanel } from '../features/route-diagram/RouteDiagramPanel';
import { PhotoModeOverlay } from '../features/photo/PhotoModeOverlay';
import { LoadingOverlay } from './LoadingOverlay';
import { useAppBootstrap } from './useAppBootstrap';
import { useAppState } from './useAppState';
import { useAppUrlSync } from './useAppUrlSync';
import type { SimulatorRuntime, RouteSession } from '../simulator/SimulatorRuntime';
import { InputController } from './InputController';

/**
 * The React shell: owns selection/input state and drives the imperative
 * SimulatorRuntime through effects. It never touches the Three.js scene.
 */
export function AppShell() {
  const { state, dispatch } = useAppState();
  const catalog = useAppBootstrap();
  useAppUrlSync(state, catalog.ready);

  const store = useMemo(() => new SimulatorSnapshotStore(), []);
  const snapshot = useSimulatorSnapshot(store);
  const [runtime, setRuntime] = useState<SimulatorRuntime | null>(null);
  const [activeRealtimeRoute, setActiveRealtimeRoute] = useState<DemoRoute | null>(null);
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [photoLabel, setPhotoLabel] = useState('Platform fly-by');
  const photoActiveRef = useRef(state.photoModeActive);
  photoActiveRef.current = state.photoModeActive;

  const onRuntime = useCallback((next: SimulatorRuntime | null) => setRuntime(next), []);
  const catalogRoute = catalog.routes.find((entry) => entry.id === state.selectedRouteId);
  // Realtime routes are Stuttgart-referenced, so simulate them against the Stuttgart city context.
  const realtimeCity = state.realtimeRoute ? catalog.cities.find((c) => c.id === 'stuttgart') ?? catalog.currentCity : null;
  const session = useMemo<RouteSession | null>(() => {
    if (state.realtimeRoute && realtimeCity) {
      return {
        route: state.realtimeRoute,
        networkRoutes: [state.realtimeRoute],
        city: realtimeCity,
        mode: state.selectedMode,
        startStationIndex: 0,
        season: state.selectedSeason,
        time: state.selectedTime,
        cameraMode: state.selectedCameraMode
      };
    }
    return catalogRoute && catalog.currentCity
      ? {
          route: catalogRoute,
          networkRoutes: catalog.routes,
          city: catalog.currentCity,
          mode: state.selectedMode,
          startStationIndex: state.selectedStartStation,
          season: state.selectedSeason,
          time: state.selectedTime,
          cameraMode: state.selectedCameraMode
        }
      : null;
  }, [state.realtimeRoute, realtimeCity, catalogRoute, catalog.routes, catalog.currentCity, state.selectedMode, state.selectedStartStation, state.selectedSeason, state.selectedTime, state.selectedCameraMode]);

  // Realtime transfers change the world imperatively, so keep presentation
  // panels aligned with the currently active journey leg.
  const route = state.realtimeRoute ? activeRealtimeRoute ?? state.realtimeRoute : session?.route ?? catalogRoute;
  const realtimeLegs = useMemo(
    () => state.realtimeRoute ? [state.realtimeRoute, ...(state.realtimeRoute.journeyLegs ?? [])] : [],
    [state.realtimeRoute]
  );
  const journeyDiagramRoute = useMemo(
    () => realtimeLegs.length > 1 ? combinedJourneyRoute(realtimeLegs) : undefined,
    [state.realtimeRoute]
  );

  // Route/city change rebuilds the world; other changes only re-init the sim.
  useEffect(() => { if (runtime && session) runtime.loadRoute(session); }, [runtime, session?.route, session?.city]);
  useEffect(() => { if (runtime && session) runtime.setStartStation(session); }, [runtime, state.selectedStartStation]);
  useEffect(() => { if (runtime && session) runtime.setRideMode(session); }, [runtime, state.selectedMode]);
  useEffect(() => runtime?.setPaused(state.paused), [runtime, state.paused]);
  useEffect(() => runtime?.setDriverInput(state.throttleHeld ? 1 : 0, state.brakeHeld ? 1 : 0), [runtime, state.throttleHeld, state.brakeHeld]);
  useEffect(() => runtime?.setInteriorLook(state.lookLeftHeld, state.lookRightHeld), [runtime, state.lookLeftHeld, state.lookRightHeld]);
  useEffect(() => runtime?.setSeason(state.selectedSeason), [runtime, state.selectedSeason]);
  useEffect(() => runtime?.setTime(state.selectedTime), [runtime, state.selectedTime]);
  useEffect(() => { runtime?.onPhotoLabel(setPhotoLabel); }, [runtime]);
  useEffect(() => { runtime?.onActiveRoute(setActiveRealtimeRoute); }, [runtime]);
  useEffect(() => setActiveRealtimeRoute(state.realtimeRoute), [state.realtimeRoute]);
  useEffect(() => {
    if (!runtime) return;
    if (state.photoModeActive) runtime.enterPhotoMode();
    else runtime.exitPhotoMode();
  }, [runtime, state.photoModeActive]);

  // Raw input listeners feed dispatches; zoom goes straight to the camera.
  useEffect(() => {
    if (!runtime) return;
    const target = document.querySelector<HTMLElement>('.simulator-viewport');
    if (!target) return;
    const input = new InputController(target, {
      onThrottle: (held) => dispatch({ type: 'throttle-changed', held }),
      onBrake: (held) => dispatch({ type: 'brake-changed', held }),
      onLook: (leftHeld, rightHeld) => dispatch({ type: 'look-changed', leftHeld, rightHeld }),
      onZoom: (delta) => runtime.adjustZoom(delta),
      onPhotoToggle: () => dispatch({ type: 'photo-mode-changed', active: !photoActiveRef.current }),
      onPhotoExit: () => dispatch({ type: 'photo-mode-changed', active: false })
    });
    return () => input.dispose();
  }, [runtime, dispatch]);

  const notice = route && catalog.currentCity
    ? `${catalog.currentCity.shortLabel} · ${transportModeLabel(routeMode(route), catalog.currentCity.transportModes)} · ${route.agency ?? catalog.currentCity.noticeNetworkName} · ${route.description} ${catalog.currentCity.freeRideNotice} Source: ${route.source ?? 'demo route'}. ${catalog.attribution} Vector 3D scenery: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors. Relief: Mapzen Terrain Tiles on AWS Open Data.`
    : '';

  return (
    <SimulatorCommandsContext.Provider value={runtime}>
      <SimulatorViewport store={store} onRuntime={onRuntime} />
      <LoadingOverlay message={catalog.loadingMessage} error={catalog.error} />
      <div className={`hud ${collapsed ? 'collapsed' : ''} ${state.selectedMode === 'driver' ? 'driver-mode' : ''}`}>
        <div className="hud-header">
          <div>
            <h1>{catalog.currentCity?.menuTitle ?? 'Transit Simulator'}</h1>
            <div className="label">{catalog.currentCity?.freeRideNotice ?? 'Free, non-commercial simulator'}</div>
          </div>
          <button
            className="menu-toggle"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? '+' : '−'}
          </button>
        </div>
        {/*<div className="hud-tabs">*/}
          {/*<button*/}
          {/*  className={state.hudTab === 'simulator' ? 'active' : ''}*/}
          {/*  onClick={() => dispatch({ type: 'hud-tab-selected', tab: 'simulator' })}*/}
          {/*>*/}
          {/*  Simulator*/}
          {/*</button>*/}
          {/*<button*/}
          {/*  className={state.hudTab === 'realtime' ? 'active' : ''}*/}
          {/*  onClick={() => dispatch({ type: 'hud-tab-selected', tab: 'realtime' })}*/}
          {/*>*/}
          {/*  Realtime*/}
          {/*</button>*/}
        {/*</div>*/} {/* TODO: realtime mode */}
        <div className="hud-content">
          {state.hudTab === 'realtime' ? (
            <>
              <SimulatorHud snapshot={snapshot} />
              <RealtimePanel />
            </>
          ) : (
            <>
              <SelectionPanel catalog={catalog} />
              <SimulatorHud snapshot={snapshot} />
              <div className="controls">
                <button onClick={() => dispatch({ type: 'pause-changed', paused: !state.paused })}>{state.paused ? 'Resume' : 'Pause'}</button>
                <button onClick={() => { const mode = runtime?.cycleCamera(); if (mode) dispatch({ type: 'camera-selected', cameraMode: mode }); }}>Camera</button>
                <button onClick={() => dispatch({ type: 'photo-mode-changed', active: true })}>Photo</button>
                <button onClick={() => session && runtime?.resetSimulation(session)}>Restart</button>
              </div>
              <DriverControls dispatch={dispatch} />
            </>
          )}
        </div>
      </div>
      <div className="right-rail">
        <RouteDiagramPanel route={journeyDiagramRoute ?? route} routes={realtimeLegs.length ? realtimeLegs : catalog.routes} activeRoute={route} journeyLegs={realtimeLegs.length > 1 ? realtimeLegs : undefined} snapshot={snapshot} />
      </div>
      <MiniMapPanel route={route} distanceM={snapshot.distanceM} />
      <div className="notice">{notice}</div>
      {runtime && (
        <PhotoModeOverlay
          active={state.photoModeActive}
          label={photoLabel}
          commands={runtime}
          onExit={() => dispatch({ type: 'photo-mode-changed', active: false })}
        />
      )}
    </SimulatorCommandsContext.Provider>
  );
}

/** A schematic-only route that keeps every transit leg visible in one panel. */
function combinedJourneyRoute(legs: DemoRoute[]): DemoRoute {
  let offsetM = 0;
  const stations = legs.flatMap((leg) => {
    const output = leg.stations.map((station) => ({ ...station, distanceM: station.distanceM + offsetM }));
    offsetM += leg.routeLengthM;
    return output;
  });
  return {
    ...legs[0],
    id: `${legs[0].id}-journey-diagram`,
    line: legs.map((leg) => leg.line).join(' → '),
    destination: legs.at(-1)?.destination ?? legs[0].destination,
    description: 'Realtime journey',
    routeLengthM: offsetM,
    stations
  };
}
