import * as THREE from 'three';
import { buildPathGeometry, lerpAt, pickHeightAnchors, poseAtDistance, type PathGeometry } from './trafficPath';
import { flatDistanceM, randomGeoPointNear, type LatLon } from './trafficGeo';
import { fetchWalkingRoute } from './pedestrianRoutingClient';
import { animatePedestrian, buildPedestrian, setPedestrianUmbrella, type PedestrianRig } from './pedestrianMesh';
import { trafficDensityScale } from './trafficDensity';
import type { TrafficDensity } from '../../app/types';
import type { WeatherKind } from '../weather';

export type PedestrianContext = {
  /** Same projection TransitWorld builds every other layer against. */
  projectGeo(lat: number, lon: number): { x: number; z: number };
  /** Raw terrain height (world y) at a lat/lon; resolves to 0 where no elevation datum exists. */
  terrainHeightAt(lat: number, lon: number): Promise<number>;
  /** A station's geo point, derived from where it sits along the route. */
  stationGeoAt(stationIndex: number): LatLon | undefined;
};

export type StationInfo = { distanceM: number };

// A station starts preloading this far before the vehicle reaches it — enough
// lead time for a handful of walking-route requests to land before arrival.
const PRELOAD_AHEAD_M = 350;
// Once the vehicle is this far past a station, stop spawning new pedestrians
// there; existing ones keep walking until they finish or drift out of range.
const DEPART_WIND_DOWN_M = 150;
const ROUTES_PER_STATION = 6; // split evenly between "toward" and "away from" the station
const PED_SPAWN_RADIUS_M = 300; // random destinations sampled within this of the station
const MIN_WALK_SEPARATION_M = 60; // avoid degenerate near-zero-length walks
const INITIAL_PEDS_PER_ROUTE = 2;
const MAX_PEDS_PER_STATION = 14;
const MAX_TOTAL_PEDESTRIANS = 45;
const TRICKLE_INTERVAL_S = 3; // while a station is active, try to add one more walker this often
const MAX_CONCURRENT_REQUESTS = 3;
const ACTIVE_RADIUS_M = 500; // pedestrians beyond this from the vehicle despawn
const RENDER_RADIUS_M = 430;
const FULL_ANIMATION_RADIUS_M = 170;
const FAR_ANIMATION_INTERVAL = 3;
const WALK_MIN_MPS = 1.05;
const WALK_MAX_MPS = 1.65;
const LATERAL_JITTER_M = 0.6; // sidewalk-width spread perpendicular to the route
const WALK_TURN_RADIUS_M = 1.2;
const SPAWN_STAGGER_MAX_S = 15; // initial batch arrives staggered, not all at once
const CACHE_RELEASE_GRACE_S = 20; // idle time after a station empties out before its routes are dropped
const HEIGHT_SAMPLE_SPACING_M = 60;
const HEIGHT_SAMPLE_MAX = 20;

type PedRoute = {
  path: PathGeometry;
  heightAnchorAtM: Float64Array;
  heightAnchorM: Float64Array;
};

type StationPedState = {
  stationIndex: number;
  geo: LatLon;
  routes: PedRoute[];
  loaded: boolean;
  windingDown: boolean;
  emptySinceS: number | null;
  trickleCooldownS: number;
  activeCount: number;
};

type Pedestrian = {
  station: StationPedState;
  route: PedRoute;
  distanceM: number;
  speedMps: number;
  lateralOffsetM: number;
  spawnDelayS: number;
  headingRad: number;
  rig: PedestrianRig;
};

/**
 * Station-aware pedestrian traffic. As the vehicle approaches a station, a
 * small set of walking routes near it are fetched once (both toward and away
 * from the station) and reused by several pedestrians each — no per-pedestrian
 * routing request. As the vehicle moves on, new spawns stop and the routes are
 * dropped once nobody is using them; existing pedestrians simply keep walking
 * until they finish or leave the active radius, so the crowd thins out rather
 * than vanishing at once.
 */
export class PedestrianSystem {
  readonly root = new THREE.Group();
  private readonly active: Pedestrian[] = [];
  private readonly pool: PedestrianRig[] = [];
  private readonly stationStates = new Map<number, StationPedState>();
  private readonly abortControllers = new Set<AbortController>();
  private pendingRequests = 0;
  private disposed = false;
  private simClockS = 0;
  private frameIndex = 0;
  private densityScale = 1;
  private wetWeather = false;
  private readonly centerWorld = new THREE.Vector2(0, 0);

  constructor(private readonly ctx: PedestrianContext) {
    this.root.name = 'Pedestrians';
  }

