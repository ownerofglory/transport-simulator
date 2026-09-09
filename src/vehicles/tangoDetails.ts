import * as THREE from 'three';

type DetailPosition = readonly [number, number, number];

export function addTangoExteriorDetails(
  car: THREE.Group,
  passengerShells: THREE.Mesh[],
  metal: THREE.Material,
  dark: THREE.Material
): void {
  function batch(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, positions: DetailPosition[]): void {
    const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
    mesh.name = name;
    mesh.userData.liveOverviewOmit = true;
    const matrix = new THREE.Matrix4();
    positions.forEach(([x, y, z], index) => mesh.setMatrixAt(index, matrix.makeTranslation(x, y, z)));
    mesh.instanceMatrix.needsUpdate = true;
    car.add(mesh);
    passengerShells.push(mesh);
  }

  // Recess lines stop below the windows and avoid the sliding door openings.
  const seams: DetailPosition[] = [];
  const latches: DetailPosition[] = [];
  const grilles: DetailPosition[] = [];
  for (const side of [-1, 1]) {
    for (const z of [-8.25, -6.55, -4.5, -2.4, 0.4, 2.15, 4.25, 6.4, 8.25]) {
      seams.push([side * 1.353, 1.19, z]);
      latches.push([side * 1.36, 1.32, z + 0.1]);
    }
    for (const z of [-2.6, -1.4, -0.2, 5.3]) {
      for (let row = 0; row < 5; row++) grilles.push([side * 1.354, 0.67 + row * 0.045, z]);
    }
  }
  batch('SSB lower body panel joints', new THREE.BoxGeometry(0.008, 0.76, 0.009), dark, seams);
  batch('SSB service panel latches', new THREE.BoxGeometry(0.012, 0.025, 0.055), metal, latches);
  batch('SSB lower ventilation grilles', new THREE.BoxGeometry(0.012, 0.012, 0.76), dark, grilles);

  const fanPositions: DetailPosition[] = [];
  const fanGuards: DetailPosition[] = [];
  for (const z of [-5.1, 0, 5.1]) {
    for (const end of [-1, 1]) {
      fanPositions.push([0, 3.705, z + end * 0.91]);
      for (let bar = -2; bar <= 2; bar++) fanGuards.push([bar * 0.07, 3.727, z + end * 0.91]);
    }
  }
  batch('SSB recessed roof fans', new THREE.CylinderGeometry(0.19, 0.19, 0.025, 20), dark, fanPositions);
  batch('SSB roof fan guards', new THREE.BoxGeometry(0.015, 0.012, 0.31), metal, fanGuards);
}
