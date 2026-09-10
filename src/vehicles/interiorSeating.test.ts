import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  PEDESTRIAN_HIP_HEIGHT_M,
  buildPedestrian,
  poseSeated,
  poseStandingHold
} from '../world/traffic/pedestrianMesh';
import {
  readInteriorFloorY,
  readSeatAnchors,
  registerInteriorFloor,
  registerSeatAnchors,
  yawForFacing
} from './interiorSeating';

describe('interior seating anchors', () => {
  it('accumulates anchors registered seat by seat', () => {
    const car = new THREE.Group();
    expect(readSeatAnchors(car)).toHaveLength(0);
    registerSeatAnchors(car, [{ x: -0.58, y: 1.365, z: 2, yaw: yawForFacing(1) }]);
    registerSeatAnchors(car, [{ x: 0.58, y: 1.365, z: 2, yaw: yawForFacing(-1) }]);
    expect(readSeatAnchors(car).map((seat) => seat.yaw)).toEqual([0, Math.PI]);
  });

  it('keeps the interior floor separate from the car origin', () => {
    const car = new THREE.Group();
    expect(readInteriorFloorY(car)).toBeUndefined();
    registerInteriorFloor(car, 1.06);
    expect(readInteriorFloorY(car)).toBe(1.06);
  });
});

describe('seated riders', () => {
  // The Tango's saloon: cushions 0.305 m above the floor, well below chair height.
  const seat = { x: 0.58, y: 1.365, z: -2.25, yaw: Math.PI };
  const floorY = 1.06;

  function seatRig(dropM = seat.y - floorY) {
    const car = new THREE.Group();
    const rig = buildPedestrian();
    rig.root.position.set(seat.x, seat.y - PEDESTRIAN_HIP_HEIGHT_M * rig.scale, seat.z);
    rig.root.rotation.set(0, seat.yaw, 0);
    poseSeated(rig, dropM);
    car.add(rig.root);
    car.updateMatrixWorld(true);
    return rig;
  }

  function soleY(rig: ReturnType<typeof buildPedestrian>): number {
    const shoe = rig.shins[0].children.find((child) => child.name === 'Shoe')!;
    return new THREE.Box3().setFromObject(shoe).min.y;
  }

  it('lands the hips on the cushion and the head above the seat back', () => {
    const rig = seatRig();
    const hip = rig.legs[0].getWorldPosition(new THREE.Vector3());
    expect(hip.y).toBeCloseTo(seat.y, 2);
    const head = rig.head.getWorldPosition(new THREE.Vector3());
    expect(head.y).toBeGreaterThan(seat.y + 0.5);
  });

  it('rests the feet on the floor of the car it is riding in', () => {
    for (const rig of [seatRig(), seatRig(), seatRig()]) {
      expect(soleY(rig)).toBeGreaterThan(floorY - 0.03);
      expect(soleY(rig)).toBeLessThan(floorY + 0.06);
    }
  });

  it('raises the knees on a low seat and drops them on a high one', () => {
    const kneeY = (dropM: number) => {
      const rig = seatRig(dropM);
      const hip = rig.legs[0].getWorldPosition(new THREE.Vector3());
      const knee = rig.shins[0].getWorldPosition(new THREE.Vector3());
      return knee.y - hip.y;
    };
    // A low cushion pushes the knees above the hips; a chair-height one does not.
    expect(kneeY(0.3)).toBeGreaterThan(0);
    expect(kneeY(0.48)).toBeLessThan(kneeY(0.3));
  });

  it('runs the thighs forward and the shins down to the floor', () => {
    const rig = seatRig();
    const hip = rig.legs[0].getWorldPosition(new THREE.Vector3());
    const knee = rig.shins[0].getWorldPosition(new THREE.Vector3());
    const shoe = rig.shins[0].children.find((child) => child.name === 'Shoe')!;
    const foot = shoe.getWorldPosition(new THREE.Vector3());
    // Knee ahead of the hip (the rider faces -Z at yaw = PI).
    expect(knee.z).toBeLessThan(hip.z - 0.25);
    // Shin drops from the knee toward the floor rather than sticking out.
    expect(foot.y).toBeLessThan(knee.y - 0.2);
    expect(Math.abs(foot.z - knee.z)).toBeLessThan(0.16);
  });

  it('puts a hand on each knee for riders who sit that way', () => {
    const rigs = Array.from({ length: 40 }, () => seatRig()).filter((rig) => rig.idleVariant === 0);
    expect(rigs.length).toBeGreaterThan(0);
    for (const rig of rigs) {
      const knee = rig.shins[0].getWorldPosition(new THREE.Vector3());
      const hand = rig.hands[0].getWorldPosition(new THREE.Vector3());
      expect(hand.distanceTo(knee)).toBeLessThan(0.22);
    }
  });

  it('raises one hand to the ceiling rail when standing', () => {
    const rig = buildPedestrian();
    poseStandingHold(rig);
    rig.root.updateMatrixWorld(true);
    const hands = rig.hands.map((hand) => hand.getWorldPosition(new THREE.Vector3()).y);
    // One hand up at the rail, the other down by the hip.
    expect(Math.max(...hands)).toBeGreaterThan(1.6);
    expect(Math.min(...hands)).toBeLessThan(1.0);
  });
});
