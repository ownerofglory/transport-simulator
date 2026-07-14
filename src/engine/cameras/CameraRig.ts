import type * as THREE from 'three';
import type { CameraMode, CameraUpdateInput } from '../../world/CameraController';

/** A read-only camera target for the active vehicle at the current frame. */
export type CameraPose = {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
};

/** Per-frame follow input a rig reads (never the full world). */
export type CameraRigContext = CameraUpdateInput;

/**
 * Computes the desired camera pose for one view (chase, passenger, cab, …).
 *
 * The shared per-frame smoothing (position lerp, side-look yaw) lives in the
 * controller and reads the rig's own smoothing constants, so each mode keeps its
 * exact feel while new rigs can be registered without touching existing ones.
 */
export interface CameraRig {
  readonly id: CameraMode;
  /** Lerp factor applied to the camera position toward the pose. */
  readonly positionSmoothing: number;
  /** Lerp factor for the side-look yaw. */
  readonly lookYawFactor: number;
  /** Maximum side-look yaw (radians) at full look input. */
  readonly lookYawAmount: number;

  pose(input: CameraRigContext): CameraPose;
}
