import * as THREE from 'three';
import {
  buildPathGeometry,
  dampAngle,
  lerpAt,
  pickHeightAnchors,
  poseAtDistance,
  shortestAngleDelta,
  type PathGeometry
} from './trafficPath';
import { flatDistanceM, randomGeoPointNear, type LatLon } from './trafficGeo';
import { fetchRoadRoute } from './roadRoutingClient';
import { animateTrafficRig, pickWeightedKind, setTrafficLampsOn, type TrafficKind, type TrafficKindSpec, type TrafficRig } from './trafficVehicleKinds';
import { trafficDensityScale } from './trafficDensity';
import type { TrafficDensity } from '../../app/types';

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
const RENDER_RADIUS_M = 950; // retain routed actors just outside the visible street scene
const FULL_ANIMATION_RADIUS_M = 280;
const FAR_ANIMATION_INTERVAL = 4;
const SPAWN_RADIUS_M = 900; // random origin/destination are sampled within this
const MIN_TRIP_SEPARATION_M = 250; // avoid degenerate near-zero-length trips
const MAX_CONCURRENT_REQUESTS = 3;
const SPAWN_ATTEMPT_INTERVAL_S = 1.2;
const HEIGHT_SAMPLE_SPACING_M = 120; // terrain is sampled sparsely and lerped, not per vertex
const HEIGHT_SAMPLE_MAX = 24; // caps terrain fetches per spawned route
// Denser settings never route more trips; they put extra vehicles on roads
// already fetched, trailing the traffic that is driving them.
const FOLLOWER_SPAWN_INTERVAL_S = 0.3;
const FOLLOWER_GAP_MIN_M = 18;
const FOLLOWER_GAP_MAX_M = 65;
const ROUTE_REUSE_POOL = 14; // most recent routed trips kept for followers

/** A routed trip, kept after spawning so more vehicles can drive it later. */
type RoutedTrip = {
  path: PathGeometry;
  heightAnchorAtM: Float64Array;
  heightAnchorM: Float64Array;
};

