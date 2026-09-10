import { isKnownTransportMode, type TransportMode } from '../domain/transport';
import type { CameraMode } from '../world/CameraController';
import type { AppState } from './AppState';
import type { EndpointValue } from '../features/realtime/LocationField';
import type { Mode, Season, TrafficDensity } from './types';

export type AppUrlState = {
  city: string;
  transportMode: TransportMode;
  routeId: string;
  startStationIndex: number;
  rideMode: Mode;
  season: Season;
  time: 'auto' | number;
  trafficDensity: TrafficDensity;
  cameraMode: CameraMode;
  // Live-traffic workspace flag (own key; `view` above is ride/driver mode).
  liveView?: boolean;
  realtime?: { origin: EndpointValue; destination: EndpointValue; journeyId: string };
};

const CAMERA_MODES = new Set<CameraMode>(['chase', 'passenger', 'cab']);
const RIDE_MODES = new Set<Mode>(['ride', 'driver']);
const SEASONS = new Set<Season>(['spring', 'summer', 'autumn', 'winter']);
const TRAFFIC_DENSITIES = new Set<TrafficDensity>(['few', 'medium', 'many']);

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

  const traffic = params.get('traffic');
  if (traffic && TRAFFIC_DENSITIES.has(traffic as TrafficDensity)) state.trafficDensity = traffic as TrafficDensity;

  const cameraMode = params.get('camera');
  if (cameraMode && CAMERA_MODES.has(cameraMode as CameraMode)) state.cameraMode = cameraMode as CameraMode;

  if (params.get('live') === '1') state.liveView = true;

  const endpoint = (prefix: string): EndpointValue | null => {
    const name = params.get(`${prefix}n`);
    const lat = Number.parseFloat(params.get(`${prefix}a`) ?? '');
    const lon = Number.parseFloat(params.get(`${prefix}o`) ?? '');
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { id: params.get(`${prefix}i`) ?? undefined, name, lat, lon };
  };
  if (params.get('rt') === '1') {
    const origin = endpoint('rfo');
    const destination = endpoint('rto');
    const journeyId = params.get('rtj');
    if (origin && destination && journeyId) state.realtime = { origin, destination, journeyId };
  }

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
  params.set('traffic', state.selectedTrafficDensity);
  params.set('camera', state.selectedCameraMode);

  if (state.view === 'live') params.set('live', '1');
  else params.delete('live');

  const realtimeKeys = ['rt', 'rfoi', 'rfon', 'rfoa', 'rfoo', 'rtoi', 'rton', 'rtoa', 'rtoo', 'rtj'];
  if (state.realtimeJourney) {
    const writeEndpoint = (prefix: string, endpoint: EndpointValue) => {
      if (endpoint.id) params.set(`${prefix}i`, endpoint.id);
      else params.delete(`${prefix}i`);
      params.set(`${prefix}n`, endpoint.name);
      params.set(`${prefix}a`, String(endpoint.lat));
      params.set(`${prefix}o`, String(endpoint.lon));
    };
    params.set('rt', '1');
    params.set('rtj', state.realtimeJourney.journey.id);
    writeEndpoint('rfo', state.realtimeJourney.origin);
    writeEndpoint('rto', state.realtimeJourney.destination);
  } else {
    realtimeKeys.forEach((key) => params.delete(key));
  }

  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  history.replaceState(history.state, '', nextUrl);
}
