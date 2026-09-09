import * as THREE from 'three';
import type { CameraMode } from '../../world/CameraController';
import type { CameraPose, CameraRig, CameraRigContext } from './CameraRig';

/**
 * Passenger interior view. For vehicles with a detailed interior (bus/s-bahn/
 * tram profiles) the camera anchors to a car mesh so articulated vehicles turn
 * correctly; otherwise it falls back to a seated eye-height position.
 */
export class PassengerCameraRig implements CameraRig {
  readonly id: CameraMode = 'passenger';
  readonly positionSmoothing = 0.32;
  readonly lookYawFactor = 0.12;
  readonly lookYawAmount = Math.PI * 0.34;

  pose(input: CameraRigContext): CameraPose {
    const normal = new THREE.Vector3(input.tangent.z, 0, -input.tangent.x).normalize();
    const midCar = input.trainCars[2] ?? input.trainCars[Math.floor(input.trainCars.length / 2)] ?? input.trainCars[0];
    const anchoredRail = input.interiorCameraProfile === 'rail' && !!midCar?.userData.passengerCameraLocal;
    const anchoredInterior =
      anchoredRail ||
      input.interiorCameraProfile === 'bus' ||
      input.interiorCameraProfile === 's-bahn' ||
      input.interiorCameraProfile === 'tram';

    if (anchoredInterior) {
      // Anchor interior cameras to a car mesh so articulated vehicles turn correctly.
      input.train.updateMatrixWorld(true);

      const passengerCar = anchoredRail ? midCar : input.interiorCameraProfile === 's-bahn'
        ? midCar // middle S-Bahn car gives a stable passenger view.
        : input.interiorCameraProfile === 'tram'
          ? midCar // middle tram section avoids front cab obstruction; falls back if fewer than 3 cars.
          : input.trainCars[0]; // bus has one body group.

      const customCameraLocal = passengerCar.userData.passengerCameraLocal as [number, number, number] | undefined;
      const customLookAtLocal = passengerCar.userData.passengerLookAtLocal as [number, number, number] | undefined;
      const localZ = input.interiorCameraProfile === 's-bahn'
        ? -2 // S-Bahn passenger seat position within selected car.
        : input.interiorCameraProfile === 'tram'
          ? -0.6 // tram interior camera near articulated center section.
          : -4.4; // bus passenger camera further back from the driver area.

      const position = passengerCar.localToWorld(new THREE.Vector3(
        customCameraLocal?.[0] ?? 0.16,
        customCameraLocal?.[1] ?? 2.3,
        customCameraLocal?.[2] ?? localZ
      ));
      const target = passengerCar.localToWorld(new THREE.Vector3(
        customLookAtLocal?.[0] ?? 0,
        customLookAtLocal?.[1] ?? 2.25,
        customLookAtLocal?.[2] ?? (input.interiorCameraProfile === 'tram' ? 26 : 70)
      ));
      const up = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(passengerCar.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
      return { position, target, up };
    }

    // Fallback passenger camera for vehicles without a detailed anchored interior.
    return {
      position: input.position.clone()
        .add(input.tangent.clone().multiplyScalar(input.passengerOffsetM))
        .add(normal.clone().multiplyScalar(0.08)) // tiny side offset to avoid exact centerline.
        .add(new THREE.Vector3(0, 2.3, 0)), // passenger eye height.
      target: input.position.clone()
        .add(input.tangent.clone().multiplyScalar(85)) // far forward look target.
        .add(normal.clone().multiplyScalar(1.5)) // small side bias so the view feels seated.
        .add(new THREE.Vector3(0, 2.25, 0)), // passenger eye-level target.
      up: new THREE.Vector3(0, 1, 0)
    };
  }
}
