import type { DemoRoute } from '../route';

export type GeoPoint = { lat: number; lon: number };

const METERS_PER_DEG_LAT = 111_320;

export function pointDistance(a: GeoPoint, b: GeoPoint): number {
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dx = (b.lon - a.lon) * Math.cos(lat) * METERS_PER_DEG_LAT;
  const dy = (b.lat - a.lat) * METERS_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

export function bearing(a: GeoPoint, b: GeoPoint): number {
  const lat1 = a.lat * (Math.PI / 180);
  const lat2 = b.lat * (Math.PI / 180);
  const dLon = (b.lon - a.lon) * (Math.PI / 180);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function interpolate(a: GeoPoint, b: GeoPoint, t: number): GeoPoint {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t
  };
}

export function geoPoints(route: DemoRoute): GeoPoint[] {
  return (route.geoPoints ?? []).map(([lat, lon]) => ({ lat, lon }));
}
