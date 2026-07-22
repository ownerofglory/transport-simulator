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
    let candidates = this.routes;
    if (v.shapeId) candidates = candidates.filter((route) => route.shapeId === v.shapeId);
    else if (v.routeId) candidates = candidates.filter((route) => route.routeId === v.routeId);
    else if (v.line) candidates = candidates.filter((route) => route.line === v.line);
    if (!candidates.length) return null;

    // A route id/line can have both directions. Pick the alignment closest to
    // the live fix, which also handles feeds whose shapeId is not exposed.
    return candidates.reduce((closest, route) =>
      this.routeDistanceM(route, vehicle.render) < this.routeDistanceM(closest, vehicle.render) ? route : closest
    );
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
