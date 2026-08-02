import * as THREE from 'three';
import { OsmSceneStreamer } from '../../osm-scene';
import { makeProjection, type LatLon, type Projection } from './liveProjection';
import type { LiveVehicleStore, TrackedVehicle } from './LiveVehicleStore';
import { LiveVehicleModels } from './LiveVehicleModels';
import { LiveTerrain } from './LiveTerrain';
import { daylightAt } from './liveDaylight';
import { LiveTunnelIndex } from './LiveTunnelIndex';
import { LiveTunnelLayer } from './LiveTunnelLayer';
import { LiveTrackLayer } from './LiveTrackLayer';
import { LiveTrackMotion } from './LiveTrackMotion';
import { ALL_LIVE_MODES, modeColor, type LiveMode } from './liveTypes';
import type { BBox } from './viewport';
import { ChaseCameraRig } from '../../engine/cameras/ChaseCameraRig';
import { PassengerCameraRig } from '../../engine/cameras/PassengerCameraRig';
import { CabCameraRig } from '../../engine/cameras/CabCameraRig';
import type { CameraMode, CameraUpdateInput } from '../../world/CameraController';
import { LiveFollowVehicle } from './LiveFollowVehicle';
import { LiveStationMarker } from './LiveStationMarker';
import { advanceFlight, flightDuration, type CameraFlight } from './cameraFlight';
import { panOffset, panScale } from './cameraPan';
import { resolveLiveVehicleDefinition } from './liveVehicleDefinition';
import { isTypingTarget } from '../../app/typingTarget';
import type { CityDefinition } from '../../cities';

// Body base height above terrain (matches the overview models); dropped into the
// bore when underground.
function followBaseOffset(underground: boolean): number {
  return underground ? -4.7 : 0.3;
}

// Free-flight 3D view over the live network (concept §2.2/§4): reused OSM scenery
// on Mapzen terrain relief (LiveTerrain), with near vehicles as full procedural
// models (LiveVehicleModels) and the rest as mode-colored instanced blocks, plus
// tunnel glows/linings for underground runs. Everything is placed at terrain
// height via LiveTerrain.heightAt so buildings, vehicles and follow camera share
// the same ground.

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

