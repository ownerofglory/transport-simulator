import { RouteRepository, stuttgartCity } from '../../route-repository';
import type { DemoRoute } from '../../route';
import { pointDistance, type GeoPoint } from '../../minimap/route-position';

const EARTH_M_PER_DEG_LAT = 111_320;
const MAX_ENDPOINT_OFFSET_M = 140;
const MAX_SHAPE_OFFSET_M = 65;
const repository = new RouteRepository();

const round = (value: number) => Math.round(value * 100) / 100;

function closestIndex(point: GeoPoint, route: DemoRoute): { index: number; distanceM: number } | null {
  const geo = route.geoPoints;
  if (!geo?.length) return null;
  let index = 0;
  let distanceM = Number.POSITIVE_INFINITY;
  geo.forEach(([lat, lon], candidateIndex) => {
    const distance = pointDistance(point, { lat, lon });
    if (distance < distanceM) {
      index = candidateIndex;
      distanceM = distance;
    }
  });
  return { index, distanceM };
}

function normalizedLine(line: string | undefined): string {
  return (line ?? '').replaceAll(' ', '').toUpperCase();
}

function routeDistance(points: GeoPoint[]): number {
  return points.reduce((total, point, index) => index === 0 ? 0 : total + pointDistance(points[index - 1], point), 0);
}

function maskRanges(mask: boolean[], points: GeoPoint[]): { startM: number; endM: number }[] {
  const distanceAt = [0];
  for (let index = 1; index < points.length; index++) {
    distanceAt.push(distanceAt[index - 1] + pointDistance(points[index - 1], points[index]));
  }
  const ranges: { startM: number; endM: number }[] = [];
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) continue;
    const start = index;
    while (index + 1 < mask.length && mask[index + 1]) index++;
    ranges.push({ startM: round(distanceAt[start]), endM: round(distanceAt[index]) });
  }
  return ranges;
}

type Match = { route: DemoRoute; start: number; end: number; score: number };

/**
 * Finds a single directed catalog trip for a realtime leg. This deliberately
 * never combines nearest samples from separate services: that was the cause of
 * the bumpy profile and false tunnel portals at crossings and parallel tracks.
 */
async function matchCatalogRoute(route: DemoRoute): Promise<Match | null> {
  const geometry = route.geoPoints?.map(([lat, lon]) => ({ lat, lon })) ?? [];
  if (geometry.length < 2 || !route.transportMode) return null;
  try {
    const { routes } = await repository.loadRoutes(stuttgartCity, route.transportMode);
    const sameLine = routes.filter((candidate) => normalizedLine(candidate.line) === normalizedLine(route.line));
    let best: Match | null = null;

    for (const candidate of sameLine) {
      if (!candidate.geoPoints?.length || candidate.elevationDatumM === undefined) continue;
      const start = closestIndex(geometry[0], candidate);
      const end = closestIndex(geometry.at(-1)!, candidate);
      if (!start || !end || start.index >= end.index) continue;
      if (start.distanceM > MAX_ENDPOINT_OFFSET_M || end.distanceM > MAX_ENDPOINT_OFFSET_M) continue;

      // Check a few points across the returned leg, while retaining one ordered
      // catalog slice instead of performing an independent per-point mapping.
      let shapeOffsetM = 0;
      const checks = Math.min(9, geometry.length);
      for (let sample = 0; sample < checks; sample++) {
        const point = geometry[Math.round(sample * (geometry.length - 1) / Math.max(1, checks - 1))];
        shapeOffsetM += closestIndex(point, candidate)?.distanceM ?? Number.POSITIVE_INFINITY;
      }
      shapeOffsetM /= checks;
      if (shapeOffsetM > MAX_SHAPE_OFFSET_M) continue;
      const score = start.distanceM + end.distanceM + shapeOffsetM * 2;
      if (!best || score < best.score) best = { route: candidate, start: start.index, end: end.index, score };
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * Replaces a realtime leg with the matching contiguous enriched catalog shape.
 * The catalog retains its own terrain, tunnel and bridge data, so tunnel
 * rendering follows the selected trip rather than a nearby unrelated line.
 */
export async function enrichRouteFromTerrain(route: DemoRoute): Promise<boolean> {
  const match = await matchCatalogRoute(route);
  if (!match) return false;

  const realtimeLengthM = Math.max(1, route.routeLengthM);
  const source = match.route;
  const selectedGeo = source.geoPoints!.slice(match.start, match.end + 1).map(([lat, lon]) => ({ lat, lon }));
  const datum = source.elevationDatumM!;
  const selectedControl = source.controlPoints.slice(match.start, match.end + 1);
  const selectedSurface = source.surfaceHeightsM?.slice(match.start, match.end + 1) ?? selectedControl.map((point) => point[1]);
  const selectedTunnel = source.tunnelMask?.slice(match.start, match.end + 1) ?? selectedControl.map(() => false);
  const selectedBridge = source.bridgeMask?.slice(match.start, match.end + 1) ?? selectedControl.map(() => false);
  if (selectedGeo.length < 2 || selectedControl.length !== selectedGeo.length) return false;

  // Rebase the catalog slice onto its own geographic origin, matching the
  // projection used by buildRealtimeRoute.
  const origin = selectedGeo[0];
  const longitudeScale = Math.cos(origin.lat * Math.PI / 180) * EARTH_M_PER_DEG_LAT;
  const absoluteTrack = selectedControl.map((point) => datum + point[1]);
  const outputDatum = absoluteTrack[0];
  route.geoPoints = selectedGeo.map((point): [number, number] => [point.lat, point.lon]);
  route.controlPoints = selectedGeo.map((point, index): [number, number, number] => [
    -(point.lon - origin.lon) * longitudeScale,
    round(absoluteTrack[index] - outputDatum),
    (point.lat - origin.lat) * EARTH_M_PER_DEG_LAT
  ]);
  route.elevationDatumM = round(outputDatum);
  route.surfaceHeightsM = selectedSurface.map((height) => round(datum + height - outputDatum));
  route.tunnelMask = selectedTunnel;
  route.bridgeMask = selectedBridge;
  route.tunnelRanges = maskRanges(selectedTunnel, selectedGeo);
  route.routeLengthM = routeDistance(selectedGeo);
  // The selected catalog trip is the same service corridor; retain the journey
  // timetable and its existing stop order, but scale distances to its precise
  // enriched shape length.
  route.stations = route.stations.map((station) => ({
    ...station,
    distanceM: round(station.distanceM / realtimeLengthM * route.routeLengthM)
  }));
  return true;
}
