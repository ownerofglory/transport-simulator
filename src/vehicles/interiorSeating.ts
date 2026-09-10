import type * as THREE from 'three';

/**
 * Where a rider can sit or stand inside a car, in car-local space. Interior
 * builders publish these so passenger systems never have to guess a floor
 * height or reverse-engineer a seat layout from geometry.
 */
export type InteriorSeatAnchor = {
  /** Cushion centre in x/z; `y` is the cushion top surface. */
  x: number;
  y: number;
  z: number;
  /** Yaw in radians the occupant faces (car-local, +Z is car forward). */
  yaw: number;
};

type InteriorSeatingUserData = {
  seatAnchors?: InteriorSeatAnchor[];
  interiorFloorY?: number;
};

function seating(car: THREE.Object3D): InteriorSeatingUserData {
  const existing = car.userData.interiorSeating as InteriorSeatingUserData | undefined;
  if (existing) return existing;
  const created: InteriorSeatingUserData = {};
  car.userData.interiorSeating = created;
  return created;
}

/** Yaw for a transverse seat whose backrest sits at `-facing` along z. */
export function yawForFacing(facing: -1 | 1): number {
  return facing > 0 ? 0 : Math.PI;
}

export function registerSeatAnchors(car: THREE.Object3D, anchors: InteriorSeatAnchor[]): void {
  if (anchors.length === 0) return;
  const data = seating(car);
  if (data.seatAnchors) data.seatAnchors.push(...anchors);
  else data.seatAnchors = [...anchors];
}

/** Interior walking surface height in car-local space, for standing riders. */
export function registerInteriorFloor(car: THREE.Object3D, floorY: number): void {
  seating(car).interiorFloorY = floorY;
}

export function readSeatAnchors(car: THREE.Object3D): readonly InteriorSeatAnchor[] {
  return (car.userData.interiorSeating as InteriorSeatingUserData | undefined)?.seatAnchors ?? [];
}

export function readInteriorFloorY(car: THREE.Object3D): number | undefined {
  return (car.userData.interiorSeating as InteriorSeatingUserData | undefined)?.interiorFloorY;
}
