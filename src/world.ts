import * as THREE from 'three';
import { makeLabelTexture } from './labels';
import type { DemoRoute } from './route';
import type { GuidewayKind, TransportModeDefinition } from './domain/transport';
import type { Season } from './app/types';
import type { CityDefinition } from './cities';
import type { CameraMode } from './world/CameraController';
import { CameraSystem } from './engine/systems/CameraSystem';
import { LightingSystem } from './engine/systems/LightingSystem';
import { PhotoSystem, type CinematicPreset } from './engine/systems/PhotoSystem';

export type { CinematicPreset };
import { ActiveVehicleSystem } from './engine/systems/ActiveVehicleSystem';
import { EnvironmentSystem } from './engine/systems/EnvironmentSystem';
import type { WorldLayerContext } from './world/layers/WorldLayerContext';
import { RouteLayer } from './world/layers/RouteLayer';
import { GuidewayLayer } from './world/layers/GuidewayLayer';
import { StationLayer } from './world/layers/StationLayer';
import { OpposingTrafficLayer } from './world/layers/OpposingTrafficLayer';
import { RoadTrafficSystem } from './world/traffic/RoadTrafficSystem';
import { PedestrianSystem } from './world/traffic/PedestrianSystem';
import { TrackSpreadProfile } from './world/trackSpread';
import { islandSpreadZones } from './world/stations/trackLayout';
type GeoPoint = { lat: number; lon: number };

const EARTH_M_PER_DEG_LAT = 111_320;
const TRACK_GAUGE_M = 2.1;
const TRACK_CENTER_SPACING_M = 4.2;
const ACTIVE_TRACK_OFFSET_M = -TRACK_CENTER_SPACING_M / 2;
const OPPOSITE_TRACK_OFFSET_M = TRACK_CENTER_SPACING_M / 2;
export class TransitWorld {
  readonly scene = new THREE.Scene();
  // Camera + chase/passenger/cab rig, zoom, look, and resize are owned here.
  private readonly cameraSystem = new CameraSystem();
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  readonly curve: THREE.CatmullRomCurve3;
  private readonly stationMarkers: THREE.Object3D[] = [];
  private readonly seasonalObjects = new THREE.Group();
  // Oncoming services rendered on the opposite track lane.
  private opposingLayer: OpposingTrafficLayer | null = null;
  // Ambient background road traffic (cars/trucks/cyclists) near the player.
  private roadTraffic: RoadTrafficSystem | null = null;
  // Station-aware pedestrian traffic near upcoming/just-departed stops.
  private pedestrians: PedestrianSystem | null = null;
  // The active vehicle (placement, doors, interior display, visibility, lamps).
  private activeVehicle!: ActiveVehicleSystem;
  // Terrain sampling, curated landmarks, OSM streaming, and scenery visibility.
  private environment!: EnvironmentSystem;
  private readonly routeGeo: GeoPoint[];
  private readonly routeGeoDistancesM: number[];
  // Sun/ambient/hemisphere lighting, time-of-day, season lighting, sky + fog.
  private readonly lightingSystem = new LightingSystem(this.scene, this.renderer);
  // Last pushed vehicle lamp state, so the per-frame check only writes on a flip.
  private vehicleLightsOn: boolean | null = null;
  // Stable reference so the per-frame camera input does not allocate a closure.
  private readonly routePointAtDistanceBound = (distanceM: number, laneOffsetM = 0) =>
    this.routePointAtDistance(distanceM, laneOffsetM);
  // Where the two tracks pull apart for an island platform. Flat on most
  // routes; every track-following system reads it so they stay together.
  private trackSpread = TrackSpreadProfile.none;
  private currentSeason: Season = 'summer';
  // Cinematic (photo) presentation: enter/exit, preset cycling, camera math.
  private readonly photoSystem = new PhotoSystem();
  // Renderer sizing stays with the world (it owns the renderer); CameraSystem
  // owns the camera aspect side of the resize.
  private readonly onRendererResizeBound = () => this.renderer.setSize(window.innerWidth, window.innerHeight);

