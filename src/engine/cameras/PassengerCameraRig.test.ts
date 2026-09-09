import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PassengerCameraRig } from './PassengerCameraRig';
import type { CameraRigContext } from './CameraRig';

function context(): CameraRigContext {
  const train = new THREE.Group();
  const cars = [new THREE.Group(), new THREE.Group()];
  train.add(...cars);
  return {
    train, trainCars: cars, interiorCameraProfile: 'rail', passengerOffsetM: 4.2,
    position: new THREE.Vector3(), tangent: new THREE.Vector3(0, 0, 1),
    underground: false, trainHalfLengthM: 20.15, routeDistanceM: 0, activeLaneOffsetM: 0,
    routePointAtDistance: (distance) => new THREE.Vector3(0, 0, distance)
  };
}

describe('rail passenger anchors', () => {
  it('follows the selected car translation, rotation and slope', () => {
    const input = context();
    const car = input.trainCars[1];
    car.userData.passengerCameraLocal = [0.08, 2.3, -2.5];
    car.userData.passengerLookAtLocal = [0.05, 2.2, 7.5];
    car.position.set(7, 2, 9.95);
    car.rotation.set(0.1, 0.6, 0.03);
    const pose = new PassengerCameraRig().pose(input);
    expect(pose.position.distanceTo(car.localToWorld(new THREE.Vector3(0.08, 2.3, -2.5)))).toBeLessThan(1e-9);
    expect(pose.target.distanceTo(car.localToWorld(new THREE.Vector3(0.05, 2.2, 7.5)))).toBeLessThan(1e-9);
    expect(pose.up.length()).toBeCloseTo(1);
  });

  it('preserves the generic rail camera when the vehicle has no custom anchor', () => {
    const pose = new PassengerCameraRig().pose(context());
    expect(pose.position.toArray()).toEqual([0.08, 2.3, 4.2]);
    expect(pose.target.toArray()).toEqual([1.5, 2.25, 85]);
  });
});
