import type { DemoRoute } from '../../route';
import type { TransportMode } from '../../domain/transport';
import { pointDistance, type GeoPoint } from '../../minimap/route-position';
import type { LegMode } from './types';

// Matches TransitWorld.projectGeo so a synthetic route's control points align
// with the OSM scenery it streams from geoPoints.
const EARTH_M_PER_DEG_LAT = 111_320;

// A station placed along the synthetic route with its position on the ground.
export type RealtimeStation = { name: string; lat: number; lon: number; scheduledS: number };

export type RealtimeRouteInput = {
  id: string;
  line: string;
  destination: string;
  description: string;
  transportMode: TransportMode;
  color?: string;
  // Ordered ground waypoints defining the ride path (origin first, destination last).
  waypoints: GeoPoint[];
  // Ordered stops along the path; distances are derived from their positions.
  stations: RealtimeStation[];
  speedLimitMps?: number;
};

// Maps a TRIAS leg mode to a renderable simulator transport mode.
export function legModeToTransportMode(mode: LegMode): TransportMode {
  return mode === 'walk' ? 'stadtbahn' : mode;
}

// Densifies a polyline so short 2-point paths still stream scenery and curve smoothly.
function densify(points: GeoPoint[], maxSegmentM: number): GeoPoint[] {
  if (points.length < 2) return points;
  const out: GeoPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segments = Math.max(1, Math.ceil(pointDistance(a, b) / maxSegmentM));
    for (let s = 1; s <= segments; s++) {
      const t = s / segments;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
    }
  }
  return out;
}

// Cumulative ground distance in meters along a polyline.
function cumulative(points: GeoPoint[]): number[] {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + pointDistance(points[i - 1], points[i]));
  }
  return distances;
}

// Ground distance from the route start to the nearest waypoint of a stop.
function stationDistance(station: GeoPoint, points: GeoPoint[], distances: number[]): number {
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i++) {
    const score = pointDistance(station, points[i]);
    if (score < bestScore) {
      bestScore = score;
      best = distances[i];
    }
  }
  return best;
}

/**
 * Builds a self-contained DemoRoute from live realtime geometry so the existing
 * simulator/world can drive it. Control points use the same projection as
 * TransitWorld.projectGeo, keeping the vehicle aligned with streamed scenery.
 */
export function buildRealtimeRoute(input: RealtimeRouteInput): DemoRoute {
  const waypoints = densify(input.waypoints, input.transportMode === 'bus' ? 90 : 160);
  const distances = cumulative(waypoints);
  const routeLengthM = Math.max(1, distances[distances.length - 1]);

  const origin = waypoints[0];
  const lonScale = Math.cos((origin.lat * Math.PI) / 180) * EARTH_M_PER_DEG_LAT;
  const controlPoints = waypoints.map(
    (p): [number, number, number] => [-(p.lon - origin.lon) * lonScale, 0, (p.lat - origin.lat) * EARTH_M_PER_DEG_LAT]
  );

  // Place stops by nearest waypoint, then keep them monotonic and de-duplicated.
  const stations = input.stations
    .map((s) => ({ name: s.name, distanceM: stationDistance(s, waypoints, distances), scheduledS: s.scheduledS, lat: s.lat, lon: s.lon }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .filter((s, i, arr) => i === 0 || (s.distanceM - arr[i - 1].distanceM > 5 && s.name !== arr[i - 1].name));

  return {
    id: input.id,
    line: input.line,
    destination: input.destination,
    description: input.description,
    transportMode: input.transportMode,
    freeRideLabel: `${input.line} live ride`,
    source: 'VVS/TRIAS realtime',
    color: input.color,
    speedLimitMps: input.speedLimitMps ?? (input.transportMode === 'bus' ? 13.8 : 19.4),
    routeLengthM,
    stations: stations.length >= 2
      ? stations
      : [
          { name: input.stations[0]?.name ?? 'Start', distanceM: 0, scheduledS: 0 },
          { name: input.destination, distanceM: routeLengthM, scheduledS: Math.round(routeLengthM / 12) }
        ],
    controlPoints,
    geoPoints: waypoints.map((p): [number, number] => [p.lat, p.lon])
  };
}
