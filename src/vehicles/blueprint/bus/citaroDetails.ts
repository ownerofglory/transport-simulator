import * as THREE from 'three';
import type { BusSectionConfig } from './BusBlueprintConfig';

type Position = [number, number, number];

export function addCitaroDetails(
  car: THREE.Group,
  section: BusSectionConfig,
  shells: THREE.Mesh[],
  m: { metal: THREE.Material; black: THREE.Material; hub: THREE.Material; indicator: THREE.Material }
): void {
  function batch(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, positions: Position[], rotation = new THREE.Quaternion()): void {
    const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
    mesh.name = `Citaro ${name}`;
    mesh.userData.liveOverviewOmit = true;
    const matrix = new THREE.Matrix4();
    positions.forEach((position, index) => {
      matrix.compose(new THREE.Vector3(...position), rotation, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    car.add(mesh);
    shells.push(mesh);
  }
  const rims: Position[] = [];
  const holes: Position[] = [];
  const nuts: Position[] = [];
  for (const z of section.axleZs) {
    for (const side of [-1, 1]) {
      rims.push([side * 1.375, 0.5, z]);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        holes.push([side * 1.39, 0.5 + Math.sin(angle) * 0.225, z + Math.cos(angle) * 0.225]);
        nuts.push([side * 1.405, 0.5 + Math.sin(angle) * 0.13, z + Math.cos(angle) * 0.13]);
      }
    }
  }
  const axleRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  batch('pressed steel rims', new THREE.CylinderGeometry(0.29, 0.29, 0.024, 24), m.hub, rims, axleRotation);
  batch('rim ventilation holes', new THREE.CylinderGeometry(0.033, 0.033, 0.012, 10), m.black, holes, axleRotation);
  batch('wheel lug nuts', new THREE.CylinderGeometry(0.022, 0.022, 0.022, 6), m.metal, nuts, axleRotation);

  const markers: Position[] = [];
  const seams: Position[] = [];
  const half = section.lengthM / 2;
  for (const side of [-1, 1]) {
    for (let z = -half + 0.6; z < half - 0.6; z += 1.55) {
      if (section.axleZs.some((axle) => Math.abs(axle - z) < 0.65)) continue;
      if (side < 0 && section.doorZs.some((door) => Math.abs(door - z) < 0.9)) continue;
      seams.push([side * 1.282, 1.38, z]);
    }
    for (const z of [-half + 0.32, 0, half - 0.32]) markers.push([side * 1.305, 0.87, z]);
  }
  batch('lower body service seams', new THREE.BoxGeometry(0.01, 0.62, 0.008), m.black, seams);
  batch('amber side reflectors', new THREE.BoxGeometry(0.026, 0.055, 0.12), m.indicator, markers);
  batch('door step edging', new THREE.BoxGeometry(0.16, 0.022, 1.48), m.metal,
    section.doorZs.map((z): Position => [-1.32, 1.073, z]));
  if (section.rear === 'tail') {
    const slats: Position[] = [];
    for (let row = 0; row < 9; row++) slats.push([0, 0.9 + row * 0.075, -half - 0.09]);
    batch('rear engine ventilation slats', new THREE.BoxGeometry(1.72, 0.026, 0.025), m.metal, slats);
  }
}
