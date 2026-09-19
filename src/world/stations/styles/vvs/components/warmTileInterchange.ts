import * as THREE from 'three';
import { makeLabelTexture } from '../../../../../labels';
import type { VvsStationMaterials } from '../VvsStationMaterials';

/**
 * Marienplatz, Österreichischer Platz, and Rathaus share Stuttgart's warm
 * tiled interchange language: a terracotta deck, pale running-bond walls, a
 * red name band, fluorescent rows, and visible overhead service wirework.
 */
export function buildWarmTileInterchangeFittings(
  local: THREE.Group,
  materials: VvsStationMaterials,
  options: { lengthM: number; ceilingHeightM: number; stationName: string }
): void {
  const root = new THREE.Group();
  root.name = `${options.stationName} warm tile interchange fittings`;
  local.add(root);

  buildTileWallJoints(root, materials, options.lengthM);
  buildRedNameBands(root, materials, options.lengthM);
  buildFluorescentRows(root, materials, options.lengthM, options.ceilingHeightM);
  buildServiceWirework(root, materials, options.lengthM, options.ceilingHeightM);
  buildStationPlaques(root, options.stationName, options.ceilingHeightM);
}

function buildTileWallJoints(root: THREE.Group, materials: VvsStationMaterials, lengthM: number): void {
  const grout = materials.painted('#a49a8a');
  const verticalRows = 6;
  const spacingM = 1.18;
  const columns = Math.max(5, Math.floor((lengthM - 8) / spacingM));
  const vertical = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.04, 0.48, 0.025),
    grout,
    columns * verticalRows * 2
  );
  vertical.name = 'Warm tile wall vertical joints';
  const dummy = new THREE.Object3D();
  const first = -((columns - 1) * spacingM) / 2;
  let index = 0;
  for (const side of [-1, 1]) {
    for (let row = 0; row < verticalRows; row += 1) {
      const rowOffset = row % 2 === 0 ? 0 : spacingM / 2;
      for (let column = 0; column < columns; column += 1) {
        dummy.position.set(side * 11.76, 1.15 + row * 0.5, first + column * spacingM + rowOffset);
        dummy.updateMatrix();
        vertical.setMatrixAt(index++, dummy.matrix);
      }
    }
  }
  vertical.instanceMatrix.needsUpdate = true;
  root.add(vertical);

  for (let row = 0; row <= verticalRows; row += 1) {
    for (const side of [-1, 1]) {
      const horizontal = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, lengthM - 4), grout);
      horizontal.position.set(side * 11.76, 0.9 + row * 0.5, 0);
      root.add(horizontal);
    }
  }
}

function buildRedNameBands(root: THREE.Group, materials: VvsStationMaterials, lengthM: number): void {
  const red = materials.painted('#a92d1e');
  for (const side of [-1, 1]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, lengthM - 2), red);
    band.position.set(side * 11.7, 4.22, 0);
    band.name = 'Warm tile red name band';
    root.add(band);
  }
}

function buildFluorescentRows(
  root: THREE.Group,
  materials: VvsStationMaterials,
  lengthM: number,
  ceilingHeightM: number
): void {
  const lamp = materials.lamp('#fff4d6');
  for (const x of [-6.7, 0, 6.7]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.13, lengthM - 4), lamp);
    strip.position.set(x, ceilingHeightM - 0.16, 0);
    strip.name = 'Warm tile fluorescent row';
    root.add(strip);
  }
}

function buildServiceWirework(
  root: THREE.Group,
  materials: VvsStationMaterials,
  lengthM: number,
  ceilingHeightM: number
): void {
  const cable = materials.painted('#222426');
  for (const x of [-4.6, -3.75, -2.9]) {
    const run = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, lengthM - 6), cable);
    run.position.set(x, ceilingHeightM - 0.82, 0);
    run.name = 'Warm tile overhead service wire';
    root.add(run);
  }
}

function buildStationPlaques(root: THREE.Group, stationName: string, ceilingHeightM: number): void {
  const texture = makeLabelTexture(stationName, {
    width: 1024,
    height: 140,
    bg: '#f0eadc',
    fg: '#252526'
  });
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  const geometry = new THREE.PlaneGeometry(4.8, 0.72);
  for (const side of [-1, 1]) {
    const plaque = new THREE.Mesh(geometry, material);
    plaque.position.set(side * 11.62, ceilingHeightM - 1.95, -14);
    plaque.rotation.y = (-side * Math.PI) / 2;
    plaque.name = 'Warm tile station plaque';
    root.add(plaque);
  }
}
