import type { DemoRoute, GtfsRouteFeed } from '../../route';
import { haversineM } from './interpolation';
import type { TrackedVehicle } from './LiveVehicleStore';

type TunnelRoute = Pick<DemoRoute, 'id' | 'line' | 'routeId' | 'shapeId' | 'geoPoints' | 'tunnelMask'>;

type CachedMatch = {
  lat: number;
  lon: number;
  checkedAt: number;
  route: TunnelRoute | null;
  routePointIndex: number;
  inTunnel: boolean;
};

type RouteHit = { route: TunnelRoute; pointIndex: number; distanceM: number };

// Once a run is matched to an alignment we keep it: rematching every refresh lets
// the "closest" route flip between parallel/overlapping tracks (shared central
// tunnels, terminals, crossings), which teleports a followed vehicle across the
// map. We only re-evaluate when the shapeId changes, or the run has stayed farther
// than this from its locked route for several consecutive checks.
const ROUTE_LOCK_M = 80;
const ROUTE_UNLOCK_MISSES = 3;
const MATCH_CACHE_MS = 1000;
const MATCH_CACHE_MOVE_M = 45;
const LOCAL_SEARCH_POINTS = 96;

type RouteLock = { route: TunnelRoute; shapeId?: string; consecutiveFar: number };

const RAIL_FILES = {
  'light-rail': '/data/routes-stadtbahn.json',
  tram: '/data/routes-stadtbahn.json',
  's-bahn': '/data/routes-s-bahn.json',
  rail: '/data/routes-s-bahn.json'
} as const;

/**
 * Lazily resolves live rail vehicles against the already-generated GTFS route
 * packages. It deliberately loads only the small rail feeds that are needed for
 * a visible vehicle; buses have no tunnel treatment in the Live view.
 */
export class LiveTunnelIndex {
  private readonly routes: TunnelRoute[] = [];
  private readonly routesByShapeId = new Map<string, TunnelRoute[]>();
  private readonly routesByRouteId = new Map<string, TunnelRoute[]>();
  private readonly routesByLine = new Map<string, TunnelRoute[]>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly matches = new Map<string, CachedMatch>();
  private readonly locks = new Map<string, RouteLock>();
  private revision = 0;

  get version(): number {
    return this.revision;
  }

  isInTunnel(vehicle: TrackedVehicle): boolean {
    const file = RAIL_FILES[vehicle.data.mode as keyof typeof RAIL_FILES];
    if (!file) return false;
    void this.ensure(file);

    const now = performance.now();
    const cached = this.matches.get(vehicle.runId);
    if (
      cached &&
      now - cached.checkedAt < MATCH_CACHE_MS &&
      haversineM(cached, vehicle.render) < MATCH_CACHE_MOVE_M
    ) {
      return cached.inTunnel;
    }

    const hit = this.matchRoute(vehicle, cached);
    const route = hit?.route ?? null;
    const inTunnel = hit ? this.pointIsInTunnel(hit.route, hit.pointIndex) : false;
    this.matches.set(vehicle.runId, {
      lat: vehicle.render.lat,
      lon: vehicle.render.lon,
      checkedAt: now,
      route,
      routePointIndex: hit?.pointIndex ?? -1,
      inTunnel
    });
    return inTunnel;
  }

  routeFor(vehicle: TrackedVehicle): TunnelRoute | null {
    this.isInTunnel(vehicle); // starts the lazy load and refreshes the cache
    return this.matches.get(vehicle.runId)?.route ?? null;
  }

  private async ensure(file: string): Promise<void> {
    let load = this.loading.get(file);
    if (!load) {
      load = fetch(file)
        .then(async (response) => {
          if (!response.ok) throw new Error(`Route feed request failed: ${response.status}`);
          const feed = (await response.json()) as GtfsRouteFeed;
          // Keep every rail alignment with geometry (not only tunnelled ones): the
          // same index feeds the overground track layer and the tunnel layer.
          for (const route of (feed.routes ?? []).filter((candidate) => candidate.geoPoints?.length)) {
            this.routes.push(route);
            this.addRoute(this.routesByShapeId, route.shapeId, route);
            this.addRoute(this.routesByRouteId, route.routeId, route);
            this.addRoute(this.routesByLine, route.line, route);
          }
          // Runs checked while the lazy request was in flight cached "no route";
          // invalidate those misses so the newly available index is used at once.
          this.matches.clear();
          this.revision++;
        })
        .catch((error) => console.warn('Live 3D: could not load tunnel route data.', error));
      this.loading.set(file, load);
    }
    await load;
  }

