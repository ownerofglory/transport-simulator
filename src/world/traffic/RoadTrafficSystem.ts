import * as THREE from 'three';
import { buildPathGeometry, lerpAt, pickHeightAnchors, poseAtDistance, type PathGeometry } from './trafficPath';
import { flatDistanceM, randomGeoPointNear, type LatLon } from './trafficGeo';
import { fetchRoadRoute } from './roadRoutingClient';
import { animateTrafficRig, pickWeightedKind, setTrafficLampsOn, type TrafficKind, type TrafficKindSpec, type TrafficRig } from './trafficVehicleKinds';

export type RoadTrafficContext = {
  /** Same projection TransitWorld builds every other layer against. */
  projectGeo(lat: number, lon: number): { x: number; z: number };
  /** Raw terrain height (world y) at a lat/lon; resolves to 0 where no elevation datum exists. */
  terrainHeightAt(lat: number, lon: number): Promise<number>;
};

// PoC-scale defaults: enough traffic to read as "streets are alive" without
// leaning on the shared personal routing server. Keep these small and local —
// the whole point of a radius-gated system is that they never need to grow
// with route length.
const TARGET_VEHICLE_COUNT = 28;
const ACTIVE_RADIUS_M = 1200; // vehicles beyond this from the player despawn
const SPAWN_RADIUS_M = 900; // random origin/destination are sampled within this
const MIN_TRIP_SEPARATION_M = 250; // avoid degenerate near-zero-length trips
const MAX_CONCURRENT_REQUESTS = 3;
const SPAWN_ATTEMPT_INTERVAL_S = 1.2;
const HEIGHT_SAMPLE_SPACING_M = 120; // terrain is sampled sparsely and lerped, not per vertex
const HEIGHT_SAMPLE_MAX = 24; // caps terrain fetches per spawned route

type TrafficVehicle = {
  spec: TrafficKindSpec;
  rig: TrafficRig;
  path: PathGeometry;
  heightAnchorAtM: Float64Array;
  heightAnchorM: Float64Array;
  distanceM: number;
  speedMps: number;
};

/**
 * Ambient background road traffic (cars/trucks/cyclists) around the player.
 * Each vehicle gets one route from the external routing server for its whole
 * trip, then just walks that polyline by distance — no live re-routing, no
 * inter-vehicle interaction. Vehicles outside {@link ACTIVE_RADIUS_M} of the
 * player, or that finish their trip, despawn and free a slot for a fresh one.
 */
export class RoadTrafficSystem {
  readonly root = new THREE.Group();
  private readonly active: TrafficVehicle[] = [];
  private readonly pools = new Map<TrafficKind, TrafficRig[]>();
  private readonly abortControllers = new Set<AbortController>();
  private pendingRequests = 0;
  private spawnCooldownS = 0;
  private disposed = false;
  private readonly centerWorld = new THREE.Vector2(0, 0);

  constructor(private readonly ctx: RoadTrafficContext) {
    this.root.name = 'Road traffic';
  }

  /** Advances every vehicle and (rate-limited) tries to keep the population near target. */
  update(centerWorld: THREE.Vector3, centerGeo: LatLon | undefined, dtSec: number): void {
    if (!centerGeo) return;
    this.centerWorld.set(centerWorld.x, centerWorld.z);

    for (let i = this.active.length - 1; i >= 0; i--) {
      const vehicle = this.active[i];
      vehicle.distanceM += vehicle.speedMps * dtSec;
      const pose = poseAtDistance(vehicle.path, vehicle.distanceM);
      const dx = pose.x - this.centerWorld.x;
      const dz = pose.z - this.centerWorld.y;
      const finishedTrip = vehicle.distanceM >= vehicle.path.total;
      const outOfRange = dx * dx + dz * dz > ACTIVE_RADIUS_M * ACTIVE_RADIUS_M;
      if (finishedTrip || outOfRange) {
        this.despawn(i);
        continue;
      }
      const y = lerpAt(vehicle.heightAnchorAtM, vehicle.heightAnchorM, vehicle.distanceM);
      vehicle.rig.root.position.set(pose.x, y, pose.z);
      vehicle.rig.root.rotation.y = pose.headingRad;
      animateTrafficRig(vehicle.rig, vehicle.distanceM);
    }

    this.spawnCooldownS -= dtSec;
    const wantsMore = this.active.length + this.pendingRequests < TARGET_VEHICLE_COUNT;
    if (this.spawnCooldownS <= 0 && wantsMore && this.pendingRequests < MAX_CONCURRENT_REQUESTS) {
      this.spawnCooldownS = SPAWN_ATTEMPT_INTERVAL_S;
      void this.trySpawn(centerGeo);
    }
  }

