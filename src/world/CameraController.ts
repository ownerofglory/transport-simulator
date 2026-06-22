import * as THREE from 'three';
import type { TransportMode } from '../domain/transport';

export type CameraMode = 'passenger' | 'cab' | 'chase';

type CameraUpdateInput = {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  underground: boolean;
  transportMode: TransportMode;
  trainHalfLengthM: number;
  train: THREE.Group;
  trainCars: THREE.Group[];
};

export class CameraController {
  private mode: CameraMode = 'chase';
  private lookDirection: -1 | 0 | 1 = 0;
  private currentLookYaw = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  cycle(): CameraMode {
    this.mode = this.mode === 'chase' ? 'passenger' : this.mode === 'passenger' ? 'cab' : 'chase';
    return this.mode;
  }

  currentMode(): CameraMode {
    return this.mode;
  }

  setLookInput(leftHeld: boolean, rightHeld: boolean): void {
    this.lookDirection = leftHeld === rightHeld ? 0 : leftHeld ? 1 : -1;
  }

  update(input: CameraUpdateInput): void {
    const normal = new THREE.Vector3(input.tangent.z, 0, -input.tangent.x).normalize();
    let camPos: THREE.Vector3;
    let lookAt: THREE.Vector3;
    let cameraUp = new THREE.Vector3(0, 1, 0);

    if (this.mode === 'passenger') {
      const anchoredInterior = input.transportMode === 'bus' || input.transportMode === 's-bahn';
      if (anchoredInterior) {
        input.train.updateMatrixWorld(true);
        const passengerCar = input.transportMode === 's-bahn' ? input.trainCars[2] : input.trainCars[0];
        const localZ = input.transportMode === 's-bahn' ? -2 : -4.4;
        camPos = passengerCar.localToWorld(new THREE.Vector3(0.16, 2.3, localZ));
        lookAt = passengerCar.localToWorld(new THREE.Vector3(0, 2.25, 70));
        cameraUp = new THREE.Vector3(0, 1, 0)
          .applyQuaternion(passengerCar.getWorldQuaternion(new THREE.Quaternion()))
          .normalize();
      } else {
        const passengerOffsetM = input.transportMode === 'stadtbahn' ? 4.2 : 0;
        camPos = input.position.clone()
          .add(input.tangent.clone().multiplyScalar(passengerOffsetM))
          .add(normal.clone().multiplyScalar(0.08))
          .add(new THREE.Vector3(0, 2.3, 0));
        lookAt = input.position.clone()
          .add(input.tangent.clone().multiplyScalar(85))
          .add(normal.clone().multiplyScalar(1.5))
          .add(new THREE.Vector3(0, 2.25, 0));
      }
    } else if (this.mode === 'cab') {
      camPos = input.position.clone()
        .add(input.tangent.clone().multiplyScalar(input.trainHalfLengthM - 1.75))
        .add(new THREE.Vector3(0, 2.65, 0));
      lookAt = input.position.clone()
        .add(input.tangent.clone().multiplyScalar(120))
        .add(new THREE.Vector3(0, 2.2, 0));
    } else if (input.underground) {
      camPos = input.position.clone()
        .add(input.tangent.clone().multiplyScalar(-(input.trainHalfLengthM + 22)))
        .add(new THREE.Vector3(0, 4.6, 0));
      lookAt = input.position.clone()
        .add(input.tangent.clone().multiplyScalar(12))
        .add(new THREE.Vector3(0, 1.8, 0));
    } else {
      camPos = input.position.clone()
        .add(input.tangent.clone().multiplyScalar(-(input.trainHalfLengthM + 14)))
        .add(new THREE.Vector3(0, 16, 0));
      lookAt = input.position.clone().add(new THREE.Vector3(0, 2, 0));
    }

    const lookYawTarget = this.mode === 'chase' ? 0 : this.lookDirection * (Math.PI * 0.34);
    this.currentLookYaw = THREE.MathUtils.lerp(this.currentLookYaw, lookYawTarget, this.mode === 'chase' ? 0.18 : 0.12);
    if (Math.abs(this.currentLookYaw) > 0.001) {
      const viewDirection = lookAt.clone().sub(camPos);
      if (viewDirection.lengthSq() > 1e-6) {
        viewDirection.applyAxisAngle(cameraUp, this.currentLookYaw);
        lookAt = camPos.clone().add(viewDirection);
      }
    }

    this.camera.position.lerp(camPos, this.mode === 'chase' ? 0.12 : 0.32);
    this.camera.up.lerp(cameraUp, 0.32).normalize();
    this.camera.lookAt(lookAt);
  }
}