  private matchRoute(vehicle: TrackedVehicle, cached?: CachedMatch): RouteHit | null {
    const v = vehicle.data;

    // Keep a previously locked alignment unless the shapeId changed or the run has
    // drifted away from it for several consecutive checks — otherwise the closest
    // route can flip between parallel tracks and fling a followed vehicle away.
    const lock = this.locks.get(vehicle.runId);
    if (lock && lock.shapeId === v.shapeId) {
      const hit = this.nearestPoint(
        lock.route,
        vehicle.render,
        cached?.route === lock.route ? cached.routePointIndex : undefined
      );
      if (hit.distanceM <= ROUTE_LOCK_M) {
        lock.consecutiveFar = 0;
        return hit;
      }
      if (++lock.consecutiveFar < ROUTE_UNLOCK_MISSES) return hit;
    }

    // Cascade shapeId → routeId → line: the live TRIAS feed's shapeIds usually
    // don't match the GTFS route packages, so most vehicles fall through to a
    // line match. The closest-alignment pick below then resolves direction.
    let candidates: TunnelRoute[] = [];
    if (v.shapeId) candidates = this.routesByShapeId.get(v.shapeId) ?? [];
    if (!candidates.length && v.routeId) candidates = this.routesByRouteId.get(v.routeId) ?? [];
    if (!candidates.length && v.line) candidates = this.routesByLine.get(v.line) ?? [];
    if (!candidates.length) {
      this.locks.delete(vehicle.runId);
      return null;
    }

    // A route id/line can have both directions. Pick the alignment closest to
    // the live fix, which also handles feeds whose shapeId is not exposed.
    let best: RouteHit | null = null;
    for (const route of candidates) {
      const hit = this.nearestPoint(route, vehicle.render);
      if (!best || hit.distanceM < best.distanceM) best = hit;
    }
    if (!best) return null;
    this.locks.set(vehicle.runId, { route: best.route, shapeId: v.shapeId, consecutiveFar: 0 });
    return best;
  }

  private pointIsInTunnel(route: TunnelRoute, nearest: number): boolean {
    const mask = route.tunnelMask;
    if (nearest < 0 || !mask?.length) return false;
    return Boolean(mask[nearest] || mask[nearest - 1] || mask[nearest + 1]);
  }

  private nearestPoint(
    route: TunnelRoute,
    point: { lat: number; lon: number },
    hint?: number
  ): RouteHit {
    const points = route.geoPoints ?? [];
    if (!points.length) return { route, pointIndex: -1, distanceM: Number.POSITIVE_INFINITY };

    const scan = (start: number, end: number): RouteHit => {
      let pointIndex = start;
      let distanceM = Number.POSITIVE_INFINITY;
      for (let i = start; i < end; i++) {
        const [lat, lon] = points[i];
        const distance = haversineM({ lat, lon }, point);
        if (distance < distanceM) {
          distanceM = distance;
          pointIndex = i;
        }
      }
      return { route, pointIndex, distanceM };
    };

    if (hint !== undefined && hint >= 0 && points.length > LOCAL_SEARCH_POINTS * 2) {
      const start = Math.max(0, hint - LOCAL_SEARCH_POINTS);
      const end = Math.min(points.length, hint + LOCAL_SEARCH_POINTS + 1);
      const local = scan(start, end);
      // Normal motion stays near the previous shape index. A distant result or
      // one pinned to the local window edge means a jump/rematch and earns one
      // full scan, rather than making every regular refresh scan the whole route.
      if (
        local.distanceM <= ROUTE_LOCK_M * 1.5 &&
        local.pointIndex > start &&
        local.pointIndex < end - 1
      ) {
        return local;
      }
    }
    return scan(0, points.length);
  }

  private addRoute(index: Map<string, TunnelRoute[]>, key: string | undefined, route: TunnelRoute): void {
    if (!key) return;
    const routes = index.get(key);
    if (routes) routes.push(route);
    else index.set(key, [route]);
  }
}