  /** The active camera, owned by CameraSystem; exposed for the engine renderer. */
  get camera(): THREE.PerspectiveCamera {
    return this.cameraSystem.camera;
  }

  constructor(
    curve: THREE.CatmullRomCurve3,
    private readonly route: DemoRoute,
    private readonly networkRoutes: DemoRoute[] = [route],
    private readonly city?: CityDefinition,
    private readonly modeDefinition?: TransportModeDefinition
  ) {
    this.curve = curve;
    this.routeGeo = (route.geoPoints ?? []).map(([lat, lon]) => ({ lat, lon }));
    this.routeGeoDistancesM = this.routeGeo.reduce<number[]>((distances, point, index) => {
      if (index === 0) return [0];
      const previous = this.routeGeo[index - 1];
      const lonScale = Math.cos((point.lat * Math.PI) / 180) * EARTH_M_PER_DEG_LAT;
      return [...distances, distances[index - 1] + Math.hypot(
        (point.lat - previous.lat) * EARTH_M_PER_DEG_LAT,
        (point.lon - previous.lon) * lonScale
      )];
    }, []);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setAnimationLoop(null);

    // Terrain sampling, curated landmarks, and OSM streaming/visibility.
    this.environment = new EnvironmentSystem({
      scene: this.scene,
      route: this.route,
      city: this.city,
      guidewayKind: this.guidewayKind,
      routeGeo: this.routeGeo,
      projectGeo: (lat, lon) => this.projectGeo(lat, lon),
      surfaceHeightAt: (t) => this.surfaceHeightAt(t),
      nearestSelectedGeoPoint: (lat, lon, points) => this.nearestSelectedGeoPoint(lat, lon, points)
    });

    // Place the camera near the route start so cities that use a regional
    // coordinate origin (e.g. Bodensee) don't produce a long fly-in over
    // empty terrain before the first frame.
    const startPoint = this.curve.getPointAt(0);
    const startTangent = this.curve.getTangentAt(0).normalize();
    this.cameraSystem.placeAtStart(startPoint, startTangent);
    this.lightingSystem.initialize();

    // Island stops move the running tracks, so the profile has to exist before
    // any track geometry, vehicle placement, or camera anchor is built.
    this.trackSpread = new TrackSpreadProfile(
      islandSpreadZones(
        this.route.stations,
        this.guidewayKind,
        this.oppositeLaneOffsetM,
        this.modeDefinition?.stationStyleId
      )
    );

    // Scene layers build their meshes from shared route geometry; TransitWorld
    // coordinates them and owns the vehicle, scenery streaming, and frame loop.
    const layerContext = this.createLayerContext();
    const routeLayer = new RouteLayer(layerContext);
    const ground = routeLayer.build();
    const guidewayLayer = new GuidewayLayer(layerContext);
    guidewayLayer.build();
    const stationLayer = new StationLayer(layerContext);
    stationLayer.build();
    this.scene.add(routeLayer.root, guidewayLayer.root, stationLayer.root);
    this.activeVehicle = new ActiveVehicleSystem({
      scene: this.scene,
      route: this.route,
      city: this.city,
      modeDefinition: this.modeDefinition,
      activeLaneOffsetM: this.activeLaneOffsetM,
      placeArticulated: (root, cars, distanceM, direction, trackOffsetM) =>
        this.updateArticulatedVehicle(root, cars, distanceM, direction, trackOffsetM)
    });
    this.activeVehicle.setPresentation(this.cameraSystem.currentMode(), this.photoSystem.isActive());
    this.vehicleLightsOn = null; // new vehicle instance: force the lamp state to be pushed.
    this.updateVehicleLighting();
    this.opposingLayer = new OpposingTrafficLayer(layerContext);
    this.opposingLayer.build(this.activeVehicle.root);
    this.scene.add(this.opposingLayer.root);
    this.environment.buildScenery(layerContext, ground, this.geoPointAt(0));
    this.scene.add(this.seasonalObjects);

    // Ferries have no roads; every other mode has real streets nearby, but
    // only when the route carries geo points to project traffic against.
    if (this.guidewayKind !== 'ferry' && this.routeGeo.length >= 2) {
      this.roadTraffic = new RoadTrafficSystem({
        projectGeo: (lat, lon) => this.projectGeo(lat, lon),
        terrainHeightAt: (lat, lon) => this.environment.terrainHeightAt(lat, lon)
      });
      this.scene.add(this.roadTraffic.root);
      // Lamp materials are shared module state, so a world built at night (or
      // after one that was) has to be told the current state once up front —
      // updateVehicleLighting only pushes on a change.
      this.roadTraffic.setLampsOn(this.vehicleLightsOn ?? false);
      this.pedestrians = new PedestrianSystem({
        projectGeo: (lat, lon) => this.projectGeo(lat, lon),
        terrainHeightAt: (lat, lon) => this.environment.terrainHeightAt(lat, lon),
        stationGeoAt: (index) => {
          const station = this.route.stations[index];
          return station ? this.geoPointAt(station.distanceM / this.route.routeLengthM) : undefined;
        }
      });
      this.scene.add(this.pedestrians.root);
    }

    window.addEventListener('resize', this.onRendererResizeBound);
  }

