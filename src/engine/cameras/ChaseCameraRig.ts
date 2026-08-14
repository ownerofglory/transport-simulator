import * as THREE from 'three';
import type { CameraMode } from '../../world/CameraController';
import type { CameraPose, CameraRig, CameraRigContext } from './CameraRig';

/**
 * Exterior chase camera, with a lower/closer variant while underground so the
 * camera stays inside tunnel headroom. Chase gets a gentler side-look and
 * smoother follow than interior views.
 */
export class ChaseCameraRig implements CameraRig {
  readonly id: CameraMode = 'chase';
  readonly positionSmoothing = 0.12;
  readonly lookYawFactor = 0.18;
  readonly lookYawAmount = Math.PI * 0.18;

  pose(input: CameraRigContext): CameraPose {
    const up = new THREE.Vector3(0, 1, 0);
    if (input.underground) {
      return {
        position: input.position.clone()
          .add(input.tangent.clone().multiplyScalar(-(input.trainHalfLengthM + 16))) // closer chase camera in tunnels.
          .add(new THREE.Vector3(0, 3.1, 0)), // under the ~5.6 m bore crown, clear of the roof and catenary.
        target: input.position.clone()
          .add(input.tangent.clone().multiplyScalar(12)) // look slightly ahead of train.
          .add(new THREE.Vector3(0, 1.8, 0)), // target near vehicle body height.
        up
      };
    }
    return {
      position: input.position.clone()
        .add(input.tangent.clone().multiplyScalar(-(input.trainHalfLengthM + 14))) // exterior chase distance behind train.
        .add(new THREE.Vector3(0, 16, 0)), // elevated outdoor chase height.
      target: input.position.clone().add(new THREE.Vector3(0, 2, 0)), // target near vehicle center mass.
      up
    };
  }
}
