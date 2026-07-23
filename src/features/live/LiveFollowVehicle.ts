import * as THREE from 'three';
import { buildTransitVehicle } from '../../vehicles';
import { fallbackTransportModeDefinition, type InteriorCameraProfile, type VehicleKind } from '../../domain/transport';
import type { CameraMode } from '../../world/CameraController';
import type { DemoRoute } from '../../route';
import type { VehicleInstance } from '../../vehicles/types';

// The fully-detailed model for the vehicle the user is following. Unlike the
// pooled overview models (LiveVehicleModels), this is built once per followed run
// with the run's real line + destination and driven like Explore's active vehicle:
// it animates doors at stops, shows the next-stop interior display, and toggles
// body/glass visibility per camera view so passenger/driver views see through the
// windows and out the front. Positioned + articulated along the live track.

const DEG = Math.PI / 180;

export type FollowOffsetPose = (offsetM: number) => { x: number; z: number; bearing: number } | null;

export type FollowUpdate = {
  x: number;
  z: number;
  bearing: number;
  centerY: number; // world Y the caller placed the body at (shared with the camera)
  offsetPose: FollowOffsetPose;
  mode: CameraMode;
  doorsOpen: boolean;
  nextStop: string;
  daylightFactor: number;
  dt: number;
};

export class LiveFollowVehicle {
  readonly root: THREE.Group;
  readonly cars: THREE.Group[];
  readonly trainHalfLengthM: number;
  readonly profile: InteriorCameraProfile;

  private readonly instance: VehicleInstance;
  private readonly carDefaults: Array<{ pos: THREE.Vector3; quat: THREE.Quaternion }>;
  private interiorCanvas: HTMLCanvasElement | null = null;
  private interiorTexture: THREE.CanvasTexture | null = null;
  private lastInteriorKey = '';
  private doorOpenAmount = 0;
  private readonly accent: string;

