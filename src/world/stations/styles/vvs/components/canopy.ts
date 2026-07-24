import * as THREE from 'three';
import type { VvsStationMaterials } from '../VvsStationMaterials';

/**
 * Surface side-platform canopy: flat roof, blue fascia edges, a glass back
 * wall, and posts with light strips. One call per platform side. Geometry
 * matches the legacy rail surface canopy.
 */
export function buildVvsCanopy(local: THREE.Group, materials: VvsStationMaterials, side: number): void {
  const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.24, 25), materials.canopy);
  roof.position.set(side * 7.8, 4.25, 8);
  roof.rotation.z = side * -0.035;
  roof.castShadow = true;
  local.add(roof);

  for (const roofEdge of [-1, 1]) {
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 25.2), materials.ssbBlue);
    fascia.position.set(side * 7.8 + roofEdge * 3.05, 4.12, 8);
    local.add(fascia);
  }

  const glassBack = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.55, 22), materials.glass);
  glassBack.position.set(side * 10.55, 2.55, 8);
  local.add(glassBack);

  for (const z of [-2.5, 8, 18.5]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.55, 0.16), materials.ssbBlue);
    post.position.set(side * 10.5, 2.25, z);
    post.castShadow = true;
    local.add(post);

    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 5.5), materials.light);
    lamp.position.set(side * 7.8, 4.08, z);
    local.add(lamp);
  }
}
