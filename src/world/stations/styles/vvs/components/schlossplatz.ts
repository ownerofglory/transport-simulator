import * as THREE from 'three';
import { makeLabelTexture } from '../../../../../labels';
import type { VvsStationMaterials } from '../VvsStationMaterials';

/** Schlossplatz wraps its side platforms in a fine-ribbed rounded shell. */
export function buildSchlossplatzFittings(
  local: THREE.Group,
  materials: VvsStationMaterials,
  options: { lengthM: number; ceilingHeightM: number }
): void {
  const root = new THREE.Group();
  root.name = 'Schlossplatz curved shell fittings';
  local.add(root);
  buildRibbedShells(root, materials, options.lengthM, options.ceilingHeightM);
  buildRecessedLightWedges(root, materials, options.lengthM, options.ceilingHeightM);
  buildStationPlaques(root, options.ceilingHeightM);
}

function buildRibbedShells(
  root: THREE.Group,
  materials: VvsStationMaterials,
  lengthM: number,
  ceilingHeightM: number
): void {
  const radiusM = 4.9;
  const centerX = 6.9;
  const centerY = 0.82;
  const geometry = roundedShellGeometry(radiusM, 0.24, lengthM - 2);
  for (const side of [-1, 1]) {
    const shell = new THREE.Mesh(geometry, materials.painted('#b9b5ac'));
    shell.position.set(0, 0, -(lengthM - 2) / 2);
    shell.scale.x = side;
    shell.name = 'Schlossplatz rounded wall shell';
    root.add(shell);

    const ridges = new THREE.InstancedMesh(new THREE.BoxGeometry(0.11, 0.11, lengthM - 3), materials.ceilingMetal, 13);
    ridges.name = 'Schlossplatz shell ribs';
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 13; i += 1) {
      const angle = (i / 12) * Math.PI / 2;
      dummy.position.set(side * (centerX + Math.cos(angle) * radiusM), centerY + Math.sin(angle) * radiusM, 0);
      dummy.updateMatrix();
      ridges.setMatrixAt(i, dummy.matrix);
    }
    ridges.instanceMatrix.needsUpdate = true;
    root.add(ridges);
  }
  root.position.y = Math.min(0, ceilingHeightM - (centerY + radiusM) - 0.08);
}

function roundedShellGeometry(radiusM: number, thicknessM: number, lengthM: number): THREE.ExtrudeGeometry {
  const centerX = 6.9;
  const centerY = 0.82;
  const shape = new THREE.Shape();
  shape.moveTo(centerX + radiusM, centerY);
  shape.absarc(centerX, centerY, radiusM, 0, Math.PI / 2, false);
  shape.lineTo(centerX, centerY + radiusM - thicknessM);
  shape.absarc(centerX, centerY, radiusM - thicknessM, Math.PI / 2, 0, true);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: lengthM, bevelEnabled: false, curveSegments: 20 });
}

function buildRecessedLightWedges(root: THREE.Group, materials: VvsStationMaterials, lengthM: number, ceilingHeightM: number): void {
  const count = Math.max(4, Math.floor((lengthM - 10) / 9));
  const first = -((count - 1) * 9) / 2;
  for (let i = 0; i < count; i += 1) {
    const wedge = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.13, 2.5), materials.lamp('#fff8e8'));
    wedge.position.set(0, ceilingHeightM - 0.22, first + i * 9);
    wedge.name = 'Schlossplatz recessed light wedge';
    root.add(wedge);
  }
}

function buildStationPlaques(root: THREE.Group, ceilingHeightM: number): void {
  const texture = makeLabelTexture('Schlossplatz', { width: 1024, height: 160, bg: '#f3efe4', fg: '#18191b' });
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  const geometry = new THREE.PlaneGeometry(5.2, 0.86);
  for (const side of [-1, 1]) {
    const plaque = new THREE.Mesh(geometry, material);
    plaque.position.set(side * 10.95, Math.min(3.5, ceilingHeightM - 1.55), -18);
    plaque.rotation.y = (-side * Math.PI) / 2;
    plaque.name = 'Schlossplatz station plaque';
    root.add(plaque);
  }
}
