import * as THREE from 'three';
import { buildTransitVehicle } from '../../vehicles';
import type { InteriorCameraProfile } from '../../domain/transport';
import type { CameraMode } from '../../world/CameraController';
import type { VehicleDefinition } from '../../vehicles/VehicleDefinition';
import { VehicleInteriorDisplay } from '../../vehicles/VehicleInteriorDisplay';
import { VehicleVisualController } from '../../vehicles/VehicleVisualController';

// The fully-detailed model for the vehicle the user is following. It owns only
// live along-track placement; doors, the interior display, per-view visibility and
// lamps are delegated to the shared VehicleVisualController, so it behaves exactly
// like the simulator's active vehicle. Built once per followed run with the run's
// real line + destination.

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

  private readonly visual: VehicleVisualController;
  private readonly carDefaults: Array<{ pos: THREE.Vector3; quat: THREE.Quaternion }>;

  // Scratch reused each frame (no per-frame allocations).
  private readonly _v = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();
  private readonly _up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly scene: THREE.Scene,
    definition: VehicleDefinition
  ) {
    this.profile = definition.interiorCameraProfile;
    // Build from the shared definition — no fake route. buildTransitVehicle
    // synthesizes any compatibility fields the builders still read.
    let display: VehicleInteriorDisplay | null = null;
    const instance = buildTransitVehicle({
      definition,
      makeInteriorDisplayMaterial: () => {
        display = new VehicleInteriorDisplay();
        return display.material;
      }
    });
    this.visual = new VehicleVisualController(instance, display, {
      line: definition.line,
      destination: definition.destination,
      lineAccentColor: definition.lineAccentColor,
      interiorCameraProfile: definition.interiorCameraProfile
    });
    this.visual.updateInteriorDisplay(definition.destination, false); // initial board

    this.root = instance.root;
    this.cars = instance.cars;
    this.trainHalfLengthM = instance.trainHalfLengthM;
    this.carDefaults = this.cars.map((c) => ({ pos: c.position.clone(), quat: c.quaternion.clone() }));
    scene.add(this.root);
  }

  update(p: FollowUpdate): void {
    // ---- Live along-track placement (the only live-specific part) ----
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

    // ---- Shared presentation ----
    this.visual.update({
      doorsOpen: p.doorsOpen,
      nextStop: p.nextStop,
      cameraMode: p.mode,
      cinematicActive: false,
      daylightFactor: p.daylightFactor,
      deltaSeconds: p.dt
    });
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.visual.dispose(); // disposes the instance + interior display
    // Free this instance's own geometries/materials (freshly built, unshared).
    this.root.traverse((o) => {
      const m = o as Partial<THREE.Mesh> & { material?: THREE.Material | THREE.Material[] };
      m.geometry?.dispose?.();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
  }
}