// Camera altitude clamp (concept §2.2: ~80 m to ~12 km). Above the top we hand
// back to the map.
const MIN_DISTANCE_M = 120;
const MAX_DISTANCE_M = 12_000;
// Vehicle block dimensions (metres); size-exaggerated a touch so they read.
const CAR_LEN = 22;
const CAR_W = 3.0;
const CAR_H = 3.4;
const MAX_PER_MODE = 1024;
// Tunnel glows mark underground runs for someone looking down from above. Up
// close (and while riding a tunnel chase) they read as a big coloured blob, so
// they only draw from a distance.
const GLOW_MIN_ALTITUDE_M = 150;
// Orbit distance a station flight settles at: close enough that nearby vehicles
// upgrade to full models (LiveVehicleModels' altitude gate), wide enough to show
// the platforms and their surroundings.
const STATION_FOCUS_DISTANCE_M = 430;

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
  /** Reports the active follow camera view (chase / passenger / cab) to the UI. */
  onCameraModeChange?: (mode: CameraMode) => void;
  /** Current city, so followed vehicles resolve to the same design as the simulator. */
  city?: CityDefinition;
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
  // Ground anchor + name plate for the station the user searched for.
  private readonly stationMarker = new LiveStationMarker();
  // Non-null while the camera is easing towards a searched station; any manual
  // camera input cancels it so the user is never fighting the animation.
  private flight: CameraFlight | null = null;
  private readonly tunnels: LiveTunnelLayer;
  private readonly tracks: LiveTrackLayer;
  // Snaps matched rail vehicles onto their route and moves them along it.
  private readonly trackMotion: LiveTrackMotion;
  private readonly terrain: LiveTerrain;
  private readonly ground: THREE.Mesh;
  // Lighting follows real local time (concept §2.5).
  private readonly sun = new THREE.DirectionalLight(0xffffff, 1.6);
  private readonly hemi = new THREE.HemisphereLight(0xddecff, 0x586a70, 1.0);
  // A small constant ambient fill lifts shadowed faces, matching Explore's rig.
  private readonly fill = new THREE.AmbientLight(0x9bb0c8, 0.16);
  // Sky colour from the daylight curve, and whether we are currently inside a
  // tunnel — underground swaps the sky/fog for enclosing darkness so gaps in the
  // bore read as earth instead of bright daylight.
  private readonly skyColor = new THREE.Color(0x9fc6e8);
  private underground = false;
  private lastLightingMs = 0;
  private followRunId: string | null = null;
  // Follow camera reuses Explore's rigs so chase/passenger/driver match that view.
  private cameraMode: CameraMode = 'chase';
  private readonly rigs = {
    chase: new ChaseCameraRig(),
    passenger: new PassengerCameraRig(),
    cab: new CabCameraRig()
  } as const;
  // The fully-detailed model of the followed run (real destination display, doors,
  // interior board, per-view visibility). Built lazily on first follow frame.
  private followVehicle: LiveFollowVehicle | null = null;
  // 0 (night) → 1 (full day), for exterior lamp switching on the followed vehicle.
  private daylightFactor = 1;
  // Gated smoothing goal (world XZ) for the followed vehicle, so a single bad frame
  // (a route rematch flipping the snapped position) can't whip the camera.
  private readonly followTarget = new THREE.Vector3();
  private followTargetSet = false;
  private followFreezeFrames = 0;
  private followJustStarted = false;
  // Scratch reused by the follow camera each frame (no per-frame allocations).
  private readonly _followPos = new THREE.Vector3();
  private readonly _followTan = new THREE.Vector3();
  private readonly _followOff = new THREE.Vector3();
  // Scratch for the pan basis, rebuilt on every pointermove.
  private readonly _panRight = new THREE.Vector3();
  private readonly _panForward = new THREE.Vector3();

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
    this.renderer.toneMappingExposure = 1.08; // slightly brighter, matching Explore
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x9fc6e8);
    this.scene.fog = new THREE.Fog(0x9fc6e8, 3000, 14000);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 30_000);
    this.updateCamera();

    // Soft sky/ground hemisphere plus a directional sun, both driven by the
    // real local time of day (updated periodically in the frame loop).
    this.scene.add(this.hemi);
    this.scene.add(this.sun);
    this.scene.add(this.fill);
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

    this.models = new LiveVehicleModels(this.scene, this.projection, opts.city);
    this.tunnels = new LiveTunnelLayer(this.projection, this.tunnelIndex, (x, z) => this.terrain.heightAt(x, z));
    this.scene.add(this.tunnels.group);
    this.tracks = new LiveTrackLayer(this.projection, this.tunnelIndex, (x, z) => this.terrain.heightAt(x, z));
    this.scene.add(this.tracks.group);
    this.trackMotion = new LiveTrackMotion(this.projection, this.tunnelIndex);
    this.scene.add(this.stationMarker.group);

    this.attachControls();
    window.addEventListener('resize', this.onResize);
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.detachControls();
    this.disposeFollowVehicle();
    this.models.dispose();
    this.stationMarker.dispose();
    this.tunnels.dispose();
    this.tracks.dispose();
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
    // Lamps come on around dusk (sun below ~5°); full day well above the horizon.
    this.daylightFactor = THREE.MathUtils.clamp(d.elevationDeg / 12, 0, 1);
    this.skyColor.setHex(d.skyColor);
    this.applyEnvironment();
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

  /**
   * Swaps between the daylight sky and enclosing tunnel darkness. Underground the
   * bore only covers the alignment, so without this the surrounding void renders
   * as bright sky instead of earth.
   */
  private applyEnvironment(): void {
    const background = this.scene.background as THREE.Color;
    const fog = this.scene.fog as THREE.Fog | null;
    if (this.underground) {
      background.setHex(0x0b0d10);
      if (fog) {
        fog.color.setHex(0x0b0d10);
        fog.near = 6;
        fog.far = 160;
      }
      return;
    }
    background.copy(this.skyColor);
    if (fog) {
      fog.color.copy(this.skyColor);
      fog.near = 3000;
      fog.far = 14_000;
    }
  }

  /** Applies underground presentation (hidden surface + dark enclosure). */
  private setUnderground(underground: boolean): void {
    this.ground.visible = !underground;
    this.streamer.group.visible = !underground;
    if (underground === this.underground) return;
    this.underground = underground;
    this.applyEnvironment();
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
    const vehicles = this.opts.store.list();
    // Snap matched rail vehicles onto their route before anything reads positions.
    this.trackMotion.tick(vehicles, dt);
    this.tunnels.update(vehicles, this.terrain.revision);
    this.tracks.update(vehicles, this.altitudeM, this.terrain.revision);
    // Near vehicles get full models; the rest fall back to instanced blocks.
    const modeled = this.models.update(
      this.opts.store,
      this.target,
      this.altitudeM,
      (vehicle) => this.tunnelIndex.isInTunnel(vehicle),
      (x, z) => this.terrain.heightAt(x, z),
      (vehicle) => this.resolveWorld(vehicle),
      this.camera.position,
      (runId, offsetM) => this.trackMotion.offsetPoseOf(runId, offsetM),
      this.followRunId // the followed run renders via the dedicated LiveFollowVehicle
    );
    // Follow after models are placed so interior cameras read fresh car matrices.
    this.updateFollow(dt);
    this.advanceStationFlight(dt);
    this.stationMarker.update((x, z) => this.terrain.heightAt(x, z));
    this.syncVehicles(modeled);

    // Keep terrain relief + scenery centered on the camera focus (both no-op
    // unless the focus moved far enough, so calling every frame is cheap).
    this.terrain.update(this.target.x, this.target.z);
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
      if (v.runId === this.followRunId) continue; // rendered by the dedicated follow vehicle
      const mode = (v.data.mode ?? 'tram') as LiveMode;
      const mesh = this.meshes.get(mode);
      const glow = this.tunnelGlows.get(mode);
      if (!mesh || !glow) continue;
      const tunnel = this.tunnelIndex.isInTunnel(v);
      if (tunnel) {
        const i = glowPerMode.get(mode) ?? 0;
        if (i < MAX_PER_MODE && this.altitudeM >= GLOW_MIN_ALTITUDE_M) {
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

  /** World position + bearing for a vehicle: route-snapped when matched, else raw. */
  private resolveWorld(v: TrackedVehicle): { x: number; z: number; bearing: number } {
    const snapped = this.trackMotion.positionOf(v.runId);
    const ll = snapped ?? v.render;
    const p = this.projection.project(ll.lat, ll.lon);
    return { x: p.x, z: p.z, bearing: snapped ? snapped.bearing : v.bearing };
  }

  private placeInstance(mesh: THREE.InstancedMesh, index: number, v: TrackedVehicle): void {
    const w = this.resolveWorld(v);
    this.dummy.position.set(w.x, this.terrain.heightAt(w.x, w.z) + CAR_H / 2 + 0.4, w.z);
    // Bearing is clockwise from north (+z); box forward is +z, so rotate by -bearing.
    this.dummy.rotation.set(0, -w.bearing * DEG, 0);
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
    window.addEventListener('keydown', this.onKeyDown);
  }

  private detachControls(): void {
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private readonly onContextMenu = (e: Event) => e.preventDefault();

  // 'c' cycles the follow view (chase / passenger / driver) while following, but
  // not while the user is typing in the station search.
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;
    if (e.key === 'c' || e.key === 'C') {
      if (this.followRunId) this.cycleCameraMode();
    }
  };

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
    if (Math.hypot(dx, dy) > 0) {
      this.cancelStationFlight();
      if (this.followRunId) this.opts.onStopFollow();
    }
    if (orbit) {
      // Grab-and-spin: dragging right/down swings the view that way.
      this.azimuth -= dx * 0.005;
      this.polar = THREE.MathUtils.clamp(this.polar - dy * 0.005, 0.15, this.followRunId ? 1.58 : 1.4);
    } else {
      // Camera-drag pan: the drag moves the camera, so dragging right pushes the
      // view right and the world slides left (see cameraPan for the convention).
      const right = this._panRight.setFromMatrixColumn(this.camera.matrix, 0).setY(0).normalize();
      const forward = this._panForward.crossVectors(UP, right).normalize();
      const offset = panOffset(right, forward, dx, dy, panScale(this.distance));
      this.target.x += offset.x;
      this.target.z += offset.z;
    }
    this.cameraDirty = true;
    this.updateCamera();
  };

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.cancelStationFlight();
    if (this.followRunId) this.opts.onStopFollow();
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    this.distance = THREE.MathUtils.clamp(this.distance * factor, MIN_DISTANCE_M, MAX_DISTANCE_M);
    this.cameraDirty = true;
    this.updateCamera();
  };

  /**
   * Flies the free-orbit camera to a searched station and marks it on the ground.
   * Any active follow is released first — the camera cannot be locked to a run and
   * travelling to a station at the same time.
   */
  focusStation(station: { name: string; lat: number; lon: number }): void {
    this.setFollowRunId(null);
    const p = this.projection.project(station.lat, station.lon);
    this.stationMarker.show(station.name, p.x, p.z);
    const travelM = Math.hypot(p.x - this.target.x, p.z - this.target.z);
    this.flight = {
      fromX: this.target.x,
      fromZ: this.target.z,
      fromY: this.target.y,
      fromDistance: this.distance,
      toX: p.x,
      toZ: p.z,
      toDistance: STATION_FOCUS_DISTANCE_M,
      elapsed: 0,
      duration: flightDuration(travelM)
    };
  }

  /** Drops an in-progress station flight the moment the user takes the camera. */
  private cancelStationFlight(): void {
    this.flight = null;
  }

  private advanceStationFlight(dt: number): void {
    if (!this.flight) return;
    // Terrain streams in while flying, so the destination ground height is only
    // known once we get there — sample it every frame rather than at take-off.
    const groundY = this.terrain.heightAt(this.flight.toX, this.flight.toZ);
    const sample = advanceFlight(this.flight, dt, groundY);
    this.target.set(sample.x, sample.y, sample.z);
    this.distance = THREE.MathUtils.clamp(sample.distance, MIN_DISTANCE_M, MAX_DISTANCE_M);
    // Looking almost straight down or edge-on hides the station; ease into a
    // readable pitch as part of the same flight.
    this.polar = THREE.MathUtils.clamp(this.polar, 0.5, 1.15);
    this.cameraDirty = true;
    this.updateCamera();
    if (sample.done) this.flight = null;
  }

  setFollowRunId(runId: string | null): void {
    if (this.followRunId === runId) return;
    this.followRunId = runId;
    this.followTargetSet = false;
    this.followFreezeFrames = 0;
    this.followJustStarted = !!runId;
    this.disposeFollowVehicle(); // rebuilt for the new run on the next follow frame
    if (runId) this.cancelStationFlight(); // a follow owns the camera outright
    if (!runId) {
      this.setUnderground(false);
      this.camera.up.set(0, 1, 0); // clear any interior-camera up-vector for free orbit
      return;
    }
  }

  private ensureFollowVehicle(vehicle: TrackedVehicle): LiveFollowVehicle {
    if (this.followVehicle) return this.followVehicle;
    const definition = resolveLiveVehicleDefinition(vehicle.data, this.opts.city);
    this.followVehicle = new LiveFollowVehicle(this.scene, definition);
    return this.followVehicle;
  }

  private disposeFollowVehicle(): void {
    this.followVehicle?.dispose();
    this.followVehicle = null;
  }

  /** Cycles the follow view chase → passenger → cab, like Explore. */
  cycleCameraMode(): CameraMode {
    return this.setCameraMode(
      this.cameraMode === 'chase' ? 'passenger' : this.cameraMode === 'passenger' ? 'cab' : 'chase'
    );
  }

  setCameraMode(mode: CameraMode): CameraMode {
    this.cameraMode = mode;
    this.followJustStarted = true; // snap into the new view instead of sliding across
    this.opts.onCameraModeChange?.(mode);
    return mode;
  }

  // Positions the follow camera by reusing Explore's rigs, so chase shows the
  // vehicle's rear (with its route display), and passenger/cab match the ride view.
  // Orbit params are kept in sync so the hand-off to free flight (on stop-follow)
  // doesn't jump and viewport polling still gets a sane altitude.
  private updateFollow(dt: number): void {
    if (!this.followRunId) return;
    // Freeze at the last valid pose when the run vanishes from the store (e.g. a
    // brief bbox flicker); never latch onto another vehicle.
    const vehicle = this.opts.store.get(this.followRunId);
    if (!vehicle) return;

    const w = this.resolveWorld(vehicle);
    // Gate the horizontal goal: a plausible step is the vehicle's own motion plus a
    // margin. A larger jump means the snapped position teleported (route rematch, bad
    // fix); hold the previous goal, but accept it if the jump persists (~1 s).
    if (!this.followTargetSet) {
      this.followTarget.set(w.x, 0, w.z);
      this.followTargetSet = true;
      this.followFreezeFrames = 0;
    } else {
      const step = Math.hypot(w.x - this.followTarget.x, w.z - this.followTarget.z);
      const allowed = Math.max(40, 45 * dt * 3);
      if (step <= allowed || this.followFreezeFrames > 60) {
        this.followTarget.set(w.x, 0, w.z);
        this.followFreezeFrames = 0;
      } else {
        this.followFreezeFrames += 1;
      }
    }

    const px = this.followTarget.x;
    const pz = this.followTarget.z;
    const underground = this.tunnelIndex.isInTunnel(vehicle);
    const baseY = this.terrain.heightAt(px, pz) + followBaseOffset(underground);
    const position = this._followPos.set(px, baseY, pz);
    // Track-forward unit vector from bearing (model forward = (-sinβ, 0, cosβ)).
    const beta = w.bearing * DEG;
    const tangent = this._followTan.set(-Math.sin(beta), 0, Math.cos(beta));

    // Build the detailed followed vehicle on first frame (needs the run's data), then
    // drive its motion, doors, interior display, and per-view visibility.
    const follow = this.ensureFollowVehicle(vehicle);
    follow.update({
      x: px,
      z: pz,
      bearing: w.bearing,
      centerY: baseY,
      offsetPose: (offsetM) => this.trackMotion.offsetPoseOf(vehicle.runId, offsetM),
      mode: this.cameraMode,
      doorsOpen: vehicle.data.status === 'at_stop',
      nextStop: vehicle.data.nextStop ?? '',
      daylightFactor: this.daylightFactor,
      dt
    });

    const input: CameraUpdateInput = {
      position,
      tangent,
      underground,
      interiorCameraProfile: follow.profile,
      passengerOffsetM: 0,
      trainHalfLengthM: follow.trainHalfLengthM,
      train: follow.root,
      trainCars: follow.cars
    };
    const rig = this.rigs[this.cameraMode];
    const pose = rig.pose(input);

    if (this.followJustStarted) {
      this.camera.position.copy(pose.position);
      this.camera.up.copy(pose.up).normalize();
      this.followJustStarted = false;
    } else {
      this.camera.position.lerp(pose.position, rig.positionSmoothing);
      this.camera.up.lerp(pose.up, 0.32).normalize();
    }
    this.camera.lookAt(pose.target);
    this.setUnderground(underground);

    // Keep orbit state consistent with the rig camera for viewport + hand-off.
    this.target.set(px, baseY + 2, pz);
    const off = this._followOff.copy(this.camera.position).sub(this.target);
    this.distance = Math.max(1, off.length());
    this.polar = THREE.MathUtils.clamp(Math.acos(THREE.MathUtils.clamp(off.y / this.distance, -1, 1)), 0.05, 1.55);
    this.azimuth = Math.atan2(off.x, off.z);
    this.cameraDirty = true;
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
