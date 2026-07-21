import * as THREE from 'three';
import { OsmSceneStreamer } from '../../osm-scene';
import { makeProjection, type LatLon, type Projection } from './liveProjection';
import type { LiveVehicleStore, TrackedVehicle } from './LiveVehicleStore';
import { LiveVehicleModels } from './LiveVehicleModels';
import { LiveTerrain } from './LiveTerrain';
import { daylightAt } from './liveDaylight';
import { LiveTunnelIndex } from './LiveTunnelIndex';
import { LiveTunnelLayer, TUNNEL_DEPTH_M } from './LiveTunnelLayer';
import { ALL_LIVE_MODES, modeColor, type LiveMode } from './liveTypes';
import type { BBox } from './viewport';

// Free-flight 3D view over the live network (concept §2.2/§4): reused OSM scenery
// on Mapzen terrain relief (LiveTerrain), with near vehicles as full procedural
// models (LiveVehicleModels) and the rest as mode-colored instanced blocks, plus
// tunnel glows/linings for underground runs. Everything is placed at terrain
// height via LiveTerrain.heightAt so buildings, vehicles and follow camera share
// the same ground.

const DEG = Math.PI / 180;

// Camera altitude clamp (concept §2.2: ~80 m to ~12 km). Above the top we hand
// back to the map.
const MIN_DISTANCE_M = 120;
const MAX_DISTANCE_M = 12_000;
// Vehicle block dimensions (metres); size-exaggerated a touch so they read.
const CAR_LEN = 22;
const CAR_W = 3.0;
const CAR_H = 3.4;
const MAX_PER_MODE = 1024;

type Live3DOptions = {
  store: LiveVehicleStore;
  origin: LatLon;
  /** Reports the camera ground footprint for viewport-bounded polling. */
  onViewport: (bbox: BBox, syntheticZoom: number) => void;
  /** Fired when the user zooms out past the top of the altitude band. */
  onExitToMap: () => void;
  /** Opens the shared live-vehicle info card for a picked vehicle. */
  onSelect: (runId: string) => void;
  /** Stops a locked follow when the user takes manual camera control. */
  onStopFollow: () => void;
};

