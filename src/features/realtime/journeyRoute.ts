import type { DemoRoute } from '../../route';
import type { GeoPoint } from '../../minimap/route-position';
import { buildRealtimeRoute, legModeToTransportMode, type RealtimeStation } from './buildRealtimeRoute';
import { parseTimeMs } from './time';
import type { EndpointValue } from './LocationField';
import type { Journey } from './types';

/** Persisted realtime selection used to restore a journey from the URL. */
export type RealtimeJourneySimulation = { origin: EndpointValue; destination: EndpointValue; journey: Journey };

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

/** Stops belonging to one vehicle run, with times relative to that run's departure. */
function transitLegStations(leg: Journey['legs'][number]): RealtimeStation[] {
  const departureMs = parseTimeMs(leg.originTime);
  return (leg.stops ?? []).flatMap((stop) => {
    if (!isCoord(stop)) return [];
    const timeMs = parseTimeMs(stop.departureTime ?? stop.arrivalTime);
    return [{
      name: stop.name ?? '',
      lat: stop.lat,
      lon: stop.lon,
      scheduledS: departureMs !== null && timeMs !== null ? Math.max(0, Math.round((timeMs - departureMs) / 1000)) : 0
    }];
  });
}

/** Builds the individual vehicle runs in a journey; walking legs are not simulated. */
export function buildJourneyRoutes(journey: Journey, origin: EndpointValue, destination: EndpointValue): DemoRoute[] {
  const transitLegs = journey.legs
    .filter((leg) => leg.mode !== 'walk')
    .map((transit, index) => ({ transit, index }));
  const routes = transitLegs.map(({ transit, index }) => {
  const geometry = transit?.geometry?.filter(isCoord).map((point) => ({ lat: point.lat, lon: point.lon })) ?? [];
  const waypoints = geometry.length >= 2 ? geometry : [{ lat: origin.lat, lon: origin.lon }, { lat: destination.lat, lon: destination.lon }];
  // A passenger's requested endpoint can be an address or a transfer stop.
  // Vehicle signs must show the service's advertised direction instead.
  const lineDestination = transit?.destination ?? transit?.destinationName ?? destination.name;

  return buildRealtimeRoute({
    id: `rt-journey-${journey.id}-${transit.id ?? index}`,
    line: transit?.line ?? 'Trip',
    destination: lineDestination,
    description: journey.summary ?? `${origin.name} → ${destination.name}`,
    transportMode: legModeToTransportMode(transit.mode ?? 'stadtbahn'),
    waypoints,
    stations: transitLegStations(transit)
  });
  });
  routes.forEach((route, index) => {
    const current = transitLegs[index].transit;
    const next = transitLegs[index + 1]?.transit;
    const arrival = parseTimeMs(current.destinationTime);
    const departure = next ? parseTimeMs(next.originTime) : null;
    if (arrival !== null && departure !== null) route.transferAfterS = Math.max(0, Math.round((departure - arrival) / 1000));
  });
  return routes;
}

/**
 * Builds a sequential realtime journey. The first route is rendered initially;
 * SimulatorRuntime swaps to the attached later vehicle runs at each transfer.
 */
export function buildJourneyRoute(journey: Journey, origin: EndpointValue, destination: EndpointValue): DemoRoute {
  const legs = buildJourneyRoutes(journey, origin, destination);
  if (legs[0]) {
    legs[0].journeyLegs = legs.slice(1);
    return legs[0];
  }
  return buildRealtimeRoute({
    id: `rt-journey-${journey.id}-walk`,
    line: 'Walk',
    destination: destination.name,
    description: journey.summary ?? `${origin.name} → ${destination.name}`,
    transportMode: 'stadtbahn',
    waypoints: [{ lat: origin.lat, lon: origin.lon }, { lat: destination.lat, lon: destination.lon }],
    stations: []
  });
}