  setWeather(kind: WeatherKind): void {
    this.wetWeather = kind === 'rain' || kind === 'thunder';
    for (const pedestrian of this.active) setPedestrianUmbrella(pedestrian.rig, this.wetWeather);
  }

  /** Advances every pedestrian and manages which stations are being tracked. */
  update(vehicleDistanceM: number, stations: StationInfo[], centerWorld: THREE.Vector3, dtSec: number): void {
    this.simClockS += dtSec;
    this.frameIndex++;
    this.centerWorld.set(centerWorld.x, centerWorld.z);
    const stepSec = Math.min(Math.max(dtSec, 0), 0.2);

    for (let i = 0; i < stations.length; i++) {
      const aheadM = stations[i].distanceM - vehicleDistanceM;
      const approaching = aheadM >= -DEPART_WIND_DOWN_M && aheadM <= PRELOAD_AHEAD_M;
      const tracked = this.stationStates.get(i);
      if (approaching && !tracked) this.beginTracking(i);
      else if (approaching && tracked) tracked.windingDown = false;
      else if (!approaching && tracked && !tracked.windingDown) {
        tracked.windingDown = true;
        tracked.emptySinceS = null;
      }
    }

    for (let i = this.active.length - 1; i >= 0; i--) {
      const ped = this.active[i];
      if (ped.spawnDelayS > 0) {
        ped.spawnDelayS -= dtSec;
        continue;
      }
      ped.distanceM += ped.speedMps * stepSec;
      const pose = poseAtDistance(ped.route.path, ped.distanceM, WALK_TURN_RADIUS_M);
      const dx = pose.x - this.centerWorld.x;
      const dz = pose.z - this.centerWorld.y;
      const finished = ped.distanceM >= ped.route.path.total;
      const outOfRange = dx * dx + dz * dz > ACTIVE_RADIUS_M * ACTIVE_RADIUS_M;
      if (finished || outOfRange) {
        this.despawn(i);
        continue;
      }
      const distanceSq = dx * dx + dz * dz;
      const visible = distanceSq <= RENDER_RADIUS_M * RENDER_RADIUS_M;
      ped.rig.root.visible = visible;
      ped.headingRad = pose.headingRad;
      this.placePedestrian(
        ped,
        pose,
        visible && (distanceSq <= FULL_ANIMATION_RADIUS_M * FULL_ANIMATION_RADIUS_M || this.frameIndex % FAR_ANIMATION_INTERVAL === 0)
      );
    }

    for (const state of this.stationStates.values()) {
      if (state.windingDown || !state.loaded) continue;
      state.trickleCooldownS -= dtSec;
      if (state.trickleCooldownS <= 0) {
        state.trickleCooldownS = TRICKLE_INTERVAL_S / this.densityScale;
        const route = state.routes[Math.floor(Math.random() * state.routes.length)];
        if (route) this.spawnPedestrian(state, route, false);
      }
    }

    for (const [index, state] of this.stationStates) {
      if (!state.windingDown) continue;
      if (state.activeCount > 0) {
        state.emptySinceS = null;
        continue;
      }
      if (state.emptySinceS === null) state.emptySinceS = this.simClockS;
      else if (this.simClockS - state.emptySinceS > CACHE_RELEASE_GRACE_S) this.stationStates.delete(index);
    }
  }

  /**
   * Ambient population multiplier. `ROUTES_PER_STATION` is deliberately not
   * scaled: a denser crowd walks the routes already fetched for its station, so
   * the walking-route request count is the same at every density.
   */
  setDensity(density: TrafficDensity): void {
    this.densityScale = trafficDensityScale(density);
  }

