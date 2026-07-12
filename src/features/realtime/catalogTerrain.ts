import { RouteRepository, stuttgartCity } from '../../route-repository';
import type { DemoRoute } from '../../route';
import { pointDistance, type GeoPoint } from '../../minimap/route-position';

// Catalog routes carrying terrain/tunnel enrichment. Bus (14 MB) is skipped:
// it has no tunnels and its elevation is covered well enough by nearby rail.
const CATALOG_MODES = ['stadtbahn', 's-bahn', 'zacke', 'seilbahn'];
// Realtime modes that ride guideways and so inherit tunnel depth + tunnel flags.
const RAIL_LIKE = new Set(['stadtbahn', 's-bahn', 'zacke', 'seilbahn', 'rail', 'tram']);
// A geoPoint must fall within this distance of a catalog point to borrow its data.
const MATCH_RADIUS_M = 35;
// Spatial-hash cell (~55 m of latitude) used to avoid an O(n·m) nearest search.
const CELL_DEG = 0.0005;

// One catalog point's absolute heights (m) and guideway flags.
type Sample = { lat: number; lon: number; trackM: number; surfaceM: number; tunnel: boolean; bridge: boolean };

const cellKey = (lat: number, lon: number) => `${Math.round(lat / CELL_DEG)}:${Math.round(lon / CELL_DEG)}`;

class TerrainIndex {
  private readonly grid = new Map<string, Sample[]>();

  add(sample: Sample): void {
    const key = cellKey(sample.lat, sample.lon);
    const bucket = this.grid.get(key);
    if (bucket) bucket.push(sample);
    else this.grid.set(key, [sample]);
  }

  get size(): number {
    let n = 0;
    for (const bucket of this.grid.values()) n += bucket.length;
    return n;
  }

  /** Nearest catalog sample within MATCH_RADIUS_M, or null. */
  nearest(point: GeoPoint): Sample | null {
    const cLat = Math.round(point.lat / CELL_DEG);
    const cLon = Math.round(point.lon / CELL_DEG);
    let best: Sample | null = null;
    let bestD = MATCH_RADIUS_M;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.grid.get(`${cLat + dx}:${cLon + dy}`);
        if (!bucket) continue;
        for (const sample of bucket) {
          const d = pointDistance(point, sample);
          if (d < bestD) {
            bestD = d;
            best = sample;
          }
        }
      }
    }
    return best;
  }
}

let indexPromise: Promise<TerrainIndex> | null = null;

// Loads the enriched rail catalog once and hashes every point into a grid.
async function loadIndex(): Promise<TerrainIndex> {
  const repository = new RouteRepository();
  const index = new TerrainIndex();
  for (const mode of CATALOG_MODES) {
    try {
      const { routes } = await repository.loadRoutes(stuttgartCity, mode);
      for (const route of routes) {
        if (route.elevationDatumM === undefined || !route.geoPoints) continue;
        const datum = route.elevationDatumM;
        route.geoPoints.forEach(([lat, lon], k) => {
          const trackRel = route.controlPoints[k]?.[1] ?? 0;
          const surfaceRel = route.surfaceHeightsM?.[k] ?? trackRel;
          index.add({
            lat,
            lon,
            trackM: datum + trackRel,
            surfaceM: datum + surfaceRel,
            tunnel: route.tunnelMask?.[k] ?? false,
            bridge: route.bridgeMask?.[k] ?? false
          });
        });
      }
    } catch {
      // A missing/failed mode feed just contributes no samples.
    }
  }
  return index;
}

function catalogTerrainIndex(): Promise<TerrainIndex> {
  return (indexPromise ??= loadIndex());
}

// Linearly fills null gaps from the nearest known anchors so heights stay continuous.
function fillGaps(values: (number | null)[]): void {
  const known = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  if (known.length === 0) return;
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== null) continue;
    const before = known.filter((k) => k < i).at(-1);
    const after = known.find((k) => k > i);
    if (before === undefined) values[i] = values[after!];
    else if (after === undefined) values[i] = values[before];
    else {
      const t = (i - before) / (after - before);
      values[i] = values[before]! + (values[after]! - values[before]!) * t;
    }
  }
}

// Contiguous true-runs of a per-point mask as route-distance ranges (meters).
function maskRanges(mask: boolean[], geo: GeoPoint[]): { startM: number; endM: number }[] {
  const distances = [0];
  for (let i = 1; i < geo.length; i++) distances.push(distances[i - 1] + pointDistance(geo[i - 1], geo[i]));
  const ranges: { startM: number; endM: number }[] = [];
  for (let i = 0; i < mask.length; ) {
    if (!mask[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i + 1 < mask.length && mask[i + 1]) i++;
    ranges.push({ startM: round(distances[start]), endM: round(distances[i]) });
    i++;
  }
  return ranges;
}

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Enriches a realtime route in place with elevation and tunnel data borrowed
 * from the nearest enriched catalog routes, so a simulated journey rides real
 * terrain and dips into tunnels instead of running flat. Rail-like modes also
 * inherit the tunnel depression and tunnel/bridge masks; other modes only take
 * ground elevation. Returns true when at least part of the route matched.
 */
export async function enrichRouteFromCatalog(route: DemoRoute): Promise<boolean> {
  const geo: GeoPoint[] = (route.geoPoints ?? []).map(([lat, lon]) => ({ lat, lon }));
  if (geo.length < 2) return false;

  const index = await catalogTerrainIndex();
  if (index.size === 0) return false;

  const railLike = RAIL_LIKE.has(route.transportMode ?? '');
  const trackAbs: (number | null)[] = [];
  const surfaceAbs: (number | null)[] = [];
  const tunnelMask: boolean[] = [];
  const bridgeMask: boolean[] = [];
  let matched = 0;

  for (const point of geo) {
    const sample = index.nearest(point);
    if (sample) {
      matched++;
      surfaceAbs.push(sample.surfaceM);
      // Non-rail vehicles ride on the ground; never inherit tunnel depth/flags.
      trackAbs.push(railLike ? sample.trackM : sample.surfaceM);
      tunnelMask.push(railLike && sample.tunnel);
      bridgeMask.push(railLike && sample.bridge);
    } else {
      trackAbs.push(null);
      surfaceAbs.push(null);
      tunnelMask.push(false);
      bridgeMask.push(false);
    }
  }

  // Too little overlap to trust — leave the route flat rather than inventing terrain.
  if (matched < 2) return false;

  fillGaps(trackAbs);
  fillGaps(surfaceAbs);

  const datum = trackAbs[0] ?? 0;
  route.elevationDatumM = round(datum);
  route.surfaceHeightsM = surfaceAbs.map((v) => round((v ?? datum) - datum));
  route.controlPoints = route.controlPoints.map((p, i) => [p[0], round((trackAbs[i] ?? datum) - datum), p[2]]);
  route.tunnelMask = tunnelMask;
  route.bridgeMask = bridgeMask;
  route.tunnelRanges = maskRanges(tunnelMask, geo);
  return true;
}
