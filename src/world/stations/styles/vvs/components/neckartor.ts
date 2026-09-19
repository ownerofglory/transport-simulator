import * as THREE from 'three';
import { makeLabelTexture } from '../../../../../labels';
import type { VvsStationMaterials } from '../VvsStationMaterials';

/**
 * Neckartor's vivid blue, green, yellow, and orange panels continue into a
 * framed glazed access gallery. These are its recognisable interior cues, not
 * a generic treatment for other underground stops.
 */
export function buildNeckartorFittings(
  local: THREE.Group,
  materials: VvsStationMaterials,
  options: { lengthM: number; ceilingHeightM: number }
): void {
  const root = new THREE.Group();
  root.name = 'Neckartor station fittings';
  local.add(root);

  buildColorPanelRuns(root, materials, options.lengthM);
  buildGlazedAccessGallery(root, materials, options.ceilingHeightM);
  buildOverheadWirework(root, materials, options.lengthM, options.ceilingHeightM);
  buildStationPlaque(root, options.ceilingHeightM);
}

function buildColorPanelRuns(root: THREE.Group, materials: VvsStationMaterials, lengthM: number): void {
  const colors = ['#1c4a9e', '#258645', '#d7a500', '#d24d2d', '#f1ebe0'];
  const positions = [-lengthM / 2 + 14, -22, -8, 8, 22, lengthM / 2 - 14];
  for (const side of [-1, 1]) {
    for (let i = 0; i < positions.length; i += 1) {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 2.45, 2.25),
        materials.painted(colors[(i + (side === 1 ? 2 : 0)) % colors.length])
      );
      panel.position.set(side * 11.73, 2.4, positions[i]);
      panel.name = 'Neckartor colored wall panel';
      root.add(panel);

      const divider = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.65, 0.1), materials.mast);
      divider.position.set(side * 11.65, 2.4, positions[i] - 1.2);
      root.add(divider);
    }
  }
}

function buildGlazedAccessGallery(root: THREE.Group, materials: VvsStationMaterials, ceilingHeightM: number): void {
  const x = -11.53;
  const z = -4;
  const heightM = Math.max(1.7, ceilingHeightM - 3.7);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.08, heightM, 18), materials.glass);
  glass.position.set(x, 3.75 + heightM / 2, z);
  glass.name = 'Neckartor glazed access gallery';
  root.add(glass);

  for (let i = -3; i <= 3; i += 1) {
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.13, heightM + 0.18, 0.13), materials.steel);
    mullion.position.set(x - 0.08, 3.75 + heightM / 2, z + i * 2.55);
    root.add(mullion);
  }
  for (const y of [3.72, 3.75 + heightM]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 18.2), materials.steel);
    rail.position.set(x - 0.08, y, z);
    root.add(rail);
  }

  const colors = ['#1d5aad', '#28854b', '#d35a31', '#d3b000'];
  for (let i = 0; i < colors.length; i += 1) {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.12, 1.85), materials.painted(colors[i]));
    pane.position.set(x + 0.07, 4.35, z - 5.8 + i * 3.85);
    root.add(pane);
  }
}

function buildOverheadWirework(
  root: THREE.Group,
  materials: VvsStationMaterials,
  lengthM: number,
  ceilingHeightM: number
): void {
  const cable = materials.painted('#1b1c1d');
  for (const x of [-5.3, -4.35, -3.4, 3.9]) {
    const run = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, lengthM - 4), cable);
    run.position.set(x, ceilingHeightM - 0.72, 0);
    run.name = 'Neckartor overhead wire';
    root.add(run);
  }
}

function buildStationPlaque(root: THREE.Group, ceilingHeightM: number): void {
  const texture = makeLabelTexture('Neckartor', {
    width: 768,
    height: 140,
    bg: '#f0eee6',
    fg: '#1e2021'
  });
  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 0.72),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
  );
  plaque.position.set(11.61, Math.min(3.8, ceilingHeightM - 1.4), 18);
  plaque.rotation.y = -Math.PI / 2;
  plaque.name = 'Neckartor station plaque';
  root.add(plaque);
}
