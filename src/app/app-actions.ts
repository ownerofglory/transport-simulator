import type { TransportMode } from '../domain/transport';
import type { CameraMode } from '../world/CameraController';
import type { DemoRoute } from '../route';
import type { AppState } from './AppState';
import type { RealtimeJourneySimulation } from '../features/realtime/journeyRoute';
import type { HudTab, Mode, Season } from './types';

/** All state transitions the React shell can dispatch. */
export type AppAction =
  | { type: 'hud-tab-selected'; tab: HudTab }
  | { type: 'realtime-route-simulated'; route: DemoRoute; journey: RealtimeJourneySimulation }
  | { type: 'city-selected'; cityId: string }
  | { type: 'transport-mode-selected'; mode: TransportMode }
  | { type: 'route-selected'; routeId: string }
  | { type: 'start-station-selected'; stationIndex: number }
  | { type: 'ride-mode-selected'; mode: Mode }
  | { type: 'season-selected'; season: Season }
  | { type: 'time-selected'; time: 'auto' | number }
  | { type: 'camera-selected'; cameraMode: CameraMode }
  | { type: 'pause-changed'; paused: boolean }
  | { type: 'photo-mode-changed'; active: boolean }
  | { type: 'throttle-changed'; held: boolean }
  | { type: 'brake-changed'; held: boolean }
  | { type: 'look-changed'; leftHeld: boolean; rightHeld: boolean }
  | { type: 'initial-state-loaded'; state: Partial<AppState> };
