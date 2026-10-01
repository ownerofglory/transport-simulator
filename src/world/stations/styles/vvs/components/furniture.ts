import * as THREE from 'three';
import type { VvsStationMaterials } from '../VvsStationMaterials';

export type VvsFurnitureCounts = {
  benches: number;
  ticketMachines: number;
  bins: number;
};

// Anchor positions reproduce the legacy single-item layout; extra items are
// distributed to additional deterministic slots so a count of 1 is unchanged.
const BENCH_SLOTS = [8, -6, 20];
const MACHINE_SLOTS = [-8, -2];
const BIN_SLOTS = [14, 2];

function slots(anchors: number[], count: number): number[] {
  return anchors.slice(0, Math.max(1, Math.min(count, anchors.length)));
}

/**
 * Per-side platform furniture: benches, ticket machines, a timetable case, and
 * bins. Counts come from resolved appearance data; a count of 1 matches the
 * legacy rail builder exactly. Benches shift slightly along underground
 * platforms. Screen/timetable faces are per-stop MeshBasicMaterials.
 */
export function buildVvsFurniture(
  local: THREE.Group,
  materials: VvsStationMaterials,
  side: number,
  underground: boolean,
  counts: VvsFurnitureCounts,
  lateral = 0, // extra outward shift when the platform is wider than default
  zShift = 0, // along-route shift for staggered platforms
  dbSurface = false
): void {
  const benchShift = (underground ? 1 : 0) + zShift;
  for (const z of slots(BENCH_SLOTS, counts.benches)) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.48, 4.8), dbSurface ? materials.dbBench : materials.bench);
    bench.position.set(side * (8.8 + lateral), 0.78, z + benchShift);
    bench.castShadow = true;
    local.add(bench);

    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.15, 4.8), dbSurface ? materials.dbBench : materials.bench);
    backrest.position.set(side * (9.32 + lateral), 1.25, z + benchShift);
    local.add(backrest);
  }

  for (const z of slots(MACHINE_SLOTS, counts.ticketMachines)) {
    const ticketMachine = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.9, 1.05), dbSurface ? materials.dbMachine : materials.machine);
    ticketMachine.position.set(side * (9.25 + lateral), 1.18, z + zShift);
    ticketMachine.castShadow = true;
    local.add(ticketMachine);

    const ticketScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.48, 0.42),
      new THREE.MeshBasicMaterial({ color: 0x82c9ef })
    );
    ticketScreen.position.set(side * (9.63 + lateral), 1.52, z + zShift);
    ticketScreen.rotation.y = (side * Math.PI) / 2;
    local.add(ticketScreen);
  }

  const timetableCase = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.85, 1.35), dbSurface ? materials.dbBlue : materials.ssbBlue);
  timetableCase.position.set(side * (9.45 + lateral), 1.46, -13 + zShift);
  local.add(timetableCase);

  const timetable = new THREE.Mesh(
    new THREE.PlaneGeometry(1.08, 1.52),
    new THREE.MeshBasicMaterial({ color: 0xf6f3e9 })
  );
  timetable.position.set(side * (9.55 + lateral), 1.46, -13 + zShift);
  timetable.rotation.y = (side * Math.PI) / 2;
  local.add(timetable);

  for (const z of slots(BIN_SLOTS, counts.bins)) {
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.95, 12), dbSurface ? materials.dbCanopyFrame : materials.ssbBlue);
    bin.position.set(side * (9.35 + lateral), 0.7, z + zShift);
    local.add(bin);
  }
}
