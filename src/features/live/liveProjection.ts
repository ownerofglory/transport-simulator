import * as THREE from 'three';

// Equirectangular lat/lon <-> world projection around a fixed origin, matching
// TransitWorld.projectGeo (world.ts) so the reused OSM/terrain primitives place
// geometry consistently. The live 3D scene fixes its origin at the map center at
// hand-off and never moves it, so world coordinates stay stable while flying.

const EARTH_M_PER_DEG_LAT = 111_320;

export type LatLon = { lat: number; lon: number };

export type Projection = {
  origin: LatLon;
  /** lat/lon -> world metres (y=0; height comes from the terrain sampler). */
  project(lat: number, lon: number): THREE.Vector3;
  /** world metres -> lat/lon (inverse of {@link project}, ignoring y). */
  unproject(x: number, z: number): LatLon;
  /** Metres per degree of longitude at the origin latitude. */
  readonly lonScale: number;
};

export function makeProjection(origin: LatLon): Projection {
  const lonScale = Math.cos((origin.lat * Math.PI) / 180) * EARTH_M_PER_DEG_LAT;
  return {
    origin,
    lonScale,
    project(lat, lon) {
      return new THREE.Vector3(-(lon - origin.lon) * lonScale, 0, (lat - origin.lat) * EARTH_M_PER_DEG_LAT);
    },
    unproject(x, z) {
      return { lat: origin.lat + z / EARTH_M_PER_DEG_LAT, lon: origin.lon - x / lonScale };
    }
  };
}
