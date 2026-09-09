import type { LatLon } from './trafficGeo';
import { fetchOrsRoute } from './orsRoutingClient';

/** One-shot walking route lookup for a station's pedestrian catchment — never called per frame. */
export function fetchWalkingRoute(origin: LatLon, destination: LatLon, signal?: AbortSignal): Promise<LatLon[] | null> {
  return fetchOrsRoute('foot-walking', origin, destination, signal);
}
