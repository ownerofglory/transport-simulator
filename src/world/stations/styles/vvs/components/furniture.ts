import * as THREE from 'three';
import type { VvsStationMaterials } from '../VvsStationMaterials';

/**
 * Per-side platform furniture: bench, ticket machine, timetable case, and bin.
 * Bench sits slightly further along underground platforms, matching the legacy
 * rail builder. Screen/timetable faces are per-stop MeshBasicMaterials.
 */
export function buildVvsFurniture(
  local: THREE.Group,
  materials: VvsStationMaterials,
  side: number,
  underground: boolean
): void {
  const benchZ = underground ? 9 : 8;

  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.48, 4.8), materials.bench);
  bench.position.set(side * 8.8, 0.78, benchZ);
  bench.castShadow = true;
  local.add(bench);

  const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.15, 4.8), materials.bench);
  backrest.position.set(side * 9.32, 1.25, benchZ);
  local.add(backrest);

  const ticketMachine = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.9, 1.05), materials.machine);
  ticketMachine.position.set(side * 9.25, 1.18, -8);
  ticketMachine.castShadow = true;
  local.add(ticketMachine);

  const ticketScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.48, 0.42),
    new THREE.MeshBasicMaterial({ color: 0x82c9ef })
  );
  ticketScreen.position.set(side * 9.63, 1.52, -8);
  ticketScreen.rotation.y = (side * Math.PI) / 2;
  local.add(ticketScreen);

  const timetableCase = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.85, 1.35), materials.ssbBlue);
  timetableCase.position.set(side * 9.45, 1.46, -13);
  local.add(timetableCase);

  const timetable = new THREE.Mesh(
    new THREE.PlaneGeometry(1.08, 1.52),
    new THREE.MeshBasicMaterial({ color: 0xf6f3e9 })
  );
  timetable.position.set(side * 9.55, 1.46, -13);
  timetable.rotation.y = (side * Math.PI) / 2;
  local.add(timetable);

  const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.95, 12), materials.ssbBlue);
  bin.position.set(side * 9.35, 0.7, 14);
  local.add(bin);
}
