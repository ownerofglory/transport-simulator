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
import { CameraController } from './world/CameraController';
import { buildTransitVehicle } from './vehicles';
type GeoPoint = { lat: number; lon: number };

const EARTH_M_PER_DEG_LAT = 111_320;
const TRACK_GAUGE_M = 2.1;
const TRACK_CENTER_SPACING_M = 4.2;
const ACTIVE_TRACK_OFFSET_M = -TRACK_CENTER_SPACING_M / 2;
const OPPOSITE_TRACK_OFFSET_M = TRACK_CENTER_SPACING_M / 2;
export class TransitWorld {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 5000);
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  readonly train = new THREE.Group();
  readonly curve: THREE.CatmullRomCurve3;
  private readonly stationMarkers: THREE.Object3D[] = [];
  private readonly seasonalObjects = new THREE.Group();
  private readonly trainCars: THREE.Group[] = [];
  private readonly opposingTrains: { root: THREE.Group; cars: THREE.Group[]; phaseM: number }[] = [];
  private readonly vehicleWindowBands: THREE.Mesh[] = [];
  private readonly vehicleCabShells: THREE.Mesh[] = [];
  private readonly vehiclePassengerShells: THREE.Mesh[] = [];
  private readonly vehicleCabDisplays: THREE.Mesh[] = [];
  private readonly vehicleDoorLeaves: { group: THREE.Group; closedZ: number; direction: -1 | 1 }[] = [];
  private vehicleGlassMaterial: THREE.MeshStandardMaterial | null = null;
  private interiorDisplayCanvas: HTMLCanvasElement | null = null;
  private interiorDisplayTexture: THREE.CanvasTexture | null = null;
  private lastInteriorDisplayKey = '';
  private doorOpenAmount = 0;
  private trainHalfLengthM = 20.15;
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

    this.camera.position.set(0, 5, -12);
    this.lighting.initialize();
    this.buildGround();
    this.buildTrack();
    this.buildTunnels();
    this.buildStations();
    this.buildTrain();
    this.buildOpposingTraffic();
    if (this.routeGeoPoints().length >= 2) {
      this.osmScene = new OsmSceneStreamer(
        this.scene,
        (lat, lon) => this.projectGeo(lat, lon),
        (lat, lon) => this.scenerySurfaceHeight(lat, lon),
        this.landmarkExclusions
      );
      this.osmScene.update(this.geoPointAt(0));
    } else {
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
  }

  cycleCamera(): string {
    this.cameraController.cycle();
    this.updateVehicleGlass();
    return this.cameraController.currentMode();
  }

  setInteriorLookInput(leftHeld: boolean, rightHeld: boolean): void {
    this.cameraController.setLookInput(leftHeld, rightHeld);
  }

  private updateVehicleGlass(): void {
    if (!this.vehicleGlassMaterial) return;
    const mode = this.cameraController.currentMode();
    const interiorView = mode === 'passenger' || mode === 'cab';
    const cabView = mode === 'cab';
    this.vehicleGlassMaterial.opacity = interiorView ? 0.1 : 0.58;
    this.vehicleGlassMaterial.depthWrite = !interiorView;
    this.vehicleGlassMaterial.color.setHex(interiorView ? 0xd9f2f8 : 0x91c7dd);
    this.vehicleGlassMaterial.needsUpdate = true;
    for (const band of this.vehicleWindowBands) band.visible = !interiorView;
    for (const shell of this.vehicleCabShells) shell.visible = !cabView;
    for (const shell of this.vehiclePassengerShells) shell.visible = !interiorView;
    for (const display of this.vehicleCabDisplays) display.visible = !cabView;
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
    this.updateArticulatedVehicle(this.train, this.trainCars, distanceM, 1, this.activeLaneOffsetM);
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
      trainHalfLengthM: this.trainHalfLengthM,
      train: this.train,
      trainCars: this.trainCars
    });
  }

  private updateDoors(open: boolean, deltaSeconds: number): void {
    this.doorOpenAmount = THREE.MathUtils.damp(
      this.doorOpenAmount,
      open ? 1 : 0,
      open ? 5.2 : 6.5,
      THREE.MathUtils.clamp(deltaSeconds, 0, 0.1)
    );
    const eased = this.doorOpenAmount * this.doorOpenAmount * (3 - 2 * this.doorOpenAmount);
    for (const leaf of this.vehicleDoorLeaves) {
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
    if (this.guidewayKind === 'zacke' || this.guidewayKind === 'seilbahn') return 0;
    return this.guidewayKind === 's-bahn' ? -2.35 : ACTIVE_TRACK_OFFSET_M;
  }

  private get oppositeLaneOffsetM(): number {
    if (this.guidewayKind === 'bus') return 1.65;
    if (this.guidewayKind === 'zacke' || this.guidewayKind === 'seilbahn') return 0;
    return this.guidewayKind === 's-bahn' ? 2.35 : OPPOSITE_TRACK_OFFSET_M;
  }

  private get railGaugeM(): number {
    return this.guidewayKind === 's-bahn' ? 1.435 : TRACK_GAUGE_M;
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
      return { x: point.x, z: point.z, t };
    });
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const x = positions.getX(vertex);
      const z = positions.getZ(vertex);
      let nearestDistanceSq = Number.POSITIVE_INFINITY;
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
          nearestT = THREE.MathUtils.lerp(a.t, b.t, segmentT);
        }
      }
      // Keep a physical gap below ballast and wheel flanges. The old route-wide
      // ribbon could overlap itself and rise above the vehicle on tight bends.
      positions.setY(vertex, this.surfaceHeightAt(nearestT) - 0.55);
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

  private buildTunnels(): void {
    if (this.guidewayKind === 'bus') return;
    const mask = this.route.tunnelMask;
    if (!mask || !mask.some(Boolean)) return;
    const liningMaterial = new THREE.MeshStandardMaterial({
      color: 0x777a78,
      roughness: 0.92,
      side: THREE.BackSide
    });
    const portalMaterial = new THREE.MeshStandardMaterial({ color: 0x555957, roughness: 0.88 });
    const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffedbd });

    for (const [start, end] of this.maskRanges(mask)) {
      if (end - start < 1) continue;
      const points = this.route.controlPoints.slice(Math.max(0, start - 1), Math.min(this.route.controlPoints.length, end + 2))
        .map(([x, y, z]) => new THREE.Vector3(x, y + 0.4, z));
      const tunnelCurve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.36);
      const segments = Math.max(12, (end - start) * 4);
      const lining = new THREE.Mesh(new THREE.TubeGeometry(tunnelCurve, segments, 6.2, 14, false), liningMaterial);
      lining.name = 'OSM tunnel lining';
      this.scene.add(lining);

      const lightPoints = tunnelCurve.getSpacedPoints(Math.max(4, end - start)).map((point) => point.add(new THREE.Vector3(0, 4.6, 0)));
      const lightCurve = new THREE.CatmullRomCurve3(lightPoints);
      this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(lightCurve, segments, 0.075, 5), lightMaterial));

      for (const t of [0, 1]) {
        const tangent = tunnelCurve.getTangentAt(t).normalize();
        const portal = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.42, 8, 24), portalMaterial);
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

  private stationIsUnderground(t: number): boolean {
    if (this.guidewayKind === 'bus') return false;
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

  private buildMercedesBus(): void {
    const car = new THREE.Group();
    car.name = 'Articulated car Mercedes-Benz city bus';
    car.userData.centerOffsetM = 0;
    const yellow = new THREE.MeshStandardMaterial({ color: 0xffdf00, roughness: 0.48, metalness: 0.04 });
    const black = new THREE.MeshStandardMaterial({ color: 0x151a1d, roughness: 0.36 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9bd2e1, transparent: true, opacity: 0.38, roughness: 0.08, depthWrite: true });
    const interior = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.88 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8b9293, roughness: 0.38, metalness: 0.65 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x315f77, roughness: 0.88 });
    const displayMaterial = this.makeInteriorDisplayMaterial();
    this.vehicleGlassMaterial = glass;

    const body = new THREE.Mesh(new THREE.BoxGeometry(2.55, 2.85, 12.1), yellow);
    body.position.y = 1.72;
    body.castShadow = true;
    car.add(body);
    this.vehiclePassengerShells.push(body);
    for (const side of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.18, 10.25), black);
      band.position.set(side * 1.3, 2.36, -0.25);
      car.add(band);
      this.vehicleWindowBands.push(band);
      for (const z of [-4.65, -3.35, -1.55, 0.05, 2.85, 4.2]) {
        if (side < 0 && (Math.abs(z + 1.55) < 0.1 || Math.abs(z - 2.85) < 0.1)) continue;
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.92, 1.05), glass);
        window.position.set(side * 1.315, 2.36, z);
        car.add(window);
      }
    }
    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(2.22, 1.15, 0.08), glass);
    windscreen.position.set(0, 2.35, 6.09);
    car.add(windscreen);
    const destination = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 0.42), new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.route.line} ${this.route.destination}`, { width: 640, height: 128, bg: '#111', fg: '#ffb900' }),
      side: THREE.DoubleSide
    }));
    destination.position.set(0, 2.98, 6.14);
    car.add(destination);
    this.addSlidingVehicleDoor(car, -1.315, -1.55, yellow, glass, black, 1.62, 1.9);
    this.addSlidingVehicleDoor(car, -1.315, 2.85, yellow, glass, black, 1.62, 1.9);
    for (const z of [-3.7, 3.7]) {
      for (const x of [-1.26, 1.26]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.18, 20), black);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.52, z);
        car.add(wheel);
      }
    }
    const roofUnit = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.25, 3.2), black);
    roofUnit.position.set(0, 3.28, -1.2);
    car.add(roofUnit);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.08, 11.4), interior);
    floor.position.y = 1.02;
    car.add(floor);
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.08, 11.3), interior);
    ceiling.position.y = 3.02;
    car.add(ceiling);
    this.addOpaqueTransitInterior(car, 11.3, 1.18, interior, (side) => side < 0 ? [-1.55, 2.85] : []);
    for (const z of [-4.35, -3.25, -2.15, 0.15, 1.25, 4.2]) {
      for (const x of [-0.92, 0.92]) {
        const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.62), seat);
        cushion.position.set(x, 1.35, z);
        car.add(cushion);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.7, 0.12), seat);
        back.position.set(x, 1.7, z - 0.3);
        car.add(back);
      }
    }
    for (const z of [-2.45, 0.2, 3.7]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.85, 8), metal);
      pole.position.set(0.65, 2.02, z);
      car.add(pole);
    }
    const dashboard = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.62, 0.75), black);
    dashboard.position.set(0, 1.42, 5.48);
    car.add(dashboard);
    const nextStopDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 0.44), displayMaterial);
    nextStopDisplay.position.set(0, 2.72, 4.75);
    nextStopDisplay.rotation.y = Math.PI;
    car.add(nextStopDisplay);
    this.trainHalfLengthM = 6.25;
    this.trainCars.push(car);
    this.train.add(car);
    this.scene.add(this.train);
    this.updateVehicleGlass();
  }

  private buildSbahnTrain(): void {
    const shell = new THREE.MeshStandardMaterial({ color: 0xdfe1df, roughness: 0.42, metalness: 0.1 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd71920, roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x202428, roughness: 0.38 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x8fb9c7, transparent: true, opacity: 0.42, roughness: 0.06, side: THREE.DoubleSide });
    const interior = new THREE.MeshStandardMaterial({ color: 0xe4e1d8, roughness: 0.88 });
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x8f9398, roughness: 0.9 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x315f78, roughness: 0.88 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x989d9e, roughness: 0.35, metalness: 0.7 });
    const displayMaterial = this.makeInteriorDisplayMaterial();
    this.vehicleGlassMaterial = glass;
    const centers = [-25.2, -8.4, 8.4, 25.2];
    centers.forEach((center, index) => {
      const car = new THREE.Group();
      car.name = `Articulated car DB 423 section ${index + 1}`;
      car.userData.centerOffsetM = center;
      const body = new THREE.Mesh(new THREE.BoxGeometry(3.02, 3.3, 16.15), shell);
      body.position.y = 2.05;
      body.castShadow = true;
      car.add(body);
      this.vehiclePassengerShells.push(body);
      const lowerRed = new THREE.Mesh(new THREE.BoxGeometry(3.08, 0.28, 16.22), red);
      lowerRed.position.y = 0.62;
      car.add(lowerRed);
      this.vehiclePassengerShells.push(lowerRed);
      const belt = new THREE.Mesh(new THREE.BoxGeometry(3.09, 0.18, 16.23), red);
      belt.position.y = 1.72;
      car.add(belt);
      this.vehiclePassengerShells.push(belt);
      for (const side of [-1, 1]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.08, 14.5), dark);
        band.position.set(side * 1.535, 2.43, 0);
        car.add(band);
        this.vehicleWindowBands.push(band);
        for (const z of [-6.25, -4.85, -1.35, 0, 1.35, 4.85, 6.25]) {
          const window = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.88, 1.08), glass);
          window.position.set(side * 1.55, 2.43, z);
          car.add(window);
        }
        this.addSlidingVehicleDoor(car, side * 1.55, -3.15, red, glass, dark, 1.72, 2.05);
        this.addSlidingVehicleDoor(car, side * 1.55, 3.15, red, glass, dark, 1.72, 2.05);
      }
      if (index === 0 || index === centers.length - 1) {
        const cabEnd = index === 0 ? -1 : 1;
        const nose = this.makeCabNose(red);
        nose.scale.set(1.18, 1.08, 0.72);
        nose.position.set(0, 2.02, cabEnd * 8.18);
        if (cabEnd > 0) nose.rotation.y = Math.PI;
        car.add(nose);
        this.vehicleCabShells.push(nose);
        const cabFace = new THREE.Mesh(new THREE.BoxGeometry(2.82, 2.58, 0.16), red);
        cabFace.position.set(0, 1.9, cabEnd * 8.43);
        car.add(cabFace);
        this.vehicleCabShells.push(cabFace);
        const windscreen = new THREE.Mesh(new THREE.BoxGeometry(2.36, 0.92, 0.06), glass);
        windscreen.position.set(0, 2.6, cabEnd * 8.53);
        car.add(windscreen);
        const display = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 0.42), new THREE.MeshBasicMaterial({
          map: makeLabelTexture(`${this.route.line} ${this.route.destination}`, { width: 700, height: 128, bg: '#111', fg: '#fff' }),
          side: THREE.DoubleSide
        }));
        display.position.set(0, 3.17, cabEnd * 8.63);
        if (cabEnd < 0) display.rotation.y = Math.PI;
        car.add(display);
      }
      const floor = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.12, 15.5), floorMaterial);
      floor.position.y = 1.12;
      car.add(floor);
      const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.68, 0.08, 15.35), interior);
      ceiling.position.y = 3.32;
      car.add(ceiling);
      this.addOpaqueTransitInterior(car, 15.35, 1.4, interior, () => [-3.15, 3.15]);
      for (const z of [-6.2, -5.1, -1.35, 0, 1.35, 5.1, 6.2]) {
        for (const x of [-1.04, -0.58, 0.58, 1.04]) {
          const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.13, 0.52), seat);
          cushion.position.set(x, 1.37, z);
          car.add(cushion);
          const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.68, 0.11), seat);
          back.position.set(x, 1.72, z - 0.25);
          car.add(back);
        }
      }
      for (const z of [-3.15, 0, 3.15]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2, 8), metal);
        pole.position.set(0, 2.1, z);
        car.add(pole);
      }
      const monitor = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.54), displayMaterial);
      monitor.position.set(0, 2.94, 0.15);
      monitor.rotation.y = Math.PI;
      monitor.renderOrder = 18;
      car.add(monitor);
      for (const z of [-5.2, 5.2]) {
        const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.42, 1.8), dark);
        bogie.position.set(0, 0.48, z);
        car.add(bogie);
      }
      this.trainCars.push(car);
      this.train.add(car);
    });
    this.trainHalfLengthM = 34.2;
    this.addPantograph(new THREE.Vector3(0, 3.86, 8.5), dark);
    this.scene.add(this.train);
    this.updateVehicleGlass();
  }

  private addSlidingVehicleDoor(
    car: THREE.Group,
    x: number,
    z: number,
    doorMaterial: THREE.Material,
    glassMaterial: THREE.Material,
    openingMaterial: THREE.Material,
    width: number,
    height: number
  ): void {
    const side = Math.sign(x) || 1;
    const opening = new THREE.Mesh(new THREE.PlaneGeometry(width, height), openingMaterial);
    opening.position.set(x + side * 0.055, 1.75, z);
    opening.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    car.add(opening);
    for (const direction of [-1, 1] as const) {
      const closedZ = z + direction * width * 0.24;
      const leaf = new THREE.Group();
      leaf.position.z = closedZ;
      for (const edge of [-1, 1] as const) {
        const stile = new THREE.Mesh(new THREE.BoxGeometry(0.125, height - 0.08, width * 0.075), doorMaterial);
        stile.position.set(x + side * 0.03, 1.75, edge * width * 0.205);
        leaf.add(stile);
      }
      const crystal = new THREE.Mesh(new THREE.BoxGeometry(0.082, height * 0.8, width * 0.37), glassMaterial);
      crystal.position.set(x + side * 0.018, 1.9, 0);
      leaf.add(crystal);
      const frameTop = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, width * 0.48), doorMaterial);
      frameTop.position.set(x + side * 0.032, 2.64, 0);
      leaf.add(frameTop);
      const frameBottom = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.18, width * 0.48), doorMaterial);
      frameBottom.position.set(x + side * 0.032, 0.88, 0);
      leaf.add(frameBottom);
      car.add(leaf);
      this.vehicleDoorLeaves.push({ group: leaf, closedZ, direction });
    }
  }

  private addOpaqueTransitInterior(
    car: THREE.Group,
    length: number,
    halfWidth: number,
    material: THREE.Material,
    doorZones: (side: -1 | 1) => number[]
  ): void {
    for (const side of [-1, 1] as const) {
      const exclusions = doorZones(side).map((center) => ({ start: center - 0.92, end: center + 0.92 })).sort((a, b) => a.start - b.start);
      let cursor = -length / 2;
      for (const exclusion of [...exclusions, { start: length / 2, end: length / 2 }]) {
        const end = Math.min(length / 2, exclusion.start);
        if (end - cursor > 0.18) {
          const lowerWall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.68, end - cursor), material);
          lowerWall.position.set(side * halfWidth, 1.42, (cursor + end) / 2);
          car.add(lowerWall);
        }
        cursor = Math.max(cursor, exclusion.end);
      }
      const header = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.38, length), material);
      header.position.set(side * (halfWidth - 0.03), 3.02, 0);
      car.add(header);
      for (let z = -length / 2 + 1.2; z < length / 2 - 0.6; z += 2.05) {
        if (exclusions.some((zone) => z >= zone.start && z <= zone.end)) continue;
        const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.1), material);
        mullion.position.set(side * halfWidth, 2.38, z);
        car.add(mullion);
      }
    }
  }

  private buildZackeTrain(): void {
    const car = new THREE.Group();
    car.name = 'Articulated car S-ZT 4.2';
    car.userData.centerOffsetM = 0;
    const yellow = new THREE.MeshStandardMaterial({ color: 0xffdc00, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b2228, roughness: 0.38 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9ccbd7, transparent: true, opacity: 0.42, roughness: 0.06 });
    const floor = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.65, 3.1, 18.6), yellow);
    body.position.y = 1.88;
    car.add(body);
    this.vehiclePassengerShells.push(body);
    for (const side of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.08, 15.8), dark);
      band.position.set(side * 1.35, 2.38, 0);
      car.add(band);
      this.vehicleWindowBands.push(band);
      for (const z of [-6.8, -4.7, -2.4, 0, 2.4, 4.7, 6.8]) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.88, 1.55), glass);
        window.position.set(side * 1.37, 2.4, z);
        car.add(window);
      }
    }
    for (const end of [-1, 1]) {
      const windscreen = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.95, 0.08), glass);
      windscreen.position.set(0, 2.45, end * 9.34);
      car.add(windscreen);
    }
    const interiorFloor = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 17.5), floor);
    interiorFloor.position.y = 1.05;
    car.add(interiorFloor);
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 17.4), floor);
    ceiling.position.y = 3.18;
    car.add(ceiling);
    this.addOpaqueTransitInterior(car, 17.4, 1.2, floor, () => []);
    this.vehicleGlassMaterial = glass;
    this.trainHalfLengthM = 9.5;
    this.trainCars.push(car);
    this.train.add(car);
    this.addPantograph(new THREE.Vector3(0, 3.55, 0), dark);
    this.scene.add(this.train);
    this.updateVehicleGlass();
  }

  private buildSeilbahnCar(): void {
    const car = new THREE.Group();
    car.name = 'Articulated car 1929 teak funicular';
    car.userData.centerOffsetM = 0;
    const teak = new THREE.MeshStandardMaterial({ color: 0x7b4b2a, roughness: 0.74 });
    const mahogany = new THREE.MeshStandardMaterial({ color: 0x4f301f, roughness: 0.82 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc7a04c, roughness: 0.34, metalness: 0.72 });
    const cream = new THREE.MeshStandardMaterial({ color: 0xd9ccb1, roughness: 0.88 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xc2e0e7, transparent: true, opacity: 0.38, roughness: 0.08 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.24, 2.72, 9.9), teak);
    body.position.y = 1.67;
    car.add(body);
    this.vehiclePassengerShells.push(body);
    for (const side of [-1, 1] as const) {
      const lowerBelt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 9.5), mahogany);
      lowerBelt.position.set(side * 1.08, 1.12, 0);
      car.add(lowerBelt);
      const header = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 9.5), mahogany);
      header.position.set(side * 1.08, 2.98, 0);
      car.add(header);
      for (const z of [-3.7, -1.85, 0, 1.85, 3.7]) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.075, 1.22, 1.28), glass);
        window.position.set(side * 1.13, 2.06, z);
        car.add(window);
        const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.42, 0.12), mahogany);
        mullion.position.set(side * 1.08, 2.04, z + 0.92);
        car.add(mullion);
      }
    }
    for (const end of [-1, 1] as const) {
      const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.24, 0.075), glass);
      windscreen.position.set(0, 2.04, end * 4.94);
      car.add(windscreen);
      const endFrame = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.18, 0.12), mahogany);
      endFrame.position.set(0, 3.01, end * 4.88);
      car.add(endFrame);
    }
    const floorBase = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.12, 9.05), mahogany);
    floorBase.position.y = 0.9;
    car.add(floorBase);
    for (let z = -4.15; z <= 4.15; z += 0.48) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.028, 0.28), teak);
      plank.position.set(0, 0.98, z);
      car.add(plank);
    }
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.08, 8.9), cream);
    ceiling.position.y = 3.02;
    car.add(ceiling);
    this.addOpaqueTransitInterior(car, 8.9, 1.0, mahogany, () => []);
    for (const side of [-1, 1] as const) {
      const benchBase = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.18, 8.15), mahogany);
      benchBase.position.set(side * 0.6, 1.14, 0);
      car.add(benchBase);
      const benchBack = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, 8.0), teak);
      benchBack.position.set(side * 0.77, 1.54, 0);
      car.add(benchBack);
      for (const z of [-3.1, -1.5, 0, 1.5, 3.1]) {
        const divider = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.76, 0.06), brass);
        divider.position.set(side * 0.7, 1.48, z);
        car.add(divider);
      }
    }
    for (const x of [-0.78, 0, 0.78]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.0, 10), brass);
      pole.position.set(x, 1.98, 0);
      car.add(pole);
    }
    const handrail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 7.9, 10), brass);
    handrail.rotation.z = Math.PI / 2;
    handrail.position.set(0, 2.6, 0);
    car.add(handrail);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.54, 0.24, 10.2), mahogany);
    roof.position.y = 3.14;
    car.add(roof);
    this.vehiclePassengerShells.push(roof);
    this.vehicleGlassMaterial = glass;
    this.trainHalfLengthM = 5;
    this.trainCars.push(car);
    this.train.add(car);
    this.scene.add(this.train);
    this.updateVehicleGlass();
  }

  private buildUlmAvenioMTram(): void {
    const shell = new THREE.MeshStandardMaterial({ color: 0xf1f3f4, roughness: 0.42, metalness: 0.16 });
    const lightGrey = new THREE.MeshStandardMaterial({ color: 0xc6ccd2, roughness: 0.52, metalness: 0.12 });
    const glossyBlack = new THREE.MeshStandardMaterial({ color: 0x161b1f, roughness: 0.18, metalness: 0.32 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x76b8e8, roughness: 0.34, metalness: 0.08 });
    const doorBlue = new THREE.MeshStandardMaterial({ color: 0x3e8ec7, roughness: 0.36, metalness: 0.1 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9bc8d8, transparent: true, opacity: 0.42, roughness: 0.06, side: THREE.DoubleSide });
    const floor = new THREE.MeshStandardMaterial({ color: 0x72787d, roughness: 0.92 });
    const ceiling = new THREE.MeshStandardMaterial({ color: 0xe1e3e4, roughness: 0.86 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x2d667f, roughness: 0.88 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x93999b, roughness: 0.36, metalness: 0.72 });
    const ledPanel = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.route.line} ${this.route.destination}`, { width: 700, height: 128, bg: '#101417', fg: '#ffb300' }),
      side: THREE.DoubleSide
    });
    const interiorDisplayMat = this.makeInteriorDisplayMaterial();
    this.vehicleGlassMaterial = glass;

    const sections = [
      { center: -12.4, length: 6.6, end: -1 as -1 | 0 | 1 },
      { center: -6.2, length: 5.2, end: 0 as -1 | 0 | 1 },
      { center: 0, length: 6.0, end: 0 as -1 | 0 | 1 },
      { center: 6.2, length: 5.2, end: 0 as -1 | 0 | 1 },
      { center: 12.4, length: 6.6, end: 1 as -1 | 0 | 1 }
    ];

    for (const section of sections) {
      const car = new THREE.Group();
      car.name = `Articulated car Ulm Avenio section ${section.center}`;
      car.userData.centerOffsetM = section.center;

      const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.34, section.length - 0.1), lightGrey);
      skirt.position.y = 0.56;
      car.add(skirt);
      this.vehiclePassengerShells.push(skirt);

      const body = new THREE.Mesh(new THREE.BoxGeometry(2.36, 2.56, section.length), shell);
      body.position.y = 1.78;
      body.castShadow = true;
      car.add(body);
      this.vehiclePassengerShells.push(body);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.2, section.length - 0.1), lightGrey);
      roof.position.y = 3.14;
      car.add(roof);
      this.vehiclePassengerShells.push(roof);

      for (const side of [-1, 1] as const) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.12, section.length - 0.2), glossyBlack);
        band.position.set(side * 1.22, 2.28, 0);
        car.add(band);
        this.vehicleWindowBands.push(band);

        const windowCount = section.length > 6 ? 3 : 2;
        for (let index = 0; index < windowCount; index++) {
          const z = -section.length * 0.28 + (index * (section.length * 0.56)) / Math.max(1, windowCount - 1);
          const win = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.88, windowCount === 3 && index === 1 ? 1.25 : 0.98), glass);
          win.position.set(side * 1.24, 2.28, z);
          car.add(win);
        }

        if (section.end === 0 || (section.end < 0 && side < 0) || (section.end > 0 && side > 0)) {
          const doorZ = section.length > 6 ? 0.55 : 0;
          this.addSlidingVehicleDoor(car, side * 1.245, doorZ, doorBlue, glass, glossyBlack, 1.48, 1.95);
          const blueAccent = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.08, 1.62), blue);
          blueAccent.position.set(side * 1.215, 1.75, doorZ);
          car.add(blueAccent);
        }
      }

      const interiorFloor = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, section.length - 0.28), floor);
      interiorFloor.position.y = 0.98;
      car.add(interiorFloor);
      const interiorCeiling = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.08, section.length - 0.34), ceiling);
      interiorCeiling.position.y = 2.98;
      car.add(interiorCeiling);
      this.addOpaqueTransitInterior(car, section.length - 0.34, 1.08, ceiling, (side) => {
        if (section.end === 0 || (section.end < 0 && side < 0) || (section.end > 0 && side > 0)) {
          return [section.length > 6 ? 0.55 : 0];
        }
        return [];
      });

      for (const z of section.length > 6 ? [-1.55, 1.55] : [-1.0, 1.0]) {
        for (const x of [-0.74, 0.74]) {
          const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.54), seat);
          cushion.position.set(x, 1.28, z);
          car.add(cushion);
          const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.11), seat);
          back.position.set(x, 1.62, z - 0.26);
          car.add(back);
        }
      }
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.8, 10), metal);
      pole.position.set(0, 1.95, 0);
      car.add(pole);

      if (section.end !== 0) {
        const cabDirection = section.end;
        const frontPanel = new THREE.Mesh(this.makeCabNose(blue).geometry.clone(), blue);
        frontPanel.scale.set(1.02, 1.02, 0.82);
        frontPanel.position.set(0, 1.86, cabDirection * (section.length / 2 - 0.18));
        if (cabDirection > 0) frontPanel.rotation.y = Math.PI;
        car.add(frontPanel);
        this.vehicleCabShells.push(frontPanel);

        const face = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.92, 0.12), glossyBlack);
        face.position.set(0, 2.12, cabDirection * (section.length / 2 + 0.12));
        car.add(face);
        this.vehicleCabShells.push(face);

        const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.94, 0.08), glass);
        windscreen.position.set(0, 2.44, cabDirection * (section.length / 2 + 0.16));
        windscreen.rotation.x = cabDirection * -0.22;
        car.add(windscreen);

        const routeDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.58, 0.34), ledPanel);
        routeDisplay.position.set(0, 2.98, cabDirection * (section.length / 2 + 0.2));
        if (cabDirection < 0) routeDisplay.rotation.y = Math.PI;
        routeDisplay.renderOrder = 20;
        car.add(routeDisplay);
        this.vehicleCabDisplays.push(routeDisplay);

        const lowerMask = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.34, 0.1), lightGrey);
        lowerMask.position.set(0, 0.84, cabDirection * (section.length / 2 + 0.11));
        car.add(lowerMask);

        const headlightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf8f4d0, emissiveIntensity: 2.0 });
        for (const x of [-0.66, 0.66]) {
          const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.08), headlightMat);
          headlight.position.set(x, 1.1, cabDirection * (section.length / 2 + 0.22));
          car.add(headlight);
        }
      } else {
        const internalDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.42), interiorDisplayMat);
        internalDisplay.position.set(0, 2.76, 0);
        internalDisplay.rotation.y = Math.PI;
        internalDisplay.renderOrder = 18;
        car.add(internalDisplay);
      }

      this.trainCars.push(car);
      this.train.add(car);
    }

    for (const z of [-9.3, -3.1, 3.1, 9.3]) {
      const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.18, 2.24, 0.7), glossyBlack);
      bellows.position.set(0, 1.84, z);
      this.train.add(bellows);
      this.vehiclePassengerShells.push(bellows);
    }

    for (const z of [-9.35, -3.15, 3.15, 9.35]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.36, 1.5), glossyBlack);
      bogie.position.set(0, 0.42, z);
      this.train.add(bogie);
    }

    const roofHvac = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.22, 7.8), lightGrey);
    roofHvac.position.set(0, 3.36, -0.4);
    this.train.add(roofHvac);
    this.addPantograph(new THREE.Vector3(0, 3.58, 2.2), metal);

    this.trainHalfLengthM = 15.6;
    this.scene.add(this.train);
    this.updateVehicleGlass();
  }

  private buildOdessaK1T306Tram(): void {
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.46, metalness: 0.14 });
    const black = new THREE.MeshStandardMaterial({ color: 0x15191d, roughness: 0.18, metalness: 0.34 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf0c31b, roughness: 0.42, metalness: 0.08 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc92f2f, roughness: 0.42, metalness: 0.06 });
    const roofGrey = new THREE.MeshStandardMaterial({ color: 0xa8adb0, roughness: 0.58, metalness: 0.1 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x98c4d7, transparent: true, opacity: 0.42, roughness: 0.05, side: THREE.DoubleSide });
    const floor = new THREE.MeshStandardMaterial({ color: 0x767a7e, roughness: 0.92 });
    const interior = new THREE.MeshStandardMaterial({ color: 0xe0e1dc, roughness: 0.84 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x355d74, roughness: 0.88 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x93989a, roughness: 0.36, metalness: 0.74 });
    const displayMat = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.route.line} ${this.route.destination}`, { width: 700, height: 128, bg: '#101216', fg: '#ffb300' }),
      side: THREE.DoubleSide
    });
    this.vehicleGlassMaterial = glass;
    const interiorDisplayMat = this.makeInteriorDisplayMaterial();

    const sections = [
      { center: -8.7, length: 8.4, cab: -1 as -1 | 0 | 1 },
      { center: 0, length: 7.2, cab: 0 as -1 | 0 | 1 },
      { center: 8.7, length: 8.4, cab: 1 as -1 | 0 | 1 }
    ];

    for (const section of sections) {
      const car = new THREE.Group();
      car.name = `Articulated car Odessa K1T306 section ${section.center}`;
      car.userData.centerOffsetM = section.center;

      const lowerSkirt = new THREE.Mesh(new THREE.BoxGeometry(2.48, 0.34, section.length - 0.08), red);
      lowerSkirt.position.y = 0.56;
      car.add(lowerSkirt);
      this.vehiclePassengerShells.push(lowerSkirt);

      const sideBody = new THREE.Mesh(new THREE.BoxGeometry(2.38, 2.52, section.length), white);
      sideBody.position.y = 1.74;
      sideBody.castShadow = true;
      car.add(sideBody);
      this.vehiclePassengerShells.push(sideBody);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.2, section.length - 0.12), roofGrey);
      roof.position.y = 3.08;
      car.add(roof);
      this.vehiclePassengerShells.push(roof);

      for (const side of [-1, 1] as const) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.12, section.length - 0.2), black);
        band.position.set(side * 1.23, 2.26, 0);
        car.add(band);
        this.vehicleWindowBands.push(band);

        for (const z of section.cab === 0 ? [-1.65, 0, 1.65] : [-2.15, 1.7]) {
          const window = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.92, 1.18), glass);
          window.position.set(side * 1.245, 2.26, z);
          car.add(window);
        }

        const doorCenters = section.cab === 0 ? [-1.6, 1.6] : [section.cab < 0 ? 1.7 : -1.7];
        for (const doorZ of doorCenters) {
          this.addSlidingVehicleDoor(car, side * 1.245, doorZ, yellow, glass, black, 1.62, 1.95);
          const yellowFrame = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.1, 1.78), yellow);
          yellowFrame.position.set(side * 1.215, 1.74, doorZ);
          car.add(yellowFrame);

          if (side < 0) {
            const accessibility = new THREE.Mesh(
              new THREE.PlaneGeometry(0.48, 0.2),
              new THREE.MeshBasicMaterial({
                map: makeLabelTexture('♿  P', { width: 256, height: 96, bg: '#1d4e89', fg: '#ffffff' }),
                side: THREE.DoubleSide,
                transparent: true
              })
            );
            accessibility.position.set(side * 1.14, 1.02, doorZ);
            accessibility.rotation.y = Math.PI / 2;
            car.add(accessibility);
          }
        }
      }

      const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.08, section.length - 0.26), floor);
      floorMesh.position.y = 0.98;
      car.add(floorMesh);
      const ceilingMesh = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.08, section.length - 0.34), interior);
      ceilingMesh.position.y = 2.96;
      car.add(ceilingMesh);
      this.addOpaqueTransitInterior(car, section.length - 0.34, 1.08, interior, () => {
        if (section.cab === 0) return [-1.6, 1.6];
        return [section.cab < 0 ? 1.7 : -1.7];
      });

      for (const z of section.cab === 0 ? [-2.2, 0, 2.2] : [-2.0, 2.0]) {
        for (const x of [-0.78, 0.78]) {
          const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.54), seat);
          cushion.position.set(x, 1.28, z);
          car.add(cushion);
          const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.11), seat);
          back.position.set(x, 1.62, z - 0.26);
          car.add(back);
        }
      }

      for (const z of section.cab === 0 ? [-1.6, 1.6] : [0]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.8, 10), metal);
        pole.position.set(0, 1.94, z);
        car.add(pole);
      }

      if (section.cab !== 0) {
        const cabDir = section.cab;
        const nose = this.makeCabNose(yellow);
        nose.scale.set(1.04, 1.02, 0.82);
        nose.position.set(0, 1.82, cabDir * (section.length / 2 - 0.1));
        if (cabDir > 0) nose.rotation.y = Math.PI;
        car.add(nose);
        this.vehicleCabShells.push(nose);

        const face = new THREE.Mesh(new THREE.BoxGeometry(2.08, 1.96, 0.12), black);
        face.position.set(0, 2.1, cabDir * (section.length / 2 + 0.12));
        car.add(face);
        this.vehicleCabShells.push(face);

        const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.72, 1.08, 0.08), glass);
        windscreen.position.set(0, 2.46, cabDir * (section.length / 2 + 0.18));
        windscreen.rotation.x = cabDir * -0.2;
        car.add(windscreen);

        const routeDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.44, 0.32), displayMat);
        routeDisplay.position.set(0, 3.02, cabDir * (section.length / 2 + 0.21));
        if (cabDir < 0) routeDisplay.rotation.y = Math.PI;
        routeDisplay.renderOrder = 20;
        car.add(routeDisplay);
        this.vehicleCabDisplays.push(routeDisplay);

        const crest = new THREE.Mesh(
          new THREE.PlaneGeometry(0.32, 0.32),
          new THREE.MeshBasicMaterial({
            map: makeLabelTexture('⚓', { width: 128, height: 128, bg: '#0d2f6d', fg: '#f3d04a' }),
            side: THREE.DoubleSide,
            transparent: true
          })
        );
        crest.position.set(-0.48, 1.36, cabDir * (section.length / 2 + 0.2));
        if (cabDir < 0) crest.rotation.y = Math.PI;
        car.add(crest);

        const fleet = new THREE.Mesh(
          new THREE.PlaneGeometry(0.58, 0.16),
          new THREE.MeshBasicMaterial({
            map: makeLabelTexture('7013', { width: 256, height: 96, bg: '#111', fg: '#ffffff' }),
            side: THREE.DoubleSide
          })
        );
        fleet.position.set(0.58, 1.36, cabDir * (section.length / 2 + 0.2));
        if (cabDir < 0) fleet.rotation.y = Math.PI;
        car.add(fleet);

        for (const x of [-0.68, 0.68]) {
          const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.08), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf8f3cf, emissiveIntensity: 2 }));
          headlight.position.set(x, 1.08, cabDir * (section.length / 2 + 0.22));
          car.add(headlight);
        }
      } else {
        const interiorDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.68, 0.42), interiorDisplayMat);
        interiorDisplay.position.set(0, 2.74, 0);
        interiorDisplay.rotation.y = Math.PI;
        interiorDisplay.renderOrder = 18;
        car.add(interiorDisplay);
      }

      this.trainCars.push(car);
      this.train.add(car);
    }

    for (const z of [-4.35, 4.35]) {
      const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.18, 2.18, 0.72), black);
      bellows.position.set(0, 1.8, z);
      this.train.add(bellows);
      this.vehiclePassengerShells.push(bellows);
    }

    for (const z of [-8.25, 0, 8.25]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.36, 1.42), black);
      bogie.position.set(0, 0.42, z);
      this.train.add(bogie);
    }

    const roofEquipment = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.2, 6.8), roofGrey);
    roofEquipment.position.set(0, 3.3, -0.4);
    this.train.add(roofEquipment);
    this.addPantograph(new THREE.Vector3(0, 3.52, 1.3), metal);

    this.trainHalfLengthM = 13.2;
    this.scene.add(this.train);
    this.updateVehicleGlass();
  }

  private buildTrain(): void {
    buildTransitVehicle({
      train: this.train,
      route: this.route,
      city: this.city,
      modeDefinition: this.modeDefinition,
      trainCars: this.trainCars,
      vehicleWindowBands: this.vehicleWindowBands,
      vehicleCabShells: this.vehicleCabShells,
      vehiclePassengerShells: this.vehiclePassengerShells,
      vehicleCabDisplays: this.vehicleCabDisplays,
      vehicleDoorLeaves: this.vehicleDoorLeaves,
      makeInteriorDisplayMaterial: () => this.makeInteriorDisplayMaterial(),
      setVehicleGlassMaterial: (material) => {
        this.vehicleGlassMaterial = material;
      },
      setTrainHalfLengthM: (length) => {
        this.trainHalfLengthM = length;
      }
    });
    this.scene.add(this.train);
    this.updateVehicleGlass();
  }

  private buildOpposingTraffic(): void {
    const trainCount = this.guidewayKind === 'seilbahn' ? 1 : this.route.routeLengthM > 5000 ? 3 : 2;
    for (let index = 0; index < trainCount; index++) {
      const root = this.train.clone(true);
      root.name = `Opposing service ${index + 1}`;
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

  private addTangoCar(
    centerZ: number,
    cabDirection: -1 | 1,
    bodyMat: THREE.Material,
    glassMat: THREE.Material,
    doorMat: THREE.Material,
    blackMat: THREE.Material,
    roofMat: THREE.Material,
    adMat: THREE.Material,
    interiorWallMat: THREE.Material,
    metalMat: THREE.Material,
    interiorDisplayMat: THREE.Material
  ): THREE.Group {
    const car = new THREE.Group();
    car.name = `Articulated car ${centerZ}`;
    car.userData.centerOffsetM = centerZ;
    car.position.z = centerZ;

    const lowerSkirt = new THREE.Mesh(new THREE.BoxGeometry(2.58, 0.38, 17.75), blackMat);
    lowerSkirt.position.y = 0.62;
    lowerSkirt.castShadow = true;
    car.add(lowerSkirt);

    const body = new THREE.Mesh(this.makeTangoBody(), bodyMat);
    body.position.y = 0.52;
    body.castShadow = true;
    car.add(body);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.24, 16.9), roofMat);
    roof.position.y = 3.34;
    roof.castShadow = true;
    car.add(roof);

    const cabZ = cabDirection * 9.56;
    const nose = this.makeCabNose(bodyMat);
    nose.position.set(0, 1.9, cabZ);
    if (cabDirection > 0) nose.rotation.y = Math.PI;
    nose.castShadow = true;
    car.add(nose);
    this.vehicleCabShells.push(nose);

    const cabMask = new THREE.Mesh(new THREE.BoxGeometry(2.28, 1.32, 0.075), blackMat);
    cabMask.position.set(0, 2.35, cabZ + cabDirection * 0.43);
    car.add(cabMask);
    this.vehicleCabShells.push(cabMask);

    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.76, 0.085), glassMat);
    windscreen.position.set(0, 2.48, cabZ + cabDirection * 0.48);
    windscreen.rotation.x = cabDirection * -0.12;
    car.add(windscreen);

    const lowerCabPanel = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.48, 0.1), blackMat);
    lowerCabPanel.position.set(0, 0.92, cabZ + cabDirection * 0.46);
    car.add(lowerCabPanel);

    const headlightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4c7, emissiveIntensity: 2.2 });
    const markerMat = new THREE.MeshStandardMaterial({ color: 0xff2d22, emissive: 0xaa0804, emissiveIntensity: 1.4 });
    for (const x of [-0.78, 0.78]) {
      const headlight = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 20), headlightMat);
      headlight.rotation.x = Math.PI / 2;
      headlight.position.set(x, 1.18, cabZ + cabDirection * 0.53);
      car.add(headlight);

      const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.065, 16), markerMat);
      marker.rotation.x = Math.PI / 2;
      marker.position.set(x, 1.48, cabZ + cabDirection * 0.54);
      car.add(marker);
    }

    for (const side of [-1, 1]) {
      const sideGroup = new THREE.Group();
      sideGroup.position.x = side * 1.345;

      const windowBand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.08, 15.9), blackMat);
      windowBand.position.set(0, 2.31, -cabDirection * 0.25);
      sideGroup.add(windowBand);
      this.vehicleWindowBands.push(windowBand);

      for (const z of [-7.55, -3.45, -0.75, 5.45, 7.45]) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.8, z === -0.75 ? 1.7 : 1.9), glassMat);
        window.position.set(0.02, 2.26, z);
        sideGroup.add(window);
      }

      for (const z of [-5.55, 3.15]) {
        for (const edge of [-1, 1]) {
          const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.11, 2.03, 0.09), blackMat);
          jamb.position.set(0.035, 1.69, z + edge * 0.765);
          sideGroup.add(jamb);
        }
        const doorHeader = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 1.62), blackMat);
        doorHeader.position.set(0.035, 2.67, z);
        sideGroup.add(doorHeader);
        const threshold = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 1.62), blackMat);
        threshold.position.set(0.035, 0.73, z);
        sideGroup.add(threshold);

        for (const direction of [-1, 1] as const) {
          const closedZ = z + direction * 0.36;
          const leafGroup = new THREE.Group();
          leafGroup.name = `Sliding door leaf ${side}/${z}/${direction}`;
          leafGroup.position.z = closedZ;

          for (const edge of [-1, 1] as const) {
            const stile = new THREE.Mesh(new THREE.BoxGeometry(0.125, 1.9, 0.1), doorMat);
            stile.position.set(0.055, 1.69, edge * 0.295);
            leafGroup.add(stile);
          }

          const doorGlass = new THREE.Mesh(new THREE.BoxGeometry(0.082, 1.5, 0.5), glassMat);
          doorGlass.position.set(0.05, 1.9, 0);
          leafGroup.add(doorGlass);

          const upperFrame = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.69), blackMat);
          upperFrame.position.set(0.06, 2.58, 0);
          leafGroup.add(upperFrame);

          const lowerFrame = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.22, 0.69), blackMat);
          lowerFrame.position.set(0.06, 0.9, 0);
          leafGroup.add(lowerFrame);

          const innerEdge = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.88, 0.035), blackMat);
          innerEdge.position.set(0.085, 1.69, -direction * 0.345);
          leafGroup.add(innerEdge);

          sideGroup.add(leafGroup);
          this.vehicleDoorLeaves.push({ group: leafGroup, closedZ, direction });
        }
      }

      const ad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.78, 2.8), adMat);
      ad.position.set(0.07, 1.02, -0.6);
      sideGroup.add(ad);

      const logo = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.55),
        new THREE.MeshBasicMaterial({ map: makeLabelTexture('SSB', { width: 256, height: 96, bg: '#ffdf00', fg: '#111' }) })
      );
      logo.position.set(side * 0.055, 1.03, cabDirection * 6.7);
      logo.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      sideGroup.add(logo);

      car.add(sideGroup);
    }

    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.08, 16.6), roofMat);
    floor.position.y = 1.02;
    car.add(floor);
    this.addInteriorShell(car, cabZ, cabDirection, interiorWallMat, blackMat);
    this.addPassengerSeating(car, cabDirection, metalMat);
    this.addInteriorDisplays(car, cabDirection, interiorDisplayMat, blackMat);

    for (const z of [-5.1, 0, 5.1]) {
      const hvac = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.24, 2.25), roofMat);
      hvac.position.set(0, 3.57, z);
      car.add(hvac);
      for (let vent = -2; vent <= 2; vent++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.03, 0.07), blackMat);
        slat.position.set(0, 3.7, z + vent * 0.28);
        car.add(slat);
      }
    }

    for (const z of [-5.8, 5.8]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.38, 1.85), blackMat);
      bogie.position.set(0, 0.43, z);
      car.add(bogie);

      for (const x of [-0.92, 0.92]) {
        for (const wheelZ of [z - 0.58, z + 0.58]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.2, 24), blackMat);
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(x, 0.37, wheelZ);
          car.add(wheel);
        }
      }
    }

    this.train.add(car);
    return car;
  }

  private addInteriorShell(
    car: THREE.Group,
    cabZ: number,
    cabDirection: -1 | 1,
    wallMaterial: THREE.Material,
    trimMaterial: THREE.Material
  ): void {
    const shell = new THREE.Group();
    shell.name = 'Opaque passenger and cab interior shell';
    const lowerWallSegments = [
      { centerZ: -7.3, length: 1.85 },
      { centerZ: -1.2, length: 7.06 },
      { centerZ: 6.1, length: 4.25 }
    ];

    for (const side of [-1, 1]) {
      for (const segment of lowerWallSegments) {
        const lowerWall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.76, segment.length), wallMaterial);
        lowerWall.position.set(side * 1.255, 1.42, segment.centerZ);
        shell.add(lowerWall);

        const sill = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, segment.length), trimMaterial);
        sill.position.set(side * 1.225, 1.83, segment.centerZ);
        shell.add(sill);
      }

      const upperWall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.48, 16.45), wallMaterial);
      upperWall.position.set(side * 1.145, 2.98, 0);
      shell.add(upperWall);

      const windowHeader = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 16.25), trimMaterial);
      windowHeader.position.set(side * 1.175, 2.72, 0);
      shell.add(windowHeader);

      for (const z of [-8.2, -6.55, -4.45, -2.05, 0.65, 2.1, 4.35, 6.45, 8.2]) {
        const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.86, 0.12), trimMaterial);
        mullion.position.set(side * 1.205, 2.28, z);
        shell.add(mullion);
      }
    }

    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 16.45), wallMaterial);
    ceiling.position.y = 3.18;
    shell.add(ceiling);

    const cabFaceZ = cabZ + cabDirection * 0.53;
    for (const x of [-1.06, 1.06]) {
      const cabPillar = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.42, 0.14), trimMaterial);
      cabPillar.position.set(x, 2.4, cabFaceZ);
      shell.add(cabPillar);
    }
    const cabHeader = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.28, 0.14), wallMaterial);
    cabHeader.position.set(0, 3.02, cabFaceZ);
    shell.add(cabHeader);
    const dashboard = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.48, 0.42), trimMaterial);
    dashboard.position.set(0, 1.5, cabZ + cabDirection * 0.27);
    shell.add(dashboard);

    const gangwayZ = -cabDirection * 9.03;
    for (const x of [-0.91, 0.91]) {
      const endWall = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.95, 0.12), wallMaterial);
      endWall.position.set(x, 2.02, gangwayZ);
      shell.add(endWall);
    }
    const endHeader = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.42, 0.12), wallMaterial);
    endHeader.position.set(0, 2.99, gangwayZ);
    shell.add(endHeader);

    car.add(shell);
  }

  private addPassengerSeating(car: THREE.Group, cabDirection: -1 | 1, metalMaterial: THREE.Material): void {
    const allRows: { z: number; facing: -1 | 1 }[] = [
      { z: -7.7, facing: 1 }, { z: -6.75, facing: -1 },
      { z: -4.25, facing: 1 }, { z: -3.25, facing: -1 },
      { z: -2.25, facing: 1 }, { z: -1.25, facing: -1 },
      { z: -0.25, facing: 1 }, { z: 0.75, facing: -1 },
      { z: 1.7, facing: -1 },
      { z: 4.35, facing: 1 }, { z: 5.35, facing: -1 },
      { z: 6.35, facing: 1 }, { z: 7.35, facing: -1 }
    ];
    const rows = allRows.filter(({ z }) => !(cabDirection < 0 && z < -7.2) && !(cabDirection > 0 && z > 7.2));
    const multiPurposeRows = new Set([-6.75, -4.25, 1.7, 4.35]);
    const seats: { x: number; z: number; facing: -1 | 1; priority: boolean }[] = [];

    rows.forEach(({ z, facing }) => {
      for (const x of [-1.0, -0.58, 0.58, 1.0]) {
        if (x > 0 && multiPurposeRows.has(z)) continue;
        seats.push({ x, z, facing, priority: Math.abs(z + 4.25) < 0.1 || Math.abs(z - 4.35) < 0.1 });
      }
    });

    const cushionMaterial = new THREE.MeshStandardMaterial({ color: 0x416b80, roughness: 0.9 });
    const backMaterial = new THREE.MeshStandardMaterial({ color: 0x365f74, roughness: 0.88 });
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x343b3e, roughness: 0.75, metalness: 0.18 });
    const cushions = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.13, 0.5), cushionMaterial, seats.length);
    const backrests = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.66, 0.12), backMaterial, seats.length);
    const pedestals = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.34, 0.2), baseMaterial, seats.length);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const priorityBlue = new THREE.Color(0x557f91);
    const standardBlue = new THREE.Color(0x416b80);

    seats.forEach((seat, index) => {
      matrix.makeTranslation(seat.x, 1.3, seat.z);
      cushions.setMatrixAt(index, matrix);
      cushions.setColorAt(index, seat.priority ? priorityBlue : standardBlue);

      rotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), seat.facing * -0.08);
      matrix.compose(
        new THREE.Vector3(seat.x, 1.66, seat.z - seat.facing * 0.285),
        rotation,
        new THREE.Vector3(1, 1, 1)
      );
      backrests.setMatrixAt(index, matrix);

      matrix.makeTranslation(seat.x, 1.15, seat.z - seat.facing * 0.08);
      pedestals.setMatrixAt(index, matrix);
    });
    cushions.name = 'SSB paired seat cushions';
    backrests.name = 'SSB paired seat backrests';
    pedestals.name = 'SSB cantilever seat supports';
    cushions.castShadow = true;
    backrests.castShadow = true;
    car.add(cushions, backrests, pedestals);

    const leaningPads = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.12, 0.7, 0.52),
      new THREE.MeshStandardMaterial({ color: 0x496e7d, roughness: 0.9 }),
      multiPurposeRows.size
    );
    [...multiPurposeRows].forEach((z, index) => {
      matrix.makeTranslation(1.18, 1.62, z);
      leaningPads.setMatrixAt(index, matrix);
    });
    leaningPads.name = 'SSB multipurpose-area leaning pads';
    car.add(leaningPads);

    for (const x of [-0.95, 0.95]) {
      const overheadRail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 15.8, 8), metalMaterial);
      overheadRail.position.set(x, 2.88, 0);
      overheadRail.rotation.x = Math.PI / 2;
      car.add(overheadRail);
    }

    const polePositions = [-6.42, -4.68, 2.28, 4.02];
    for (const z of polePositions) {
      for (const x of [-1.08, 1.08]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.75, 8), metalMaterial);
        pole.position.set(x, 1.98, z);
        car.add(pole);
      }
    }
  }

  private addInteriorDisplays(
    car: THREE.Group,
    cabDirection: -1 | 1,
    displayMaterial: THREE.Material,
    casingMaterial: THREE.Material
  ): void {
    for (const side of [-1, 1]) {
      for (const z of [-5.55, 3.15]) {
        const casing = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.54, 1.92), casingMaterial);
        casing.position.set(side * 1.12, 2.88, z);
        car.add(casing);

        const display = new THREE.Mesh(new THREE.PlaneGeometry(1.78, 0.42), displayMaterial);
        display.name = 'SSB next-station door display';
        display.position.set(side * 1.075, 2.88, z);
        display.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        display.renderOrder = 18;
        car.add(display);
      }
    }

    const endZ = cabDirection * 8.3;
    const endCasing = new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.62, 0.1), casingMaterial);
    endCasing.position.set(0, 2.84, endZ + cabDirection * 0.045);
    car.add(endCasing);

    const endDisplay = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.48), displayMaterial);
    endDisplay.name = 'SSB next-station aisle display';
    endDisplay.position.set(0, 2.84, endZ - cabDirection * 0.015);
    endDisplay.rotation.y = cabDirection > 0 ? Math.PI : 0;
    endDisplay.renderOrder = 18;
    car.add(endDisplay);

    const overheadZ = -1.15;
    const overheadCasing = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.58, 0.12), casingMaterial);
    overheadCasing.position.set(0, 2.82, overheadZ);
    car.add(overheadCasing);

    const overheadDisplayRear = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.44), displayMaterial);
    overheadDisplayRear.name = 'SSB overhead next-station display';
    overheadDisplayRear.position.set(0, 2.82, overheadZ - 0.065);
    overheadDisplayRear.rotation.y = Math.PI;
    overheadDisplayRear.renderOrder = 18;
    car.add(overheadDisplayRear);

    const overheadDisplayFront = overheadDisplayRear.clone();
    overheadDisplayFront.position.z = overheadZ + 0.065;
    overheadDisplayFront.rotation.y = 0;
    car.add(overheadDisplayFront);
  }

  private makeTangoBody(): THREE.ExtrudeGeometry {
    const crossSection = new THREE.Shape();
    crossSection.moveTo(-1.325, 0);
    crossSection.lineTo(1.325, 0);
    crossSection.lineTo(1.325, 2.08);
    crossSection.lineTo(1.17, 2.72);
    crossSection.lineTo(-1.17, 2.72);
    crossSection.lineTo(-1.325, 2.08);
    crossSection.closePath();
    const geometry = new THREE.ExtrudeGeometry(crossSection, {
      depth: 18.25,
      bevelEnabled: true,
      bevelSize: 0.025,
      bevelThickness: 0.025,
      bevelSegments: 1
    });
    geometry.translate(0, 0, -9.125);
    return geometry;
  }

  private makeCabNose(material: THREE.Material): THREE.Mesh {
    const shape = new THREE.Shape();
    shape.moveTo(-1.18, -1.28);
    shape.lineTo(1.18, -1.28);
    shape.lineTo(1.04, 1.05);
    shape.lineTo(0.62, 1.36);
    shape.lineTo(-0.62, 1.36);
    shape.lineTo(-1.04, 1.05);
    shape.lineTo(-1.18, -1.28);

    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1.05, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
    geometry.center();
    geometry.rotateX(Math.PI / 2);
    return new THREE.Mesh(geometry, material);
  }

  private makeCoupler(): THREE.Group {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.55 });
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.8), mat);
    arm.position.z = -0.25;
    group.add(arm);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.28, 0.2), mat);
    head.position.z = -0.7;
    group.add(head);
    return group;
  }

  private addPantograph(position: THREE.Vector3, material: THREE.Material): void {
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.14, 0.72), material);
    base.position.copy(position);
    this.train.add(base);

    const points = [
      [new THREE.Vector3(-0.55, 0, -0.2), new THREE.Vector3(0, 0.78, 0)],
      [new THREE.Vector3(0.55, 0, -0.2), new THREE.Vector3(0, 0.78, 0)],
      [new THREE.Vector3(-0.55, 0, 0.2), new THREE.Vector3(0, 0.78, 0)],
      [new THREE.Vector3(0.55, 0, 0.2), new THREE.Vector3(0, 0.78, 0)]
    ];
    for (const [a, b] of points) {
      const curve = new THREE.LineCurve3(a.clone().add(position), b.clone().add(position));
      const arm = new THREE.Mesh(new THREE.TubeGeometry(curve, 1, 0.025, 6), material);
      this.train.add(arm);
    }

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.055, 0.16), material);
    shoe.position.copy(position).add(new THREE.Vector3(0, 0.84, 0));
    this.train.add(shoe);
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
