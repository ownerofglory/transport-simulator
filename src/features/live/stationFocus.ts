import type { LatLon } from './liveProjection';

// Handing a searched station to the 3D view: which station, and a key that
// changes on every pick so re-selecting the same station flies there again.
export type StationFocus = { key: string; name: string; lat: number; lon: number };

// The 3D scene's projection origin is fixed for its lifetime (liveProjection),
// and terrain/scenery stream around it. Flying much further than this from the
// origin would drift off the useful part of the tangent plane, so a distant
// station gets a fresh scene centred on it instead of a very long flight.
const MAX_FLIGHT_RADIUS_M = 9_000;
const EARTH_M_PER_DEG_LAT = 111_320;

/** Approximate ground distance between two coordinates (equirectangular). */
export function groundDistanceM(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * EARTH_M_PER_DEG_LAT;
  const dLon = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180) * EARTH_M_PER_DEG_LAT;
  return Math.hypot(dLat, dLon);
}

/**
 * Whether focusing `station` needs the 3D scene rebuilt around a new origin
 * (true) or can be reached by flying the existing camera (false).
 */
export function needsNewOrigin(origin: LatLon | null, station: LatLon): boolean {
  if (!origin) return true;
  return groundDistanceM(origin, station) > MAX_FLIGHT_RADIUS_M;
}
