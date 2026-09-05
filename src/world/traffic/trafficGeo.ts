// Small equirectangular geo helpers for road traffic. Deliberately independent
// of TransitWorld.projectGeo: this module only needs a *relative* origin (the
// player's current geo point) to pick random points nearby and measure the
// distance between them, not the world's fixed coordinate origin.

export type LatLon = { lat: number; lon: number };

const EARTH_M_PER_DEG_LAT = 111_320;

/** Metres per degree of longitude at a latitude (matches the app's flat-earth projection). */
export function lonScaleAt(lat: number): number {
  return Math.cos((lat * Math.PI) / 180) * EARTH_M_PER_DEG_LAT;
}

/** A point uniformly distributed within `radiusM` of `center` (uniform over area, not radius). */
export function randomGeoPointNear(center: LatLon, radiusM: number): LatLon {
  const r = radiusM * Math.sqrt(Math.random());
  const theta = Math.random() * Math.PI * 2;
  const dz = r * Math.cos(theta);
  const dx = r * Math.sin(theta);
  const lonScale = lonScaleAt(center.lat);
  return {
    lat: center.lat + dz / EARTH_M_PER_DEG_LAT,
    lon: center.lon + dx / lonScale
  };
}

/** Straight-line ground distance between two points, in metres. */
export function flatDistanceM(a: LatLon, b: LatLon): number {
  const lonScale = lonScaleAt((a.lat + b.lat) / 2);
  return Math.hypot((b.lat - a.lat) * EARTH_M_PER_DEG_LAT, (b.lon - a.lon) * lonScale);
}
