import * as THREE from 'three';
import { makeLabelTexture } from '../../../../../labels';
import type { VvsStationMaterials } from '../VvsStationMaterials';

/**
 * Kirchtalstraße's U15 platform is a deliberately spare concrete box: a
 * central structural pier, bright linear fittings, and the large blue wall
 * chevrons are the station's visual identity.
 */
export function buildKirchtalstrasseFittings(
  local: THREE.Group,
  materials: VvsStationMaterials,
  options: { lengthM: number; ceilingHeightM: number }
): void {
  const root = new THREE.Group();
  root.name = 'Kirchtalstraße station fittings';
  local.add(root);

  buildCentralStructure(root, materials, options.ceilingHeightM);
  buildBlueConcreteMurals(root, materials, options.lengthM);
  buildLinearLighting(root, materials, options.lengthM, options.ceilingHeightM);
  buildOverheadWirework(root, materials, options.lengthM, options.ceilingHeightM);
  buildStationPlaques(root, options.ceilingHeightM);
}

function buildCentralStructure(root: THREE.Group, materials: VvsStationMaterials, ceilingHeightM: number): void {
  const pier = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, ceilingHeightM - 0.1, 1.55),
    materials.painted('#909596')
  );
  pier.position.y = (ceilingHeightM - 0.1) / 2;
  pier.name = 'Kirchtalstraße central support pier';
  root.add(pier);

  const beam = new THREE.Mesh(new THREE.BoxGeometry(20.8, 0.28, 0.46), materials.steel);
  beam.position.set(0, ceilingHeightM - 0.48, 0);
  beam.name = 'Kirchtalstraße ceiling crossbeam';
  root.add(beam);

  for (const z of [-0.55, 0.55]) {
    const brace = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.14, 0.14), materials.steel);
    brace.position.set(0, ceilingHeightM - 0.72, z);
    brace.name = 'Kirchtalstraße steel ceiling brace';
    root.add(brace);
  }
}

function buildBlueConcreteMurals(root: THREE.Group, materials: VvsStationMaterials, lengthM: number): void {
  const blue = ['#1647ab', '#2866c5', '#4d88d2'];
  const muralRuns = Math.max(3, Math.floor((lengthM - 18) / 24));
  const firstZ = -((muralRuns - 1) * 24) / 2;

  for (const side of [-1, 1]) {
    for (let run = 0; run < muralRuns; run += 1) {
      const centerZ = firstZ + run * 24;
      for (const direction of [-1, 1]) {
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 4.3, 0.38),
          materials.painted(blue[(run + (direction === 1 ? 1 : 0)) % blue.length])
        );
        stripe.position.set(side * 11.7, 2.65, centerZ + direction * 2.1);
        stripe.rotation.x = side * direction * 0.56;
        stripe.name = 'Kirchtalstraße blue wall chevron';
        root.add(stripe);
      }

      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.72, 0.8),
        materials.painted(blue[(run + 2) % blue.length])
      );
      panel.position.set(side * 11.7, 4.42, centerZ + 8.5);
      panel.name = 'Kirchtalstraße blue wall panel';
      root.add(panel);
    }
  }
}

function buildLinearLighting(
  root: THREE.Group,
  materials: VvsStationMaterials,
  lengthM: number,
  ceilingHeightM: number
): void {
  for (const x of [-5.2, 5.2]) {
    const light = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.13, lengthM - 4),
      materials.lamp('#f7fbff')
    );
    light.position.set(x, ceilingHeightM - 0.18, 0);
    light.name = 'Kirchtalstraße linear ceiling light';
    root.add(light);
  }
}

function buildOverheadWirework(
  root: THREE.Group,
  materials: VvsStationMaterials,
  lengthM: number,
  ceilingHeightM: number
): void {
  const cable = materials.painted('#25282a');
  for (const x of [-4.15, -3.25, 3.25, 4.15]) {
    const run = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, lengthM - 6), cable);
    run.position.set(x, ceilingHeightM - 0.88, 0);
    run.name = 'Kirchtalstraße overhead wire';
    root.add(run);
  }
}

function buildStationPlaques(root: THREE.Group, ceilingHeightM: number): void {
  const texture = makeLabelTexture('Kirchtalstraße', {
    width: 1024,
    height: 160,
    bg: '#f1f2ef',
    fg: '#1d2022'
  });
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  const geometry = new THREE.PlaneGeometry(5.1, 0.82);
  for (const side of [-1, 1]) {
    const plaque = new THREE.Mesh(geometry, material);
    plaque.position.set(side * 11.5, Math.min(3.7, ceilingHeightM - 1.4), -18);
    plaque.rotation.y = (-side * Math.PI) / 2;
    plaque.name = 'Kirchtalstraße station plaque';
    root.add(plaque);
  }
}