  mount(target: HTMLElement): void {
    target.appendChild(this.renderer.domElement);
  }

  setSeason(season: Season): void {
    this.currentSeason = season;
    this.lightingSystem.setSeason(season);
    // Decorative seasonal props are scene decorations owned by the world.
    this.seasonalObjects.clear();
    if (season === 'autumn') this.addLeaves();
    else if (season === 'winter') this.addSnow();
  }

  setTimeOfDay(hour: number): void {
    this.lightingSystem.setTimeOfDay(hour);
    this.updateVehicleLighting();
  }

  /** Reapplies interior/cab window + shell visibility for the current view. */
  private applyVehiclePresentation(): void {
    this.activeVehicle.setPresentation(this.cameraSystem.currentMode(), this.photoSystem.isActive());
  }

  cycleCamera(): CameraMode {
    this.cameraSystem.cycle();
    this.applyVehiclePresentation();
    return this.cameraSystem.currentMode();
  }

  currentCameraMode(): CameraMode {
    return this.cameraSystem.currentMode();
  }

  setCameraMode(mode: CameraMode): CameraMode {
    this.cameraSystem.setMode(mode);
    this.applyVehiclePresentation();
    return this.cameraSystem.currentMode();
  }

  setInteriorLookInput(leftHeld: boolean, rightHeld: boolean): void {
    this.cameraSystem.setLookInput(leftHeld, rightHeld);
  }

  adjustCameraZoom(delta: number): void {
    this.cameraSystem.adjustZoom(delta);
  }

  toggleCinematicMode(): { active: boolean; label: string } {
    const result = this.photoSystem.toggle();
    this.applyVehiclePresentation();
    return result;
  }

  setCinematicMode(active: boolean): { active: boolean; label: string } {
    const result = this.photoSystem.setActive(active);
    this.applyVehiclePresentation();
    return result;
  }

  cinematicModeActive(): boolean {
    return this.photoSystem.isActive();
  }

  cycleCinematicPreset(): { preset: CinematicPreset; label: string } {
    return this.photoSystem.cyclePreset();
  }

  currentCinematicPreset(): CinematicPreset {
    return this.photoSystem.currentPreset();
  }

  currentCinematicPresetLabel(): string {
    return this.photoSystem.currentLabel();
  }

