import * as THREE from 'three';
import type { VehicleDoorConfig, VehicleSectionConfig } from './VehicleBlueprintConfig';
import type { VehicleDoorLeaf } from '../types';
import { resolveMaterial } from './materials';

// Builds one two-leaf sliding door on the given side, mirroring the layout used
// by the procedural builders (opening panel + two leaves that slide apart).
export function buildBlueprintDoors(
  group: THREE.Group,
  section: VehicleSectionConfig,
  door: VehicleDoorConfig,
  materials: Record<string, THREE.MeshStandardMaterial>
): VehicleDoorLeaf[] {
  const widthM = section.widthM ?? 2.4;
  const heightM = section.heightM ?? 3.2;
  const floorHeightM = heightM * 0.28;
  const bodyHeight = heightM - floorHeightM * 0.35;
  const bodyCenterY = floorHeightM * 0.35 + bodyHeight / 2;
  const doorWidth = door.widthM ?? 1.3;
  const doorHeight = door.heightM ?? bodyHeight * 0.85;
  const doorMaterial = resolveMaterial(materials, door.material, 'accent');
  const glassMaterial = resolveMaterial(materials, door.glassMaterial, 'glass');
  const darkMaterial = resolveMaterial(materials, door.darkMaterial, 'dark');

  const sides: (-1 | 1)[] = door.side === 'both' ? [-1, 1] : door.side === 'left' ? [-1] : [1];
  const leaves: VehicleDoorLeaf[] = [];

  for (const side of sides) {
    const x = side * (widthM ?? 2.4) * 0.5;
    const opening = new THREE.Mesh(new THREE.PlaneGeometry(doorWidth, doorHeight), darkMaterial);
    opening.position.set(x + side * 0.03, bodyCenterY, door.z);
    opening.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(opening);

    for (const direction of [-1, 1] as const) {
      const closedZ = door.z + direction * doorWidth * 0.24;
      const leaf = new THREE.Group();
      leaf.name = `Sliding door leaf ${section.center}/${side}/${door.z}/${direction}`;
      leaf.position.z = closedZ;
      for (const edge of [-1, 1] as const) {
        const stile = new THREE.Mesh(new THREE.BoxGeometry(0.1, doorHeight - 0.06, doorWidth * 0.08), doorMaterial);
        stile.position.set(x + side * 0.02, bodyCenterY, edge * doorWidth * 0.2);
        leaf.add(stile);
      }
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.06, doorHeight * 0.78, doorWidth * 0.36), glassMaterial);
      pane.position.set(x + side * 0.012, bodyCenterY + doorHeight * 0.06, 0);
      leaf.add(pane);
      group.add(leaf);
      leaves.push({ group: leaf, closedZ, direction });
    }
  }
  return leaves;
}
