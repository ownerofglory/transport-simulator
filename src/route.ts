import * as THREE from 'three';
import type { SimulatorConfig } from './simulator/simulator-types';
import type { TransportMode } from './domain/transport';
import { routeTransportMode } from './domain/transport';

// Runtime route package used by both the renderer and Go/WASM simulator.
export type DemoRoute = SimulatorConfig & {
  id: string;
  transportMode?: TransportMode;
  agency?: string;
  description: string;
  freeRideLabel: string;
  source?: string;
  routeId?: string;
  tripId?: string;
  shapeId?: string;
  color?: string;
  textColor?: string;
  controlPoints: [number, number, number][]; // local Three.js route control points in meters
  geoPoints?: [number, number][]; // source GTFS/geo points as [lat, lon]
  elevationDatumM?: number; // terrain baseline used to normalize DEM heights
  surfaceHeightsM?: number[]; // sampled height profile along the route
  tunnelMask?: boolean[]; // per-shape/segment tunnel classification
  bridgeMask?: boolean[]; // per-shape/segment bridge classification
  tunnelRanges?: { startM: number; endM: number }[]; // route-distance tunnel ranges in meters
};

// Complete route feed generated from GTFS or fallback/demo data.
export type GtfsRouteFeed = {
  generatedAt: string;
  sourceUrl: string;
  license: string;
  attribution: string;
  routes: DemoRoute[];
};

// Lightweight manifest so the app can lazy-load only the selected transport mode.
export type RouteFeedManifest = {
  generatedAt: string;
  sourceUrl: string;
  license: string;
  attribution: string;
  modes: Array<{
    mode: TransportMode;
    file: string;
    routeCount: number;
    lines: string[];
  }>;
};

// Built-in fallback routes used when generated route packages cannot be fetched.
export const routePackages: DemoRoute[] = [
  {
    id: 'u-demo-central',
    line: 'U-Demo',
    destination: 'Charlottenplatz',
    description: 'Central tunnel-to-surface sample with dense stations and ad inventory.',
    freeRideLabel: 'Intro ride',
    speedLimitMps: 16.6, // about 60 km/h demo top speed
    routeLengthM: 2200, // demo route length in meters
    stations: [
      { name: 'Killesberg', distanceM: 0, scheduledS: 0 },
      { name: 'Pragfriedhof', distanceM: 620, scheduledS: 72 },
      { name: 'Hauptbahnhof', distanceM: 1380, scheduledS: 165 },
      { name: 'Charlottenplatz', distanceM: 2200, scheduledS: 270 }
    ],
    controlPoints: [
      [-30, 0, 0],
      [-20, 0, 120],
      [18, 0, 260],
      [8, 0, 440],
      [-36, 0, 610],
      [-8, 0, 780],
      [42, 0, 1000],
      [30, 0, 1260],
      [-22, 0, 1460],
      [-48, 0, 1700],
      [12, 0, 1960],
      [36, 0, 2200]
    ]
  },
  {
    id: 'u6-airport-sample',
    line: 'U6',
    destination: 'Flughafen/Messe',
    description: 'Longer express-flavored sample for timetable and speed-limit testing.',
    freeRideLabel: 'Airport preview',
    speedLimitMps: 19.4, // about 70 km/h demo top speed
    routeLengthM: 3000, // longer demo route length in meters
    stations: [
      { name: 'Hauptbahnhof', distanceM: 0, scheduledS: 0 },
      { name: 'Charlottenplatz', distanceM: 520, scheduledS: 62 },
      { name: 'Bopser', distanceM: 1160, scheduledS: 140 },
      { name: 'Degerloch', distanceM: 2020, scheduledS: 248 },
      { name: 'Flughafen/Messe', distanceM: 3000, scheduledS: 382 }
    ],
    controlPoints: [
      [22, 0, 0],
      [-12, 0, 160],
      [-36, 0, 380],
      [4, 0, 620],
      [46, 0, 910],
      [36, 0, 1210],
      [-18, 0, 1540],
      [-52, 0, 1850],
      [-20, 0, 2160],
      [28, 0, 2460],
      [52, 0, 2740],
      [8, 0, 3000]
    ]
  },
  {
    id: 'u11-event-sample',
    line: 'U11',
    destination: 'NeckarPark',
    description: 'Event-service sample for football and Wasen special editions.',
    freeRideLabel: 'Event ride',
    speedLimitMps: 15.2, // about 55 km/h demo top speed
    routeLengthM: 1800, // short event-service demo route length in meters
    stations: [
      { name: 'Stadtmitte', distanceM: 0, scheduledS: 0 },
      { name: 'Schlossplatz', distanceM: 430, scheduledS: 54 },
      { name: 'Mineralbaeder', distanceM: 980, scheduledS: 126 },
      { name: 'NeckarPark', distanceM: 1800, scheduledS: 238 }
    ],
    controlPoints: [
      [-42, 0, 0],
      [-10, 0, 170],
      [34, 0, 340],
      [44, 0, 560],
      [8, 0, 770],
      [-34, 0, 980],
      [-48, 0, 1240],
      [-8, 0, 1480],
      [38, 0, 1800]
    ]
  }
];

// Default route used before external GTFS-derived route packages are loaded.
export const demoRoute = routePackages[0];

// Sorts bus-like numbered lines ahead of nonstandard labels while keeping natural German ordering.
function routeSortKey(route: DemoRoute): [number, string, string, string] {
  const line = route.line.trim();

  // Plain city bus line numbers, optionally with a one-letter suffix.
  const plainNumeric = /^\d{1,2}[A-Z]?$/i.test(line);

  const stuttgartBusPriority = routeMode(route) === 'bus'
    ? plainNumeric
      ? 0 // normal numeric bus lines first
      : /^\d/.test(line)
        ? 1 // other digit-starting labels next
        : 2 // named/special labels last
    : 0;

  return [stuttgartBusPriority, line, route.destination, route.id];
}

