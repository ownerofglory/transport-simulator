import type { DemoRoute } from '../../route';
import type { GeoPoint } from '../../minimap/route-position';
import { buildRealtimeRoute, legModeToTransportMode, type RealtimeStation } from './buildRealtimeRoute';
import { parseTimeMs } from './time';
import type { EndpointValue } from './LocationField';
import type { Journey } from './types';

// Asserts a wire point has real coordinates while preserving its other fields.
function isCoord<T extends { lat?: number; lon?: number }>(p: T): p is T & GeoPoint {
  return typeof p.lat === 'number' && typeof p.lon === 'number';
}

/** Ground path of a journey: the real per-leg geometry concatenated in order. */
export function journeyGeometry(journey: Journey): GeoPoint[] {
  const points: GeoPoint[] = [];
  for (const leg of journey.legs) {
    for (const g of leg.geometry ?? []) if (isCoord(g)) points.push({ lat: g.lat, lon: g.lon });
  }
  return points;
}

/**
 * Stations along a journey. Prefers the real intermediate stops (with
 * coordinates and times); when the backend omits them, falls back to
 * distributing leg boundaries along the straight origin→destination line by
 * their share of the total travel time.
 */
export function journeyStations(journey: Journey, origin: EndpointValue, destination: EndpointValue): RealtimeStation[] {
  const depMs = parseTimeMs(journey.departureTime);

  const real: RealtimeStation[] = [];
  for (const leg of journey.legs) {
    for (const stop of leg.stops ?? []) {
      if (!isCoord(stop)) continue;
      const tMs = parseTimeMs(stop.departureTime ?? stop.arrivalTime);
      real.push({
        name: stop.name ?? '',
        lat: stop.lat,
        lon: stop.lon,
        scheduledS: depMs !== null && tMs !== null ? Math.max(0, Math.round((tMs - depMs) / 1000)) : 0
      });
    }
  }
  if (real.length >= 2) return real;

  // Fallback: no per-stop data, so place leg boundaries by time fraction.
  const arrMs = parseTimeMs(journey.arrivalTime);
  const total = depMs !== null && arrMs !== null ? Math.max(1, arrMs - depMs) : null;
  const boundaries: { name: string; ms: number | null }[] = [
    { name: journey.legs[0]?.originName ?? origin.name, ms: parseTimeMs(journey.legs[0]?.originTime) ?? depMs }
  ];
  for (const leg of journey.legs) boundaries.push({ name: leg.destinationName ?? destination.name, ms: parseTimeMs(leg.destinationTime) });

  return boundaries.map((b, i) => {
    const fraction = total && depMs !== null && b.ms !== null
      ? Math.min(1, Math.max(0, (b.ms - depMs) / total))
      : i / Math.max(1, boundaries.length - 1);
    return {
      name: b.name,
      lat: origin.lat + (destination.lat - origin.lat) * fraction,
      lon: origin.lon + (destination.lon - origin.lon) * fraction,
      scheduledS: total && depMs !== null && b.ms !== null ? Math.round((b.ms - depMs) / 1000) : Math.round(fraction * 600)
    };
  });
}

/** Polyline to draw for a journey: real geometry when present, else a straight line. */
export function journeyPath(journey: Journey, origin: EndpointValue, destination: EndpointValue): GeoPoint[] {
  const geometry = journeyGeometry(journey);
  return geometry.length >= 2 ? geometry : [{ lat: origin.lat, lon: origin.lon }, { lat: destination.lat, lon: destination.lon }];
}

/** Builds a simulator DemoRoute that follows the journey's real geometry and stops. */
export function buildJourneyRoute(journey: Journey, origin: EndpointValue, destination: EndpointValue): DemoRoute {
  const transit = journey.legs.find((leg) => leg.mode !== 'walk');
  const geometry = journeyGeometry(journey);
  const waypoints = geometry.length >= 2 ? geometry : [{ lat: origin.lat, lon: origin.lon }, { lat: destination.lat, lon: destination.lon }];

  return buildRealtimeRoute({
    id: `rt-journey-${journey.id}`,
    line: transit?.line ?? 'Trip',
    destination: destination.name,
    description: journey.summary ?? `${origin.name} → ${destination.name}`,
    transportMode: legModeToTransportMode(transit?.mode ?? 'stadtbahn'),
    waypoints,
    stations: journeyStations(journey, origin, destination)
  });
}