  /** Hides/shows all pedestrians at once — the player can't see the street while underground. */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.abortControllers) controller.abort();
    this.abortControllers.clear();
    this.active.length = 0;
    this.pool.length = 0;
    this.stationStates.clear();
    this.root.clear();
  }

  private beginTracking(stationIndex: number): void {
    const geo = this.ctx.stationGeoAt(stationIndex);
    if (!geo) return;
    const state: StationPedState = {
      stationIndex,
      geo,
      routes: [],
      loaded: false,
      windingDown: false,
      emptySinceS: null,
      trickleCooldownS: TRICKLE_INTERVAL_S,
      activeCount: 0
    };
    this.stationStates.set(stationIndex, state);
    void this.loadStationRoutes(state);
  }

  private async loadStationRoutes(state: StationPedState): Promise<void> {
    const loads: Promise<void>[] = [];
    for (let i = 0; i < ROUTES_PER_STATION; i++) loads.push(this.loadOneRoute(state, i % 2 === 0));
    await Promise.all(loads);
    if (this.disposed || !this.stationStates.has(state.stationIndex)) return;
    state.loaded = true;
    const perRoute = INITIAL_PEDS_PER_ROUTE * this.densityScale;
    for (const route of state.routes) {
      for (let n = 0; n < perRoute; n++) this.spawnPedestrian(state, route, true);
    }
  }

  private async loadOneRoute(state: StationPedState, towardStation: boolean): Promise<void> {
    const nearby = randomGeoPointNear(state.geo, PED_SPAWN_RADIUS_M);
    if (flatDistanceM(state.geo, nearby) < MIN_WALK_SEPARATION_M) return;
    const origin = towardStation ? nearby : state.geo;
    const destination = towardStation ? state.geo : nearby;

    const controller = new AbortController();
    this.abortControllers.add(controller);
    try {
      const points = await this.runLimited(() => fetchWalkingRoute(origin, destination, controller.signal));
      if (this.disposed || !points) return;
      const projected = points.map((p) => this.ctx.projectGeo(p.lat, p.lon));
      const path = buildPathGeometry(projected);
      if (path.total < MIN_WALK_SEPARATION_M) return;
      const anchors = pickHeightAnchors(points, path.cum, HEIGHT_SAMPLE_SPACING_M, HEIGHT_SAMPLE_MAX);
      const heights = await Promise.all(anchors.map((a) => this.ctx.terrainHeightAt(a.point.lat, a.point.lon)));
      if (this.disposed) return;
      state.routes.push({
        path,
        heightAnchorAtM: Float64Array.from(anchors.map((a) => a.atM)),
        heightAnchorM: Float64Array.from(heights)
      });
    } finally {
      this.abortControllers.delete(controller);
    }
  }

  /** Caps concurrent fetches across every tracked station, not just one. */
  private async runLimited<T>(task: () => Promise<T>): Promise<T> {
    while (this.pendingRequests >= MAX_CONCURRENT_REQUESTS) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this.pendingRequests++;
    try {
      return await task();
    } finally {
      this.pendingRequests--;
    }
  }

  private spawnPedestrian(state: StationPedState, route: PedRoute, staggered: boolean): void {
    if (this.disposed) return;
    if (this.active.length >= MAX_TOTAL_PEDESTRIANS * this.densityScale) return;
    if (state.activeCount >= MAX_PEDS_PER_STATION * this.densityScale) return;

    const spawnDelayS = staggered ? Math.random() * SPAWN_STAGGER_MAX_S : 0;
    const rig = this.acquireRig();
    setPedestrianUmbrella(rig, this.wetWeather);
    this.root.add(rig.root);

    const distanceM = Math.random() * route.path.total * 0.6;
    const ped: Pedestrian = {
      station: state,
      route,
      // Some pedestrians start already mid-walk so a freshly loaded street
      // reads as ongoing activity rather than everyone leaving from the curb.
      distanceM,
      speedMps: THREE.MathUtils.lerp(WALK_MIN_MPS, WALK_MAX_MPS, Math.random()),
      lateralOffsetM: (Math.random() - 0.5) * LATERAL_JITTER_M,
      spawnDelayS,
      headingRad: poseAtDistance(route.path, distanceM, WALK_TURN_RADIUS_M).headingRad,
      rig
    };
    // Placed immediately so a pooled mesh never renders one frame at its old
    // despawn position; still hidden while it waits out a staggered delay.
    this.placePedestrian(ped);
    rig.root.visible = spawnDelayS <= 0;
    this.active.push(ped);
    state.activeCount++;
  }

  private placePedestrian(ped: Pedestrian, pose = poseAtDistance(ped.route.path, ped.distanceM, WALK_TURN_RADIUS_M), animate = true): void {
    const forwardX = Math.sin(pose.headingRad);
    const forwardZ = Math.cos(pose.headingRad);
    const rightX = forwardZ;
    const rightZ = -forwardX;
    const y = lerpAt(ped.route.heightAnchorAtM, ped.route.heightAnchorM, ped.distanceM);
    ped.rig.root.position.set(pose.x + rightX * ped.lateralOffsetM, y, pose.z + rightZ * ped.lateralOffsetM);
    ped.rig.root.rotation.y = ped.headingRad;
    if (animate) animatePedestrian(ped.rig, ped.distanceM);
  }

  private acquireRig(): PedestrianRig {
    const pooled = this.pool.pop();
    if (pooled) return pooled;
    return buildPedestrian();
  }

  private despawn(index: number): void {
    const [ped] = this.active.splice(index, 1);
    this.root.remove(ped.rig.root);
    ped.station.activeCount--;
    this.pool.push(ped.rig);
  }
}
