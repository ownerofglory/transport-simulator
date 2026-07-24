import * as THREE from 'three';
import type { VvsStationMaterials } from '../VvsStationMaterials';

/**
 * Underground hall shell (ceiling + side walls). Attaches to the positioned,
 * rotated local group. Geometry matches the legacy 27x82m rail hall.
 */
export function buildVvsUndergroundHall(local: THREE.Group, materials: VvsStationMaterials): void {
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(27, 0.48, 82), materials.undergroundWall);
  ceiling.position.y = 5.7;
  ceiling.receiveShadow = true;
  local.add(ceiling);

  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.45, 5.3, 82), materials.undergroundWall);
    wall.position.set(side * 12.2, 2.75, 0);
    wall.receiveShadow = true;
    local.add(wall);
  }
}

/** Per-side underground pillars and ceiling light strips. */
export function buildVvsUndergroundSideLighting(
  local: THREE.Group,
  materials: VvsStationMaterials,
  side: number
): void {
  for (const z of [-24, 0, 24]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.58, 5.1, 0.58), materials.ssbBlue);
    pillar.position.set(side * 9.7, 2.72, z);
    pillar.castShadow = true;
    local.add(pillar);
  }
  for (const z of [-24, -8, 8, 24]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.12, 8.5), materials.light);
    light.position.set(side * 7.1, 5.4, z);
    local.add(light);
  }
}
