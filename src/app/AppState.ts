import type { TransportMode } from '../domain/transport';
import type { DemoRoute } from '../route';
import type { Mode, Season } from './types';

export type AppState = {
  selectedCityId: string;
  selectedRoute: DemoRoute;
  selectedTransportMode: TransportMode;
  selectedMode: Mode;
  selectedSeason: Season;
  selectedTime: 'auto' | number;
  selectedStartStation: number;
  paused: boolean;
  throttleHeld: boolean;
  brakeHeld: boolean;
  lookLeftHeld: boolean;
  lookRightHeld: boolean;
};

export function createInitialAppState(route: DemoRoute): AppState {
  return {
    selectedCityId: 'stuttgart',
    selectedRoute: route,
    selectedTransportMode: 'stadtbahn',
    selectedMode: 'ride',
    selectedSeason: 'summer',
    selectedTime: 'auto',
    selectedStartStation: 0,
    paused: false,
    throttleHeld: false,
    brakeHeld: false,
    lookLeftHeld: false,
    lookRightHeld: false
  };
}