// Returns a sorted copy so callers do not mutate cached route arrays.
function sortRoutes(routes: DemoRoute[]): DemoRoute[] {
  return [...routes].sort((a, b) => {
    const [aPriority, aLine, aDestination, aId] = routeSortKey(a);
    const [bPriority, bLine, bDestination, bId] = routeSortKey(b);

    return aPriority - bPriority ||
      aLine.localeCompare(bLine, 'de', { numeric: true }) ||
      aDestination.localeCompare(bDestination, 'de') ||
      aId.localeCompare(bId, 'de');
  });
}

// Loads the city route manifest, falling back to built-in/demo metadata if unavailable.
export async function loadRouteManifest(
  file: string,
  fallbackManifest: RouteFeedManifest
): Promise<RouteFeedManifest> {
  try {
    const response = await fetch(file);
    if (!response.ok) throw new Error(`Route manifest request failed: ${response.status}`);

    const manifest = (await response.json()) as RouteFeedManifest;
    if (!Array.isArray(manifest.modes) || manifest.modes.length === 0) {
      throw new Error('Route manifest did not include any transport modes.');
    }

    return manifest;
  } catch (error) {
    console.warn('Falling back to demo route manifest.', error);
    return fallbackManifest;
  }
}

// Loads only the selected mode's route feed from the manifest.
export async function loadRoutesForMode(
  mode: TransportMode,
  manifest: RouteFeedManifest,
  fallbackRoutes: DemoRoute[],
  fallbackAttribution: string
): Promise<{ routes: DemoRoute[]; attribution: string }> {
  const matchingFallbackRoutes = sortRoutes(fallbackRoutes.filter((route) => routeMode(route) === mode));
  const descriptor = manifest.modes.find((entry) => entry.mode === mode);

  if (!descriptor) {
    if (matchingFallbackRoutes.length) return { routes: matchingFallbackRoutes, attribution: fallbackAttribution };
    return { routes: [], attribution: manifest.attribution };
  }

  try {
    const response = await fetch(descriptor.file);
    if (!response.ok) throw new Error(`Route feed request failed: ${response.status}`);

    const feed = (await response.json()) as GtfsRouteFeed;
    if (!Array.isArray(feed.routes) || feed.routes.length === 0) {
      throw new Error(`Route feed ${descriptor.file} did not include routes.`);
    }

    return { routes: sortRoutes(feed.routes), attribution: feed.attribution };
  } catch (error) {
    console.warn(`Falling back for ${mode} route feed.`, error);

    return matchingFallbackRoutes.length
      ? { routes: matchingFallbackRoutes, attribution: fallbackAttribution }
      : { routes: [], attribution: manifest.attribution };
  }
}

// Detects when generated local X coordinates need mirroring to match lon direction.
function inferredMirrorX(route: DemoRoute): boolean {
  const firstControl = route.controlPoints[0];
  const lastControl = route.controlPoints.at(-1);
  const firstGeo = route.geoPoints?.[0];
  const lastGeo = route.geoPoints?.at(-1);

  if (!firstControl || !lastControl || !firstGeo || !lastGeo) return false;

  const controlDx = lastControl[0] - firstControl[0];
  const geoDx = lastGeo[1] - firstGeo[1];

  // Ignore nearly vertical/noisy deltas that would make the sign check unstable.
  if (Math.abs(controlDx) < 1e-6 || Math.abs(geoDx) < 1e-9) return false;

  return Math.sign(controlDx) === Math.sign(geoDx);
}

// Builds the smoothed Three.js curve used by vehicles, tracks, stations, and route geometry.
export function createRouteCurve(route: DemoRoute, options?: { mirrorX?: boolean }): THREE.CatmullRomCurve3 {
  const mirrorX = (options?.mirrorX ?? inferredMirrorX(route)) ? -1 : 1;
  let points = route.controlPoints.map(([x, y, z]) => new THREE.Vector3(x * mirrorX, y, z));

  // Two light smoothing passes reduce jagged GTFS-derived XZ shapes without changing endpoints.
  // Y is excluded: elevation is already correctly set by terrain enrichment and must match surfaceHeightsM.
  for (let pass = 0; pass < 2; pass++) {
    points = points.map((point, index, source) => {
      if (index === 0 || index === source.length - 1) return point.clone();
      const blendedX = source[index - 1].x * 0.2 + point.x * 0.6 + source[index + 1].x * 0.2;
      const blendedZ = source[index - 1].z * 0.2 + point.z * 0.6 + source[index + 1].z * 0.2;
      return new THREE.Vector3(blendedX, point.y, blendedZ);
    });
  }

  // Centripetal curves reduce loops/overshoot on tight route bends.
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');

  // Minimum 1200 divisions keeps distance mapping smooth on short routes; 12 per point scales with long routes.
  curve.arcLengthDivisions = Math.max(1200, points.length * 12);
  curve.updateArcLengths();

  return curve;
}

// Converts route distance in meters to normalized curve progress.
export function distanceToT(distanceM: number, routeLengthM: number): number {
  return THREE.MathUtils.clamp(distanceM / routeLengthM, 0, 1);
}

// Normalizes missing/legacy route transport modes through the domain helper.
export function routeMode(route: DemoRoute): TransportMode {
  return routeTransportMode(route.transportMode);
}
