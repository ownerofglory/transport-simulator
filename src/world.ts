import * as THREE from 'three';
import { makeLabelTexture } from './labels';
import { OsmSceneStreamer } from './osm-scene';
import type { DemoRoute } from './route';
import { TerrainSampler } from './terrain';

type Season = 'spring' | 'summer' | 'autumn' | 'winter';
type GeoPoint = { lat: number; lon: number };

const EARTH_M_PER_DEG_LAT = 111_320;
const TRACK_GAUGE_M = 2.1;
const TRACK_CENTER_SPACING_M = 4.2;
const ACTIVE_TRACK_OFFSET_M = -TRACK_CENTER_SPACING_M / 2;
const OPPOSITE_TRACK_OFFSET_M = TRACK_CENTER_SPACING_M / 2;
const DOUBLE_FORMATION_LINES = new Set(['U1', 'U6', 'U7', 'U11', 'U12', 'U19']);

export class StadtbahnWorld {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 5000);
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  readonly train = new THREE.Group();
  readonly curve: THREE.CatmullRomCurve3;
  private cameraMode: 'passenger' | 'cab' | 'chase' = 'chase';
  private readonly stationMarkers: THREE.Object3D[] = [];
  private readonly seasonalObjects = new THREE.Group();
  private readonly trainCars: THREE.Group[] = [];
  private readonly opposingTrains: { root: THREE.Group; cars: THREE.Group[]; phaseM: number }[] = [];
  private readonly vehicleWindowBands: THREE.Mesh[] = [];
  private readonly vehicleCabShells: THREE.Mesh[] = [];
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
  private osmScene: OsmSceneStreamer | null = null;
  private terrain: TerrainSampler | null = null;
  private readonly onResizeBound = () => this.onResize();

  constructor(
    curve: THREE.CatmullRomCurve3,
    private readonly route: DemoRoute,
    private readonly networkRoutes: DemoRoute[] = [route]
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
    this.renderer.setAnimationLoop(null);

    this.scene.background = new THREE.Color(0xaac8df);
    this.scene.fog = new THREE.Fog(0xaac8df, 900, 2800);
    if (route.elevationDatumM !== undefined) this.terrain = new TerrainSampler(route.elevationDatumM);

    this.camera.position.set(0, 5, -12);
    this.setupLighting();
    this.buildGround();
    this.buildAdjacentLines();
    this.buildTrack();
    this.buildTunnels();
    this.buildStations();
    this.buildTrain();
    this.buildOpposingTraffic();
    if (this.routeGeoPoints().length >= 2) {
      this.osmScene = new OsmSceneStreamer(
        this.scene,
        (lat, lon) => this.projectGeo(lat, lon),
        (lat, lon) => this.terrain?.sample(lat, lon) ?? Promise.resolve(0)
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
  }

  cycleCamera(): string {
    this.cameraMode = this.cameraMode === 'chase' ? 'passenger' : this.cameraMode === 'passenger' ? 'cab' : 'chase';
    this.updateVehicleGlass();
    return this.cameraMode;
  }

  private updateVehicleGlass(): void {
    if (!this.vehicleGlassMaterial) return;
    const interiorView = this.cameraMode === 'passenger' || this.cameraMode === 'cab';
    const cabView = this.cameraMode === 'cab';
    this.vehicleGlassMaterial.opacity = interiorView ? 0.1 : 0.58;
    this.vehicleGlassMaterial.depthWrite = !interiorView;
    this.vehicleGlassMaterial.color.setHex(interiorView ? 0xd9f2f8 : 0x91c7dd);
    this.vehicleGlassMaterial.needsUpdate = true;
    for (const band of this.vehicleWindowBands) band.visible = !interiorView;
    for (const shell of this.vehicleCabShells) shell.visible = !cabView;
    for (const display of this.vehicleCabDisplays) display.visible = !cabView;
  }

  updateTrain(distanceM: number, doorsOpen = false, deltaSeconds = 1 / 60, nextStation = ''): void {
    const t = THREE.MathUtils.clamp(distanceM / this.route.routeLengthM, 0, 1);
    const underground = this.stationIsUnderground(t);
    const tangent = this.curve.getTangentAt(t).normalize();
    const normal = this.normalAt(t);
    const position = this.curve.getPointAt(t).add(normal.clone().multiplyScalar(ACTIVE_TRACK_OFFSET_M));

    this.osmScene?.update(this.geoPointAt(t));
    if (this.ground) this.ground.visible = !underground;
    if (this.osmScene) this.osmScene.group.visible = !underground;
    this.updateDoors(doorsOpen, deltaSeconds);
    this.updateInteriorDisplay(nextStation, doorsOpen);
    this.updateArticulatedVehicle(this.train, this.trainCars, distanceM, 1, ACTIVE_TRACK_OFFSET_M);
    for (const traffic of this.opposingTrains) {
      const opposingDistance = this.wrapDistance(this.route.routeLengthM - distanceM + traffic.phaseM);
      this.updateArticulatedVehicle(traffic.root, traffic.cars, opposingDistance, -1, OPPOSITE_TRACK_OFFSET_M);
    }
    this.updateCamera(position, tangent, t);
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
    context.fillStyle = '#ffd800';
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

    context.fillStyle = '#ffd800';
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

  private setupLighting(): void {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x607080, 1.3);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-220, 380, -120);
    sun.castShadow = true;
    sun.shadow.camera.left = -400;
    sun.shadow.camera.right = 400;
    sun.shadow.camera.top = 400;
    sun.shadow.camera.bottom = -400;
    this.scene.add(sun);
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

  private buildAdjacentLines(): void {
    const selectedGeo = this.routeGeoPoints();
    if (selectedGeo.length < 2) return;
    const renderedLines = new Set<string>([this.route.line]);

    for (const candidate of this.networkRoutes) {
      if (renderedLines.has(candidate.line) || !candidate.geoPoints || candidate.geoPoints.length < 2) continue;
      const runs: THREE.Vector3[][] = [];
      let run: THREE.Vector3[] = [];
      for (const [lat, lon] of candidate.geoPoints) {
        const projected = this.projectGeo(lat, lon);
        const nearest = this.nearestSelectedGeoPoint(lat, lon, selectedGeo);
        if (nearest.distanceM <= 42) {
          projected.y = this.curve.getPointAt(nearest.t).y + 0.48;
          run.push(projected);
        } else if (run.length) {
          if (run.length >= 3) runs.push(run);
          run = [];
        }
      }
      if (run.length >= 3) runs.push(run);
      if (runs.length === 0) continue;

      renderedLines.add(candidate.line);
      const color = new THREE.Color(candidate.color ?? '#f0d000');
      const material = new THREE.MeshBasicMaterial({ color });
      for (const points of runs) {
        const smooth = new THREE.CatmullRomCurve3(points, false, 'centripetal');
        const tube = new THREE.Mesh(new THREE.TubeGeometry(smooth, Math.max(12, points.length * 2), 0.13, 6), material);
        tube.name = `Adjacent ${candidate.line}`;
        this.scene.add(tube);
      }

      const anchor = runs[0][Math.floor(runs[0].length / 2)];
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(candidate.line, { width: 256, height: 128, bg: candidate.color ?? '#ffd900', fg: candidate.textColor ?? '#111' }) }));
      badge.position.copy(anchor).add(new THREE.Vector3(0, 4.5, 0));
      badge.scale.set(7, 3.5, 1);
      badge.name = `Adjacent line badge ${candidate.line}`;
      this.scene.add(badge);
    }
  }

  private nearestSelectedGeoPoint(lat: number, lon: number, points: GeoPoint[]): { distanceM: number; t: number } {
    const lonScale = Math.cos((lat * Math.PI) / 180) * EARTH_M_PER_DEG_LAT;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestIndex = 0;
    for (let index = 0; index < points.length; index++) {
      const distance = Math.hypot((points[index].lat - lat) * EARTH_M_PER_DEG_LAT, (points[index].lon - lon) * lonScale);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    const totalDistanceM = this.routeGeoDistancesM.at(-1) ?? 0;
    return {
      distanceM: bestDistance,
      t: totalDistanceM > 0 ? (this.routeGeoDistancesM[bestIndex] ?? 0) / totalDistanceM : 0
    };
  }

  private buildTrack(): void {
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x7f858a, metalness: 0.7, roughness: 0.28 });
    const sleeperMaterial = new THREE.MeshStandardMaterial({ color: 0x453429, roughness: 0.85 });
    const ballastMaterial = new THREE.MeshStandardMaterial({ color: 0x6d6a63, roughness: 0.95 });

    for (const trackOffset of [ACTIVE_TRACK_OFFSET_M, OPPOSITE_TRACK_OFFSET_M]) {
      const ballast = new THREE.Mesh(this.makeTrackStrip(trackOffset, 4.5, 260), ballastMaterial);
      ballast.receiveShadow = true;
      this.scene.add(ballast);

      for (const railOffset of [-TRACK_GAUGE_M / 2, TRACK_GAUGE_M / 2]) {
        const points = this.offsetCurvePoints(trackOffset + railOffset, 260, 0.22);
        const railCurve = new THREE.CatmullRomCurve3(points);
        const rail = new THREE.Mesh(new THREE.TubeGeometry(railCurve, 260, 0.08, 8), railMaterial);
        rail.castShadow = true;
        this.scene.add(rail);
      }
    }

    const sleeperGeo = new THREE.BoxGeometry(3.2, 0.15, 0.55);
    for (const trackOffset of [ACTIVE_TRACK_OFFSET_M, OPPOSITE_TRACK_OFFSET_M]) {
      for (let i = 0; i < 120; i++) {
        const t = i / 119;
        const p = this.curve.getPointAt(t).add(this.normalAt(t).multiplyScalar(trackOffset));
        const tangent = this.curve.getTangentAt(t).normalize();
        const yaw = Math.atan2(tangent.x, tangent.z);
        const sleeper = new THREE.Mesh(sleeperGeo, sleeperMaterial);
        sleeper.position.copy(p).add(new THREE.Vector3(0, 0.08, 0));
        sleeper.rotation.y = yaw + Math.PI / 2;
        sleeper.receiveShadow = true;
        this.scene.add(sleeper);
      }
    }
  }

  private buildTunnels(): void {
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

  private stationIsUnderground(t: number): boolean {
    if (this.route.tunnelRanges?.length) {
      const distanceM = THREE.MathUtils.clamp(t, 0, 1) * this.route.routeLengthM;
      return this.route.tunnelRanges.some((range) => distanceM >= range.startM && distanceM <= range.endM);
    }
    const mask = this.route.tunnelMask;
    if (!mask?.length) return false;
    const { index, fraction } = this.geoSegmentAt(t);
    return Boolean(mask[Math.min(mask.length - 1, Math.round(index + fraction))]);
  }

  private buildTrain(): void {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffdf00, roughness: 0.52, metalness: 0.05 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.38 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x91c7dd,
      roughness: 0.08,
      metalness: 0.02,
      transparent: true,
      opacity: 0.58,
      depthWrite: true,
      side: THREE.DoubleSide
    });
    this.vehicleGlassMaterial = glassMat;
    const adMat = new THREE.MeshStandardMaterial({ color: 0x1d66ff, roughness: 0.5 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xd7d0bf, roughness: 0.72, metalness: 0.05 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xf6c900, roughness: 0.48 });
    const interiorWallMat = new THREE.MeshStandardMaterial({ color: 0xd9d5ca, roughness: 0.88 });
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x11151b, roughness: 0.8 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x8a8f91, roughness: 0.4, metalness: 0.65 });
    const interiorDisplayMat = this.makeInteriorDisplayMaterial();

    const doubleFormation = DOUBLE_FORMATION_LINES.has(this.route.line);
    const carCenters = doubleFormation ? [-29.85, -9.95, 9.95, 29.85] : [-9.95, 9.95];
    const cabDirections: (-1 | 1)[] = doubleFormation ? [-1, 1, -1, 1] : [-1, 1];
    this.trainHalfLengthM = doubleFormation ? 40.05 : 20.15;
    carCenters.forEach((center, index) => {
      this.trainCars.push(this.addTangoCar(center, cabDirections[index], bodyMat, glassMat, doorMat, blackMat, roofMat, adMat, interiorWallMat, metalMat, interiorDisplayMat));
    });

    for (const z of doubleFormation ? [-19.9, 19.9] : [0]) {
      const gangway = new THREE.Mesh(new THREE.BoxGeometry(2.42, 2.48, 1.05), rubberMat);
      gangway.position.set(0, 1.78, z);
      gangway.castShadow = true;
      this.train.add(gangway);
    }

    if (doubleFormation) {
      const middleCouplerA = this.makeCoupler();
      middleCouplerA.position.set(0, 0.25, 0.55);
      this.train.add(middleCouplerA);
      const middleCouplerB = this.makeCoupler();
      middleCouplerB.position.set(0, 0.25, -0.55);
      middleCouplerB.rotation.y = Math.PI;
      this.train.add(middleCouplerB);
    }

    const couplerFront = this.makeCoupler();
    couplerFront.position.set(0, 0.25, -this.trainHalfLengthM);
    this.train.add(couplerFront);

    const couplerRear = this.makeCoupler();
    couplerRear.position.set(0, 0.25, this.trainHalfLengthM);
    couplerRear.rotation.y = Math.PI;
    this.train.add(couplerRear);

    const destinationFront = new THREE.Mesh(
      new THREE.PlaneGeometry(2.55, 0.58),
      new THREE.MeshBasicMaterial({
        map: makeLabelTexture(`${this.route.line} ${this.route.destination}`, { width: 512, height: 128, bg: '#111', fg: '#ffd900' }),
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
      })
    );
    destinationFront.name = 'Front cab route display';
    destinationFront.position.set(0, 2.78, -10.2);
    destinationFront.rotation.y = Math.PI;
    destinationFront.renderOrder = 20;
    this.trainCars[0].add(destinationFront);

    const destinationRear = destinationFront.clone();
    destinationRear.name = 'Rear cab route display';
    destinationRear.position.set(0, 2.78, 10.2);
    destinationRear.rotation.y = 0;
    this.trainCars.at(-1)?.add(destinationRear);
    this.vehicleCabDisplays.push(destinationFront, destinationRear);

    for (const z of doubleFormation ? [-15.3, 24.5] : [4.6]) {
      this.addPantograph(new THREE.Vector3(-0.2, 3.75, z), metalMat);
    }

    this.scene.add(this.train);
    this.updateVehicleGlass();
  }

  private buildOpposingTraffic(): void {
    const trainCount = this.route.routeLengthM > 5000 ? 3 : 2;
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
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
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

          const door = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.9, 0.69), doorMat);
          door.position.set(0.055, 1.69, 0);
          leafGroup.add(door);

          const doorGlass = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.82, 0.4), glassMat);
          doorGlass.position.set(0.075, 2.08, 0);
          leafGroup.add(doorGlass);

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

  private updateCamera(position: THREE.Vector3, tangent: THREE.Vector3, routeT: number): void {
    const normal = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
    const underground = this.stationIsUnderground(routeT);
    let camPos: THREE.Vector3;
    let lookAt: THREE.Vector3;

    if (this.cameraMode === 'passenger') {
      camPos = position.clone()
        .add(tangent.clone().multiplyScalar(4.2))
        .add(normal.clone().multiplyScalar(0.08))
        .add(new THREE.Vector3(0, 2.3, 0));
      lookAt = position.clone().add(tangent.clone().multiplyScalar(85)).add(normal.clone().multiplyScalar(1.5)).add(new THREE.Vector3(0, 2.25, 0));
    } else if (this.cameraMode === 'cab') {
      camPos = position.clone().add(tangent.clone().multiplyScalar(this.trainHalfLengthM - 1.75)).add(new THREE.Vector3(0, 2.65, 0));
      lookAt = position.clone().add(tangent.clone().multiplyScalar(120)).add(new THREE.Vector3(0, 2.2, 0));
    } else if (underground) {
      camPos = position.clone().add(tangent.clone().multiplyScalar(-(this.trainHalfLengthM + 22))).add(new THREE.Vector3(0, 4.6, 0));
      lookAt = position.clone().add(tangent.clone().multiplyScalar(12)).add(new THREE.Vector3(0, 1.8, 0));
    } else {
      camPos = position.clone().add(tangent.clone().multiplyScalar(-(this.trainHalfLengthM + 14))).add(new THREE.Vector3(0, 16, 0));
      lookAt = position.clone().add(new THREE.Vector3(0, 2, 0));
    }

    this.camera.position.lerp(camPos, 0.12);
    this.camera.lookAt(lookAt);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
