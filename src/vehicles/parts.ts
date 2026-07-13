import * as THREE from 'three';
import type { VehicleInstance } from './types';

// Shared vehicle part builders used by both the procedural factory and the
// blueprint renderers. Geometry and constants are unchanged extractions from
// the procedural builders; keep them byte-identical unless visuals should change.

export type ExteriorLightRig = {
  headLampMaterials: THREE.MeshStandardMaterial[];
  tailLampMaterials: THREE.MeshStandardMaterial[];
  headlightBeams: THREE.SpotLight[];
  tailGlows: THREE.PointLight[];
  cabinLights: THREE.PointLight[];
};

export function makeExteriorLightRig(): ExteriorLightRig {
  return { headLampMaterials: [], tailLampMaterials: [], headlightBeams: [], tailGlows: [], cabinLights: [] };
}

// Night-time light throw: a forward headlight beam and a red tail glow, both
// switched off in daylight via the setExteriorLightsOn handler.
export function addExteriorLightThrow(root: THREE.Object3D, rig: ExteriorLightRig, halfLengthM: number, beamHeightM: number): void {
  const headBeam = new THREE.SpotLight(0xfff3d0, 0, 80, 0.4, 0.6, 1.8);
  headBeam.name = 'Exterior lamp headlight beam';
  headBeam.position.set(0, beamHeightM, halfLengthM - 0.1);
  headBeam.target.name = 'Exterior lamp headlight target';
  headBeam.target.position.set(0, 0.15, halfLengthM + 26);
  root.add(headBeam, headBeam.target);
  rig.headlightBeams.push(headBeam);

  const tailGlow = new THREE.PointLight(0xd42020, 0, 16, 2);
  tailGlow.name = 'Exterior lamp tail glow';
  tailGlow.position.set(0, 0.9, -(halfLengthM + 1.4));
  root.add(tailGlow);
  rig.tailGlows.push(tailGlow);
}

// Warm cabin light so the interior stays readable in night/dawn views;
// switched together with the exterior lamps and off in daylight.
export function addCabinLight(rig: ExteriorLightRig, parent: THREE.Object3D, y: number, z = 0): void {
  const light = new THREE.PointLight(0xfff4dc, 0, 11, 1.8);
  light.name = 'Cabin light';
  light.position.set(0, y, z);
  parent.add(light);
  rig.cabinLights.push(light);
}

// Builds the day/night switch for every lamp material and light in the rig.
// Returns undefined when the vehicle has no switchable lights at all.
export function makeSetExteriorLightsOn(rig: ExteriorLightRig): ((on: boolean) => void) | undefined {
  if (rig.headLampMaterials.length + rig.tailLampMaterials.length + rig.cabinLights.length === 0) return undefined;
  return (on: boolean) => {
    for (const lamp of rig.headLampMaterials) lamp.emissiveIntensity = on ? 3.4 : 0.55;
    for (const lamp of rig.tailLampMaterials) lamp.emissiveIntensity = on ? 1.8 : 0.35;
    for (const beam of rig.headlightBeams) beam.intensity = on ? 260 : 0;
    for (const glow of rig.tailGlows) glow.intensity = on ? 8 : 0;
    for (const cabin of rig.cabinLights) cabin.intensity = on ? 6 : 0;
  };
}

export function addSlidingVehicleDoor(
  doors: VehicleInstance['doors'],
  car: THREE.Group,
  x: number,
  z: number,
  doorMaterial: THREE.Material,
  glassMaterial: THREE.Material,
  openingMaterial: THREE.Material,
  width: number,
  height: number
): void {
  const side = Math.sign(x) || 1;
  const opening = new THREE.Mesh(new THREE.PlaneGeometry(width, height), openingMaterial);
  opening.position.set(x + side * 0.055, 1.75, z);
  opening.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  car.add(opening);
  for (const direction of [-1, 1] as const) {
    const closedZ = z + direction * width * 0.24;
    const leaf = new THREE.Group();
    leaf.position.z = closedZ;
    for (const edge of [-1, 1] as const) {
      const stile = new THREE.Mesh(new THREE.BoxGeometry(0.125, height - 0.08, width * 0.075), doorMaterial);
      stile.position.set(x + side * 0.03, 1.75, edge * width * 0.205);
      leaf.add(stile);
    }
    const crystal = new THREE.Mesh(new THREE.BoxGeometry(0.082, height * 0.8, width * 0.37), glassMaterial);
    crystal.position.set(x + side * 0.018, 1.9, 0);
    leaf.add(crystal);
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, width * 0.48), doorMaterial);
    frameTop.position.set(x + side * 0.032, 2.64, 0);
    leaf.add(frameTop);
    const frameBottom = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.18, width * 0.48), doorMaterial);
    frameBottom.position.set(x + side * 0.032, 0.88, 0);
    leaf.add(frameBottom);
    car.add(leaf);
    doors.push({ group: leaf, closedZ, direction });
  }
}

export function addOpaqueTransitInterior(
  car: THREE.Group,
  length: number,
  halfWidth: number,
  material: THREE.Material,
  doorZones: (side: -1 | 1) => number[]
): void {
  for (const side of [-1, 1] as const) {
    const exclusions = doorZones(side).map((center) => ({ start: center - 0.92, end: center + 0.92 })).sort((a, b) => a.start - b.start);
    let cursor = -length / 2;
    for (const exclusion of [...exclusions, { start: length / 2, end: length / 2 }]) {
      const end = Math.min(length / 2, exclusion.start);
      if (end - cursor > 0.18) {
        const lowerWall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.68, end - cursor), material);
        lowerWall.position.set(side * halfWidth, 1.42, (cursor + end) / 2);
        car.add(lowerWall);
      }
      cursor = Math.max(cursor, exclusion.end);
    }
    const header = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.38, length), material);
    header.position.set(side * (halfWidth - 0.03), 3.02, 0);
    car.add(header);
    for (let z = -length / 2 + 1.2; z < length / 2 - 0.6; z += 2.05) {
      if (exclusions.some((zone) => z >= zone.start && z <= zone.end)) continue;
      const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.1), material);
      mullion.position.set(side * halfWidth, 2.38, z);
      car.add(mullion);
    }
  }
}
