import type { TransportMode } from '../domain/transport';
import type { CameraMode } from '../world/CameraController';
import type { DemoRoute } from '../route';
import type { AppState } from './AppState';
import type { RealtimeJourneySimulation } from '../features/realtime/journeyRoute';
import type { DebugWeather, HudTab, Mode, Season, TrafficDensity } from './types';

/** All state transitions the React shell can dispatch. */
export type AppAction =
  | { type: 'hud-tab-selected'; tab: HudTab }
  | { type: 'view-changed'; view: 'simulator' | 'live' }
  | { type: 'realtime-route-simulated'; route: DemoRoute; journey: RealtimeJourneySimulation }
  | { type: 'city-selected'; cityId: string }
  | { type: 'transport-mode-selected'; mode: TransportMode }
  | { type: 'route-selected'; routeId: string }
  | { type: 'start-station-selected'; stationIndex: number }
  | { type: 'ride-mode-selected'; mode: Mode }
  | { type: 'season-selected'; season: Season }
  | { type: 'time-selected'; time: 'auto' | number }
  | { type: 'traffic-density-selected'; density: TrafficDensity }
  | { type: 'debug-mode-toggled' }
  | { type: 'debug-weather-selected'; weather: DebugWeather }
  | { type: 'camera-selected'; cameraMode: CameraMode }
  | { type: 'pause-changed'; paused: boolean }
  | { type: 'initial-state-loaded'; state: Partial<AppState> };
