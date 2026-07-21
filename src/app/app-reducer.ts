import type { AppAction } from './app-actions';
import type { AppState } from './AppState';

/** Pure reducer for all selection/input state. Side effects live in effects/runtime. */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'hud-tab-selected':
      return { ...state, hudTab: action.tab };
    case 'view-changed':
      return { ...state, view: action.view };
    case 'realtime-route-simulated':
      // Switch to the simulator view so the freshly built route is visible.
      return { ...state, realtimeRoute: action.route, realtimeJourney: action.journey, selectedMode: 'ride', hudTab: 'simulator' };
    case 'city-selected':
      // A manual city change leaves realtime mode and drops any simulated route.
      // Live only exists for Stuttgart, so switching city always exits Live first.
      return { ...state, selectedCityId: action.cityId, view: 'simulator', selectedStartStation: 0, realtimeRoute: null, realtimeJourney: null };
    case 'transport-mode-selected':
      return { ...state, selectedTransportMode: action.mode, selectedStartStation: 0 };
    case 'route-selected':
      // Selecting a catalog line supersedes any simulated realtime route.
      return { ...state, selectedRouteId: action.routeId, selectedStartStation: 0, realtimeRoute: null, realtimeJourney: null };
    case 'start-station-selected':
      return { ...state, selectedStartStation: action.stationIndex };
    case 'ride-mode-selected':
      return { ...state, selectedMode: action.mode };
    case 'season-selected':
      return { ...state, selectedSeason: action.season };
    case 'time-selected':
      return { ...state, selectedTime: action.time };
    case 'camera-selected':
      return { ...state, selectedCameraMode: action.cameraMode };
    case 'pause-changed':
      return { ...state, paused: action.paused };
    case 'initial-state-loaded':
      return { ...state, ...action.state };
  }
}
