import * as THREE from 'three';
import { makeLabelTexture } from './labels';
import type { LandmarkZone } from './landmarks';
import { OsmSceneStreamer } from './osm-scene';
import type { DemoRoute } from './route';
import { TerrainSampler } from './terrain';
import type { GuidewayKind, TransportModeDefinition, VehicleKind } from './domain/transport';
import type { Season } from './app/types';
import type { CityDefinition } from './cities';
import { LightingController } from './world/LightingController';
import { CameraController, type CameraMode } from './world/CameraController';
import { buildTransitVehicle } from './vehicles';
import type { VehicleInstance } from './vehicles/types';
import type { WorldLayerContext } from './world/layers/WorldLayerContext';
import { RouteLayer } from './world/layers/RouteLayer';
import { GuidewayLayer } from './world/layers/GuidewayLayer';
import { StationLayer } from './world/layers/StationLayer';
import { LandmarkLayer } from './world/layers/LandmarkLayer';
import { OpposingTrafficLayer } from './world/layers/OpposingTrafficLayer';
type GeoPoint = { lat: number; lon: number };
export type CinematicPreset =
  | 'platform-fly-by'
  | 'front-tracking-shot'
  | 'side-tracking-shot'
  | 'high-drone-shot'
  | 'cab-approach'
  | 'station-departure';