  updateTrain(distanceM: number, doorsOpen = false, deltaSeconds = 1 / 60, nextStation = ''): void {
    const t = THREE.MathUtils.clamp(distanceM / this.route.routeLengthM, 0, 1);
    const underground = this.stationIsUnderground(t);
    const tangent = this.curve.getTangentAt(t).normalize();
    const normal = this.normalAt(t);
    const position = this.curve.getPointAt(t).add(normal.clone().multiplyScalar(this.activeLaneOffsetM));

    this.environment.updateStreaming(this.geoPointAt(t));
    this.environment.setUnderground(underground);
    this.roadTraffic?.update(position, this.geoPointAt(t), deltaSeconds);
    this.roadTraffic?.setVisible(!underground);
    this.pedestrians?.update(distanceM, this.route.stations, position, deltaSeconds);
    this.pedestrians?.setVisible(!underground);
    this.lightingSystem.updateUnderground(underground, position, tangent, deltaSeconds);
    this.updateVehicleLighting();
    this.activeVehicle.updateDoors(doorsOpen, deltaSeconds);
    this.activeVehicle.updateInteriorDisplay(nextStation, doorsOpen);
    this.activeVehicle.place(distanceM);
    this.opposingLayer?.update(distanceM);
    this.cameraSystem.follow({
      position,
      tangent,
      underground,
      interiorCameraProfile: this.modeDefinition?.interiorCameraProfile ?? 'rail',
      passengerOffsetM: this.modeDefinition?.passengerOffsetM ?? 0,
      trainHalfLengthM: this.activeVehicle.trainHalfLengthM,
      train: this.activeVehicle.root,
      trainCars: this.activeVehicle.cars,
      routeDistanceM: distanceM,
      activeLaneOffsetM: this.activeLaneOffsetM,
      routePointAtDistance: this.routePointAtDistanceBound
    });
    if (this.photoSystem.isActive()) {
      this.photoSystem.updateCamera({
        camera: this.camera,
        distanceM,
        routeLengthM: this.route.routeLengthM,
        trainPosition: position,
        tangent,
        trainHalfLengthM: this.activeVehicle.trainHalfLengthM,
        activeLaneOffsetM: this.activeLaneOffsetM,
        normalAt: (t) => this.normalAt(t),
        nearestStations: (d) => this.nearestStations(d),
        routePointAtDistance: (d, offset) => this.routePointAtDistance(d, offset),
        routeTangentAtDistance: (d) => this.routeTangentAtDistance(d)
      });
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onRendererResizeBound);
    this.cameraSystem.dispose();
    this.lightingSystem.dispose();
    this.photoSystem.dispose();
    this.environment.dispose();
    this.activeVehicle.dispose();
    this.roadTraffic?.dispose();
    this.roadTraffic = null;
    this.pedestrians?.dispose();
    this.pedestrians = null;
    // Free geometries/materials/textures built by the scene layers so switching
    // routes does not leak GPU resources.
    this.disposeSceneGraph();
    this.opposingLayer = null;
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }

  /** Recursively disposes geometries and materials of every mesh in the scene. */
  private disposeSceneGraph(): void {
    this.scene.traverse((object) => {
      const mesh = object as Partial<THREE.Mesh> & { material?: THREE.Material | THREE.Material[] };
      mesh.geometry?.dispose?.();
      const material = mesh.material;
      if (Array.isArray(material)) for (const entry of material) this.disposeMaterial(entry);
      else if (material) this.disposeMaterial(material);
    });
    this.scene.clear();
  }

  private disposeMaterial(material: THREE.Material): void {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    material.dispose();
  }

  private get guidewayKind(): GuidewayKind {
    return this.modeDefinition?.guidewayKind ?? 'stadtbahn';
  }

  private get activeLaneOffsetM(): number {
    if (this.guidewayKind === 'bus') return -1.65;
    if (this.guidewayKind === 'schwebebahn') return -1.45;
    if (this.guidewayKind === 'zacke' || this.guidewayKind === 'seilbahn' || this.guidewayKind === 'ferry') return 0;
    return this.guidewayKind === 's-bahn' ? -2.35 : ACTIVE_TRACK_OFFSET_M;
  }