type TrafficVehicle = {
  spec: TrafficKindSpec;
  rig: TrafficRig;
  trip: RoutedTrip;
  /** False for vehicles reusing a trip, which are not counted against the routing budget. */
  routed: boolean;
  distanceM: number;
  speedMps: number;
  cruiseSpeedMps: number;
  headingRad: number;
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
  private readonly recentTrips: RoutedTrip[] = [];
  private pendingRequests = 0;
  private routedCount = 0;
  private spawnCooldownS = 0;
  private followerCooldownS = 0;
  private densityScale = 1;
  private frameIndex = 0;
  private disposed = false;
  private readonly centerWorld = new THREE.Vector2(0, 0);

  constructor(private readonly ctx: RoadTrafficContext) {
    this.root.name = 'Road traffic';
  }

  /** Advances every vehicle and (rate-limited) tries to keep the population near target. */
  update(centerWorld: THREE.Vector3, centerGeo: LatLon | undefined, dtSec: number): void {
    if (!centerGeo) return;
    this.frameIndex++;
    this.centerWorld.set(centerWorld.x, centerWorld.z);
    const stepSec = Math.min(Math.max(dtSec, 0), 0.2);

    for (let i = this.active.length - 1; i >= 0; i--) {
      const vehicle = this.active[i];
      vehicle.distanceM += vehicle.speedMps * stepSec;
      const pose = poseAtDistance(vehicle.trip.path, vehicle.distanceM);
      const dx = pose.x - this.centerWorld.x;
      const dz = pose.z - this.centerWorld.y;
      const finishedTrip = vehicle.distanceM >= vehicle.trip.path.total;
      const outOfRange = dx * dx + dz * dz > ACTIVE_RADIUS_M * ACTIVE_RADIUS_M;
      if (finishedTrip || outOfRange) {
        this.despawn(i);
        continue;
      }

      const distanceSq = dx * dx + dz * dz;
      const visible = distanceSq <= RENDER_RADIUS_M * RENDER_RADIUS_M;
      vehicle.rig.root.visible = visible;

      // Look a little ahead so a car eases into a bend instead of snapping at
      // a polyline vertex. Sharp bends and the end of a route also trim speed.
      const lookAheadM = Math.min(6, Math.max(2, vehicle.speedMps * 0.45));
      const targetHeading = poseAtDistance(vehicle.trip.path, vehicle.distanceM + lookAheadM).headingRad;
      const turnRad = Math.abs(shortestAngleDelta(vehicle.headingRad, targetHeading));
      const turnScale = 1 - Math.min(turnRad / (Math.PI / 2), 1) * 0.38;
      const remainingM = vehicle.trip.path.total - vehicle.distanceM;
      const arrivalScale = THREE.MathUtils.clamp(remainingM / 28, 0.28, 1);
      const targetSpeedMps = vehicle.cruiseSpeedMps * Math.min(turnScale, arrivalScale);
      vehicle.speedMps += (targetSpeedMps - vehicle.speedMps) * (1 - Math.exp(-2.4 * stepSec));
      vehicle.headingRad = dampAngle(vehicle.headingRad, targetHeading, 7.5, stepSec);

      const y = lerpAt(vehicle.trip.heightAnchorAtM, vehicle.trip.heightAnchorM, vehicle.distanceM);
      vehicle.rig.root.position.set(pose.x, y, pose.z);
      vehicle.rig.root.rotation.y = vehicle.headingRad;
      if (visible && (distanceSq <= FULL_ANIMATION_RADIUS_M * FULL_ANIMATION_RADIUS_M || this.frameIndex % FAR_ANIMATION_INTERVAL === 0)) {
        animateTrafficRig(vehicle.rig, vehicle.distanceM);
      }
    }

    // Routing budget: unchanged by density. Only vehicles that own a routed
    // trip count against it, so the server sees the same request rate whether
    // the streets carry 28 vehicles or 84.
    this.spawnCooldownS -= dtSec;
    const wantsRoute = this.routedCount + this.pendingRequests < TARGET_VEHICLE_COUNT;
    if (this.spawnCooldownS <= 0 && wantsRoute && this.pendingRequests < MAX_CONCURRENT_REQUESTS) {
      this.spawnCooldownS = SPAWN_ATTEMPT_INTERVAL_S;
      void this.trySpawn(centerGeo);
    }

    // Everything above the base population rides an already-routed trip. At
    // 'few' the allowance is zero, so the streets look exactly as they did
    // before this setting existed.
    this.followerCooldownS -= dtSec;
    const followerAllowance = Math.round(TARGET_VEHICLE_COUNT * (this.densityScale - 1));
    if (this.followerCooldownS <= 0 && this.active.length - this.routedCount < followerAllowance) {
      this.followerCooldownS = FOLLOWER_SPAWN_INTERVAL_S;
      this.spawnFollower();
    }
  }

  /** Ambient population multiplier. Does not change the routing request rate. */
  setDensity(density: TrafficDensity): void {
    this.densityScale = trafficDensityScale(density);
  }

  /**
   * Puts one more vehicle on a trip that has already been routed, spaced a gap
   * behind whichever vehicle is furthest back on it — a car joining the same
   * road rather than a second request for the same street.
   */
  private spawnFollower(): void {
    const trip = this.recentTrips[Math.floor(Math.random() * this.recentTrips.length)];
    if (!trip) return;

    let trailingM = Infinity;
    for (const vehicle of this.active) {
      if (vehicle.trip === trip && vehicle.distanceM < trailingM) trailingM = vehicle.distanceM;
    }
    const gapM = FOLLOWER_GAP_MIN_M + Math.random() * (FOLLOWER_GAP_MAX_M - FOLLOWER_GAP_MIN_M);
    // Nobody on this trip yet: start it from the top rather than mid-road.
    const distanceM = trailingM === Infinity ? 0 : Math.max(0, trailingM - gapM);
    if (distanceM >= trip.path.total) return;
    this.addVehicle(pickWeightedKind(), trip, distanceM, false);
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
    this.recentTrips.length = 0;
    this.routedCount = 0;
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

    const trip: RoutedTrip = {
      path,
      heightAnchorAtM: Float64Array.from(anchors.map((a) => a.atM)),
      heightAnchorM: Float64Array.from(heights)
    };
    this.recentTrips.push(trip);
    if (this.recentTrips.length > ROUTE_REUSE_POOL) this.recentTrips.shift();
    this.addVehicle(spec, trip, 0, true);
  }

  private addVehicle(spec: TrafficKindSpec, trip: RoutedTrip, distanceM: number, routed: boolean): void {
    const rig = this.acquireRig(spec);
    const cruiseSpeedMps = THREE.MathUtils.lerp(spec.minSpeedMps, spec.maxSpeedMps, Math.random());
    this.root.add(rig.root);
    if (routed) this.routedCount++;
    this.active.push({
      spec,
      rig,
      trip,
      routed,
      distanceM,
      speedMps: cruiseSpeedMps,
      cruiseSpeedMps,
      headingRad: poseAtDistance(trip.path, distanceM).headingRad
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
    if (vehicle.routed) this.routedCount--;
    this.root.remove(vehicle.rig.root);
    let pool = this.pools.get(vehicle.spec.id);
    if (!pool) {
      pool = [];
      this.pools.set(vehicle.spec.id, pool);
    }
    pool.push(vehicle.rig);
  }
}