  /** Hides/shows all traffic at once — the player can't see streets while underground. */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** Head/tail lamps follow the world's daylight factor, like the player's vehicle. */
  setLampsOn(on: boolean): void {
    setTrafficLampsOn(on);
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.abortControllers) controller.abort();
    this.abortControllers.clear();
    this.active.length = 0;
    this.pools.clear();
    this.root.clear();
  }

  private async trySpawn(centerGeo: LatLon): Promise<void> {
    const origin = randomGeoPointNear(centerGeo, SPAWN_RADIUS_M);
    let destination = randomGeoPointNear(centerGeo, SPAWN_RADIUS_M);
    for (let attempt = 0; attempt < 4 && flatDistanceM(origin, destination) < MIN_TRIP_SEPARATION_M; attempt++) {
      destination = randomGeoPointNear(centerGeo, SPAWN_RADIUS_M);
    }
    if (flatDistanceM(origin, destination) < MIN_TRIP_SEPARATION_M) return;

    // Chosen before routing, not after: each kind rides its own ORS profile
    // (a truck avoids weight-restricted roads, a cyclist prefers bike paths),
    // so the profile has to be known before the request goes out.
    const spec = pickWeightedKind();
    const controller = new AbortController();
    this.abortControllers.add(controller);
    this.pendingRequests++;
    try {
      const points = await fetchRoadRoute(spec.profile, origin, destination, controller.signal);
      if (this.disposed || !points) return;
      await this.spawnFromRoute(spec, points);
    } finally {
      this.pendingRequests--;
      this.abortControllers.delete(controller);
    }
  }

  private async spawnFromRoute(spec: TrafficKindSpec, points: LatLon[]): Promise<void> {
    const projected = points.map((p) => this.ctx.projectGeo(p.lat, p.lon));
    const path = buildPathGeometry(projected);
    if (path.total < MIN_TRIP_SEPARATION_M) return;

    const anchors = pickHeightAnchors(points, path.cum, HEIGHT_SAMPLE_SPACING_M, HEIGHT_SAMPLE_MAX);
    const heights = await Promise.all(anchors.map((a) => this.ctx.terrainHeightAt(a.point.lat, a.point.lon)));
    if (this.disposed) return;

    const rig = this.acquireRig(spec);
    const speedMps = THREE.MathUtils.lerp(spec.minSpeedMps, spec.maxSpeedMps, Math.random());
    this.root.add(rig.root);
    this.active.push({
      spec,
      rig,
      path,
      heightAnchorAtM: Float64Array.from(anchors.map((a) => a.atM)),
      heightAnchorM: Float64Array.from(heights),
      distanceM: 0,
      speedMps
    });
  }

  private acquireRig(spec: TrafficKindSpec): TrafficRig {
    const pooled = this.pools.get(spec.id)?.pop();
    if (pooled) {
      pooled.root.visible = true;
      return pooled;
    }
    return spec.buildRig();
  }

  private despawn(index: number): void {
    const [vehicle] = this.active.splice(index, 1);
    this.root.remove(vehicle.rig.root);
    let pool = this.pools.get(vehicle.spec.id);
    if (!pool) {
      pool = [];
      this.pools.set(vehicle.spec.id, pool);
    }
    pool.push(vehicle.rig);
  }
}
