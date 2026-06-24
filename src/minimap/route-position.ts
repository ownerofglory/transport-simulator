import type { DemoRoute } from '../route';

export type GeoPoint = { lat: number; lon: number };

// Approximate meters per one degree of latitude, good enough for local city-scale map distances.
const METERS_PER_DEG_LAT = 111_320;

/** Returns approximate ground distance between two WGS84 points in meters. */
export function pointDistance(a: GeoPoint, b: GeoPoint): number {
  // Use midpoint latitude so longitude scaling is accurate enough for short route segments.
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);

  const dx = (b.lon - a.lon) * Math.cos(lat) * METERS_PER_DEG_LAT;
  const dy = (b.lat - a.lat) * METERS_PER_DEG_LAT;

  return Math.hypot(dx, dy);
}

/** Returns heading from point a to point b in degrees, clockwise from north. */
export function bearing(a: GeoPoint, b: GeoPoint): number {
  const lat1 = a.lat * (Math.PI / 180);
  const lat2 = b.lat * (Math.PI / 180);
  const dLon = (b.lon - a.lon) * (Math.PI / 180);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  // Convert radians to degrees, then normalize into [0, 360).
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Linearly interpolates between two nearby WGS84 points. */
export function interpolate(a: GeoPoint, b: GeoPoint, t: number): GeoPoint {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t
  };
}

/** Converts route geoPoints tuples into named GeoPoint objects. */
export function geoPoints(route: DemoRoute): GeoPoint[] {
  return (route.geoPoints ?? []).map(([lat, lon]) => ({ lat, lon }));
}
