import * as THREE from 'three';
import { makeLabelTexture } from '../../../labels';
import type { SBahnBlueprintConfig } from './SBahnBlueprintConfig';

type Position = readonly [number, number, number];

export function addBR430ExteriorDetails(
  car: THREE.Group,
  config: SBahnBlueprintConfig,
  cabEnd: -1 | 0 | 1,
  passengerShells: THREE.Mesh[],
  cabShells: THREE.Mesh[],
  materials: { dark: THREE.Material; metal: THREE.Material; destination: THREE.Material; brand: THREE.Material }
): void {
  const { dark, metal } = materials;
  const matrix = new THREE.Matrix4();
  function batch(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, positions: Position[], rotation = new THREE.Quaternion()): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
    mesh.name = `BR430 ${name}`;
    mesh.userData.liveOverviewOmit = true;
    for (const [index, position] of positions.entries()) {
      matrix.compose(new THREE.Vector3(...position), rotation, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    car.add(mesh);
    passengerShells.push(mesh);
    return mesh;
  }

  const tyres: Position[] = [];
  const hubs: Position[] = [];
  const axleBoxes: Position[] = [];
  for (const bogieZ of config.layout.bogieZs) {
    for (const side of [-1, 1]) {
      for (const offset of [-0.58, 0.58]) {
        tyres.push([side * 1.18, 0.4, bogieZ + offset]);
        hubs.push([side * 1.295, 0.4, bogieZ + offset]);
        axleBoxes.push([side * 1.37, 0.4, bogieZ + offset]);
      }
    }
  }
  const wheelRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  batch('steel wheel treads', new THREE.CylinderGeometry(0.39, 0.39, 0.2, 24), metal, tyres, wheelRotation);
  batch('recessed wheel faces', new THREE.CylinderGeometry(0.27, 0.27, 0.025, 20), dark, hubs, wheelRotation);
  batch('axle bearing housings', new THREE.BoxGeometry(0.13, 0.18, 0.22), metal, axleBoxes);

  const seams: Position[] = [];
  const vents: Position[] = [];
  const sills: Position[] = [];
  const doorIndicators: Position[] = [];
  for (const side of [-1, 1]) {
    for (const z of [-6.6, -4.3, -1.9, 1.9, 4.3, 6.6]) seams.push([side * 1.542, 1.18, z]);
    for (let row = 0; row < 6; row++) vents.push([side * 1.546, 0.93 + row * 0.06, 0]);
    for (const z of config.layout.doorZs) {
      sills.push([side * 1.6, 0.77, z]);
      doorIndicators.push([side * 1.625, 1.68, z + 0.92]);
    }
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.48, 0.24), materials.destination);
    board.name = 'BR430 side destination display';
    board.position.set(side * 1.602, 2.6, 0);
    board.rotation.y = side * Math.PI / 2;
    car.add(board);
    passengerShells.push(board);
    const brand = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.3), materials.brand);
    brand.name = 'BR430 side DB badge';
    brand.position.set(side * 1.546, 1.35, -5.4);
    brand.rotation.y = side * Math.PI / 2;
    car.add(brand);
    passengerShells.push(brand);
  }
  batch('service panel joints', new THREE.BoxGeometry(0.009, 0.65, 0.009), dark, seams);
  batch('underfloor cooling louvres', new THREE.BoxGeometry(0.012, 0.018, 1.4), dark, vents);
  batch('aluminium door thresholds', new THREE.BoxGeometry(0.18, 0.045, 1.65), metal, sills);
  batch('door request button bezels', new THREE.SphereGeometry(0.055, 8, 6), metal, doorIndicators);

  if (!cabEnd) return;
  const front = new THREE.Group();
  front.name = 'BR430 cab finishing';
  front.position.z = cabEnd * 8.83;
  if (cabEnd < 0) front.rotation.y = Math.PI;
  car.add(front);
  const wiper = new THREE.Group();
  wiper.position.set(0, 2.49, 0.035);
  wiper.rotation.x = -0.197;
  front.add(wiper);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.027, 0.65, 0.026), dark);
  arm.name = 'BR430 windscreen wiper arm';
  arm.position.set(-0.23, -0.05, 0.04);
  arm.rotation.z = -0.42;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.74, 0.03), dark);
  blade.position.set(-0.39, 0.1, 0.055);
  blade.rotation.z = -0.08;
  wiper.add(arm, blade);
  cabShells.push(arm, blade);
  const recess = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.35, 0.1), dark);
  recess.position.set(0, 0.72, 0);
  const coupler = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.18, 0.22), metal);
  coupler.name = 'BR430 automatic coupler';
  coupler.position.set(0, 0.71, 0.09);
  front.add(recess, coupler);
  cabShells.push(recess, coupler);
}

export function makeBR430ExteriorLabels(line: string, destination: string): { destination: THREE.Material; brand: THREE.Material } {
  return {
    destination: new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${line} ${destination}`, { width: 512, height: 96, bg: '#101518', fg: '#f5e4b0' }),
      toneMapped: false
    }),
    brand: new THREE.MeshBasicMaterial({
      map: makeLabelTexture('DB', { width: 192, height: 96, bg: '#d71920', fg: '#ffffff' })
    })
  };
}