  private get oppositeLaneOffsetM(): number {
    if (this.guidewayKind === 'bus') return 1.65;
    if (this.guidewayKind === 'schwebebahn') return 1.45;
    if (this.guidewayKind === 'zacke' || this.guidewayKind === 'seilbahn' || this.guidewayKind === 'ferry') return 0;
    return this.guidewayKind === 's-bahn' ? 2.35 : OPPOSITE_TRACK_OFFSET_M;
  }

  private get railGaugeM(): number {
    return this.guidewayKind === 's-bahn' ? 1.435 : TRACK_GAUGE_M;
  }

  /**
   * Switches head/tail lamps and saloon lighting from the effective light level,
   * so they come on in tunnels as well as after dark. Only pushed to the vehicle
   * when the on/off state actually flips — the setter walks every lamp material.
   */
  private updateVehicleLighting(): void {
    const lightsOn = this.lightingSystem.effectiveDaylightFactor() < 0.45;
    if (lightsOn === this.vehicleLightsOn) return;
    this.vehicleLightsOn = lightsOn;
    this.activeVehicle.updateExteriorLights(lightsOn ? 0 : 1);
    this.roadTraffic?.setLampsOn(lightsOn);
  }

  /** True when the route is in tunnel/underground at normalized progress t. */
  private stationIsUnderground(t: number): boolean {
    if (this.guidewayKind === 'bus' || this.guidewayKind === 'ferry') return false;
    if (this.route.tunnelRanges?.length) {
      const distanceM = THREE.MathUtils.clamp(t, 0, 1) * this.route.routeLengthM;
      return this.route.tunnelRanges.some((range) => distanceM >= range.startM && distanceM <= range.endM);
    }
    const mask = this.route.tunnelMask;
    if (!mask?.length) return false;
    const { index, fraction } = this.geoSegmentAt(t);
    return Boolean(mask[Math.min(mask.length - 1, Math.round(index + fraction))]);
  }

  /** Bundles shared route geometry/sampling helpers for the scene layers. */
  private createLayerContext(): WorldLayerContext {
    return {
      curve: this.curve,
      route: this.route,
      guidewayKind: this.guidewayKind,
      stationStyleId: this.modeDefinition?.stationStyleId,
      activeLaneOffsetM: this.activeLaneOffsetM,
      oppositeLaneOffsetM: this.oppositeLaneOffsetM,
      railGaugeM: this.railGaugeM,
      stationMarkers: this.stationMarkers,
      stationIsUnderground: (t) => this.stationIsUnderground(t),
      normalAt: (t) => this.normalAt(t),
      laneOffsetAtT: (t, baseOffsetM) => this.laneOffsetAtT(t, baseOffsetM),
      offsetCurvePoints: (offsetM, segments, heightM) => this.offsetCurvePoints(offsetM, segments, heightM),
      offsetCurvePointsAt: (offsetAt, segments, heightM) => this.offsetCurvePointsAt(offsetAt, segments, heightM),
      surfaceHeightAt: (t) => this.surfaceHeightAt(t),
      makeRouteStrip: (offsetM, widthM, startT, endT, segments, heightM) =>
        this.makeRouteStrip(offsetM, widthM, startT, endT, segments, heightM),
      makeTrackStrip: (offsetM, widthM, segments) => this.makeTrackStrip(offsetM, widthM, segments),
      maskRanges: (mask) => this.maskRanges(mask),
      routeBounds: () => this.routeBounds(),
      routeGeoPoints: () => this.routeGeoPoints(),
      updateArticulatedVehicle: (root, cars, distanceM, direction, trackOffsetM) =>
        this.updateArticulatedVehicle(root, cars, distanceM, direction, trackOffsetM),
      wrapDistance: (distanceM) => this.wrapDistance(distanceM)
    };
  }

