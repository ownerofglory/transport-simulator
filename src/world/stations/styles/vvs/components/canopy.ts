import * as THREE from 'three';
import { makeLabelTexture } from '../../../../../labels';
import type { StationCanopyStyle } from '../../../types';
import type { VvsStationMaterials } from '../VvsStationMaterials';

export type VvsCanopyOptions = {
  lengthM?: number;
  platformOffsetM?: number; // lateral center of the platform this canopy covers
  centerZ?: number; // along-route center (shifted for staggered platforms)
  accent?: THREE.Material; // fascia/post accent; defaults to SSB blue
  style?: StationCanopyStyle;
  postMaterial?: THREE.Material;
  // Stop name printed along the outer fascia, as the real canopies carry it.
  nameOnFascia?: string;
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

  const style = options.style ?? 'flat-slab';

  if (style === 'curved-shell') {
    // Translucent barrel over the platform, as on the newer roadside stops.
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(3.3, 3.3, lengthM, 16, 1, true, Math.PI, Math.PI),
      materials.glass
    );
    shell.position.set(roofX, 3.9, center);
    shell.rotation.z = Math.PI / 2;
    shell.rotation.y = Math.PI / 2;
    local.add(shell);
  }

  const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.24, lengthM), materials.canopy);
  roof.position.set(roofX, 4.25, center);
  // The butterfly roof tilts hard off a single spine instead of lying near flat.
  roof.rotation.z = side * (style === 'butterfly' ? -0.14 : -0.035);
  roof.castShadow = true;
  local.add(roof);

  for (const roofEdge of [-1, 1]) {
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, lengthM + 0.2), accent);
    fascia.position.set(roofX + roofEdge * 3.05, 4.12, center);
    local.add(fascia);
  }

  if (options.nameOnFascia) {
    const texture = makeLabelTexture(options.nameOnFascia, {
      width: 1024,
      height: 96,
      bg: '#f2f2ef',
      fg: '#1b1c1e'
    });
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(lengthM - 2, 20), 0.38),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide })
    );
    plate.position.set(roofX - side * 3.15, 4.12, center);
    plate.rotation.y = (-side * Math.PI) / 2;
    local.add(plate);
  }

  const glassBack = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.55, lengthM - 3), materials.glass);
  glassBack.position.set(glassX, 2.55, center);
  local.add(glassBack);

  const postMaterial = options.postMaterial ?? accent;
  for (const z of postZs) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.55, 0.16), postMaterial);
    post.position.set(postX, 2.25, z);
    post.castShadow = true;
    local.add(post);

    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 5.5), materials.light);
    lamp.position.set(roofX, 4.08, z);
    local.add(lamp);
  }
}
