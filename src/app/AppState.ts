import type { TransportMode } from '../domain/transport';
import type { CameraMode } from '../world/CameraController';
import { demoRoute, type DemoRoute } from '../route';
import type { RealtimeJourneySimulation } from '../features/realtime/journeyRoute';
import type { HudTab, Mode, Season } from './types';

/**
 * Serializable selection state for the app. Routes are referenced by id and
 * resolved through RouteRepository so the state stays lightweight and easy to
 * persist (URL/localStorage) without carrying full DemoRoute objects.
 *
 * Transient held input (throttle/brake/look) and photo-mode activation are NOT
 * stored here — they are owned by the engine (see engine/runtime/InputState and
 * SimulatorRuntime) so holding a control never re-renders the shell.
 */
export type AppState = {
  hudTab: HudTab;
  // A synthetic route built from live realtime data, simulated in place of a
  // catalog route when set.
  realtimeRoute: DemoRoute | null;
  realtimeJourney: RealtimeJourneySimulation | null;
  selectedCityId: string;
  selectedRouteId: string;
  selectedTransportMode: TransportMode;
  selectedMode: Mode;
  selectedSeason: Season;
  selectedTime: 'auto' | number;
  selectedStartStation: number;
  selectedCameraMode: CameraMode;
  paused: boolean;
};

export function createInitialAppState(routeId: string = demoRoute.id): AppState {
  return {
    hudTab: 'simulator',
    realtimeRoute: null,
    realtimeJourney: null,
    selectedCityId: 'stuttgart',
    selectedRouteId: routeId,
    selectedTransportMode: 'stadtbahn',
    selectedMode: 'ride',
    selectedSeason: 'summer',
    selectedTime: 'auto',
    selectedStartStation: 0,
    selectedCameraMode: 'chase',
    paused: false
  };
}
