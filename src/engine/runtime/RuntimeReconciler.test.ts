import { describe, it, expect, vi } from 'vitest';
import { RuntimeReconciler, type ReconcilerRuntime } from './RuntimeReconciler';
import type { DesiredRuntimeState } from './DesiredRuntimeState';
import type { RouteSession } from '../../simulator/SimulatorRuntime';

function makeRuntime() {
  return {
    loadRoute: vi.fn(),
    setStartStation: vi.fn(),
    setRideMode: vi.fn(),
    setSeason: vi.fn(),
    setTime: vi.fn(),
    setTrafficDensity: vi.fn(),
    setDebugWeather: vi.fn(),
    setCameraMode: vi.fn(),
    setPaused: vi.fn()
  } satisfies ReconcilerRuntime;
}

/** Minimal session — only the fields worldKey/reconciler read matter. */
function session(overrides: Partial<{ cityId: string; routeId: string; transportMode: string; mode: 'ride' | 'driver'; startStationIndex: number }> = {}): RouteSession {
  const { cityId = 'stuttgart', routeId = 'u12', transportMode = 'stadtbahn', mode = 'ride', startStationIndex = 0 } = overrides;
  return {
    route: { id: routeId, transportMode } as unknown as RouteSession['route'],
    networkRoutes: [],
    city: { id: cityId } as unknown as RouteSession['city'],
    mode,
    startStationIndex,
    season: 'summer',
    time: 'auto',
    cameraMode: 'chase',
    trafficDensity: 'few',
    debugWeather: 'auto'
  } as unknown as RouteSession;
}

function desired(overrides: Partial<DesiredRuntimeState['presentation']> & { session?: RouteSession | null; paused?: boolean } = {}): DesiredRuntimeState {
  return {
    session: 'session' in overrides ? overrides.session! : session(),
    simulation: { paused: overrides.paused ?? false },
    presentation: {
      season: overrides.season ?? 'summer',
      time: overrides.time ?? 'auto',
      cameraMode: overrides.cameraMode ?? 'chase',
      trafficDensity: overrides.trafficDensity ?? 'few',
      debugWeather: overrides.debugWeather ?? 'auto'
    }
  };
}

describe('RuntimeReconciler', () => {
  it('loads the route on first apply, then does nothing for identical state', () => {
    const runtime = makeRuntime();
    const r = new RuntimeReconciler(runtime);
    const state = desired();
    r.apply(state);
    expect(runtime.loadRoute).toHaveBeenCalledTimes(1);
    r.apply(desired()); // structurally identical
    expect(runtime.loadRoute).toHaveBeenCalledTimes(1);
    expect(runtime.setStartStation).not.toHaveBeenCalled();
    expect(runtime.setRideMode).not.toHaveBeenCalled();
  });

  it('rebuilds the world exactly once on a route change', () => {
    const runtime = makeRuntime();
    const r = new RuntimeReconciler(runtime);
    r.apply(desired());
    r.apply(desired({ session: session({ routeId: 'u6' }) }));
    expect(runtime.loadRoute).toHaveBeenCalledTimes(2);
  });

  it('rebuilds the world on a vehicle-design/structural change', () => {
    const runtime = makeRuntime();
    const r = new RuntimeReconciler(runtime);
    r.apply(desired());
    r.apply(desired({ session: session({ cityId: 'ulm' }) }));
    expect(runtime.loadRoute).toHaveBeenCalledTimes(2);
  });

  it('season change calls only setSeason', () => {
    const runtime = makeRuntime();
    const r = new RuntimeReconciler(runtime);
    r.apply(desired());
    Object.values(runtime).forEach((fn) => fn.mockClear());
    r.apply(desired({ season: 'winter' }));
    expect(runtime.setSeason).toHaveBeenCalledWith('winter');
    expect(runtime.loadRoute).not.toHaveBeenCalled();
    expect(runtime.setStartStation).not.toHaveBeenCalled();
    expect(runtime.setCameraMode).not.toHaveBeenCalled();
  });

  it('start-station change updates the world without rebuilding it', () => {
    const runtime = makeRuntime();
    const r = new RuntimeReconciler(runtime);
    r.apply(desired());
    Object.values(runtime).forEach((fn) => fn.mockClear());
    r.apply(desired({ session: session({ startStationIndex: 3 }) }));
    expect(runtime.setStartStation).toHaveBeenCalledTimes(1);
    expect(runtime.loadRoute).not.toHaveBeenCalled();
  });

  it('camera change calls only setCameraMode (no world rebuild)', () => {
    const runtime = makeRuntime();
    const r = new RuntimeReconciler(runtime);
    r.apply(desired());
    Object.values(runtime).forEach((fn) => fn.mockClear());
    r.apply(desired({ cameraMode: 'cab' }));
    expect(runtime.setCameraMode).toHaveBeenCalledWith('cab');
    expect(runtime.loadRoute).not.toHaveBeenCalled();
  });

  it('ride-mode change calls only setRideMode', () => {
    const runtime = makeRuntime();
    const r = new RuntimeReconciler(runtime);
    r.apply(desired());
    Object.values(runtime).forEach((fn) => fn.mockClear());
    r.apply(desired({ session: session({ mode: 'driver' }) }));
    expect(runtime.setRideMode).toHaveBeenCalledTimes(1);
    expect(runtime.loadRoute).not.toHaveBeenCalled();
  });

  it('traffic density updates the running world without a rebuild', () => {
    const runtime = makeRuntime();
    const r = new RuntimeReconciler(runtime);
    r.apply(desired());
    Object.values(runtime).forEach((fn) => fn.mockClear());
    r.apply(desired({ trafficDensity: 'many' }));
    expect(runtime.setTrafficDensity).toHaveBeenCalledWith('many');
    expect(runtime.loadRoute).not.toHaveBeenCalled();
    r.apply(desired({ trafficDensity: 'many' }));
    expect(runtime.setTrafficDensity).toHaveBeenCalledTimes(1);
  });

  it('debug weather forces a condition and hands it back on auto', () => {
    const runtime = makeRuntime();
    const r = new RuntimeReconciler(runtime);
    r.apply(desired());
    Object.values(runtime).forEach((fn) => fn.mockClear());
    r.apply(desired({ debugWeather: 'snow' }));
    expect(runtime.setDebugWeather).toHaveBeenCalledWith('snow');
    expect(runtime.loadRoute).not.toHaveBeenCalled();
    r.apply(desired({ debugWeather: 'auto' }));
    expect(runtime.setDebugWeather).toHaveBeenLastCalledWith('auto');
  });

  it('pause toggles setPaused only when it changes', () => {
    const runtime = makeRuntime();
    const r = new RuntimeReconciler(runtime);
    r.apply(desired({ paused: false }));
    expect(runtime.setPaused).toHaveBeenCalledTimes(1);
    r.apply(desired({ paused: false }));
    expect(runtime.setPaused).toHaveBeenCalledTimes(1);
    r.apply(desired({ paused: true }));
    expect(runtime.setPaused).toHaveBeenLastCalledWith(true);
  });

  it('does nothing structural when session is null', () => {
    const runtime = makeRuntime();
    const r = new RuntimeReconciler(runtime);
    r.apply(desired({ session: null }));
    expect(runtime.loadRoute).not.toHaveBeenCalled();
    expect(runtime.setPaused).not.toHaveBeenCalled();
  });
});