const EARTH_M_PER_DEG_LAT = 111_320;
const TRACK_GAUGE_M = 2.1;
const TRACK_CENTER_SPACING_M = 4.2;
const ACTIVE_TRACK_OFFSET_M = -TRACK_CENTER_SPACING_M / 2;
const OPPOSITE_TRACK_OFFSET_M = TRACK_CENTER_SPACING_M / 2;
const CINEMATIC_PRESETS: Array<{ id: CinematicPreset; label: string }> = [
  { id: 'platform-fly-by', label: 'Platform fly-by' },
  { id: 'front-tracking-shot', label: 'Front tracking shot' },
  { id: 'side-tracking-shot', label: 'Side tracking shot' },
  { id: 'high-drone-shot', label: 'High drone shot' },
  { id: 'cab-approach', label: 'Cab approach' },
  { id: 'station-departure', label: 'Station departure' }
];
export class TransitWorld {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 5000);
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  private train = new THREE.Group();
  private vehicle: VehicleInstance | null = null;
  readonly curve: THREE.CatmullRomCurve3;
  private readonly stationMarkers: THREE.Object3D[] = [];
  private readonly seasonalObjects = new THREE.Group();
  // Oncoming services rendered on the opposite track lane.
  private opposingLayer: OpposingTrafficLayer | null = null;
  private interiorDisplayCanvas: HTMLCanvasElement | null = null;
  private interiorDisplayTexture: THREE.CanvasTexture | null = null;
  private lastInteriorDisplayKey = '';
  private doorOpenAmount = 0;
  private ground: THREE.Mesh | null = null;
  private readonly routeGeo: GeoPoint[];
  private readonly routeGeoDistancesM: number[];
  private readonly landmarkGroup: THREE.Group;
  private readonly landmarkExclusions: LandmarkZone[];
  private osmScene: OsmSceneStreamer | null = null;
  private terrain: TerrainSampler | null = null;
  private readonly hemi = new THREE.HemisphereLight();
  private readonly sun = new THREE.DirectionalLight();
  private readonly visibilityFill = new THREE.AmbientLight();
  private readonly lighting = new LightingController(this.scene, this.renderer, this.hemi, this.sun, this.visibilityFill);
  private readonly cameraController = new CameraController(this.camera);
  private currentSeason: Season = 'summer';
  private cinematicActive = false;
  private cinematicPresetIndex = 0;
  private readonly onResizeBound = () => this.onResize();

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

    this.scene.background = new THREE.Color(0xaac8df);
    this.scene.fog = new THREE.Fog(0xaac8df, 900, 2800);
    if (route.elevationDatumM !== undefined) this.terrain = new TerrainSampler(route.elevationDatumM);
    const landmarkLayer = this.city?.landmarkFactory?.(
      this.routeGeo,
      (lat, lon) => this.projectGeo(lat, lon),
      (lat, lon) => this.terrain?.sample(lat, lon) ?? Promise.resolve(0)
    );
    this.landmarkGroup = landmarkLayer?.group ?? new THREE.Group();
    this.landmarkExclusions = landmarkLayer?.zones ?? [];
    this.scene.add(this.landmarkGroup);

    // Place the camera near the route start so cities that use a regional
    // coordinate origin (e.g. Bodensee) don't produce a long fly-in over
    // empty terrain before the first frame.
    const startPoint = this.curve.getPointAt(0);
    const startTangent = this.curve.getTangentAt(0).normalize();
    this.camera.position.set(
      startPoint.x - startTangent.x * 60,
      startPoint.y + 16,
      startPoint.z - startTangent.z * 60
    );
    this.lighting.initialize();

    // Scene layers build their meshes from shared route geometry; TransitWorld
    // coordinates them and owns the vehicle, scenery streaming, and frame loop.
    const layerContext = this.createLayerContext();
    this.ground = new RouteLayer(layerContext).build();
    new GuidewayLayer(layerContext).build();
    new StationLayer(layerContext).build();
    this.buildTrain();
    this.opposingLayer = new OpposingTrafficLayer(layerContext);
    this.opposingLayer.build(this.train);
    // Ferry routes are on open water — streaming land buildings from surrounding hills
    // at their real elevation (often 200–300 m above the lake) produces floating boxes.
    const osmEnabled = this.guidewayKind !== 'ferry' && this.routeGeoPoints().length >= 2;
    if (osmEnabled) {
      this.osmScene = new OsmSceneStreamer(
        this.scene,
        (lat, lon) => this.projectGeo(lat, lon),
        (lat, lon) => this.scenerySurfaceHeight(lat, lon),
        this.landmarkExclusions
      );
      this.osmScene.update(this.geoPointAt(0));
    } else if (this.guidewayKind !== 'ferry') {
      new LandmarkLayer(layerContext).build();
    }
    this.scene.add(this.seasonalObjects);

    window.addEventListener('resize', this.onResizeBound);
  }

  mount(target: HTMLElement): void {
    target.appendChild(this.renderer.domElement);
  }

  setSeason(season: Season): void {
    this.currentSeason = season;
    this.seasonalObjects.clear();
    switch (season) {
      case 'spring':
        this.scene.background = new THREE.Color(0xb9d6ed);
        this.scene.fog = new THREE.Fog(0xb9d6ed, 900, 2800);
        break;
      case 'summer':
        this.scene.background = new THREE.Color(0xa7d3ff);
        this.scene.fog = new THREE.Fog(0xa7d3ff, 1100, 3200);
        break;
      case 'autumn':
        this.scene.background = new THREE.Color(0xcab38f);
        this.scene.fog = new THREE.Fog(0xcab38f, 760, 2300);
        this.addLeaves();
        break;
      case 'winter':
        this.scene.background = new THREE.Color(0xd8e5ee);
        this.scene.fog = new THREE.Fog(0xd8e5ee, 620, 1800);
        this.addSnow();
        break;
    }
    this.lighting.setSeason(this.currentSeason);
  }

  setTimeOfDay(hour: number): void {
    this.lighting.setTimeOfDay(hour);
    this.updateVehicleExteriorLights();
  }

  // Head/tail lamps come on in low light (night, dawn, dusk). Opposing trains
  // share the player train's lamp materials via clone(), so they follow along.
  private updateVehicleExteriorLights(): void {
    this.vehicle?.setExteriorLightsOn?.(this.lighting.daylightFactor() < 0.45);
  }

  cycleCamera(): CameraMode {
    this.cameraController.cycle();
    this.updateVehicleGlass();
    return this.cameraController.currentMode();
  }

  currentCameraMode(): CameraMode {
    return this.cameraController.currentMode();
  }

  setCameraMode(mode: CameraMode): CameraMode {
    this.cameraController.setMode(mode);
    this.updateVehicleGlass();
    return this.cameraController.currentMode();
  }

  setInteriorLookInput(leftHeld: boolean, rightHeld: boolean): void {
    this.cameraController.setLookInput(leftHeld, rightHeld);
  }

  adjustCameraZoom(delta: number): void {
    this.cameraController.adjustZoom(delta);
  }

  toggleCinematicMode(): { active: boolean; label: string } {
    return this.setCinematicMode(!this.cinematicActive);
  }

  setCinematicMode(active: boolean): { active: boolean; label: string } {
    this.cinematicActive = active;
    this.updateVehicleGlass();
    return { active: this.cinematicActive, label: this.currentCinematicPresetLabel() };
  }

  cinematicModeActive(): boolean {
    return this.cinematicActive;
  }

  cycleCinematicPreset(): { preset: CinematicPreset; label: string } {
    this.cinematicPresetIndex = (this.cinematicPresetIndex + 1) % CINEMATIC_PRESETS.length;
    return { preset: this.currentCinematicPreset(), label: this.currentCinematicPresetLabel() };
  }

  currentCinematicPreset(): CinematicPreset {
    return CINEMATIC_PRESETS[this.cinematicPresetIndex]?.id ?? 'platform-fly-by';
  }

  currentCinematicPresetLabel(): string {
    return CINEMATIC_PRESETS[this.cinematicPresetIndex]?.label ?? 'Platform fly-by';
  }

  private updateVehicleGlass(): void {
    const glassMaterial = this.vehicle?.glassMaterial;
    if (!glassMaterial) return;
    const mode = this.cameraController.currentMode();
    const interiorView = !this.cinematicActive && (mode === 'passenger' || mode === 'cab');
    const cabView = mode === 'cab';
    glassMaterial.opacity = interiorView ? 0.1 : 0.58;
    glassMaterial.depthWrite = !interiorView;
    glassMaterial.color.setHex(interiorView ? 0xd9f2f8 : 0x91c7dd);
    glassMaterial.needsUpdate = true;
    for (const band of this.vehicle?.windowBands ?? []) band.visible = !interiorView;
    for (const shell of this.vehicle?.cabShells ?? []) shell.visible = !cabView;
    for (const shell of this.vehicle?.passengerShells ?? []) shell.visible = !interiorView;
    for (const display of this.vehicle?.cabDisplays ?? []) display.visible = !cabView;
  }

  updateTrain(distanceM: number, doorsOpen = false, deltaSeconds = 1 / 60, nextStation = ''): void {
    const t = THREE.MathUtils.clamp(distanceM / this.route.routeLengthM, 0, 1);
    const underground = this.stationIsUnderground(t);
    const tangent = this.curve.getTangentAt(t).normalize();
    const normal = this.normalAt(t);
    const position = this.curve.getPointAt(t).add(normal.clone().multiplyScalar(this.activeLaneOffsetM));

    this.osmScene?.update(this.geoPointAt(t));
    if (this.ground) this.ground.visible = !underground;
    if (this.osmScene) this.osmScene.group.visible = !underground;
    this.landmarkGroup.visible = !underground;
    this.updateDoors(doorsOpen, deltaSeconds);
    this.updateInteriorDisplay(nextStation, doorsOpen);
    this.updateArticulatedVehicle(this.train, this.vehicle?.cars ?? [], distanceM, 1, this.activeLaneOffsetM);
    this.opposingLayer?.update(distanceM);
    this.cameraController.update({
      position,
      tangent,
      underground,
      interiorCameraProfile: this.modeDefinition?.interiorCameraProfile ?? 'rail',
      passengerOffsetM: this.modeDefinition?.passengerOffsetM ?? 0,
      trainHalfLengthM: this.vehicle?.trainHalfLengthM ?? 20.15,
      train: this.train,
      trainCars: this.vehicle?.cars ?? []
    });
    if (this.cinematicActive) this.updateCinematicCamera(distanceM, position, tangent);
  }

  private updateDoors(open: boolean, deltaSeconds: number): void {
    this.doorOpenAmount = THREE.MathUtils.damp(
      this.doorOpenAmount,
      open ? 1 : 0,
      open ? 5.2 : 6.5,
      THREE.MathUtils.clamp(deltaSeconds, 0, 0.1)
    );
    const eased = this.doorOpenAmount * this.doorOpenAmount * (3 - 2 * this.doorOpenAmount);
    for (const leaf of this.vehicle?.doors ?? []) {
      leaf.group.position.z = leaf.closedZ + leaf.direction * 0.72 * eased;
    }
  }

  private makeInteriorDisplayMaterial(): THREE.MeshBasicMaterial {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    this.interiorDisplayCanvas = canvas;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    this.interiorDisplayTexture = texture;
    this.updateInteriorDisplay(this.route.stations[1]?.name ?? this.route.destination, false);
    return new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
  }

  private updateInteriorDisplay(nextStation: string, doorsOpen: boolean): void {
    if (!this.interiorDisplayCanvas || !this.interiorDisplayTexture) return;
    const station = nextStation === 'End of line' ? 'Endstation' : nextStation || this.route.destination;
    const key = `${station}/${doorsOpen}`;
    if (key === this.lastInteriorDisplayKey) return;
    this.lastInteriorDisplayKey = key;

    const context = this.interiorDisplayCanvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#071015';
    context.fillRect(0, 0, 1024, 256);
    const accent = this.modeDefinition?.lineAccentColor ?? (this.vehicleKind === 's-bahn' ? '#e0202b' : '#ffd800');
    context.fillStyle = accent;
    context.fillRect(0, 0, 1024, 14);
    context.fillRect(24, 40, 126, 126);
    context.fillStyle = '#11151a';
    context.font = '800 56px Inter, Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(this.route.line, 87, 104);

    context.textAlign = 'left';
    context.fillStyle = '#a9b7bd';
    context.font = '600 30px Inter, Arial, sans-serif';
    context.fillText(doorsOpen ? 'TÜREN GEÖFFNET · DANACH' : 'NÄCHSTER HALT', 184, 62);

    let fontSize = 58;
    do {
      context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
      fontSize -= 2;
    } while (context.measureText(station).width > 806 && fontSize > 30);
    context.fillStyle = '#f5f7f6';
    context.fillText(station, 184, 126);

    context.fillStyle = accent;
    context.font = '500 25px Inter, Arial, sans-serif';
    context.fillText(`Richtung ${this.route.destination}`, 184, 202);
    this.interiorDisplayTexture.needsUpdate = true;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResizeBound);
    this.osmScene?.dispose();
    this.vehicle?.dispose?.();
    // Free geometries/materials/textures built by the scene layers so switching
    // routes does not leak GPU resources.
    this.disposeSceneGraph();
    this.opposingLayer = null;
    this.ground = null;
    this.osmScene = null;
    this.terrain = null;
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

  private get vehicleKind(): VehicleKind {
    return this.modeDefinition?.vehicleKind ?? 'stadtbahn';
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
      scene: this.scene,
      curve: this.curve,
      route: this.route,
      guidewayKind: this.guidewayKind,
      activeLaneOffsetM: this.activeLaneOffsetM,
      oppositeLaneOffsetM: this.oppositeLaneOffsetM,
      railGaugeM: this.railGaugeM,
      stationMarkers: this.stationMarkers,
      stationIsUnderground: (t) => this.stationIsUnderground(t),
      normalAt: (t) => this.normalAt(t),
      offsetCurvePoints: (offsetM, segments, heightM) => this.offsetCurvePoints(offsetM, segments, heightM),
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

  private updateCinematicCamera(distanceM: number, trainPosition: THREE.Vector3, tangent: THREE.Vector3): void {
    const routeT = THREE.MathUtils.clamp(distanceM / this.route.routeLengthM, 0, 1);
    const normal = this.normalAt(routeT);
    const halfLength = this.vehicle?.trainHalfLengthM ?? 20.15;
    const { previous, next } = this.nearestStations(distanceM);
    let cameraPosition = this.camera.position.clone();
    let lookAt = trainPosition.clone().add(new THREE.Vector3(0, 2.5, 0));

    switch (this.currentCinematicPreset()) {
      case 'platform-fly-by': {
        const stationDistanceM = next?.distanceM ?? Math.min(this.route.routeLengthM, distanceM + 120);
        const anchor = this.routePointAtDistance(stationDistanceM, this.activeLaneOffsetM);
        const anchorTangent = this.routeTangentAtDistance(stationDistanceM);
        const anchorNormal = new THREE.Vector3(anchorTangent.z, 0, -anchorTangent.x).normalize();
        cameraPosition = anchor
          .add(anchorNormal.multiplyScalar(12))
          .add(anchorTangent.multiplyScalar(-14))
          .add(new THREE.Vector3(0, 3.2, 0));
        break;
      }
      case 'front-tracking-shot':
        cameraPosition = trainPosition.clone()
          .add(tangent.clone().multiplyScalar(halfLength + 22))
          .add(normal.clone().multiplyScalar(1.8))
          .add(new THREE.Vector3(0, 4.8, 0));
        lookAt = trainPosition.clone().add(tangent.clone().multiplyScalar(halfLength * 0.2)).add(new THREE.Vector3(0, 2.5, 0));
        break;
      case 'side-tracking-shot':
        cameraPosition = trainPosition.clone()
          .add(normal.clone().multiplyScalar(14))
          .add(tangent.clone().multiplyScalar(-3.5))
          .add(new THREE.Vector3(0, 5.4, 0));
        break;
      case 'high-drone-shot':
        cameraPosition = trainPosition.clone()
          .add(normal.clone().multiplyScalar(10))
          .add(tangent.clone().multiplyScalar(-16))
          .add(new THREE.Vector3(0, 52, 0));
        lookAt = trainPosition.clone().add(new THREE.Vector3(0, 3.5, 0));
        break;
      case 'cab-approach':
        cameraPosition = trainPosition.clone()
          .add(tangent.clone().multiplyScalar(halfLength + 34))
          .add(normal.clone().multiplyScalar(0.8))
          .add(new THREE.Vector3(0, 3.4, 0));
        lookAt = trainPosition.clone().add(tangent.clone().multiplyScalar(halfLength * 0.3)).add(new THREE.Vector3(0, 2.6, 0));
        break;
      case 'station-departure': {
        const stationDistanceM = previous?.distanceM ?? Math.max(0, distanceM - 90);
        const anchor = this.routePointAtDistance(stationDistanceM, this.activeLaneOffsetM);
        const anchorTangent = this.routeTangentAtDistance(stationDistanceM);
        const anchorNormal = new THREE.Vector3(anchorTangent.z, 0, -anchorTangent.x).normalize();
        cameraPosition = anchor
          .add(anchorNormal.multiplyScalar(12))
          .add(anchorTangent.multiplyScalar(-26))
          .add(new THREE.Vector3(0, 6.4, 0));
        break;
      }
    }

    this.camera.up.lerp(new THREE.Vector3(0, 1, 0), 0.4).normalize();
    this.camera.position.lerp(cameraPosition, 0.11);
    this.camera.lookAt(lookAt);
  }

  private routePointAtDistance(distanceM: number, laneOffsetM = 0): THREE.Vector3 {
    const t = THREE.MathUtils.clamp(distanceM / this.route.routeLengthM, 0, 1);
    return this.curve.getPointAt(t).add(this.normalAt(t).multiplyScalar(laneOffsetM));
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

  private buildTrain(): void {
    this.vehicle = buildTransitVehicle({
      route: this.route,
      city: this.city,
      modeDefinition: this.modeDefinition,
      makeInteriorDisplayMaterial: () => this.makeInteriorDisplayMaterial()
    });
    this.train = this.vehicle.root;
    this.scene.add(this.vehicle.root);
    this.updateVehicleGlass();
    this.updateVehicleExteriorLights();
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
    position
      .add(this.normalAt(t).multiplyScalar(trackOffsetM))
      .add(new THREE.Vector3(0, 0.2, 0));
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
    return this.curve.getSpacedPoints(segments).map((p, i, arr) => {
      const t = i / Math.max(arr.length - 1, 1);
      return p.clone().add(this.normalAt(t).multiplyScalar(offsetM)).add(new THREE.Vector3(0, heightM, 0));
    });
  }

  private surfaceHeightAt(t: number): number {
    const heights = this.route.surfaceHeightsM;
    if (!heights?.length) return this.curve.getPointAt(t).y;
    const { index, fraction } = this.geoSegmentAt(t);
    const next = Math.min(index + 1, heights.length - 1);
    return THREE.MathUtils.lerp(heights[index] ?? heights.at(-1) ?? 0, heights[next] ?? heights.at(-1) ?? 0, fraction);
  }

  private async scenerySurfaceHeight(lat: number, lon: number): Promise<number> {
    const sampledHeight = await (this.terrain?.sample(lat, lon) ?? Promise.resolve(0));
    if (this.routeGeo.length < 2) return sampledHeight;
    const nearest = this.nearestSelectedGeoPoint(lat, lon, this.routeGeo);
    const innerCorridorM = this.guidewayKind === 's-bahn' ? 28 : this.guidewayKind === 'bus' ? 20 : 12;
    const outerCorridorM = this.guidewayKind === 's-bahn' ? 110 : this.guidewayKind === 'bus' ? 80 : 52;
    if (nearest.distanceM >= outerCorridorM) return sampledHeight;
    const routeSurfaceHeight = this.surfaceHeightAt(nearest.t);
    const blend = THREE.MathUtils.smoothstep(nearest.distanceM, innerCorridorM, outerCorridorM);
    return THREE.MathUtils.lerp(routeSurfaceHeight, sampledHeight, blend);
  }

  private makeRouteStrip(
    offsetM: number,
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
      const center = this.curve.getPointAt(t).add(this.normalAt(t).multiplyScalar(offsetM)).add(new THREE.Vector3(0, heightM, 0));
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

  private makeTrackStrip(offsetM: number, widthM: number, segments: number): THREE.BufferGeometry {
    return this.makeRouteStrip(offsetM, widthM, 0, 1, segments, 0.035);
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

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
