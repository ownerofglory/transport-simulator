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
  private readonly opposingTrains: { root: THREE.Group; cars: THREE.Group[]; phaseM: number }[] = [];
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
    this.buildGround();
    this.buildTrack();
    this.buildTunnels();
    this.buildStations();
    this.buildTrain();
    this.buildOpposingTraffic();
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
      this.buildCityBlocks();
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
    this.cinematicActive = !this.cinematicActive;
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
    for (const traffic of this.opposingTrains) {
      const opposingDistance = this.guidewayKind === 'seilbahn'
        ? this.route.routeLengthM - distanceM
        : this.wrapDistance(this.route.routeLengthM - distanceM + traffic.phaseM);
      this.updateArticulatedVehicle(traffic.root, traffic.cars, opposingDistance, -1, this.oppositeLaneOffsetM);
    }
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
    this.osmScene = null;
    this.terrain = null;
    this.renderer.domElement.remove();
    this.renderer.dispose();
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

  private buildGround(): void {
    const bounds = this.routeBounds();
    const width = Math.max(900, bounds.size.x + 700);
    const depth = Math.max(900, bounds.size.z + 700);
    const groundGeometry = this.route.surfaceHeightsM?.length
      ? this.makeGroundTerrain(bounds.center, width, depth)
      : new THREE.PlaneGeometry(width, depth);
    const ground = new THREE.Mesh(groundGeometry, new THREE.MeshStandardMaterial({
      color: 0x52764b,
      roughness: 1,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    }));
    if (!this.route.surfaceHeightsM?.length) {
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(bounds.center.x, -0.04, bounds.center.z);
    }
    ground.receiveShadow = true;
    ground.renderOrder = -100;
    ground.name = 'Untextured terrain relief';
    this.ground = ground;
    this.scene.add(ground);

    if (this.routeGeoPoints().length >= 2) return;

    const roadMat = new THREE.MeshStandardMaterial({ color: 0x394047, roughness: 0.9 });
    const roadCount = Math.max(3, Math.min(26, Math.round(this.route.routeLengthM / 850)));
    for (let i = 1; i < roadCount; i++) {
      const t = i / roadCount;
      const p = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      const yaw = Math.atan2(tangent.x, tangent.z);
      const road = new THREE.Mesh(new THREE.PlaneGeometry(520, 22), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.rotation.z = yaw + Math.PI / 2;
      road.position.set(p.x, 0.01, p.z);
      this.scene.add(road);
    }
  }

  private makeGroundTerrain(center: THREE.Vector3, widthM: number, depthM: number): THREE.PlaneGeometry {
    const xSegments = THREE.MathUtils.clamp(Math.ceil(widthM / 140), 40, 140);
    const zSegments = THREE.MathUtils.clamp(Math.ceil(depthM / 140), 40, 140);
    const geometry = new THREE.PlaneGeometry(widthM, depthM, xSegments, zSegments);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(center.x, 0, center.z);

    const routeSamples = Array.from({ length: 321 }, (_, index) => {
      const t = index / 320;
      const point = this.curve.getPointAt(t);
      return { x: point.x, y: point.y, z: point.z, t };
    });
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const x = positions.getX(vertex);
      const z = positions.getZ(vertex);
      let nearestDistanceSq = Number.POSITIVE_INFINITY;
      let nearestY = 0;
      let nearestT = 0;
      for (let index = 1; index < routeSamples.length; index++) {
        const a = routeSamples[index - 1];
        const b = routeSamples[index];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const lengthSq = dx * dx + dz * dz || 1;
        const segmentT = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / lengthSq, 0, 1);
        const closestX = a.x + dx * segmentT;
        const closestZ = a.z + dz * segmentT;
        const distanceSq = (x - closestX) ** 2 + (z - closestZ) ** 2;
        if (distanceSq < nearestDistanceSq) {
          nearestDistanceSq = distanceSq;
          nearestY = THREE.MathUtils.lerp(a.y, b.y, segmentT);
          nearestT = THREE.MathUtils.lerp(a.t, b.t, segmentT);
        }
      }
      // Use the actual curve Y so terrain tracks the spline exactly. For tunnel
      // segments the curve dips underground, so take max with surface height to
      // keep the terrain mesh at ground level above tunnels.
      const surfaceY = this.surfaceHeightAt(nearestT);
      positions.setY(vertex, Math.max(nearestY, surfaceY) - 0.55);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
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

  private buildTrack(): void {
    if (this.guidewayKind === 'bus') {
      this.buildBusRouteStreet();
      return;
    }
    if (this.guidewayKind === 'ferry') {
      this.buildFerryRoutePath();
      return;
    }
    if (this.guidewayKind === 'schwebebahn') {
      this.buildSchwebebahnGuideway();
      return;
    }
    if (this.guidewayKind === 'zacke' || this.guidewayKind === 'seilbahn') {
      this.buildMountainRailwayTrack();
      return;
    }
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x7f858a, metalness: 0.7, roughness: 0.28 });
    const sleeperMaterial = new THREE.MeshStandardMaterial({ color: 0x453429, roughness: 0.85 });
    const ballastMaterial = new THREE.MeshStandardMaterial({ color: 0x6d6a63, roughness: 0.95 });
    const trackSegments = THREE.MathUtils.clamp(Math.ceil(this.route.routeLengthM / 10), 480, 5000);

    for (const trackOffset of [this.activeLaneOffsetM, this.oppositeLaneOffsetM]) {
      const ballast = new THREE.Mesh(this.makeTrackStrip(trackOffset, 4.5, trackSegments), ballastMaterial);
      ballast.receiveShadow = true;
      this.scene.add(ballast);

      for (const railOffset of [-this.railGaugeM / 2, this.railGaugeM / 2]) {
        const points = this.offsetCurvePoints(trackOffset + railOffset, trackSegments, 0.22);
        const railCurve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
        const rail = new THREE.Mesh(new THREE.TubeGeometry(railCurve, trackSegments, 0.08, 8), railMaterial);
        rail.castShadow = true;
        this.scene.add(rail);
      }
    }

    const sleeperGeo = new THREE.BoxGeometry(this.guidewayKind === 's-bahn' ? 2.65 : 3.2, 0.15, 0.55);
    const sleeperCount = THREE.MathUtils.clamp(Math.ceil(this.route.routeLengthM / 8), 240, 4000);
    for (const trackOffset of [this.activeLaneOffsetM, this.oppositeLaneOffsetM]) {
      const sleepers = new THREE.InstancedMesh(sleeperGeo, sleeperMaterial, sleeperCount);
      const matrix = new THREE.Matrix4();
      const rotation = new THREE.Quaternion();
      for (let i = 0; i < sleeperCount; i++) {
        const t = i / Math.max(1, sleeperCount - 1);
        const p = this.curve.getPointAt(t).add(this.normalAt(t).multiplyScalar(trackOffset));
        const tangent = this.curve.getTangentAt(t).normalize();
        const yaw = Math.atan2(tangent.x, tangent.z);
        rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI / 2);
        matrix.compose(p.add(new THREE.Vector3(0, 0.08, 0)), rotation, new THREE.Vector3(1, 1, 1));
        sleepers.setMatrixAt(i, matrix);
      }
      sleepers.instanceMatrix.needsUpdate = true;
      sleepers.receiveShadow = true;
      sleepers.name = 'Curve-aligned sleepers';
      this.scene.add(sleepers);
    }
  }

  private buildMountainRailwayTrack(): void {
    const rail = new THREE.MeshStandardMaterial({ color: 0x858b8e, metalness: 0.72, roughness: 0.3 });
    const sleeper = new THREE.MeshStandardMaterial({ color: 0x493a2d, roughness: 0.9 });
    const rack = new THREE.MeshStandardMaterial({ color: 0x555b5e, metalness: 0.65, roughness: 0.4 });
    const ballast = new THREE.Mesh(this.makeTrackStrip(0, 3.1, 220), new THREE.MeshStandardMaterial({ color: 0x66645f, roughness: 1 }));
    this.scene.add(ballast);
    for (const offset of [-0.5, 0.5]) {
      const line = new THREE.CatmullRomCurve3(this.offsetCurvePoints(offset, 240, 0.22));
      this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(line, 240, 0.07, 7), rail));
    }
    const count = Math.max(80, Math.min(520, Math.floor(this.route.routeLengthM / (this.guidewayKind === 'zacke' ? 1.4 : 2.5))));
    const bars = new THREE.InstancedMesh(
      new THREE.BoxGeometry(this.guidewayKind === 'zacke' ? 1.05 : 2.15, 0.12, 0.22),
      this.guidewayKind === 'zacke' ? rack : sleeper,
      count
    );
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    for (let index = 0; index < count; index++) {
      const t = index / Math.max(1, count - 1);
      const point = this.curve.getPointAt(t).add(new THREE.Vector3(0, 0.13, 0));
      const tangent = this.curve.getTangentAt(t).normalize();
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tangent.x, tangent.z) + Math.PI / 2);
      matrix.compose(point, rotation, new THREE.Vector3(1, 1, 1));
      bars.setMatrixAt(index, matrix);
    }
    bars.name = this.guidewayKind === 'zacke' ? 'Zacke center rack' : 'Seilbahn sleepers';
    bars.instanceMatrix.needsUpdate = true;
    this.scene.add(bars);
    if (this.guidewayKind === 'seilbahn') {
      const cableCurve = new THREE.CatmullRomCurve3(this.offsetCurvePoints(0, 240, 0.34));
      const cable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 240, 0.035, 5), rack);
      cable.name = 'Funicular haul cable';
      this.scene.add(cable);
    }
  }

  private buildSchwebebahnGuideway(): void {
    const steel = new THREE.MeshStandardMaterial({ color: 0x7b858c, roughness: 0.42, metalness: 0.65 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x4c565d, roughness: 0.46, metalness: 0.55 });
    const deck = new THREE.MeshStandardMaterial({ color: 0x9aa1a5, roughness: 0.56, metalness: 0.32 });

    for (const offset of [this.activeLaneOffsetM, this.oppositeLaneOffsetM]) {
      const beam = new THREE.Mesh(this.makeRouteStrip(offset, 0.8, 0, 1, 420, 2.55), steel);
      beam.name = 'Schwebebahn running beam';
      beam.castShadow = true;
      this.scene.add(beam);

      const rail = new THREE.Mesh(this.makeRouteStrip(offset, 0.16, 0, 1, 420, 2.84), darkSteel);
      rail.name = 'Schwebebahn upper guide rail';
      this.scene.add(rail);
    }

    const maintenanceWalkway = new THREE.Mesh(this.makeRouteStrip(0, 4.2, 0, 1, 360, 2.2), deck);
    maintenanceWalkway.name = 'Schwebebahn maintenance deck';
    maintenanceWalkway.receiveShadow = true;
    this.scene.add(maintenanceWalkway);

    const supportCount = THREE.MathUtils.clamp(Math.ceil(this.route.routeLengthM / 18), 32, 1200);
    const columns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 1, 0.38), steel, supportCount * 2);
    const crossheads = new THREE.InstancedMesh(new THREE.BoxGeometry(3.9, 0.28, 0.7), darkSteel, supportCount);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const identity = new THREE.Vector3(1, 1, 1);
    const columnScale = new THREE.Vector3(1, 1, 1);

    for (let index = 0; index < supportCount; index++) {
      const t = index / Math.max(1, supportCount - 1);
      const center = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      const yaw = Math.atan2(tangent.x, tangent.z);
      const groundY = this.surfaceHeightAt(t);
      const columnHeight = Math.max(4.5, center.y - groundY + 2.5);
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

      for (const [columnIndex, offset] of [this.activeLaneOffsetM, this.oppositeLaneOffsetM].entries()) {
        const position = center.clone().add(this.normalAt(t).multiplyScalar(offset));
        position.y = groundY + columnHeight / 2;
        columnScale.set(1, columnHeight, 1);
        matrix.compose(position, rotation, columnScale);
        columns.setMatrixAt(index * 2 + columnIndex, matrix);
      }

      const crossheadPosition = center.clone().add(new THREE.Vector3(0, 2.48, 0));
      matrix.compose(crossheadPosition, rotation, identity);
      crossheads.setMatrixAt(index, matrix);
    }

    columns.instanceMatrix.needsUpdate = true;
    columns.castShadow = true;
    columns.receiveShadow = true;
    columns.name = 'Schwebebahn support columns';
    this.scene.add(columns);

    crossheads.instanceMatrix.needsUpdate = true;
    crossheads.castShadow = true;
    crossheads.receiveShadow = true;
    crossheads.name = 'Schwebebahn support crossheads';
    this.scene.add(crossheads);
  }

  private buildBusRouteStreet(): void {
    const asphaltMaterial = new THREE.MeshStandardMaterial({
      color: 0x50575c,
      roughness: 0.94,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    const sidewalkMaterial = new THREE.MeshStandardMaterial({
      color: 0x989995,
      roughness: 0.98,
      polygonOffset: true,
      polygonOffsetFactor: -1
    });
    const markingMaterial = new THREE.MeshStandardMaterial({
      color: 0xeee5c6,
      roughness: 0.75,
      emissive: 0x342f20,
      emissiveIntensity: 0.18
    });

    const street = new THREE.Mesh(this.makeRouteStrip(0, 9.2, 0, 1, 420, 0.2), asphaltMaterial);
    street.name = `GTFS bus street corridor ${this.route.line}`;
    street.receiveShadow = true;
    street.renderOrder = 2;
    this.scene.add(street);

    for (const side of [-1, 1]) {
      const sidewalk = new THREE.Mesh(this.makeRouteStrip(side * 5.45, 2.2, 0, 1, 360, 0.24), sidewalkMaterial);
      sidewalk.name = `Bus corridor sidewalk ${side}`;
      sidewalk.receiveShadow = true;
      sidewalk.renderOrder = 1;
      this.scene.add(sidewalk);
    }

    const dashSpacingM = 16;
    const dashCount = THREE.MathUtils.clamp(Math.floor(this.route.routeLengthM / dashSpacingM), 24, 620);
    const markings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.025, 4.2), markingMaterial, dashCount);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    for (let index = 0; index < dashCount; index++) {
      const t = (index + 0.5) / dashCount;
      const position = this.curve.getPointAt(t).add(new THREE.Vector3(0, 0.28, 0));
      const tangent = this.curve.getTangentAt(t).normalize();
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tangent.x, tangent.z));
      matrix.compose(position, rotation, new THREE.Vector3(1, 1, 1));
      markings.setMatrixAt(index, matrix);
    }
    markings.name = 'GTFS bus corridor center markings';
    markings.instanceMatrix.needsUpdate = true;
    markings.renderOrder = 3;
    this.scene.add(markings);
  }

  private buildFerryRoutePath(): void {
    const wakeMaterial = new THREE.MeshStandardMaterial({
      color: 0xd4e8ef,
      roughness: 0.24,
      emissive: 0x5b9cc0,
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: 0.72
    });
    const channelMaterial = new THREE.MeshStandardMaterial({
      color: 0x76b3cd,
      roughness: 0.42,
      transparent: true,
      opacity: 0.28
    });
    const path = new THREE.Mesh(this.makeRouteStrip(0, 10.5, 0, 1, 320, 0.18), channelMaterial);
    path.name = `Ferry route channel ${this.route.line}`;
    path.renderOrder = 1;
    this.scene.add(path);

    const wakeCount = THREE.MathUtils.clamp(Math.floor(this.route.routeLengthM / 55), 18, 220);
    const wakes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.04, 7.5), wakeMaterial, wakeCount);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    for (let index = 0; index < wakeCount; index++) {
      const t = (index + 0.5) / wakeCount;
      const position = this.curve.getPointAt(t).add(new THREE.Vector3(0, 0.24, 0));
      const tangent = this.curve.getTangentAt(t).normalize();
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tangent.x, tangent.z));
      matrix.compose(position, rotation, new THREE.Vector3(1, 1, 1));
      wakes.setMatrixAt(index, matrix);
    }
    wakes.instanceMatrix.needsUpdate = true;
    wakes.renderOrder = 2;
    wakes.name = 'Ferry wake markers';
    this.scene.add(wakes);
  }

  private buildTunnels(): void {
    if (this.guidewayKind === 'bus' || this.guidewayKind === 'ferry' || this.guidewayKind === 'schwebebahn') return;
    const mask = this.route.tunnelMask;
    if (!mask || !mask.some(Boolean)) return;
    const liningMaterial = new THREE.MeshStandardMaterial({
      color: 0x777a78,
      roughness: 0.92,
      side: THREE.BackSide
    });
    const portalMaterial = new THREE.MeshStandardMaterial({ color: 0x555957, roughness: 0.88 });
    const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffedbd });

    // Wide bore so the chase camera stays inside the lining on curves.
    const boreRadiusM = 8.2;
    const lastPointIndex = this.route.controlPoints.length - 1;
    for (const [start, end] of this.maskRanges(mask)) {
      if (end - start < 1) continue;
      // Sample the actual route spline instead of re-smoothing raw control
      // points: a separately smoothed tube drifts off the track on tight
      // bends, pushing one wall into the train and camera.
      const startT = Math.max(0, start - 1) / lastPointIndex;
      const endT = Math.min(lastPointIndex, end + 1) / lastPointIndex;
      const sampleCount = Math.max(16, (end - start) * 6);
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= sampleCount; i++) {
        const t = startT + ((endT - startT) * i) / sampleCount;
        points.push(this.curve.getPoint(t).add(new THREE.Vector3(0, 1.2, 0)));
      }
      const tunnelCurve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
      const segments = Math.max(24, (end - start) * 6);
      const lining = new THREE.Mesh(new THREE.TubeGeometry(tunnelCurve, segments, boreRadiusM, 18, false), liningMaterial);
      lining.name = 'OSM tunnel lining';
      this.scene.add(lining);

      const lightPoints = tunnelCurve.getSpacedPoints(Math.max(4, end - start)).map((point) => point.add(new THREE.Vector3(0, 5.8, 0)));
      const lightCurve = new THREE.CatmullRomCurve3(lightPoints);
      this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(lightCurve, segments, 0.075, 5), lightMaterial));

      for (const t of [0, 1]) {
        const tangent = tunnelCurve.getTangentAt(t).normalize();
        const portal = new THREE.Mesh(new THREE.TorusGeometry(boreRadiusM, 0.5, 8, 24), portalMaterial);
        portal.position.copy(tunnelCurve.getPointAt(t));
        portal.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
        this.scene.add(portal);
      }
    }
  }

  private buildStations(): void {
    if (this.guidewayKind === 'bus') {
      this.buildBusStops();
      return;
    }
    if (this.guidewayKind === 'ferry') {
      this.buildFerryStops();
      return;
    }
    if (this.guidewayKind === 'schwebebahn') {
      this.buildSchwebebahnStations();
      return;
    }
    if (this.guidewayKind === 's-bahn') {
      this.buildSbahnStations();
      return;
    }
    if (this.guidewayKind === 'zacke' || this.guidewayKind === 'seilbahn') {
      this.buildMountainRailwayStops();
      return;
    }
    const platformMat = new THREE.MeshStandardMaterial({ color: 0xb9b7b0, roughness: 0.9 });
    const platformEdgeMat = new THREE.MeshStandardMaterial({ color: 0x696b6c, roughness: 0.82 });
    const tactileMat = new THREE.MeshStandardMaterial({ color: 0xeee7cf, roughness: 0.92 });
    const ssbBlueMat = new THREE.MeshStandardMaterial({ color: 0x174a73, roughness: 0.45, metalness: 0.28 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xa9d0dd,
      roughness: 0.12,
      metalness: 0.08,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide
    });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xd7dde0, roughness: 0.38, metalness: 0.34 });
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x234e68, roughness: 0.68 });
    const machineMat = new THREE.MeshStandardMaterial({ color: 0xffd800, roughness: 0.48 });
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4cf, emissiveIntensity: 2.1 });
    const undergroundWallMat = new THREE.MeshStandardMaterial({ color: 0xcacbc8, roughness: 0.88 });

    for (const station of this.route.stations) {
      const t = THREE.MathUtils.clamp(station.distanceM / this.route.routeLengthM, 0, 1);
      const p = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      const yaw = Math.atan2(tangent.x, tangent.z);
      const underground = this.stationIsUnderground(t);
      const stationGroup = new THREE.Group();
      stationGroup.name = `${underground ? 'Underground' : 'Surface'} station ${station.name}`;
      stationGroup.position.copy(p);
      stationGroup.rotation.y = yaw;
      this.scene.add(stationGroup);

      if (underground) {
        const ceiling = new THREE.Mesh(new THREE.BoxGeometry(27, 0.48, 82), undergroundWallMat);
        ceiling.position.y = 5.7;
        ceiling.receiveShadow = true;
        stationGroup.add(ceiling);
        for (const side of [-1, 1]) {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(0.45, 5.3, 82), undergroundWallMat);
          wall.position.set(side * 12.2, 2.75, 0);
          wall.receiveShadow = true;
          stationGroup.add(wall);
        }
      }

      for (const side of [-1, 1]) {
        const halfLengthM = 38;
        const startT = THREE.MathUtils.clamp((station.distanceM - halfLengthM) / this.route.routeLengthM, 0, 1);
        const endT = THREE.MathUtils.clamp((station.distanceM + halfLengthM) / this.route.routeLengthM, 0, 1);
        const platformEdge = new THREE.Mesh(this.makeRouteStrip(side * 7.4, 8.25, startT, endT, 28, 0.12), platformEdgeMat);
        platformEdge.receiveShadow = true;
        stationGroup.parent?.add(platformEdge);
        const platform = new THREE.Mesh(this.makeRouteStrip(side * 7.4, 8, startT, endT, 24, 0.22), platformMat);
        platform.receiveShadow = true;
        platform.name = `Curved platform ${station.name}`;
        stationGroup.parent?.add(platform);

        const tactileOffset = side * 3.72;
        const tactile = new THREE.Mesh(this.makeRouteStrip(tactileOffset, 0.72, startT, endT, 28, 0.245), tactileMat);
        tactile.name = `Tactile platform edge ${station.name}`;
        stationGroup.parent?.add(tactile);

        if (underground) {
          for (const z of [-24, 0, 24]) {
            const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.58, 5.1, 0.58), ssbBlueMat);
            pillar.position.set(side * 9.7, 2.72, z);
            pillar.castShadow = true;
            stationGroup.add(pillar);
          }
          for (const z of [-24, -8, 8, 24]) {
            const light = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.12, 8.5), lightMat);
            light.position.set(side * 7.1, 5.4, z);
            stationGroup.add(light);
          }
        } else {
          const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.24, 25), canopyMat);
          roof.position.set(side * 7.8, 4.25, 8);
          roof.rotation.z = side * -0.035;
          roof.castShadow = true;
          stationGroup.add(roof);
          for (const roofEdge of [-1, 1]) {
            const fascia = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 25.2), ssbBlueMat);
            fascia.position.set(side * 7.8 + roofEdge * 3.05, 4.12, 8);
            stationGroup.add(fascia);
          }

          const glassBack = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.55, 22), glassMat);
          glassBack.position.set(side * 10.55, 2.55, 8);
          stationGroup.add(glassBack);
          for (const z of [-2.5, 8, 18.5]) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.55, 0.16), ssbBlueMat);
            post.position.set(side * 10.5, 2.25, z);
            post.castShadow = true;
            stationGroup.add(post);
            const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 5.5), lightMat);
            lamp.position.set(side * 7.8, 4.08, z);
            stationGroup.add(lamp);
          }
        }

        const bench = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.48, 4.8), benchMat);
        bench.position.set(side * 8.8, 0.78, underground ? 9 : 8);
        bench.castShadow = true;
        stationGroup.add(bench);
        const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.15, 4.8), benchMat);
        backrest.position.set(side * 9.32, 1.25, underground ? 9 : 8);
        stationGroup.add(backrest);

        const ticketMachine = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.9, 1.05), machineMat);
        ticketMachine.position.set(side * 9.25, 1.18, -8);
        ticketMachine.castShadow = true;
        stationGroup.add(ticketMachine);
        const ticketScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.42), new THREE.MeshBasicMaterial({ color: 0x82c9ef }));
        ticketScreen.position.set(side * 9.63, 1.52, -8);
        ticketScreen.rotation.y = side * Math.PI / 2;
        stationGroup.add(ticketScreen);

        const timetableCase = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.85, 1.35), ssbBlueMat);
        timetableCase.position.set(side * 9.45, 1.46, -13);
        stationGroup.add(timetableCase);
        const timetable = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 1.52), new THREE.MeshBasicMaterial({ color: 0xf6f3e9 }));
        timetable.position.set(side * 9.55, 1.46, -13);
        timetable.rotation.y = side * Math.PI / 2;
        stationGroup.add(timetable);

        const signTexture = makeLabelTexture(`${this.route.line}  ${station.name}`, {
          width: 1024,
          height: 180,
          bg: '#174a73',
          fg: '#ffffff'
        });
        for (const z of [-21, 21]) {
          const sign = new THREE.Mesh(
            new THREE.PlaneGeometry(8.6, 1.5),
            new THREE.MeshBasicMaterial({ map: signTexture, side: THREE.FrontSide })
          );
          sign.position.set(side * 10.75, underground ? 3.55 : 3.05, z);
          sign.rotation.y = side * Math.PI / 2;
          stationGroup.add(sign);
          const signBack = sign.clone();
          signBack.rotation.y += Math.PI;
          stationGroup.add(signBack);
          this.stationMarkers.push(sign, signBack);
        }

        const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.95, 12), ssbBlueMat);
        bin.position.set(side * 9.35, 0.7, 14);
        stationGroup.add(bin);
      }

      if (underground) {
        const wayfindingTexture = makeLabelTexture(`Ausgang   ${station.name}   →`, {
          width: 1024,
          height: 160,
          bg: '#173f62',
          fg: '#ffffff'
        });
        const wayfinding = new THREE.Mesh(
          new THREE.PlaneGeometry(10, 1.55),
          new THREE.MeshBasicMaterial({ map: wayfindingTexture, side: THREE.FrontSide })
        );
        wayfinding.position.set(0, 4.75, -18);
        stationGroup.add(wayfinding);
        const wayfindingBack = wayfinding.clone();
        wayfindingBack.rotation.y = Math.PI;
        stationGroup.add(wayfindingBack);
      }
    }
  }

  private buildSbahnStations(): void {
    const platformMaterial = new THREE.MeshStandardMaterial({ color: 0xb6b3aa, roughness: 0.96 });
    const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x777a7b, roughness: 0.9 });
    const tactileMaterial = new THREE.MeshStandardMaterial({ color: 0xe9e4d3, roughness: 0.94 });
    const dbBlue = new THREE.MeshStandardMaterial({ color: 0x173f73, roughness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x747b7f, roughness: 0.45, metalness: 0.55 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xaacbd4, transparent: true, opacity: 0.34, roughness: 0.1, side: THREE.DoubleSide });
    const displayMaterial = new THREE.MeshBasicMaterial({ color: 0x101417 });
    const undergroundMaterial = new THREE.MeshStandardMaterial({ color: 0xc8c8c3, roughness: 0.9 });

    for (const station of this.route.stations) {
      const t = THREE.MathUtils.clamp(station.distanceM / this.route.routeLengthM, 0, 1);
      const halfLengthM = 78;
      const startT = THREE.MathUtils.clamp((station.distanceM - halfLengthM) / this.route.routeLengthM, 0, 1);
      const endT = THREE.MathUtils.clamp((station.distanceM + halfLengthM) / this.route.routeLengthM, 0, 1);
      const center = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      const yaw = Math.atan2(tangent.x, tangent.z);
      const underground = this.stationIsUnderground(t);
      const stationGroup = new THREE.Group();
      stationGroup.name = `DB S-Bahn station ${station.name}`;
      stationGroup.position.copy(center);
      stationGroup.rotation.y = yaw;
      this.scene.add(stationGroup);

      for (const side of [-1, 1]) {
        const platform = new THREE.Mesh(this.makeRouteStrip(side * 6.25, 5.7, startT, endT, 72, 0.28), platformMaterial);
        platform.receiveShadow = true;
        platform.name = `S-Bahn 96cm platform ${station.name}`;
        this.scene.add(platform);
        const edge = new THREE.Mesh(this.makeRouteStrip(side * 3.55, 0.35, startT, endT, 76, 0.31), edgeMaterial);
        this.scene.add(edge);
        const tactile = new THREE.Mesh(this.makeRouteStrip(side * 3.95, 0.55, startT, endT, 76, 0.335), tactileMaterial);
        this.scene.add(tactile);

        for (const z of [-48, 0, 48]) {
          const sign = new THREE.Mesh(
            new THREE.PlaneGeometry(5.8, 0.88),
            new THREE.MeshBasicMaterial({ map: makeLabelTexture(station.name, { width: 768, height: 128, bg: '#164279', fg: '#fff' }), side: THREE.DoubleSide })
          );
          sign.position.set(side * 7.55, 2.65, z);
          sign.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
          stationGroup.add(sign);
          this.stationMarkers.push(sign);
        }

        const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.2, 28), steel);
        canopy.position.set(side * 6.55, 4.15, 5);
        stationGroup.add(canopy);
        const glassBack = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.45, 18), glass);
        glassBack.position.set(side * 8.3, 2.35, 5);
        stationGroup.add(glassBack);
        for (const z of [-7, 5, 17]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.4, 0.14), steel);
          post.position.set(side * 6.55, 2.25, z);
          stationGroup.add(post);
        }

        const dfi = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.82, 3.6), displayMaterial);
        dfi.position.set(side * 6.5, 3.45, -15);
        stationGroup.add(dfi);
        const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.08, 24), new THREE.MeshBasicMaterial({ color: 0xf7f7f2 }));
        clock.rotation.z = Math.PI / 2;
        clock.position.set(side * 6.5, 3.45, 22);
        stationGroup.add(clock);
        const sBadge = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture('S', { width: 256, height: 256, bg: '#07864b', fg: '#fff' }) }));
        sBadge.position.set(side * 7.1, 4.7, -24);
        sBadge.scale.set(2.2, 2.2, 1);
        stationGroup.add(sBadge);
      }

      if (underground) {
        const ceiling = new THREE.Mesh(new THREE.BoxGeometry(24, 0.42, 155), undergroundMaterial);
        ceiling.position.y = 5.7;
        stationGroup.add(ceiling);
        for (const side of [-1, 1]) {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(0.38, 5.2, 155), undergroundMaterial);
          wall.position.set(side * 11.7, 2.75, 0);
          stationGroup.add(wall);
        }
      }
    }
  }

  private buildMountainRailwayStops(): void {
    const platformMaterial = new THREE.MeshStandardMaterial({ color: 0xb4b0a5, roughness: 0.95 });
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x174a73, roughness: 0.55 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x70472c, roughness: 0.82 });
    for (const station of this.route.stations) {
      const t = THREE.MathUtils.clamp(station.distanceM / this.route.routeLengthM, 0, 1);
      const group = new THREE.Group();
      group.position.copy(this.curve.getPointAt(t));
      group.rotation.y = Math.atan2(this.curve.getTangentAt(t).x, this.curve.getTangentAt(t).z);
      const length = this.guidewayKind === 'seilbahn' ? 14 : 28;
      const platform = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.22, length), platformMaterial);
      platform.position.set(2.15, 0.08, 0);
      group.add(platform);
      const shelter = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.18, 5.5), this.guidewayKind === 'seilbahn' ? wood : postMaterial);
      shelter.position.set(2.2, 3.05, 0);
      group.add(shelter);
      for (const z of [-2.4, 2.4]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.8, 0.12), postMaterial);
        post.position.set(2.2, 1.55, z);
        group.add(post);
      }
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(`${this.route.line}  ${station.name}`, { width: 768, height: 160, bg: '#174a73', fg: '#fff' }) }));
      sign.position.set(2.2, 3.75, 0);
      sign.scale.set(7, 1.45, 1);
      group.add(sign);
      this.stationMarkers.push(sign);
      this.scene.add(group);
    }
  }

  private buildSchwebebahnStations(): void {
    const platformMaterial = new THREE.MeshStandardMaterial({ color: 0xc8c5bb, roughness: 0.94 });
    const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x777c7e, roughness: 0.88 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x5f6b73, roughness: 0.44, metalness: 0.58 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x245d85, roughness: 0.5, metalness: 0.24 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0xb6d8e4,
      transparent: true,
      opacity: 0.32,
      roughness: 0.08,
      side: THREE.DoubleSide
    });

    for (const station of this.route.stations) {
      const t = THREE.MathUtils.clamp(station.distanceM / this.route.routeLengthM, 0, 1);
      const halfLengthM = 18;
      const startT = THREE.MathUtils.clamp((station.distanceM - halfLengthM) / this.route.routeLengthM, 0, 1);
      const endT = THREE.MathUtils.clamp((station.distanceM + halfLengthM) / this.route.routeLengthM, 0, 1);
      const center = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      const yaw = Math.atan2(tangent.x, tangent.z);

      const platform = new THREE.Mesh(this.makeRouteStrip(0, 4.9, startT, endT, 42, -1.38), platformMaterial);
      platform.name = `Schwebebahn island platform ${station.name}`;
      platform.receiveShadow = true;
      this.scene.add(platform);

      for (const edgeOffset of [-1.48, 1.48]) {
        const edge = new THREE.Mesh(this.makeRouteStrip(edgeOffset, 0.18, startT, endT, 44, -1.31), edgeMaterial);
        edge.name = `Schwebebahn platform edge ${station.name}`;
        this.scene.add(edge);
      }

      const stationGroup = new THREE.Group();
      stationGroup.name = `Schwebebahn station hall ${station.name}`;
      stationGroup.position.copy(center);
      stationGroup.rotation.y = yaw;
      this.scene.add(stationGroup);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.22, 19.5), steel);
      roof.position.set(0, 0.95, 0);
      roof.castShadow = true;
      stationGroup.add(roof);
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.24, 19.7), blue);
      ridge.position.set(0, 1.12, 0);
      stationGroup.add(ridge);

      for (const x of [-2.45, 2.45]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.55, 17.6), glass);
        wall.position.set(x, -0.22, 0);
        stationGroup.add(wall);
      }
      for (const z of [-7.8, 0, 7.8]) {
        for (const x of [-2.5, 2.5]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.8, 0.16), steel);
          post.position.set(x, -0.2, z);
          post.castShadow = true;
          stationGroup.add(post);
        }
      }

      const overheadBeam = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.2, 0.55), steel);
      overheadBeam.position.set(0, 2.15, 0);
      stationGroup.add(overheadBeam);

      const signTexture = makeLabelTexture(`60  ${station.name}`, {
        width: 1024,
        height: 180,
        bg: '#174a73',
        fg: '#ffffff'
      });
      for (const z of [-6.4, 6.4]) {
        const sign = new THREE.Mesh(
          new THREE.PlaneGeometry(4.8, 0.9),
          new THREE.MeshBasicMaterial({ map: signTexture, side: THREE.DoubleSide })
        );
        sign.position.set(0, 0.2, z);
        sign.rotation.y = Math.PI / 2;
        stationGroup.add(sign);
        this.stationMarkers.push(sign);
      }

      const dfi = new THREE.Mesh(
        new THREE.PlaneGeometry(3.6, 0.62),
        new THREE.MeshBasicMaterial({ map: makeLabelTexture(`60  ${this.route.destination}`, { width: 768, height: 140, bg: '#111820', fg: '#ffb300' }), side: THREE.DoubleSide })
      );
      dfi.position.set(0, 0.02, -8.3);
      dfi.rotation.y = Math.PI;
      stationGroup.add(dfi);
    }
  }

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

  private buildBusStops(): void {
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x4c555a, roughness: 0.58, metalness: 0.55 });
    const yellowMaterial = new THREE.MeshStandardMaterial({ color: 0xffdf00, roughness: 0.48 });
    const stopGreenMaterial = new THREE.MeshStandardMaterial({ color: 0x16723a, roughness: 0.5 });
    const shelterMaterial = new THREE.MeshStandardMaterial({
      color: 0xb9dce7,
      transparent: true,
      opacity: 0.32,
      roughness: 0.1,
      side: THREE.DoubleSide
    });
    const seatMaterial = new THREE.MeshStandardMaterial({ color: 0x234e68, roughness: 0.75 });

    for (const station of this.route.stations) {
      const t = THREE.MathUtils.clamp(station.distanceM / this.route.routeLengthM, 0, 1);
      const tangent = this.curve.getTangentAt(t).normalize();
      const normal = this.normalAt(t);
      const group = new THREE.Group();
      group.name = `Bus stop ${station.name}`;
      group.position.copy(this.curve.getPointAt(t)).add(normal.multiplyScalar(-7.2));
      group.rotation.y = Math.atan2(tangent.x, tangent.z);

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 3.3, 10), poleMaterial);
      pole.position.y = 1.65;
      group.add(pole);
      const discBorder = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.075, 24), stopGreenMaterial);
      discBorder.rotation.z = Math.PI / 2;
      discBorder.position.set(0, 2.85, 0);
      group.add(discBorder);
      const hBadge = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture('H', { width: 256, height: 256, bg: '#ffdf00', fg: '#176f39' }) }));
      hBadge.position.set(0.06, 2.85, 0);
      hBadge.scale.set(0.65, 0.65, 1);
      group.add(hBadge);

      const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeLabelTexture(`${this.route.line}  ${station.name}`, { width: 768, height: 160, bg: '#174a73', fg: '#fff' })
      }));
      label.position.set(0, 3.65, 0);
      label.scale.set(7.2, 1.5, 1);
      group.add(label);

      const dfi = new THREE.Mesh(
        new THREE.PlaneGeometry(4.6, 0.82),
        new THREE.MeshBasicMaterial({ map: makeLabelTexture(`${this.route.line}  ${this.route.destination}`, { width: 768, height: 140, bg: '#111820', fg: '#ffb300' }), side: THREE.DoubleSide })
      );
      dfi.position.set(-0.65, 3.18, 1.25);
      group.add(dfi);

      const back = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.25, 5.6), shelterMaterial);
      back.position.set(-1.7, 1.42, 2.8);
      group.add(back);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 5.8), poleMaterial);
      roof.position.set(-0.7, 2.58, 2.8);
      group.add(roof);
      const fascia = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.18, 5.95), yellowMaterial);
      fascia.position.set(-0.7, 2.68, 2.8);
      group.add(fascia);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 3.2), seatMaterial);
      seat.position.set(-1.25, 0.72, 2.8);
      group.add(seat);
      this.scene.add(group);
      this.stationMarkers.push(label);
    }
  }

  private buildFerryStops(): void {
    const dockMaterial = new THREE.MeshStandardMaterial({ color: 0xb8b3a6, roughness: 0.96 });
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x1f5e88, roughness: 0.56 });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0xe6ecee, roughness: 0.48 });
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0xb6dbe4,
      transparent: true,
      opacity: 0.3,
      roughness: 0.12,
      side: THREE.DoubleSide
    });
    for (const station of this.route.stations) {
      const t = THREE.MathUtils.clamp(station.distanceM / this.route.routeLengthM, 0, 1);
      const tangent = this.curve.getTangentAt(t).normalize();
      const normal = this.normalAt(t);
      const group = new THREE.Group();
      group.name = `Ferry dock ${station.name}`;
      group.position.copy(this.curve.getPointAt(t)).add(normal.multiplyScalar(6));
      group.rotation.y = Math.atan2(tangent.x, tangent.z);

      const pier = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.28, 18), dockMaterial);
      pier.position.y = 0.08;
      group.add(pier);
      const pontoon = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.4, 8.5), dockMaterial);
      pontoon.position.set(0, -0.12, -4.2);
      group.add(pontoon);
      const shelterRoof = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 5.4), roofMaterial);
      shelterRoof.position.set(0, 2.55, 3.1);
      group.add(shelterRoof);
      for (const x of [-1.2, 1.2]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), postMaterial);
        post.position.set(x, 1.26, 3.1);
        group.add(post);
      }
      const glassBack = new THREE.Mesh(new THREE.BoxGeometry(2.85, 1.8, 0.08), glassMaterial);
      glassBack.position.set(0, 1.55, 4.55);
      group.add(glassBack);
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeLabelTexture(`${this.route.line}  ${station.name}`, { width: 768, height: 160, bg: '#1f5e88', fg: '#ffffff' })
      }));
      sign.position.set(0, 3.3, 3.1);
      sign.scale.set(7, 1.45, 1);
      group.add(sign);
      this.stationMarkers.push(sign);
      this.scene.add(group);
    }
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

  private buildOpposingTraffic(): void {
    if (!this.vehicle) return;
    const trainCount = this.guidewayKind === 'seilbahn' ? 1 : this.route.routeLengthM > 5000 ? 3 : 2;
    for (let index = 0; index < trainCount; index++) {
      const root = this.train.clone(true);
      root.name = `Opposing service ${index + 1}`;
      // Beam lights stay exclusive to the player train: cloned spotlights would
      // keep aiming at the original train's target and add per-fragment cost.
      const clonedLights: THREE.Object3D[] = [];
      root.traverse((object) => {
        if ((object as THREE.Light).isLight || object.name.startsWith('Exterior lamp')) clonedLights.push(object);
      });
      for (const light of clonedLights) light.parent?.remove(light);
      const cars = root.children.filter((child): child is THREE.Group => child instanceof THREE.Group && child.name.startsWith('Articulated car'));
      this.opposingTrains.push({
        root,
        cars,
        phaseM: ((index + 1) / (trainCount + 1)) * this.route.routeLengthM
      });
      this.scene.add(root);
    }
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

  private buildCityBlocks(): void {
    const mats = [
      new THREE.MeshStandardMaterial({ color: 0xb6a38f, roughness: 0.82 }),
      new THREE.MeshStandardMaterial({ color: 0xd1c8b7, roughness: 0.76 }),
      new THREE.MeshStandardMaterial({ color: 0x8e9aa5, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0xc0b3a2, roughness: 0.84 })
    ];

    const blockCount = Math.max(50, Math.min(180, Math.round(this.route.routeLengthM / 150)));
    for (let i = 0; i < blockCount; i++) {
      const t = i / Math.max(1, blockCount - 1);
      const p = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      const normal = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
      for (const side of [-1, 1]) {
        const width = 18 + Math.random() * 16;
        const depth = 28 + Math.random() * 18;
        const height = 8 + Math.random() * 34;
        const b = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mats[Math.floor(Math.random() * mats.length)]);
        b.position.copy(p).add(normal.multiplyScalar(side * (72 + Math.random() * 140)));
        b.position.y = height / 2;
        b.position.add(tangent.multiplyScalar((Math.random() - 0.5) * 70));
        b.castShadow = true;
        b.receiveShadow = true;
        this.scene.add(b);
      }
    }
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
