import * as THREE from 'three';
import type { InteriorCameraProfile } from '../domain/transport';
import type { CameraRig } from '../engine/cameras/CameraRig';
import { ChaseCameraRig } from '../engine/cameras/ChaseCameraRig';
import { PassengerCameraRig } from '../engine/cameras/PassengerCameraRig';
import { CabCameraRig } from '../engine/cameras/CabCameraRig';

export type CameraMode = 'passenger' | 'cab' | 'chase';

export type CameraUpdateInput = {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  underground: boolean;
  interiorCameraProfile: InteriorCameraProfile;
  passengerOffsetM: number;
  trainHalfLengthM: number;
  train: THREE.Group;
  trainCars: THREE.Group[];
  // Route distance of the vehicle and a sampler along the alignment. A rig that
  // must stay inside a structure (the tunnel bore) places itself along the route
  // instead of on the tangent, which leaves the curve on bends.
  routeDistanceM: number;
  activeLaneOffsetM: number;
  routePointAtDistance: (distanceM: number, laneOffsetM?: number) => THREE.Vector3;
};

/** Controls chase, passenger, and cab camera placement for the active vehicle. */
export class CameraController {
  private mode: CameraMode = 'chase';
  private zoomLevel = 1;
  private projectionDirty = true;

  // -1/1 are side-look inputs; 0 means looking forward.
  private lookDirection: -1 | 0 | 1 = 0;

  // Smoothed yaw offset for passenger/cab look-left/look-right controls.
  private currentLookYaw = 0;

  // Registered camera rigs keyed by mode; new rigs plug in without touching
  // existing ones or the shared smoothing below.
  private readonly rigs = new Map<CameraMode, CameraRig>();

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    for (const rig of [new ChaseCameraRig(), new PassengerCameraRig(), new CabCameraRig()]) {
      this.registerRig(rig);
    }
  }

  /** Registers (or replaces) a camera rig for its mode. */
  registerRig(rig: CameraRig): void {
    this.rigs.set(rig.id, rig);
  }

  /** Cycles through exterior chase, passenger interior, and cab views. */
  cycle(): CameraMode {
    this.mode = this.mode === 'chase' ? 'passenger' : this.mode === 'passenger' ? 'cab' : 'chase';
    return this.mode;
  }

  /** Returns the active camera mode for HUD and vehicle-visibility logic. */
  currentMode(): CameraMode {
    return this.mode;
  }

  /** Restores a specific camera mode when rebuilding the world from selection state. */
  setMode(mode: CameraMode): CameraMode {
    this.mode = mode;
    return this.mode;
  }

  /** Stores held look direction from keyboard/touch input. */
  setLookInput(leftHeld: boolean, rightHeld: boolean): void {
    this.lookDirection = leftHeld === rightHeld ? 0 : leftHeld ? 1 : -1;
  }

  /** Adjusts the perspective zoom used by all camera modes. */
  adjustZoom(delta: number): void {
    const nextZoom = THREE.MathUtils.clamp(this.zoomLevel + delta, 0.7, 2.4);
    if (Math.abs(nextZoom - this.zoomLevel) < 0.0001) return;
    this.zoomLevel = nextZoom;
    this.projectionDirty = true;
  }

  /** Updates camera position, target, up-vector, and side-look yaw each frame. */
  update(input: CameraUpdateInput): void {
    if (this.projectionDirty) {
      this.camera.zoom = this.zoomLevel;
      this.camera.updateProjectionMatrix();
      this.projectionDirty = false;
    }

    const rig = this.rigs.get(this.mode) ?? this.rigs.get('chase')!;
    const pose = rig.pose(input);
    const camPos = pose.position;
    let lookAt = pose.target;
    const cameraUp = pose.up;

    const lookYawTarget = this.lookDirection * rig.lookYawAmount;
    this.currentLookYaw = THREE.MathUtils.lerp(this.currentLookYaw, lookYawTarget, rig.lookYawFactor);

    if (Math.abs(this.currentLookYaw) > 0.001) {
      const viewDirection = lookAt.clone().sub(camPos);

      if (viewDirection.lengthSq() > 1e-6) {
        viewDirection.applyAxisAngle(cameraUp, this.currentLookYaw);
        lookAt = camPos.clone().add(viewDirection);
      }
    }

    this.camera.position.lerp(camPos, rig.positionSmoothing);
    this.camera.up.lerp(cameraUp, 0.32).normalize(); // blend up-vector to avoid abrupt banking changes.
    this.camera.lookAt(lookAt);
  }
}
