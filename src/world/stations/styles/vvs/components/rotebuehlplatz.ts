import * as THREE from 'three';
import { makeLabelTexture } from '../../../../../labels';
import type { VvsStationMaterials } from '../VvsStationMaterials';

/**
 * Rotebühlplatz Stadtmitte is a large, older interchange hall. Its exposed red
 * roof structure, warm poster bays, and large suspended interchange plates
 * are authored here so those cues do not leak into newer Stuttgart boxes.
 */
export function buildRotebuehlplatzFittings(
  local: THREE.Group,
  materials: VvsStationMaterials,
  options: { lengthM: number; ceilingHeightM: number }
): void {
  const root = new THREE.Group();
  root.name = 'Rotebühlplatz station fittings';
  local.add(root);

  buildTerracottaPosterBays(root, materials, options.lengthM);
  buildTrussCrossMembers(root, materials, options.lengthM, options.ceilingHeightM);
  buildInterchangeSigns(root, materials, options.ceilingHeightM);
}

function buildTerracottaPosterBays(root: THREE.Group, materials: VvsStationMaterials, lengthM: number): void {
  const bayMaterial = materials.painted('#943b26');
  const frameMaterial = materials.painted('#e0c9ac');
  const posterMaterial = materials.painted('#262327');
  const positions = [-lengthM / 2 + 15, -12, 12, lengthM / 2 - 15];

  for (const side of [-1, 1]) {
    for (const z of positions) {
      const bay = new THREE.Mesh(new THREE.BoxGeometry(0.11, 3.25, 5.6), bayMaterial);
      bay.position.set(side * 11.79, 2.42, z);
      bay.name = 'Rotebühlplatz terracotta poster bay';
      root.add(bay);

      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.08, 1.45), frameMaterial);
      frame.position.set(side * 11.69, 2.42, z);
      root.add(frame);

      const poster = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.76, 1.16), posterMaterial);
      poster.position.set(side * 11.63, 2.42, z);
      root.add(poster);

      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 1.04), materials.lamp('#fff0cc'));
      glow.position.set(side * 11.59, 3.34, z);
      root.add(glow);
    }
  }
}

function buildTrussCrossMembers(
  root: THREE.Group,
  materials: VvsStationMaterials,
  lengthM: number,
  ceilingHeightM: number
): void {
  const spacingM = 12;
  const count = Math.max(3, Math.floor((lengthM - 12) / spacingM));
  const crossbars = new THREE.InstancedMesh(
    new THREE.BoxGeometry(23.8, 0.13, 0.16),
    materials.painted('#7b2d23'),
    count
  );
  crossbars.name = 'Rotebühlplatz red roof cross members';
  const dummy = new THREE.Object3D();
  const first = -((count - 1) * spacingM) / 2;
  for (let i = 0; i < count; i += 1) {
    dummy.position.set(0, ceilingHeightM - 0.48, first + i * spacingM);
    dummy.updateMatrix();
    crossbars.setMatrixAt(i, dummy.matrix);
  }
  crossbars.instanceMatrix.needsUpdate = true;
  root.add(crossbars);
}

function buildInterchangeSigns(root: THREE.Group, materials: VvsStationMaterials, ceilingHeightM: number): void {
  const texture = makeLabelTexture('Rotebühlplatz Stadtmitte   U1  U2  U4  U11', {
    width: 1280,
    height: 180,
    bg: '#f3f0e7',
    fg: '#182334'
  });
  const signMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  const signGeometry = new THREE.PlaneGeometry(6.4, 1.15);

  for (const side of [-1, 1]) {
    for (const z of [-20, 18]) {
      const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), materials.steel);
      hanger.position.set(side * 6.85, ceilingHeightM - 0.4, z);
      root.add(hanger);

      const sign = new THREE.Mesh(signGeometry, signMaterial);
      sign.position.set(side * 6.85, ceilingHeightM - 1.15, z);
      sign.rotation.y = (side * Math.PI) / 2;
      sign.name = 'Rotebühlplatz suspended interchange sign';
      root.add(sign);
    }
  }
}
