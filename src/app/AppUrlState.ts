import { isKnownTransportMode, type TransportMode } from '../domain/transport';
import type { CameraMode } from '../world/CameraController';
import type { AppState } from './AppState';
import type { Mode, Season } from './types';

export type AppUrlState = {
  city: string;
  transportMode: TransportMode;
  routeId: string;
  startStationIndex: number;
  rideMode: Mode;
  season: Season;
  time: 'auto' | number;
  cameraMode: CameraMode;
};

const CAMERA_MODES = new Set<CameraMode>(['chase', 'passenger', 'cab']);
const RIDE_MODES = new Set<Mode>(['ride', 'driver']);
const SEASONS = new Set<Season>(['spring', 'summer', 'autumn', 'winter']);

export function readUrlState(): Partial<AppUrlState> {
  const params = new URLSearchParams(window.location.search);
  const state: Partial<AppUrlState> = {};

  const city = params.get('city');
  if (city) state.city = city;

  const transportMode = params.get('transport');
  if (transportMode && isKnownTransportMode(transportMode)) {
    state.transportMode = transportMode;
  }

  const routeId = params.get('route');
  if (routeId) state.routeId = routeId;

  const station = params.get('station');
  if (station) {
    const value = Number.parseInt(station, 10);
    if (Number.isInteger(value) && value >= 0) state.startStationIndex = value;
  }

  const rideMode = params.get('view');
  if (rideMode && RIDE_MODES.has(rideMode as Mode)) state.rideMode = rideMode as Mode;

  const season = params.get('season');
  if (season && SEASONS.has(season as Season)) state.season = season as Season;

  const time = params.get('time');
  if (time === 'auto') {
    state.time = 'auto';
  } else if (time) {
    const value = Number.parseFloat(time);
    if (Number.isFinite(value) && value >= 0 && value <= 24) state.time = value;
  }

  const cameraMode = params.get('camera');
  if (cameraMode && CAMERA_MODES.has(cameraMode as CameraMode)) state.cameraMode = cameraMode as CameraMode;

  return state;
}

export function writeUrlState(state: AppState): void {
  const params = new URLSearchParams(window.location.search);

  params.set('city', state.selectedCityId);
  params.set('transport', state.selectedTransportMode);
  params.set('route', state.selectedRouteId);
  params.set('station', String(state.selectedStartStation));
  params.set('view', state.selectedMode);
  params.set('season', state.selectedSeason);
  params.set('time', state.selectedTime === 'auto' ? 'auto' : String(state.selectedTime));
  params.set('camera', state.selectedCameraMode);

  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  history.replaceState(history.state, '', nextUrl);
}
