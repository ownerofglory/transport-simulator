import * as THREE from 'three';
import type { VvsStationMaterials } from '../VvsStationMaterials';

// Stadtbahn tracks sit at ±2.1m (guideway spacing); a terminus caps each with a
// buffer stop and a low end wall across both tracks. An island terminus is wider:
// its tracks have been pulled apart around the platform, and the buffers have to
// follow them or they stand in the six-foot.
const TRACK_OFFSET_M = 2.1;

/**
 * Terminus track ends: a red buffer stop (Prellbock) on each track plus a
 * concrete end wall. `endSign` points to the outward end of the platform
 * (+1 toward increasing route distance, −1 toward the start).
 */
export function buildVvsTerminusBuffer(
  local: THREE.Group,
  materials: VvsStationMaterials,
  platformLengthM: number,
  endSign: number,
  trackOffsetM = TRACK_OFFSET_M
): void {
  const endZ = endSign * (platformLengthM / 2 + 1.5);

  for (const x of [-trackOffsetM, trackOffsetM]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 0.5), materials.buffer);
    beam.position.set(x, 0.6, endZ);
    beam.castShadow = true;
    local.add(beam);
    for (const bx of [-0.55, 0.55]) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.4, 10), materials.buffer);
      pad.rotation.x = Math.PI / 2;
      pad.position.set(x + bx, 0.6, endZ - endSign * 0.35);
      local.add(pad);
    }
  }

  // Wide enough to close the gap behind both buffers, whatever the spacing.
  const wallWidthM = Math.max(11, trackOffsetM * 2 + 6.6);
  const endWall = new THREE.Mesh(new THREE.BoxGeometry(wallWidthM, 3.2, 0.5), materials.concrete);
  endWall.position.set(0, 1.4, endZ + endSign * 1.2);
  endWall.receiveShadow = true;
  local.add(endWall);
}
