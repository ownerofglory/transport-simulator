import * as THREE from 'three';
import type { CameraMode } from '../../world/CameraController';
import type { CameraPose, CameraRig, CameraRigContext } from './CameraRig';

/** Driver cab view: just behind the vehicle nose looking far forward. */
export class CabCameraRig implements CameraRig {
  readonly id: CameraMode = 'cab';
  readonly positionSmoothing = 0.32;
  readonly lookYawFactor = 0.12;
  readonly lookYawAmount = Math.PI * 0.34;

  pose(input: CameraRigContext): CameraPose {
    return {
      position: input.position.clone()
        .add(input.tangent.clone().multiplyScalar(input.trainHalfLengthM - 1.75)) // just behind the vehicle nose.
        .add(new THREE.Vector3(0, 2.65, 0)), // cab eye height.
      target: input.position.clone()
        .add(input.tangent.clone().multiplyScalar(120)) // long forward target for driving view.
        .add(new THREE.Vector3(0, 2.2, 0)), // slightly lower than cab eye height.
      up: new THREE.Vector3(0, 1, 0)
    };
  }
}
