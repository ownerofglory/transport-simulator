import * as THREE from 'three';
import type { InteriorCameraProfile } from '../domain/transport';

export type CameraMode = 'passenger' | 'cab' | 'chase';

type CameraUpdateInput = {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  underground: boolean;
  interiorCameraProfile: InteriorCameraProfile;
  passengerOffsetM: number;
  trainHalfLengthM: number;
  train: THREE.Group;
  trainCars: THREE.Group[];
};

/** Controls chase, passenger, and cab camera placement for the active vehicle. */
export class CameraController {
  private mode: CameraMode = 'chase';

  // -1/1 are side-look inputs; 0 means looking forward.
  private lookDirection: -1 | 0 | 1 = 0;

  // Smoothed yaw offset for passenger/cab look-left/look-right controls.
  private currentLookYaw = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Cycles through exterior chase, passenger interior, and cab views. */
  cycle(): CameraMode {
    this.mode = this.mode === 'chase' ? 'passenger' : this.mode === 'passenger' ? 'cab' : 'chase';
    return this.mode;
  }

  /** Returns the active camera mode for HUD and vehicle-visibility logic. */
  currentMode(): CameraMode {
    return this.mode;
  }

  /** Stores held look direction from keyboard/touch input. */
  setLookInput(leftHeld: boolean, rightHeld: boolean): void {
    this.lookDirection = leftHeld === rightHeld ? 0 : leftHeld ? 1 : -1;
  }

  /** Updates camera position, target, up-vector, and side-look yaw each frame. */
  update(input: CameraUpdateInput): void {
    // Horizontal route normal used for passenger offsets and forward-looking bias.
    const normal = new THREE.Vector3(input.tangent.z, 0, -input.tangent.x).normalize();

    let camPos: THREE.Vector3;
    let lookAt: THREE.Vector3;

    // Default world up; interior cameras may inherit the vehicle car's up vector.
    let cameraUp = new THREE.Vector3(0, 1, 0);

    if (this.mode === 'passenger') {
      const anchoredInterior = input.interiorCameraProfile === 'bus' || input.interiorCameraProfile === 's-bahn' || input.interiorCameraProfile === 'tram';

      if (anchoredInterior) {
        // Anchor interior cameras to a car mesh so articulated vehicles turn correctly.
        input.train.updateMatrixWorld(true);

        const midCar = input.trainCars[2] ?? input.trainCars[Math.floor(input.trainCars.length / 2)] ?? input.trainCars[0];
        const passengerCar = input.interiorCameraProfile === 's-bahn'
          ? midCar // middle S-Bahn car gives a stable passenger view.
          : input.interiorCameraProfile === 'tram'
            ? midCar // middle tram section avoids front cab obstruction; falls back if fewer than 3 cars.
            : input.trainCars[0]; // bus has one body group.

        const localZ = input.interiorCameraProfile === 's-bahn'
          ? -2 // S-Bahn passenger seat position within selected car.
          : input.interiorCameraProfile === 'tram'
            ? -0.6 // tram interior camera near articulated center section.
            : -4.4; // bus passenger camera further back from the driver area.

        camPos = passengerCar.localToWorld(new THREE.Vector3(0.16, 2.3, localZ)); // slight side offset, eye height.
        lookAt = passengerCar.localToWorld(new THREE.Vector3(0, 2.25, input.interiorCameraProfile === 'tram' ? 26 : 70)); // forward interior look target.

        cameraUp = new THREE.Vector3(0, 1, 0)
          .applyQuaternion(passengerCar.getWorldQuaternion(new THREE.Quaternion()))
          .normalize();
      } else {
        // Fallback passenger camera for vehicles without a detailed anchored interior.
        camPos = input.position.clone()
          .add(input.tangent.clone().multiplyScalar(input.passengerOffsetM))
          .add(normal.clone().multiplyScalar(0.08)) // tiny side offset to avoid exact centerline.
          .add(new THREE.Vector3(0, 2.3, 0)); // passenger eye height.

        lookAt = input.position.clone()
          .add(input.tangent.clone().multiplyScalar(85)) // far forward look target.
          .add(normal.clone().multiplyScalar(1.5)) // small side bias so the view feels seated.
          .add(new THREE.Vector3(0, 2.25, 0)); // passenger eye-level target.
      }
    } else if (this.mode === 'cab') {
      camPos = input.position.clone()
        .add(input.tangent.clone().multiplyScalar(input.trainHalfLengthM - 1.75)) // just behind the vehicle nose.
        .add(new THREE.Vector3(0, 2.65, 0)); // cab eye height.

      lookAt = input.position.clone()
        .add(input.tangent.clone().multiplyScalar(120)) // long forward target for driving view.
        .add(new THREE.Vector3(0, 2.2, 0)); // slightly lower than cab eye height.
    } else if (input.underground) {
      camPos = input.position.clone()
        .add(input.tangent.clone().multiplyScalar(-(input.trainHalfLengthM + 22))) // closer chase camera in tunnels.
        .add(new THREE.Vector3(0, 4.6, 0)); // low ceiling-safe camera height.

      lookAt = input.position.clone()
        .add(input.tangent.clone().multiplyScalar(12)) // look slightly ahead of train.
        .add(new THREE.Vector3(0, 1.8, 0)); // target near vehicle body height.
    } else {
      camPos = input.position.clone()
        .add(input.tangent.clone().multiplyScalar(-(input.trainHalfLengthM + 14))) // exterior chase distance behind train.
        .add(new THREE.Vector3(0, 16, 0)); // elevated outdoor chase height.

      lookAt = input.position.clone().add(new THREE.Vector3(0, 2, 0)); // target near vehicle center mass.
    }

    const lookYawTarget = this.mode === 'chase' ? 0 : this.lookDirection * (Math.PI * 0.34); // about 61° side-look.
    this.currentLookYaw = THREE.MathUtils.lerp(
      this.currentLookYaw,
      lookYawTarget,
      this.mode === 'chase' ? 0.18 : 0.12 // faster reset in chase, gentler interior look smoothing.
    );

    if (Math.abs(this.currentLookYaw) > 0.001) {
      const viewDirection = lookAt.clone().sub(camPos);

      if (viewDirection.lengthSq() > 1e-6) {
        viewDirection.applyAxisAngle(cameraUp, this.currentLookYaw);
        lookAt = camPos.clone().add(viewDirection);
      }
    }

    this.camera.position.lerp(camPos, this.mode === 'chase' ? 0.12 : 0.32); // smoother chase, snappier interior.
    this.camera.up.lerp(cameraUp, 0.32).normalize(); // blend up-vector to avoid abrupt banking changes.
    this.camera.lookAt(lookAt);
  }
}
