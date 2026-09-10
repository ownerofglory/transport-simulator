import * as THREE from 'three';
import type { VehicleDoorConfig, VehicleInteriorConfig, VehicleSectionConfig } from './VehicleBlueprintConfig';
import { resolveMaterial } from './materials';
import { registerInteriorFloor, registerSeatAnchors, yawForFacing } from '../interiorSeating';

// Builds a simple opaque interior shell (floor, ceiling, wall segments that
// avoid door openings) plus optional auto-placed bench seats and grab poles.
export function buildBlueprintInterior(
  group: THREE.Group,
  section: VehicleSectionConfig,
  sectionIndex: number,
  sectionDoors: VehicleDoorConfig[],
  materials: Record<string, THREE.MeshStandardMaterial>,
  interior: VehicleInteriorConfig | undefined
): void {
  if (!interior?.enabled) return;

  const widthM = section.widthM ?? 2.4;
  const heightM = section.heightM ?? 3.2;
  const floorHeightM = heightM * 0.28;
  const bodyHeight = heightM - floorHeightM * 0.35;
  const bodyCenterY = floorHeightM * 0.35 + bodyHeight / 2;
  const floorMaterial = resolveMaterial(materials, interior.floorMaterial, 'floor');
  const wallMaterial = resolveMaterial(materials, interior.wallMaterial, 'interior');
  const poleMaterial = resolveMaterial(materials, interior.poleMaterial, 'metal');
  const seatMaterial = resolveMaterial(materials, interior.seatMaterial, 'seat');

  const floor = new THREE.Mesh(new THREE.BoxGeometry(widthM * 0.86, 0.06, section.length - 0.14), floorMaterial);
  floor.position.y = floorHeightM * 0.35 + 0.03;
  group.add(floor);
  registerInteriorFloor(group, floorHeightM * 0.35 + 0.06);
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(widthM * 0.82, 0.06, section.length - 0.2), wallMaterial);
  ceiling.position.y = bodyCenterY + bodyHeight / 2 - 0.05;
  group.add(ceiling);

  if (interior.autoPassengerShell !== false) {
    const doorZones = sectionDoors.map((door) => ({ start: door.z - (door.widthM ?? 1.3) * 0.6, end: door.z + (door.widthM ?? 1.3) * 0.6 })).sort((a, b) => a.start - b.start);
    for (const side of [-1, 1] as const) {
      let cursor = -section.length / 2;
      for (const zone of [...doorZones, { start: section.length / 2, end: section.length / 2 }]) {
        const end = Math.min(section.length / 2, zone.start);
        if (end - cursor > 0.2) {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(0.08, bodyHeight * 0.42, end - cursor), wallMaterial);
          wall.position.set(side * widthM * 0.46, bodyCenterY - bodyHeight * 0.05, (cursor + end) / 2);
          group.add(wall);
        }
        cursor = Math.max(cursor, zone.end);
      }
    }
  }

  if (interior.autoSeats !== false) {
    const usableLength = section.length - 1.6;
    if (usableLength > 1) {
      const rowCount = Math.max(1, Math.round(usableLength / 1.1));
      const step = usableLength / rowCount;
      const start = -usableLength / 2 + step / 2;
      for (let row = 0; row < rowCount; row++) {
        const z = start + row * step;
        for (const x of [-widthM * 0.24, widthM * 0.24]) {
          const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.5), seatMaterial);
          cushion.position.set(x, floorHeightM * 0.35 + 0.36, z);
          group.add(cushion);
          const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.62, 0.1), seatMaterial);
          back.position.set(x, floorHeightM * 0.35 + 0.68, z - 0.24);
          group.add(back);
          registerSeatAnchors(group, [{ x, y: floorHeightM * 0.35 + 0.42, z, yaw: yawForFacing(1) }]);
        }
      }
    }
  }

  if (interior.autoPoles !== false) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, bodyHeight * 0.72, 8), poleMaterial);
    pole.position.set(0, bodyCenterY - bodyHeight * 0.1, 0);
    group.add(pole);
  }
}
