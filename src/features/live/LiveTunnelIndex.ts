import type { DemoRoute, GtfsRouteFeed } from '../../route';
import { haversineM } from './interpolation';
import type { TrackedVehicle } from './LiveVehicleStore';

type TunnelRoute = Pick<DemoRoute, 'id' | 'line' | 'routeId' | 'shapeId' | 'geoPoints' | 'tunnelMask'>;

type CachedMatch = {
  lat: number;
  lon: number;
  checkedAt: number;
  route: TunnelRoute | null;
  inTunnel: boolean;
};

// Once a run is matched to an alignment we keep it: rematching every refresh lets
// the "closest" route flip between parallel/overlapping tracks (shared central
// tunnels, terminals, crossings), which teleports a followed vehicle across the
// map. We only re-evaluate when the shapeId changes, or the run has stayed farther
// than this from its locked route for several consecutive checks.
const ROUTE_LOCK_M = 80;
const ROUTE_UNLOCK_MISSES = 3;

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
      now - cached.checkedAt < 500 &&
      haversineM(cached, vehicle.render) < 25
    ) {
      return cached.inTunnel;
    }

    const route = this.matchRoute(vehicle);
    const inTunnel = route ? this.pointIsInTunnel(route, vehicle.render) : false;
    this.matches.set(vehicle.runId, {
      lat: vehicle.render.lat,
      lon: vehicle.render.lon,
      checkedAt: now,
      route,
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
          this.routes.push(...(feed.routes ?? []).filter((route) => route.geoPoints?.length));
          this.revision++;
        })
        .catch((error) => console.warn('Live 3D: could not load tunnel route data.', error));
      this.loading.set(file, load);
    }
    await load;
  }

  private matchRoute(vehicle: TrackedVehicle): TunnelRoute | null {
    const v = vehicle.data;

    // Keep a previously locked alignment unless the shapeId changed or the run has
    // drifted away from it for several consecutive checks — otherwise the closest
    // route can flip between parallel tracks and fling a followed vehicle away.
    const lock = this.locks.get(vehicle.runId);
    if (lock && lock.shapeId === v.shapeId) {
      if (this.routeDistanceM(lock.route, vehicle.render) <= ROUTE_LOCK_M) {
        lock.consecutiveFar = 0;
        return lock.route;
      }
      if (++lock.consecutiveFar < ROUTE_UNLOCK_MISSES) return lock.route;
    }

    // Cascade shapeId → routeId → line: the live TRIAS feed's shapeIds usually
    // don't match the GTFS route packages, so most vehicles fall through to a
    // line match. The closest-alignment pick below then resolves direction.
    let candidates: TunnelRoute[] = [];
    if (v.shapeId) candidates = this.routes.filter((route) => route.shapeId === v.shapeId);
    if (!candidates.length && v.routeId) candidates = this.routes.filter((route) => route.routeId === v.routeId);
    if (!candidates.length && v.line) candidates = this.routes.filter((route) => route.line === v.line);
    if (!candidates.length) {
      this.locks.delete(vehicle.runId);
      return null;
    }

    // A route id/line can have both directions. Pick the alignment closest to
    // the live fix, which also handles feeds whose shapeId is not exposed.
    const best = candidates.reduce((closest, route) =>
      this.routeDistanceM(route, vehicle.render) < this.routeDistanceM(closest, vehicle.render) ? route : closest
    );
    this.locks.set(vehicle.runId, { route: best, shapeId: v.shapeId, consecutiveFar: 0 });
    return best;
  }

  private pointIsInTunnel(route: TunnelRoute, point: { lat: number; lon: number }): boolean {
    const points = route.geoPoints;
    const mask = route.tunnelMask;
    if (!points?.length || !mask?.length) return false;
    let nearest = 0;
    let distance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length; i++) {
      const d = haversineM({ lat: points[i][0], lon: points[i][1] }, point);
      if (d < distance) {
        distance = d;
        nearest = i;
      }
    }
    return Boolean(mask[nearest] || mask[nearest - 1] || mask[nearest + 1]);
  }

  private routeDistanceM(route: TunnelRoute, point: { lat: number; lon: number }): number {
    const points = route.geoPoints ?? [];
    let nearest = Number.POSITIVE_INFINITY;
    for (const [lat, lon] of points) nearest = Math.min(nearest, haversineM({ lat, lon }, point));
    return nearest;
  }
}
