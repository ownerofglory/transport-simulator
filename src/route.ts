import * as THREE from 'three';
import type { SimulatorConfig } from './wasm';
import type { TransportMode } from './domain/transport';

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
  controlPoints: [number, number, number][];
  geoPoints?: [number, number][];
  elevationDatumM?: number;
  surfaceHeightsM?: number[];
  tunnelMask?: boolean[];
  bridgeMask?: boolean[];
  tunnelRanges?: { startM: number; endM: number }[];
};

export type GtfsRouteFeed = {
  generatedAt: string;
  sourceUrl: string;
  license: string;
  attribution: string;
  routes: DemoRoute[];
};

export const routePackages: DemoRoute[] = [
  {
    id: 'u-demo-central',
    line: 'U-Demo',
    destination: 'Charlottenplatz',
    description: 'Central tunnel-to-surface sample with dense stations and ad inventory.',
    freeRideLabel: 'Intro ride',
    speedLimitMps: 16.6,
    routeLengthM: 2200,
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
    speedLimitMps: 19.4,
    routeLengthM: 3000,
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
    speedLimitMps: 15.2,
    routeLengthM: 1800,
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

export const demoRoute = routePackages[0];

export async function loadRoutePackages(): Promise<{ routes: DemoRoute[]; attribution: string }> {
  try {
    const response = await fetch('/data/vvs-stadtbahn-routes.json');
    if (!response.ok) throw new Error(`GTFS route package request failed: ${response.status}`);
    const feed = (await response.json()) as GtfsRouteFeed;
    if (!Array.isArray(feed.routes) || feed.routes.length === 0) {
      throw new Error('GTFS route package did not include routes.');
    }
    return { routes: feed.routes, attribution: feed.attribution };
  } catch (error) {
    console.warn('Falling back to demo route packages.', error);
    return {
      routes: routePackages,
      attribution: 'Demo route fallback. Real VVS GTFS route package could not be loaded.'
    };
  }
}

export function createRouteCurve(route: DemoRoute): THREE.CatmullRomCurve3 {
  let points = route.controlPoints.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  // GTFS shapes contain survey/GPS jitter which becomes visible as sharp rail kinks.
  // A short weighted filter preserves the alignment while giving the renderer a
  // centerline suitable for long articulated vehicles.
  for (let pass = 0; pass < 2; pass++) {
    points = points.map((point, index, source) => {
      if (index === 0 || index === source.length - 1) return point.clone();
      return source[index - 1].clone()
        .multiplyScalar(0.2)
        .add(point.clone().multiplyScalar(0.6))
        .add(source[index + 1].clone().multiplyScalar(0.2));
    });
  }
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  curve.arcLengthDivisions = Math.max(1200, points.length * 12);
  curve.updateArcLengths();
  return curve;
}

export function distanceToT(distanceM: number, routeLengthM: number): number {
  return THREE.MathUtils.clamp(distanceM / routeLengthM, 0, 1);
}
