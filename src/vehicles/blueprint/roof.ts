import * as THREE from 'three';
import type { VehiclePantographConfig, VehicleRoofEquipmentConfig } from './VehicleBlueprintConfig';
import { resolveMaterial } from './materials';

export function buildBlueprintPantograph(
  root: THREE.Group,
  config: VehiclePantographConfig,
  materials: Record<string, THREE.MeshStandardMaterial>
): void {
  const material = resolveMaterial(materials, config.material, 'metal');
  const position = new THREE.Vector3(config.x, config.y, config.z);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.6), material);
  base.position.copy(position);
  root.add(base);

  const arms: [THREE.Vector3, THREE.Vector3][] = [
    [new THREE.Vector3(-0.45, 0, -0.16), new THREE.Vector3(0, 0.65, 0)],
    [new THREE.Vector3(0.45, 0, -0.16), new THREE.Vector3(0, 0.65, 0)],
    [new THREE.Vector3(-0.45, 0, 0.16), new THREE.Vector3(0, 0.65, 0)],
    [new THREE.Vector3(0.45, 0, 0.16), new THREE.Vector3(0, 0.65, 0)]
  ];
  for (const [a, b] of arms) {
    const curve = new THREE.LineCurve3(a.clone().add(position), b.clone().add(position));
    root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 1, 0.02, 6), material));
  }
  const shoe = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.045, 0.14), material);
  shoe.position.copy(position).add(new THREE.Vector3(0, 0.7, 0));
  root.add(shoe);
}

export function buildBlueprintRoofEquipment(
  root: THREE.Group,
  config: VehicleRoofEquipmentConfig,
  materials: Record<string, THREE.MeshStandardMaterial>
): void {
  const material = resolveMaterial(materials, config.material, 'roof');
  const box = new THREE.Mesh(new THREE.BoxGeometry(config.widthM, config.heightM, config.lengthM), material);
  box.position.set(config.x, config.y, config.z);
  root.add(box);
  if (config.type === 'hvac') {
    const slatCount = Math.max(1, Math.round(config.lengthM / 0.28));
    for (let index = 0; index < slatCount; index++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(config.widthM * 0.82, 0.02, 0.06), material);
      slat.position.set(config.x, config.y + config.heightM / 2 + 0.02, config.z - config.lengthM / 2 + index * 0.28 + 0.14);
      root.add(slat);
    }
  }
}