export class Live3DScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly projection: Projection;
  private readonly streamer: OsmSceneStreamer;

  // Orbit/fly rig state.
  private readonly target = new THREE.Vector3(0, 0, 0);
  private distance = 700;
  private azimuth = 0;
  private polar = 0.75; // radians from +Y; clamped so we never go underground

  private readonly meshes = new Map<LiveMode, THREE.InstancedMesh>();
  private readonly tunnelGlows = new Map<LiveMode, THREE.InstancedMesh>();
  private readonly instanceRunIds = new Map<LiveMode, string[]>();
  private readonly tunnelGlowRunIds = new Map<LiveMode, string[]>();
  private readonly dummy = new THREE.Object3D();
  // Near-field full vehicle models + line labels (LOD upgrade over the blocks).
  private readonly models: LiveVehicleModels;
  private readonly tunnelIndex = new LiveTunnelIndex();
  private readonly tunnels: LiveTunnelLayer;
  private readonly terrain: LiveTerrain;
  private readonly ground: THREE.Mesh;
  // Lighting follows real local time (concept §2.5).
  private readonly sun = new THREE.DirectionalLight(0xffffff, 1.6);
  private readonly hemi = new THREE.HemisphereLight(0xdfeeff, 0x50603a, 1.0);
  private lastLightingMs = 0;
  private followRunId: string | null = null;

  private raf: number | null = null;
  private lastTime = 0;
  private disposed = false;

  // Viewport reporting throttle.
  private lastReport = 0;
  private cameraDirty = true;

  // Pointer drag state.
  private dragButton = -1;
  private lastPointer = { x: 0, y: 0 };
  private pointerStart = { x: 0, y: 0 };

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: Live3DOptions
  ) {
    this.projection = makeProjection(opts.origin);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x9fc6e8);
    this.scene.fog = new THREE.Fog(0x9fc6e8, 3000, 14000);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 30_000);
    this.updateCamera();

    // Soft sky/ground hemisphere plus a directional sun, both driven by the
    // real local time of day (updated periodically in the frame loop).
    this.scene.add(this.hemi);
    this.scene.add(this.sun);
    this.applyDaylight();

    // Terrain relief around the fixed origin doubles as the base ground (so there
    // is no void before OSM tiles stream in) and the height source for everything
    // placed in the scene.
    this.terrain = new LiveTerrain(this.projection);
    this.ground = this.terrain.mesh;
    this.scene.add(this.ground);

    // Reused OSM scenery streamer, placed on the terrain via the shared sampler.
    this.streamer = new OsmSceneStreamer(
      this.scene,
      (lat, lon) => this.projection.project(lat, lon),
      (lat, lon) => this.terrain.surfaceHeight(lat, lon)
    );

    // One instanced block mesh per mode (≤5 draw calls for the whole fleet).
    for (const mode of ALL_LIVE_MODES) {
      const geom = new THREE.BoxGeometry(CAR_W, CAR_H, CAR_LEN);
      const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(modeColor(mode)) });
      const mesh = new THREE.InstancedMesh(geom, mat, MAX_PER_MODE);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.meshes.set(mode, mesh);

      const glow = new THREE.InstancedMesh(
        new THREE.CircleGeometry(8, 16).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(modeColor(mode)), transparent: true, opacity: 0.65 }),
        MAX_PER_MODE
      );
      glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      glow.count = 0;
      glow.frustumCulled = false;
      this.scene.add(glow);
      this.tunnelGlows.set(mode, glow);
    }

    this.models = new LiveVehicleModels(this.scene, this.projection);
    this.tunnels = new LiveTunnelLayer(this.projection, this.tunnelIndex, (x, z) => this.terrain.heightAt(x, z));
    this.scene.add(this.tunnels.group);

    this.attachControls();
    window.addEventListener('resize', this.onResize);
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.detachControls();
    this.models.dispose();
    this.tunnels.dispose();
    this.streamer.dispose();
    for (const mesh of this.meshes.values()) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.scene.remove(mesh);
    }
    for (const mesh of this.tunnelGlows.values()) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.scene.remove(mesh);
    }
    this.scene.traverse((o) => {
      const m = o as Partial<THREE.Mesh> & { material?: THREE.Material | THREE.Material[] };
      m.geometry?.dispose?.();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }

  /** Camera ground altitude, used for tier mapping and the exit-to-map gate. */
  private get altitudeM(): number {
    return this.distance * Math.cos(this.polar);
  }

  /** Drives sun/sky/fog from the real local hour (concept §2.5). */
  private applyDaylight(): void {
    const now = new Date();
    const d = daylightAt(now.getHours() + now.getMinutes() / 60);
    const sky = new THREE.Color(d.skyColor);
    (this.scene.background as THREE.Color).copy(sky);
    if (this.scene.fog) this.scene.fog.color.copy(sky);
    this.sun.color.setHex(d.sunColor);
    this.sun.intensity = d.sunIntensity;
    this.hemi.intensity = d.hemiIntensity;
    const el = d.elevationDeg * DEG;
    const R = 4000;
    this.sun.position.set(
      Math.cos(el) * Math.sin(d.azimuthRad) * R,
      Math.max(Math.sin(el), 0.02) * R + 100,
      Math.cos(el) * Math.cos(d.azimuthRad) * R
    );
  }

  private updateCamera(): void {
    const s = Math.sin(this.polar) * this.distance;
    this.camera.position.set(
      this.target.x + s * Math.sin(this.azimuth),
      this.target.y + this.distance * Math.cos(this.polar),
      this.target.z + s * Math.cos(this.azimuth)
    );
    this.camera.lookAt(this.target);
  }

  private readonly frame = (time: number) => {
    if (this.disposed) return;
    const dt = this.lastTime ? Math.min(0.1, (time - this.lastTime) / 1000) : 0.016;
    this.lastTime = time;

    // Refresh lighting occasionally; it changes slowly with wall-clock time.
    if (time - this.lastLightingMs > 15_000) {
      this.applyDaylight();
      this.lastLightingMs = time;
    }

    this.opts.store.tick(dt);
    // Near vehicles get full models; the rest fall back to instanced blocks.
    this.updateFollow(dt);
    const vehicles = this.opts.store.list();
    this.tunnels.update(vehicles);
    const modeled = this.models.update(
      this.opts.store,
      this.target,
      this.altitudeM,
      (vehicle) => this.tunnelIndex.isInTunnel(vehicle),
      (x, z) => this.terrain.heightAt(x, z)
    );
    this.syncVehicles(modeled);

    // Stream scenery around the camera focus (streamer no-ops unless the center
    // tile changed, so calling every frame is cheap).
    const focus = this.projection.unproject(this.target.x, this.target.z);
    this.streamer.update(focus);

    this.reportViewport(time, focus);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  private syncVehicles(modeled: Set<string>): void {
    const perMode = new Map<LiveMode, number>();
    const glowPerMode = new Map<LiveMode, number>();
    for (const mode of ALL_LIVE_MODES) perMode.set(mode, 0);
    for (const mode of ALL_LIVE_MODES) glowPerMode.set(mode, 0);

    for (const v of this.opts.store.list()) {
      const mode = (v.data.mode ?? 'tram') as LiveMode;
      const mesh = this.meshes.get(mode);
      const glow = this.tunnelGlows.get(mode);
      if (!mesh || !glow) continue;
      const tunnel = this.tunnelIndex.isInTunnel(v);
      if (tunnel) {
        const i = glowPerMode.get(mode) ?? 0;
        if (i < MAX_PER_MODE) {
          this.placeTunnelGlow(glow, i, v);
          const ids = this.tunnelGlowRunIds.get(mode) ?? [];
          ids[i] = v.runId;
          this.tunnelGlowRunIds.set(mode, ids);
          glowPerMode.set(mode, i + 1);
        }
        continue;
      }
      // Vehicles shown as full models are omitted from the instanced blocks.
      if (modeled.has(v.runId)) continue;
      const i = perMode.get(mode) ?? 0;
      if (i >= MAX_PER_MODE) continue;
      this.placeInstance(mesh, i, v);
      const ids = this.instanceRunIds.get(mode) ?? [];
      ids[i] = v.runId;
      this.instanceRunIds.set(mode, ids);
      perMode.set(mode, i + 1);
    }

    for (const [mode, mesh] of this.meshes) {
      mesh.count = perMode.get(mode) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      const glow = this.tunnelGlows.get(mode)!;
      glow.count = glowPerMode.get(mode) ?? 0;
      glow.instanceMatrix.needsUpdate = true;
    }
  }

  private placeInstance(mesh: THREE.InstancedMesh, index: number, v: TrackedVehicle): void {
    const p = this.projection.project(v.render.lat, v.render.lon);
    this.dummy.position.set(p.x, this.terrain.heightAt(p.x, p.z) + CAR_H / 2 + 0.4, p.z);
    // Bearing is clockwise from north (+z); box forward is +z, so rotate by -bearing.
    this.dummy.rotation.set(0, -v.bearing * DEG, 0);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }

  private placeTunnelGlow(mesh: THREE.InstancedMesh, index: number, v: TrackedVehicle): void {
    const p = this.projection.project(v.render.lat, v.render.lon);
    this.dummy.position.set(p.x, this.terrain.heightAt(p.x, p.z) + 0.35, p.z);
    this.dummy.rotation.set(-Math.PI / 2, 0, 0);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }

  // Reports at most ~4×/s, and only when the camera moved since the last report.
  private reportViewport(time: number, focus: LatLon): void {
    if (!this.cameraDirty || time - this.lastReport < 250) return;
    this.cameraDirty = false;
    this.lastReport = time;

    const alt = this.altitudeM;
    if (this.distance >= MAX_DISTANCE_M * 0.95) {
      this.opts.onExitToMap();
      return;
    }
    // Visible ground radius grows with altitude; convert to a lat/lon box.
    const radiusM = Math.max(500, alt * 1.3);
    const dLat = radiusM / 111_320;
    const dLon = radiusM / this.projection.lonScale;
    const bbox: BBox = {
      latMin: focus.lat - dLat,
      lonMin: focus.lon - dLon,
      latMax: focus.lat + dLat,
      lonMax: focus.lon + dLon
    };
    // Synthetic Leaflet-style zoom so the polling hook picks a sensible tier.
    const zoom = alt < 1500 ? 16 : alt < 6000 ? 13 : 11;
    this.opts.onViewport(bbox, zoom);
  }

  // ---- Free-orbit controls ----

  private attachControls(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContextMenu);
  }

  private detachControls(): void {
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContextMenu);
  }

  private readonly onContextMenu = (e: Event) => e.preventDefault();

  private readonly onPointerDown = (e: PointerEvent) => {
    this.dragButton = e.button;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.pointerStart = this.lastPointer;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    const moved = Math.hypot(e.clientX - this.pointerStart.x, e.clientY - this.pointerStart.y);
    if (this.dragButton === 0 && moved < 5) this.pick(e);
    this.dragButton = -1;
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    if (this.dragButton < 0) return;
    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    this.lastPointer = { x: e.clientX, y: e.clientY };

    const orbit = this.dragButton === 2 || e.ctrlKey || e.metaKey;
    if (Math.hypot(dx, dy) > 0 && this.followRunId) this.opts.onStopFollow();
    if (orbit) {
      this.azimuth += dx * 0.005;
      this.polar = THREE.MathUtils.clamp(this.polar + dy * 0.005, 0.15, this.followRunId ? 1.58 : 1.4);
    } else {
      // Pan the ground target in the camera's horizontal plane.
      const panScale = this.distance * 0.0018;
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0).setY(0).normalize();
      const forward = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), right).normalize();
      this.target.addScaledVector(right, dx * panScale).addScaledVector(forward, dy * panScale);
    }
    this.cameraDirty = true;
    this.updateCamera();
  };

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (this.followRunId) this.opts.onStopFollow();
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    this.distance = THREE.MathUtils.clamp(this.distance * factor, MIN_DISTANCE_M, MAX_DISTANCE_M);
    this.cameraDirty = true;
    this.updateCamera();
  };

  setFollowRunId(runId: string | null): void {
    if (this.followRunId === runId) return;
    this.followRunId = runId;
    if (!runId) {
      this.ground.visible = true;
      this.streamer.group.visible = true;
      return;
    }
    const vehicle = this.opts.store.get(runId);
    if (!vehicle) return;
    const underground = this.tunnelIndex.isInTunnel(vehicle);
    this.distance = underground ? 42 : 180;
    this.polar = underground ? 1.55 : 0.82;
    this.azimuth = Math.PI - vehicle.bearing * DEG;
    const p = this.projection.project(vehicle.render.lat, vehicle.render.lon);
    const surface = this.terrain.heightAt(p.x, p.z);
    this.target.set(p.x, surface - (underground ? TUNNEL_DEPTH_M : 0), p.z);
    this.cameraDirty = true;
    this.updateCamera();
  }

  private updateFollow(dt: number): void {
    if (!this.followRunId) return;
    const vehicle = this.opts.store.get(this.followRunId);
    if (!vehicle) return;
    const underground = this.tunnelIndex.isInTunnel(vehicle);
    const p = this.projection.project(vehicle.render.lat, vehicle.render.lon);
    p.y = this.terrain.heightAt(p.x, p.z) - (underground ? TUNNEL_DEPTH_M : 0);
    this.target.lerp(p, 1 - Math.exp(-dt / 0.28));
    this.azimuth = THREE.MathUtils.lerp(this.azimuth, Math.PI - vehicle.bearing * DEG, 1 - Math.exp(-dt / 0.4));
    this.distance = THREE.MathUtils.lerp(this.distance, underground ? 42 : 180, 1 - Math.exp(-dt / 0.5));
    this.polar = THREE.MathUtils.lerp(this.polar, underground ? 1.55 : 0.82, 1 - Math.exp(-dt / 0.5));
    this.ground.visible = !underground;
    this.streamer.group.visible = !underground;
    this.cameraDirty = true;
    this.updateCamera();
  }

  private pick(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const modelRunId = this.models.pick(raycaster);
    if (modelRunId) {
      this.opts.onSelect(modelRunId);
      return;
    }
    for (const [mode, mesh] of this.meshes) {
      const hit = raycaster.intersectObject(mesh)[0];
      const runId = hit?.instanceId === undefined ? null : this.instanceRunIds.get(mode)?.[hit.instanceId];
      if (runId) {
        this.opts.onSelect(runId);
        return;
      }
    }
    for (const [mode, mesh] of this.tunnelGlows) {
      const hit = raycaster.intersectObject(mesh)[0];
      const runId = hit?.instanceId === undefined ? null : this.tunnelGlowRunIds.get(mode)?.[hit.instanceId];
      if (runId) {
        this.opts.onSelect(runId);
        return;
      }
    }

    // Sprite and instanced-mesh raycasts can be flaky at a steep camera angle.
    // Keep the visual marker's generous click target by falling back to the
    // nearest projected vehicle, without ever picking scenery.
    let closest: { runId: string; distance: number } | null = null;
    for (const vehicle of this.opts.store.list()) {
      const world = this.projection.project(vehicle.render.lat, vehicle.render.lon);
      world.y = this.terrain.heightAt(world.x, world.z) + (this.tunnelIndex.isInTunnel(vehicle) ? 0.4 : CAR_H / 2);
      world.project(this.camera);
      if (world.z < -1 || world.z > 1) continue;
      const x = rect.left + ((world.x + 1) * rect.width) / 2;
      const y = rect.top + ((1 - world.y) * rect.height) / 2;
      const distance = Math.hypot(e.clientX - x, e.clientY - y);
      if (distance <= 34 && (!closest || distance < closest.distance)) closest = { runId: vehicle.runId, distance };
    }
    if (closest) this.opts.onSelect(closest.runId);
  }

  private readonly onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