  // Scratch reused each frame (no per-frame allocations).
  private readonly _v = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();
  private readonly _up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly kind: VehicleKind,
    private readonly line: string,
    private readonly destination: string,
    profile: InteriorCameraProfile
  ) {
    this.profile = profile;
    this.accent = kind === 's-bahn' ? '#e0202b' : '#ffd800';
    // A throwaway route carrying only the fields the builder reads. The real line
    // drives both the formation and the cab/destination display text.
    const route = { line, destination, stations: [], controlPoints: [] } as unknown as DemoRoute;
    this.instance = buildTransitVehicle({
      route,
      modeDefinition: { ...fallbackTransportModeDefinition, id: kind, vehicleKind: kind },
      makeInteriorDisplayMaterial: () => this.makeInteriorDisplayMaterial()
    });
    this.root = this.instance.root;
    this.cars = this.instance.cars;
    this.trainHalfLengthM = this.instance.trainHalfLengthM;
    this.carDefaults = this.cars.map((c) => ({ pos: c.position.clone(), quat: c.quaternion.clone() }));
    scene.add(this.root);
  }

  update(p: FollowUpdate): void {
    this.root.position.set(p.x, p.centerY, p.z);
    this.root.rotation.set(0, -p.bearing * DEG, 0); // yaw keeps root.quaternion in sync

    // Articulate the cars along the track (procedural Stadtbahn); blueprint sections
    // have no per-body offset and stay at their built local transform.
    const invRoot = this._q.copy(this.root.quaternion).invert();
    this.cars.forEach((car, i) => {
      const def = this.carDefaults[i];
      const offsetRaw = car.userData.centerOffsetM;
      const pose = offsetRaw === undefined ? null : p.offsetPose(Number(offsetRaw));
      if (!pose) {
        car.position.copy(def.pos);
        car.quaternion.copy(def.quat);
        return;
      }
      this._v.set(pose.x - p.x, 0, pose.z - p.z).applyQuaternion(invRoot);
      car.position.set(this._v.x, def.pos.y, this._v.z);
      car.quaternion.setFromAxisAngle(this._up, -pose.bearing * DEG).premultiply(invRoot);
    });

    this.updateDoors(p.doorsOpen, p.dt);
    this.updateInteriorDisplay(p.nextStop, p.doorsOpen);
    this.setPresentation(p.mode);
    this.instance.setExteriorLightsOn?.(p.daylightFactor < 0.45);
  }

  private updateDoors(open: boolean, dt: number): void {
    this.doorOpenAmount = THREE.MathUtils.damp(this.doorOpenAmount, open ? 1 : 0, open ? 5.2 : 6.5, THREE.MathUtils.clamp(dt, 0, 0.1));
    const eased = this.doorOpenAmount * this.doorOpenAmount * (3 - 2 * this.doorOpenAmount);
    for (const leaf of this.instance.doors) {
      leaf.group.position.z = leaf.closedZ + leaf.direction * 0.72 * eased;
    }
  }

  // Interior/cab window transparency and shell visibility per view (mirrors
  // Explore's ActiveVehicleSystem.setPresentation): in passenger/cab views the
  // opaque body shells hide so the outside shows through the glass, and in cab view
  // the cab shell/display hide so the driver can see the line ahead.
  private setPresentation(mode: CameraMode): void {
    const glass = this.instance.glassMaterial;
    const interiorView = mode === 'passenger' || mode === 'cab';
    const cabView = mode === 'cab';
    if (glass) {
      glass.opacity = interiorView ? 0.1 : 0.58;
      glass.depthWrite = !interiorView;
      glass.color.setHex(interiorView ? 0xd9f2f8 : 0x91c7dd);
      glass.needsUpdate = true;
    }
    for (const band of this.instance.windowBands) band.visible = !interiorView;
    for (const shell of this.instance.cabShells) shell.visible = !cabView;
    for (const shell of this.instance.passengerShells) shell.visible = !interiorView;
    for (const display of this.instance.cabDisplays) display.visible = !cabView;
  }

  private makeInteriorDisplayMaterial(): THREE.MeshBasicMaterial {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    this.interiorCanvas = canvas;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    this.interiorTexture = texture;
    this.renderInteriorDisplay(this.destination, false);
    return new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
  }

  private updateInteriorDisplay(nextStop: string, doorsOpen: boolean): void {
    const station = nextStop || this.destination;
    const key = `${station}/${doorsOpen}`;
    if (key === this.lastInteriorKey) return;
    this.lastInteriorKey = key;
    this.renderInteriorDisplay(station, doorsOpen);
  }

  private renderInteriorDisplay(station: string, doorsOpen: boolean): void {
    const ctx = this.interiorCanvas?.getContext('2d');
    if (!ctx || !this.interiorTexture) return;
    ctx.fillStyle = '#071015';
    ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = this.accent;
    ctx.fillRect(0, 0, 1024, 14);
    ctx.fillRect(24, 40, 126, 126);
    ctx.fillStyle = '#11151a';
    ctx.font = '800 56px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.line, 87, 104);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#a9b7bd';
    ctx.font = '600 30px Inter, Arial, sans-serif';
    ctx.fillText(doorsOpen ? 'TÜREN GEÖFFNET · DANACH' : 'NÄCHSTER HALT', 184, 62);

    let fontSize = 58;
    do {
      ctx.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
      fontSize -= 2;
    } while (ctx.measureText(station).width > 806 && fontSize > 30);
    ctx.fillStyle = '#f5f7f6';
    ctx.fillText(station, 184, 126);

    ctx.fillStyle = this.accent;
    ctx.font = '500 25px Inter, Arial, sans-serif';
    ctx.fillText(`Richtung ${this.destination}`, 184, 202);
    this.interiorTexture.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.instance.dispose?.();
    this.interiorTexture?.dispose();
    this.interiorTexture = null;
    this.interiorCanvas = null;
    // Dispose this instance's own geometries/materials (freshly built, unshared).
    this.root.traverse((o) => {
      const m = o as Partial<THREE.Mesh> & { material?: THREE.Material | THREE.Material[] };
      m.geometry?.dispose?.();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
  }
}
