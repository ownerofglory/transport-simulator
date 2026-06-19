import * as THREE from 'three';
import { makeLabelTexture } from './labels';
import { OsmSceneStreamer } from './osm-scene';
import type { DemoRoute } from './route';
import { TerrainSampler } from './terrain';

type Season = 'spring' | 'summer' | 'autumn' | 'winter';
type GeoPoint = { lat: number; lon: number };

const MAP_TILE_ZOOM = 17;
const MAP_TILE_VISIBLE_RADIUS = 2;
const MAP_TILE_RETAIN_RADIUS = 3;
const EARTH_M_PER_DEG_LAT = 111_320;
const TRACK_GAUGE_M = 2.1;
const TRACK_CENTER_SPACING_M = 4.2;
const ACTIVE_TRACK_OFFSET_M = -TRACK_CENTER_SPACING_M / 2;
const OPPOSITE_TRACK_OFFSET_M = TRACK_CENTER_SPACING_M / 2;

export class StadtbahnWorld {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 5000);
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  readonly train = new THREE.Group();
  readonly curve: THREE.CatmullRomCurve3;
  private cameraMode: 'passenger' | 'cab' | 'chase' = 'chase';
  private readonly stationMarkers: THREE.Object3D[] = [];
  private readonly seasonalObjects = new THREE.Group();
  private readonly mapTiles = new THREE.Group();
  private readonly mapTileMeshes = new Map<string, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>();
  private readonly mapTileLoader = new THREE.TextureLoader();
  private osmScene: OsmSceneStreamer | null = null;
  private terrain: TerrainSampler | null = null;
  private mapTileCenterKey = '';
  private readonly onResizeBound = () => this.onResize();

  constructor(curve: THREE.CatmullRomCurve3, private readonly route: DemoRoute) {
    this.curve = curve;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.setAnimationLoop(null);

    this.scene.background = new THREE.Color(0xaac8df);
    this.scene.fog = new THREE.Fog(0xaac8df, 900, 2800);
    if (route.elevationDatumM !== undefined) this.terrain = new TerrainSampler(route.elevationDatumM);
    this.mapTileLoader.setCrossOrigin('anonymous');
    this.scene.add(this.mapTiles);

    this.camera.position.set(0, 5, -12);
    this.setupLighting();
    this.buildGround();
    this.buildMapTiles();
    this.buildTrack();
    this.buildTunnels();
    this.buildStations();
    this.buildTrain();
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
    return this.cameraMode;
  }

  updateTrain(distanceM: number): void {
    const t = THREE.MathUtils.clamp(distanceM / this.route.routeLengthM, 0, 1);
    const tangent = this.curve.getTangentAt(t).normalize();
    const normal = this.normalAt(t);
    const position = this.curve.getPointAt(t).add(normal.clone().multiplyScalar(ACTIVE_TRACK_OFFSET_M));
    const yaw = Math.atan2(tangent.x, tangent.z);

    this.updateMapTiles(t);
    this.osmScene?.update(this.geoPointAt(t));
    this.train.position.copy(position).add(new THREE.Vector3(0, 0.2, 0));
    this.train.rotation.set(0, yaw, 0);
    this.updateCamera(position, tangent, yaw);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResizeBound);
    for (const mesh of this.mapTileMeshes.values()) {
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
    }
    this.mapTileMeshes.clear();
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
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({ color: 0x4c6f45, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(bounds.center.x, this.terrain ? -180 : 0, bounds.center.z);
    ground.receiveShadow = true;
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

  private buildMapTiles(): void {
    const points = this.routeGeoPoints();
    if (points.length < 2) return;

    this.updateMapTiles(0);
  }

  private updateMapTiles(routeT: number): void {
    const point = this.geoPointAt(routeT);
    if (!point) return;

    const center = this.geoToTile(point, MAP_TILE_ZOOM);
    const centerKey = `${center.x}/${center.y}`;
    if (centerKey === this.mapTileCenterKey) return;
    this.mapTileCenterKey = centerKey;

    for (let dx = -MAP_TILE_VISIBLE_RADIUS; dx <= MAP_TILE_VISIBLE_RADIUS; dx++) {
      for (let dy = -MAP_TILE_VISIBLE_RADIUS; dy <= MAP_TILE_VISIBLE_RADIUS; dy++) {
        this.ensureMapTile(center.x + dx, center.y + dy);
      }
    }

    for (const [key, mesh] of this.mapTileMeshes) {
      const [tileX, tileY] = key.split('/').map(Number);
      if (Math.abs(tileX - center.x) <= MAP_TILE_RETAIN_RADIUS && Math.abs(tileY - center.y) <= MAP_TILE_RETAIN_RADIUS) {
        continue;
      }

      this.mapTiles.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
      this.mapTileMeshes.delete(key);
    }
  }

  private ensureMapTile(x: number, y: number): void {
    const key = `${x}/${y}`;
    if (this.mapTileMeshes.has(key)) return;

    const bounds = this.tileBounds(x, y, MAP_TILE_ZOOM);
    const northWest = this.projectGeo(bounds.north, bounds.west);
    const southEast = this.projectGeo(bounds.south, bounds.east);
    const center = new THREE.Vector3((northWest.x + southEast.x) / 2, 0.026, (northWest.z + southEast.z) / 2);
    const width = Math.abs(southEast.x - northWest.x);
    const depth = Math.abs(northWest.z - southEast.z);
    const texture = this.mapTileLoader.load(`https://tile.openstreetmap.org/${MAP_TILE_ZOOM}/${x}/${y}.png`);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;

    const geometry = new THREE.PlaneGeometry(width, depth, this.terrain ? 12 : 1, this.terrain ? 12 : 1);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(center);
    mesh.receiveShadow = true;
    this.mapTiles.add(mesh);
    this.mapTileMeshes.set(key, mesh);
    if (this.terrain) {
      void this.terrain.deformPlane(geometry, bounds).catch((error) => {
        console.warn(`Could not apply terrain relief to map tile ${key}.`, error);
      });
    }
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
    const platformMat = new THREE.MeshStandardMaterial({ color: 0xb7b2a8, roughness: 0.86 });
    const shelterMat = new THREE.MeshStandardMaterial({ color: 0x3d4e5d, roughness: 0.42, metalness: 0.1 });

    for (const station of this.route.stations) {
      const t = THREE.MathUtils.clamp(station.distanceM / this.route.routeLengthM, 0, 1);
      const p = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      const normal = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
      const yaw = Math.atan2(tangent.x, tangent.z);

      for (const side of [-1, 1]) {
        const platform = new THREE.Mesh(new THREE.BoxGeometry(8, 0.32, 72), platformMat);
        platform.position.copy(p).add(normal.clone().multiplyScalar(side * 7.4)).add(new THREE.Vector3(0, 0.16, 0));
        platform.rotation.y = yaw;
        platform.receiveShadow = true;
        this.scene.add(platform);

        const shelter = new THREE.Mesh(new THREE.BoxGeometry(5.5, 2.6, 9), shelterMat);
        shelter.position.copy(p).add(normal.clone().multiplyScalar(side * 8.7)).add(tangent.clone().multiplyScalar(12)).add(new THREE.Vector3(0, 1.45, 0));
        shelter.rotation.y = yaw;
        shelter.castShadow = true;
        this.scene.add(shelter);
      }

      const signTexture = makeLabelTexture(station.name);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 2.5),
        new THREE.MeshBasicMaterial({ map: signTexture, side: THREE.DoubleSide })
      );
      sign.position.copy(p).add(normal.clone().multiplyScalar(8.8)).add(new THREE.Vector3(0, 3.2, 0));
      sign.rotation.y = yaw;
      this.scene.add(sign);
      this.stationMarkers.push(sign);
    }
  }

  private buildTrain(): void {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffdf00, roughness: 0.52, metalness: 0.05 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.38 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x91c7dd, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.74 });
    const adMat = new THREE.MeshStandardMaterial({ color: 0x1d66ff, roughness: 0.5 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xd7d0bf, roughness: 0.72, metalness: 0.05 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xf6c900, roughness: 0.48 });
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x11151b, roughness: 0.8 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x8a8f91, roughness: 0.4, metalness: 0.65 });

    this.addTangoCar(-9.95, -1, bodyMat, glassMat, doorMat, blackMat, roofMat, adMat);
    this.addTangoCar(9.95, 1, bodyMat, glassMat, doorMat, blackMat, roofMat, adMat);

    const gangway = new THREE.Mesh(new THREE.BoxGeometry(2.42, 2.48, 1.05), rubberMat);
    gangway.position.set(0, 1.78, 0);
    gangway.castShadow = true;
    this.train.add(gangway);

    const couplerFront = this.makeCoupler();
    couplerFront.position.set(0, 0.25, -20.15);
    this.train.add(couplerFront);

    const couplerRear = this.makeCoupler();
    couplerRear.position.set(0, 0.25, 20.15);
    couplerRear.rotation.y = Math.PI;
    this.train.add(couplerRear);

    const destinationFront = new THREE.Mesh(
      new THREE.PlaneGeometry(2.55, 0.58),
      new THREE.MeshBasicMaterial({ map: makeLabelTexture(`${this.route.line} ${this.route.destination}`, { width: 512, height: 128, bg: '#111', fg: '#ffd900' }) })
    );
    destinationFront.position.set(0, 2.78, -19.86);
    destinationFront.rotation.y = Math.PI;
    this.train.add(destinationFront);

    const destinationRear = destinationFront.clone();
    destinationRear.position.set(0, 2.78, 19.86);
    destinationRear.rotation.y = 0;
    this.train.add(destinationRear);

    this.addPantograph(new THREE.Vector3(-0.2, 3.75, 4.6), metalMat);

    this.scene.add(this.train);
  }

  private addTangoCar(
    centerZ: number,
    cabDirection: -1 | 1,
    bodyMat: THREE.Material,
    glassMat: THREE.Material,
    doorMat: THREE.Material,
    blackMat: THREE.Material,
    roofMat: THREE.Material,
    adMat: THREE.Material
  ): void {
    const car = new THREE.Group();
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

    const cabMask = new THREE.Mesh(new THREE.BoxGeometry(2.28, 1.32, 0.075), blackMat);
    cabMask.position.set(0, 2.35, cabZ + cabDirection * 0.43);
    car.add(cabMask);

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

      for (const z of [-7.55, -3.45, -0.75, 5.45, 7.45]) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.8, z === -0.75 ? 1.7 : 1.9), glassMat);
        window.position.set(0.02, 2.26, z);
        sideGroup.add(window);
      }

      for (const z of [-5.55, 3.15]) {
        const doorSeal = new THREE.Mesh(new THREE.BoxGeometry(0.11, 2.03, 1.58), blackMat);
        doorSeal.position.set(0.035, 1.69, z);
        sideGroup.add(doorSeal);

        const door = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.9, 1.43), doorMat);
        door.position.set(0.055, 1.69, z);
        sideGroup.add(door);

        const doorGlass = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.82, 0.82), glassMat);
        doorGlass.position.set(0.075, 2.08, z);
        sideGroup.add(doorGlass);

        const doorSplit = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.88, 0.035), blackMat);
        doorSplit.position.set(0.085, 1.69, z);
        sideGroup.add(doorSplit);
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
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x315b78, roughness: 0.82 });
    for (const z of [-7.1, -4.2, -1.5, 1.4, 4.4, 7.1]) {
      for (const x of [-0.86, 0.86]) {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.62, 0.72), seatMat);
        seat.position.set(x, 1.38, z);
        car.add(seat);
      }
    }

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

  private makeTrackStrip(offsetM: number, widthM: number, segments: number): THREE.BufferGeometry {
    const vertices: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const center = this.curve.getPointAt(t).add(this.normalAt(t).multiplyScalar(offsetM)).add(new THREE.Vector3(0, 0.035, 0));
      const halfWidth = this.normalAt(t).multiplyScalar(widthM / 2);
      const left = center.clone().sub(halfWidth);
      const right = center.clone().add(halfWidth);
      vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
      uvs.push(0, t * 20, 1, t * 20);
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
    return (this.route.geoPoints ?? []).map(([lat, lon]) => ({ lat, lon }));
  }

  private geoPointAt(t: number): GeoPoint | undefined {
    const points = this.routeGeoPoints();
    if (points.length === 0) return undefined;
    if (points.length === 1) return points[0];

    const scaled = THREE.MathUtils.clamp(t, 0, 1) * (points.length - 1);
    const index = Math.min(Math.floor(scaled), points.length - 2);
    const fraction = scaled - index;
    return {
      lat: THREE.MathUtils.lerp(points[index].lat, points[index + 1].lat, fraction),
      lon: THREE.MathUtils.lerp(points[index].lon, points[index + 1].lon, fraction)
    };
  }

  private geoToTile(point: GeoPoint, zoom: number): { x: number; y: number } {
    const latRad = (point.lat * Math.PI) / 180;
    const n = 2 ** zoom;
    return {
      x: Math.floor(((point.lon + 180) / 360) * n),
      y: Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
    };
  }

  private tileBounds(x: number, y: number, z: number): { north: number; south: number; west: number; east: number } {
    const n = 2 ** z;
    const west = (x / n) * 360 - 180;
    const east = ((x + 1) / n) * 360 - 180;
    const north = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    const south = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
    return { north, south, west, east };
  }

  private projectGeo(lat: number, lon: number): THREE.Vector3 {
    const origin = this.routeGeoPoints()[0];
    if (!origin) return new THREE.Vector3(0, 0, 0);
    const lonScale = Math.cos((origin.lat * Math.PI) / 180) * EARTH_M_PER_DEG_LAT;
    return new THREE.Vector3(-(lon - origin.lon) * lonScale, 0, (lat - origin.lat) * EARTH_M_PER_DEG_LAT);
  }

  private updateCamera(position: THREE.Vector3, tangent: THREE.Vector3, yaw: number): void {
    const normal = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
    let camPos: THREE.Vector3;
    let lookAt: THREE.Vector3;

    if (this.cameraMode === 'passenger') {
      camPos = position.clone().add(normal.clone().multiplyScalar(1.3)).add(new THREE.Vector3(0, 3.0, 0));
      lookAt = position.clone().add(tangent.clone().multiplyScalar(120)).add(normal.clone().multiplyScalar(5)).add(new THREE.Vector3(0, 2.6, 0));
    } else if (this.cameraMode === 'cab') {
      camPos = position.clone().add(tangent.clone().multiplyScalar(-9.6)).add(new THREE.Vector3(0, 3.1, 0));
      lookAt = position.clone().add(tangent.clone().multiplyScalar(120)).add(new THREE.Vector3(0, 2.2, 0));
    } else {
      camPos = position.clone().add(tangent.clone().multiplyScalar(-34)).add(new THREE.Vector3(0, 16, 0));
      lookAt = position.clone().add(new THREE.Vector3(0, 2, 0));
    }

    this.camera.position.lerp(camPos, 0.12);
    this.camera.lookAt(lookAt);
    this.train.rotation.y = yaw;
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
