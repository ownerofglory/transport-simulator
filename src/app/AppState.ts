import type { TransportMode } from '../domain/transport';
import type { CameraMode } from '../world/CameraController';
import type { Mode, Season } from './types';

/**
 * Serializable selection + input state for the app. Routes are referenced by id
 * and resolved through RouteRepository so the state stays lightweight and easy
 * to persist (URL/localStorage) without carrying full DemoRoute objects.
 */
export type AppState = {
  selectedCityId: string;
  selectedRouteId: string;
  selectedTransportMode: TransportMode;
  selectedMode: Mode;
  selectedSeason: Season;
  selectedTime: 'auto' | number;
  selectedStartStation: number;
  selectedCameraMode: CameraMode;
  photoModeActive: boolean;
  paused: boolean;
  throttleHeld: boolean;
  brakeHeld: boolean;
  lookLeftHeld: boolean;
  lookRightHeld: boolean;
};

export function createInitialAppState(routeId: string): AppState {
  return {
    selectedCityId: 'stuttgart',
    selectedRouteId: routeId,
    selectedTransportMode: 'stadtbahn',
    selectedMode: 'ride',
    selectedSeason: 'summer',
    selectedTime: 'auto',
    selectedStartStation: 0,
    selectedCameraMode: 'chase',
    photoModeActive: false,
    paused: false,
    throttleHeld: false,
    brakeHeld: false,
    lookLeftHeld: false,
    lookRightHeld: false
  };
}
