import * as THREE from 'three';
import type { VvsStationMaterials } from '../VvsStationMaterials';

export type VvsCanopyOptions = {
  lengthM?: number;
  platformOffsetM?: number; // lateral center of the platform this canopy covers
  centerZ?: number; // along-route center (shifted for staggered platforms)
  accent?: THREE.Material; // fascia/post accent; defaults to SSB blue
};

/**
 * Surface side-platform canopy: flat roof, accent fascia edges, a glass back
 * wall, and posts with light strips. One call per platform side. With default
 * options the geometry matches the legacy rail surface canopy.
 */
export function buildVvsCanopy(
  local: THREE.Group,
  materials: VvsStationMaterials,
  side: number,
  options: VvsCanopyOptions = {}
): void {
  const lengthM = options.lengthM ?? 25;
  const platformOffset = options.platformOffsetM ?? 7.4;
  const center = options.centerZ ?? 8;
  const accent = options.accent ?? materials.ssbBlue;
  if (lengthM <= 0) return; // roof: 'none'

  // Canopy elements sit at fixed lateral offsets from the platform center, so a
  // platform of offset 7.4 reproduces the legacy x positions.
  const roofX = side * (platformOffset + 0.4);
  const glassX = side * (platformOffset + 3.15);
  const postX = side * (platformOffset + 3.1);
  const half = lengthM / 2;
  const postZs = [center - half + 2, center, center + half - 2];

  const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.24, lengthM), materials.canopy);
  roof.position.set(roofX, 4.25, center);
  roof.rotation.z = side * -0.035;
  roof.castShadow = true;
  local.add(roof);

  for (const roofEdge of [-1, 1]) {
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, lengthM + 0.2), accent);
    fascia.position.set(roofX + roofEdge * 3.05, 4.12, center);
    local.add(fascia);
  }

  const glassBack = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.55, lengthM - 3), materials.glass);
  glassBack.position.set(glassX, 2.55, center);
  local.add(glassBack);

  for (const z of postZs) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.55, 0.16), accent);
    post.position.set(postX, 2.25, z);
    post.castShadow = true;
    local.add(post);

    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 5.5), materials.light);
    lamp.position.set(roofX, 4.08, z);
    local.add(lamp);
  }
}
