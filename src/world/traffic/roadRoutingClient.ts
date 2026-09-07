import type { LatLon } from './trafficGeo';
import { fetchOrsRoute } from './orsRoutingClient';

/**
 * One-shot road route lookup for a vehicle's whole trip — never called per
 * frame. `profile` is an ORS routing profile (e.g. `driving-car`,
 * `driving-hgv`, `cycling-regular`); the server rejects an unknown one, which
 * {@link fetchOrsRoute} turns into a null result like any other failure.
 */
export function fetchRoadRoute(profile: string, origin: LatLon, destination: LatLon, signal?: AbortSignal): Promise<LatLon[] | null> {
  return fetchOrsRoute(profile, origin, destination, signal);
}