  private routePointAtDistance(distanceM: number, laneOffsetM = 0): THREE.Vector3 {
    const t = THREE.MathUtils.clamp(distanceM / this.route.routeLengthM, 0, 1);
    // Lane-aware: the chase camera anchors on this, so it has to swing out with
    // the train where the tracks part for an island platform.
    const offsetM = this.trackSpread.laneOffsetAt(distanceM, laneOffsetM);
    return this.curve.getPointAt(t).add(this.normalAt(t).multiplyScalar(offsetM));
  }

  private routeTangentAtDistance(distanceM: number): THREE.Vector3 {
    const t = THREE.MathUtils.clamp(distanceM / this.route.routeLengthM, 0, 1);
    return this.curve.getTangentAt(t).normalize();
  }

  private nearestStations(distanceM: number): { previous: { distanceM: number } | undefined; next: { distanceM: number } | undefined } {
    let previous: { distanceM: number } | undefined;
    let next: { distanceM: number } | undefined;
    for (const station of this.route.stations) {
      if (station.distanceM <= distanceM) previous = station;
      if (station.distanceM > distanceM) {
        next = station;
        break;
      }
    }
    return { previous, next };
  }

  private nearestSelectedGeoPoint(lat: number, lon: number, points: GeoPoint[]): { distanceM: number; t: number } {
    const lonScale = Math.cos((lat * Math.PI) / 180) * EARTH_M_PER_DEG_LAT;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestRouteDistanceM = 0;
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1];
      const b = points[index];
      const ax = (a.lon - lon) * lonScale;
      const az = (a.lat - lat) * EARTH_M_PER_DEG_LAT;
      const bx = (b.lon - lon) * lonScale;
      const bz = (b.lat - lat) * EARTH_M_PER_DEG_LAT;
      const vx = bx - ax;
      const vz = bz - az;
      const fraction = THREE.MathUtils.clamp(-(ax * vx + az * vz) / (vx * vx + vz * vz || 1), 0, 1);
      const distance = Math.hypot(ax + vx * fraction, az + vz * fraction);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestRouteDistanceM = THREE.MathUtils.lerp(
          this.routeGeoDistancesM[index - 1] ?? 0,
          this.routeGeoDistancesM[index] ?? 0,
          fraction
        );
      }
    }
    const totalDistanceM = this.routeGeoDistancesM.at(-1) ?? 0;
    return {
      distanceM: bestDistance,
      t: totalDistanceM > 0 ? bestRouteDistanceM / totalDistanceM : 0
    };
  }

  private updateArticulatedVehicle(
    root: THREE.Group,
    cars: THREE.Group[],
    distanceM: number,
    direction: 1 | -1,
    trackOffsetM: number
  ): void {
    const centerPose = this.trackPose(distanceM, direction, trackOffsetM);
    root.position.copy(centerPose.position);
    root.quaternion.copy(centerPose.quaternion);
    const inverseRoot = centerPose.quaternion.clone().invert();

    for (const car of cars) {
      const centerOffsetM = Number(car.userData.centerOffsetM ?? 0);
      const pose = this.trackPose(distanceM + centerOffsetM * direction, direction, trackOffsetM);
      car.position.copy(pose.position).sub(centerPose.position).applyQuaternion(inverseRoot);
      car.quaternion.copy(inverseRoot).multiply(pose.quaternion);
    }
  }

  private trackPose(distanceM: number, direction: 1 | -1, trackOffsetM: number): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
    const clampedDistance = THREE.MathUtils.clamp(distanceM, 0, this.route.routeLengthM);
    const t = clampedDistance / this.route.routeLengthM;
    const routeTangent = this.curve.getTangentAt(t).normalize();
    const position = this.curve.getPointAt(t);
    if (distanceM < 0) position.add(routeTangent.clone().multiplyScalar(distanceM));
    if (distanceM > this.route.routeLengthM) {
      position.add(routeTangent.clone().multiplyScalar(distanceM - this.route.routeLengthM));
    }
    const laneOffsetM = this.trackSpread.laneOffsetAt(clampedDistance, trackOffsetM);
    position
      .add(this.normalAt(t).multiplyScalar(laneOffsetM))
      .add(new THREE.Vector3(0, 0.2, 0));

    // Through a spread the lane runs at an angle to the alignment. Without the
    // correction the cars keep pointing straight down the route and crab
    // sideways into the platform as the tracks part.
    if (!this.trackSpread.isFlat) {
      const aheadM = this.trackSpread.laneOffsetAt(clampedDistance + 2, trackOffsetM);
      routeTangent.add(this.normalAt(t).multiplyScalar((aheadM - laneOffsetM) / 2)).normalize();
    }
    const tangent = routeTangent.multiplyScalar(direction);
    // Build a level track frame instead of using the shortest rotation from
    // forward to the tangent. The latter can introduce visible roll whenever
    // a steep route, such as the Zacke, changes both heading and elevation.
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = worldUp.clone().cross(tangent).normalize();
    const up = tangent.clone().cross(right).normalize();
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up, tangent)
    );
    return { position, quaternion };
  }

  private wrapDistance(distanceM: number): number {
    const wrapped = distanceM % this.route.routeLengthM;
    return wrapped < 0 ? wrapped + this.route.routeLengthM : wrapped;
  }

  private addSnow(): void {
    const bounds = this.routeBounds();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let i = 0; i < 260; i++) {
      const snow = new THREE.Mesh(new THREE.SphereGeometry(0.18 + Math.random() * 0.15, 8, 8), mat);
      snow.position.set(
        bounds.min.x + Math.random() * bounds.size.x,
        2 + Math.random() * 70,
        bounds.min.z + Math.random() * bounds.size.z
      );
      this.seasonalObjects.add(snow);
    }
  }

  private addLeaves(): void {
    const bounds = this.routeBounds();
    const mat = new THREE.MeshBasicMaterial({ color: 0xb96b2a, side: THREE.DoubleSide });
    for (let i = 0; i < 160; i++) {
      const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.28), mat);
      leaf.position.set(
        bounds.min.x + Math.random() * bounds.size.x,
        0.06,
        bounds.min.z + Math.random() * bounds.size.z
      );
      leaf.rotation.y = Math.random() * Math.PI;
      this.seasonalObjects.add(leaf);
    }
  }

  private routeBounds(): { min: THREE.Vector3; max: THREE.Vector3; center: THREE.Vector3; size: THREE.Vector3 } {
    const points = this.curve.getSpacedPoints(120);
    const box = new THREE.Box3().setFromPoints(points);
    const padding = new THREE.Vector3(320, 0, 320);
    box.min.sub(padding);
    box.max.add(padding);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    return { min: box.min, max: box.max, center, size };
  }

  private normalAt(t: number): THREE.Vector3 {
    const tangent = this.curve.getTangentAt(t).normalize();
    return new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
  }

  private offsetCurvePoints(offsetM: number, segments: number, heightM: number): THREE.Vector3[] {
    return this.offsetCurvePointsAt(() => offsetM, segments, heightM);
  }

  /** As `offsetCurvePoints`, for offsets that vary along the route (spread tracks). */
  private offsetCurvePointsAt(
    offsetAt: (t: number) => number,
    segments: number,
    heightM: number
  ): THREE.Vector3[] {
    return this.curve.getSpacedPoints(segments).map((p, i, arr) => {
      const t = i / Math.max(arr.length - 1, 1);
      return p.clone().add(this.normalAt(t).multiplyScalar(offsetAt(t))).add(new THREE.Vector3(0, heightM, 0));
    });
  }

  /** A track's lateral offset at route parameter t, including any island spread. */
  private laneOffsetAtT(t: number, baseOffsetM: number): number {
    return this.trackSpread.laneOffsetAt(t * this.route.routeLengthM, baseOffsetM);
  }

  private surfaceHeightAt(t: number): number {
    const heights = this.route.surfaceHeightsM;
    if (!heights?.length) return this.curve.getPointAt(t).y;
    const { index, fraction } = this.geoSegmentAt(t);
    const next = Math.min(index + 1, heights.length - 1);
    return THREE.MathUtils.lerp(heights[index] ?? heights.at(-1) ?? 0, heights[next] ?? heights.at(-1) ?? 0, fraction);
  }

  private makeRouteStrip(
    offsetM: number,
    widthM: number,
    startT: number,
    endT: number,
    segments: number,
    heightM: number
  ): THREE.BufferGeometry {
    return this.makeStrip(() => offsetM, widthM, startT, endT, segments, heightM);
  }

  private makeStrip(
    offsetAt: (t: number) => number,
    widthM: number,
    startT: number,
    endT: number,
    segments: number,
    heightM: number
  ): THREE.BufferGeometry {
    const vertices: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = THREE.MathUtils.lerp(startT, endT, i / segments);
      const center = this.curve.getPointAt(t).add(this.normalAt(t).multiplyScalar(offsetAt(t))).add(new THREE.Vector3(0, heightM, 0));
      const halfWidth = this.normalAt(t).multiplyScalar(widthM / 2);
      const left = center.clone().sub(halfWidth);
      const right = center.clone().add(halfWidth);
      vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
      uvs.push(0, i / segments, 1, i / segments);
      if (i < segments) {
        const base = i * 2;
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  /** Ballast/running-surface strip. Lane-aware, so it follows a spread track. */
  private makeTrackStrip(offsetM: number, widthM: number, segments: number): THREE.BufferGeometry {
    return this.makeStrip((t) => this.laneOffsetAtT(t, offsetM), widthM, 0, 1, segments, 0.035);
  }

  private maskRanges(mask: boolean[]): [number, number][] {
    const ranges: [number, number][] = [];
    for (let index = 0; index < mask.length;) {
      if (!mask[index]) {
        index++;
        continue;
      }
      const start = index;
      while (index + 1 < mask.length && mask[index + 1]) index++;
      ranges.push([start, index]);
      index++;
    }
    return ranges;
  }

  private routeGeoPoints(): GeoPoint[] {
    return this.routeGeo;
  }

  private geoPointAt(t: number): GeoPoint | undefined {
    const points = this.routeGeo;
    if (points.length === 0) return undefined;
    if (points.length === 1) return points[0];
    const { index, fraction } = this.geoSegmentAt(t);
    return {
      lat: THREE.MathUtils.lerp(points[index].lat, points[index + 1].lat, fraction),
      lon: THREE.MathUtils.lerp(points[index].lon, points[index + 1].lon, fraction)
    };
  }

  private geoSegmentAt(t: number): { index: number; fraction: number } {
    if (this.routeGeoDistancesM.length < 2) return { index: 0, fraction: 0 };
    const totalDistanceM = this.routeGeoDistancesM.at(-1) ?? 0;
    const targetDistanceM = THREE.MathUtils.clamp(t, 0, 1) * totalDistanceM;
    let low = 0;
    let high = this.routeGeoDistancesM.length - 1;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.routeGeoDistancesM[middle] <= targetDistanceM) low = middle;
      else high = middle;
    }
    const segmentLengthM = this.routeGeoDistancesM[high] - this.routeGeoDistancesM[low];
    return {
      index: Math.min(low, this.routeGeo.length - 2),
      fraction: segmentLengthM > 0 ? (targetDistanceM - this.routeGeoDistancesM[low]) / segmentLengthM : 0
    };
  }

  private projectGeo(lat: number, lon: number): THREE.Vector3 {
    const origin = this.routeGeoPoints()[0];
    if (!origin) return new THREE.Vector3(0, 0, 0);
    const lonScale = Math.cos((origin.lat * Math.PI) / 180) * EARTH_M_PER_DEG_LAT;
    return new THREE.Vector3(-(lon - origin.lon) * lonScale, 0, (lat - origin.lat) * EARTH_M_PER_DEG_LAT);
  }
}
