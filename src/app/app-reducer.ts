import type { AppAction } from './app-actions';
import type { AppState } from './AppState';

/** Pure reducer for all selection/input state. Side effects live in effects/runtime. */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'city-selected':
      return { ...state, selectedCityId: action.cityId, selectedStartStation: 0 };
    case 'transport-mode-selected':
      return { ...state, selectedTransportMode: action.mode, selectedStartStation: 0 };
    case 'route-selected':
      return { ...state, selectedRouteId: action.routeId, selectedStartStation: 0 };
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
    case 'photo-mode-changed':
      return { ...state, photoModeActive: action.active };
    case 'throttle-changed':
      return { ...state, throttleHeld: action.held };
    case 'brake-changed':
      return { ...state, brakeHeld: action.held };
    case 'look-changed':
      return { ...state, lookLeftHeld: action.leftHeld, lookRightHeld: action.rightHeld };
    case 'initial-state-loaded':
      return { ...state, ...action.state };
  }
}
