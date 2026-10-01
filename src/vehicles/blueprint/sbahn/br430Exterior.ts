import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { makeLabelTexture } from '../../../labels';
import type { SBahnBlueprintConfig } from './SBahnBlueprintConfig';

type Position = readonly [number, number, number];

export function addBR430ExteriorDetails(
  car: THREE.Group,
  config: SBahnBlueprintConfig,
  cabEnd: -1 | 0 | 1,
  passengerShells: THREE.Mesh[],
  cabShells: THREE.Mesh[],
  materials: {
    dark: THREE.Material;
    metal: THREE.Material;
    accent: THREE.Material;
    destination: THREE.Material;
    brand: THREE.Material;
    accessible: THREE.Material;
    firstClass: THREE.Material;
    sideLogo: THREE.Material;
  }
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
    const accessiblePanel = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.72), materials.accessible);
    accessiblePanel.name = 'BR430 blue multipurpose area';
    accessiblePanel.position.set(side * 1.604, 1.42, 0);
    accessiblePanel.rotation.y = side * Math.PI / 2;
    car.add(accessiblePanel);
    passengerShells.push(accessiblePanel);
    const brand = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.24), materials.brand);
    brand.name = 'BR430 S-Bahn Stuttgart branding';
    brand.position.set(side * 1.604, 1.05, -5.4);
    brand.rotation.y = side * Math.PI / 2;
    car.add(brand);
    passengerShells.push(brand);
    if (cabEnd) {
      const firstClass = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.75), materials.firstClass);
      firstClass.name = 'BR430 yellow first-class panel';
      firstClass.position.set(side * 1.605, 1.43, cabEnd * 5.42);
      firstClass.rotation.y = side * Math.PI / 2;
      car.add(firstClass);
      passengerShells.push(firstClass);
      const sideLogo = new THREE.Mesh(new THREE.CircleGeometry(0.28, 28), materials.sideLogo);
      sideLogo.name = 'BR430 green S-Bahn emblem';
      sideLogo.position.set(side * 1.608, 2.04, cabEnd * 6.52);
      sideLogo.rotation.y = side * Math.PI / 2;
      car.add(sideLogo);
      passengerShells.push(sideLogo);
    }
  }
  batch('service panel joints', new THREE.BoxGeometry(0.009, 0.65, 0.009), dark, seams);
  batch('underfloor cooling louvres', new THREE.BoxGeometry(0.012, 0.018, 1.4), dark, vents);
  batch('aluminium door thresholds', new THREE.BoxGeometry(0.18, 0.045, 1.65), metal, sills);
  batch('door request button bezels', new THREE.SphereGeometry(0.055, 8, 6), metal, doorIndicators);

  if (cabEnd) {
    const stripePositions: Position[] = [];
    for (const side of [-1, 1]) {
      for (const y of [0.54, 0.64, 0.74]) stripePositions.push([side * 1.598, y, cabEnd * 6.65]);
    }
    batch('lower blue side stripes', new THREE.BoxGeometry(0.025, 0.055, 3.15), materials.accent, stripePositions);
  }

  if (!cabEnd) return;
  const roofFairing = new THREE.Mesh(new RoundedBoxGeometry(1.88, 0.24, 2.15, 4, 0.08), dark);
  roofFairing.name = 'BR430 stepped cab roof fairing';
  roofFairing.position.set(0, 3.91, cabEnd * 6.55);
  roofFairing.rotation.y = cabEnd < 0 ? Math.PI : 0;
  car.add(roofFairing);
  cabShells.push(roofFairing);
  const roofCowl = new THREE.Mesh(new RoundedBoxGeometry(1.32, 0.2, 1.15, 4, 0.07), metal);
  roofCowl.name = 'BR430 cab roof equipment cowl';
  roofCowl.position.set(0, 4.12, cabEnd * 6.7);
  car.add(roofCowl);
  cabShells.push(roofCowl);

  const front = new THREE.Group();
  front.name = 'BR430 cab finishing';
  front.position.z = cabEnd * 8.83;
  if (cabEnd < 0) front.rotation.y = Math.PI;
  car.add(front);
  const wiper = new THREE.Group();
  wiper.position.set(0, 2.49, 0.115);
  wiper.rotation.x = -0.197;
  front.add(wiper);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.027, 0.65, 0.026), dark);
  arm.name = 'BR430 windscreen wiper arm';
  arm.position.set(-0.23, -0.05, 0.02);
  arm.rotation.z = -0.42;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.74, 0.03), dark);
  blade.position.set(-0.39, 0.1, 0.03);
  blade.rotation.z = -0.08;
  wiper.add(arm, blade);
  cabShells.push(arm, blade);
  const recess = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.35, 0.1), dark);
  recess.position.set(0, 0.72, 0.34);
  const coupler = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.18, 0.22), metal);
  coupler.name = 'BR430 automatic coupler';
  coupler.position.set(0, 0.71, 0.52);
  front.add(recess, coupler);
  cabShells.push(recess, coupler);
  for (const y of [0.52, 0.62, 0.72]) {
    for (const [startX, endX] of [[-1.2, -0.18], [0.18, 1.2]] as const) {
      const stripe = new THREE.Mesh(makeCurvedFrontStripeGeometry(startX, endX), materials.accent);
      stripe.name = 'BR430 lower blue front stripe';
      stripe.position.y = y;
      front.add(stripe);
      cabShells.push(stripe);
    }
  }
}

function makeCurvedFrontStripeGeometry(startX: number, endX: number): THREE.BufferGeometry {
  const segments = 8;
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let segment = 0; segment <= segments; segment++) {
    const x = THREE.MathUtils.lerp(startX, endX, segment / segments);
    const widthRatio = Math.min(1, Math.abs(x) / 1.3);
    const z = 0.09 + 0.24 * (1 - widthRatio * widthRatio);
    vertices.push(x, -0.0275, z, x, 0.0275, z);
  }
  for (let segment = 0; segment < segments; segment++) {
    const a = segment * 2;
    indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function makeBR430ExteriorLabels(line: string, destination: string): {
  destination: THREE.MeshBasicMaterial;
  brand: THREE.MeshBasicMaterial;
  accessible: THREE.MeshBasicMaterial;
  firstClass: THREE.MeshBasicMaterial;
  sideLogo: THREE.MeshBasicMaterial;
} {
  return {
    destination: new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${line} ${destination}`, { width: 512, height: 96, bg: '#101518', fg: '#f5e4b0' }),
      toneMapped: false
    }),
    brand: new THREE.MeshBasicMaterial({
      map: makeLabelTexture('S-Bahn Stuttgart', { width: 512, height: 96, bg: '#dfe2e0', fg: '#343c40' })
    }),
    accessible: new THREE.MeshBasicMaterial({
      map: makeLabelTexture('♿', { width: 320, height: 160, bg: '#159bd3', fg: '#eaf7fc' })
    }),
    firstClass: new THREE.MeshBasicMaterial({
      map: makeLabelTexture('1', { width: 320, height: 160, bg: '#e8b900', fg: '#fff8dc' })
    }),
    sideLogo: new THREE.MeshBasicMaterial({
      map: makeLabelTexture('S', { width: 192, height: 192, bg: '#438b43', fg: '#ffffff' })
    })
  };
}
