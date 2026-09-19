import * as THREE from 'three';
import type { VvsStationMaterials } from '../VvsStationMaterials';

/**
 * Maybachstraße is a deep side-platform box whose identity comes from the
 * glazed access enclosure, dark ceiling, and large circular wall insets.  This
 * is an authored station detail, not a generic building or facade system.
 */
export function buildMaybachstrasseFittings(
  local: THREE.Group,
  materials: VvsStationMaterials,
  options: { lengthM: number; ceilingHeightM: number }
): void {
  const root = new THREE.Group();
  root.name = 'Maybachstraße station fittings';
  local.add(root);

  buildWallPanelJoints(root, materials, options.lengthM);
  buildWallInsets(root, materials);
  buildWallLightRuns(root, materials, options.lengthM, options.ceilingHeightM);
  buildGlazedAccessPavilion(root, materials, options.ceilingHeightM);
}

function buildWallPanelJoints(root: THREE.Group, materials: VvsStationMaterials, lengthM: number): void {
  const spacingM = 6.2;
  const countPerSide = Math.max(4, Math.floor((lengthM - 10) / spacingM));
  const joints = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.06, 3.55, 0.055),
    materials.plinth,
    countPerSide * 2
  );
  joints.name = 'Maybachstraße wall panel joints';
  const dummy = new THREE.Object3D();
  const first = -((countPerSide - 1) * spacingM) / 2;
  let index = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < countPerSide; i += 1) {
      dummy.position.set(side * 11.79, 2.73, first + i * spacingM);
      dummy.updateMatrix();
      joints.setMatrixAt(index++, dummy.matrix);
    }
  }
  joints.instanceMatrix.needsUpdate = true;
  root.add(joints);
}

function buildWallInsets(root: THREE.Group, materials: VvsStationMaterials): void {
  const rimGeometry = new THREE.TorusGeometry(2.05, 0.13, 10, 28);
  const faceGeometry = new THREE.CircleGeometry(1.9, 28);
  const insetFace = materials.painted('#bcc1bd');

  for (const side of [-1, 1]) {
    for (const z of [-19, 19]) {
      const face = new THREE.Mesh(faceGeometry, insetFace);
      face.position.set(side * 11.73, 3.05, z);
      face.rotation.y = Math.PI / 2;
      face.name = 'Maybachstraße circular wall inset';
      root.add(face);

      const rim = new THREE.Mesh(rimGeometry, materials.steel);
      rim.position.set(side * 11.66, 3.05, z);
      rim.rotation.y = Math.PI / 2;
      root.add(rim);
    }
  }
}

function buildWallLightRuns(
  root: THREE.Group,
  materials: VvsStationMaterials,
  lengthM: number,
  ceilingHeightM: number
): void {
  const lamp = materials.lamp('#fff0cd');
  for (const side of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, lengthM - 4), lamp);
    strip.position.set(side * 11.63, ceilingHeightM - 0.88, 0);
    strip.name = 'Maybachstraße warm wall light';
    root.add(strip);
  }
}

function buildGlazedAccessPavilion(
  root: THREE.Group,
  materials: VvsStationMaterials,
  ceilingHeightM: number
): void {
  const x = 9.35;
  const z = 10;
  const baseY = 0.8;
  const heightM = Math.max(3.8, ceilingHeightM - baseY - 0.35);
  const pavilion = new THREE.Mesh(new THREE.BoxGeometry(3.6, heightM, 4.8), materials.glass);
  pavilion.position.set(x, baseY + heightM / 2, z);
  pavilion.name = 'Maybachstraße glazed lift pavilion';
  root.add(pavilion);

  const verticalGeometry = new THREE.BoxGeometry(0.13, heightM, 0.13);
  const crossbarGeometry = new THREE.BoxGeometry(3.85, 0.12, 0.12);
  const violet = materials.lamp('#c9b6ff');
  for (const edgeX of [-1, 1]) {
    for (const edgeZ of [-1, 1]) {
      const post = new THREE.Mesh(verticalGeometry, materials.steel);
      post.position.set(x + edgeX * 1.86, baseY + heightM / 2, z + edgeZ * 2.46);
      root.add(post);
    }
  }
  for (const y of [baseY + 1.35, baseY + heightM - 1.1]) {
    const crossbar = new THREE.Mesh(crossbarGeometry, materials.steel);
    crossbar.position.set(x, y, z - 2.46);
    root.add(crossbar);

    const accent = new THREE.Mesh(new THREE.BoxGeometry(3.35, 0.06, 0.06), violet);
    accent.position.set(x, y + 0.16, z - 2.53);
    root.add(accent);
  }
}
