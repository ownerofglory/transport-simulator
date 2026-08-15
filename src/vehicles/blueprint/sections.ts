import * as THREE from 'three';
import type { VehicleBlueprintConfig, VehicleSectionConfig, VehicleWindowConfig } from './VehicleBlueprintConfig';
import { resolveMaterial } from './materials';

export type SectionBuildResult = {
  group: THREE.Group;
  passengerShells: THREE.Mesh[];
  cabShells: THREE.Mesh[];
  windowBands: THREE.Mesh[];
};

// Builds one articulated-car section: skirt, body shell, roof cap, side window
// band with strip windows, and an optional chamfered cab face. All geometry is
// local to the section's own center (z=0 at the section midpoint), since the
// runtime overwrites each car's world position every frame using centerOffsetM.
export function buildBlueprintSection(
  section: VehicleSectionConfig,
  sectionIndex: number,
  config: VehicleBlueprintConfig,
  materials: Record<string, THREE.MeshStandardMaterial>,
  windows: VehicleWindowConfig[]
): SectionBuildResult {
  const group = new THREE.Group();
  group.name = `Articulated car ${config.displayName} section ${sectionIndex}`;
  group.userData.centerOffsetM = section.center;

  const passengerShells: THREE.Mesh[] = [];
  const cabShells: THREE.Mesh[] = [];
  const windowBands: THREE.Mesh[] = [];

  const widthM = section.widthM ?? config.dimensions.widthM;
  const heightM = section.heightM ?? config.dimensions.heightM;
  const floorHeightM = config.dimensions.floorHeightM ?? heightM * 0.28;
  const bodyMaterial = resolveMaterial(materials, section.bodyMaterial, 'body');
  const accentMaterial = resolveMaterial(materials, section.accentMaterial, 'accent');
  const glassMaterial = resolveMaterial(materials, section.glassMaterial, 'glass');
  const darkMaterial = resolveMaterial(materials, section.darkMaterial, 'dark');
  const roofMaterial = resolveMaterial(materials, section.roofMaterial, 'roof');

  const bodyHeight = heightM - floorHeightM * 0.35;
  const bodyCenterY = floorHeightM * 0.35 + bodyHeight / 2;

  const skirt = new THREE.Mesh(new THREE.BoxGeometry(widthM * 0.98, floorHeightM * 0.5, section.length - 0.1), accentMaterial);
  skirt.position.y = floorHeightM * 0.25;
  group.add(skirt);
  passengerShells.push(skirt);

  const body = new THREE.Mesh(new THREE.BoxGeometry(widthM * 0.94, bodyHeight, section.length), bodyMaterial);
  body.position.y = bodyCenterY;
  body.castShadow = true;
  group.add(body);
  passengerShells.push(body);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(widthM * 0.84, heightM * 0.06, section.length - 0.1), roofMaterial);
  roof.position.y = bodyCenterY + bodyHeight / 2 + heightM * 0.03;
  group.add(roof);
  passengerShells.push(roof);

  const windowCenterY = bodyCenterY + bodyHeight * 0.14;
  const windowHeight = bodyHeight * 0.42;
  const sectionWindows = windows.filter((window) => window.section === sectionIndex);
  for (const side of [-1, 1] as const) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, windowHeight + 0.14, section.length - 0.2), darkMaterial);
    band.position.set(side * widthM * 0.5, windowCenterY, 0);
    group.add(band);
    windowBands.push(band);

    const sideLabel = side < 0 ? 'left' : 'right';
    const sideWindows = sectionWindows.filter((window) => window.side === sideLabel || window.side === 'both');
    const placedWindows: { z: number; widthM?: number; heightM?: number; material?: string }[] =
      sideWindows.length > 0 ? sideWindows : autoPlaceWindows(section);
    for (const window of placedWindows) {
      const windowMaterial = window.material ? resolveMaterial(materials, window.material, 'glass') : glassMaterial;
      const pane = new THREE.Mesh(
        new THREE.BoxGeometry(0.085, window.heightM ?? windowHeight, window.widthM ?? section.length * 0.16),
        windowMaterial
      );
      pane.position.set(side * widthM * 0.505, windowCenterY, window.z);
      group.add(pane);
    }
  }

  if (section.cab === 'front' || section.cab === 'rear') {
    const cabDirection = section.cab === 'front' ? -1 : 1;
    const cabZ = cabDirection * (section.length / 2);
    if (section.noseStyle !== 'none') {
      const nose = makeCabNose(widthM, bodyHeight, resolveMaterial(materials, section.noseMaterial, section.bodyMaterial ?? 'body'));
      nose.position.set(0, bodyCenterY, cabZ);
      if (cabDirection > 0) nose.rotation.y = Math.PI;
      group.add(nose);
      cabShells.push(nose);
    }

    const face = new THREE.Mesh(new THREE.BoxGeometry(widthM * 0.9, bodyHeight * 0.78, 0.1), darkMaterial);
    face.position.set(0, bodyCenterY + bodyHeight * 0.1, cabZ + cabDirection * 0.14);
    group.add(face);
    cabShells.push(face);

    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(widthM * 0.76, bodyHeight * 0.32, 0.07), glassMaterial);
    windscreen.position.set(0, bodyCenterY + bodyHeight * 0.24, cabZ + cabDirection * 0.19);
    group.add(windscreen);
  }

  return { group, passengerShells, cabShells, windowBands };
}

function autoPlaceWindows(section: VehicleSectionConfig): { z: number; widthM?: number; heightM?: number; material?: string }[] {
  const usableLength = section.length - 1.2;
  if (usableLength <= 0) return [];
  const count = Math.max(1, Math.round(usableLength / 1.6));
  const step = usableLength / count;
  const start = -usableLength / 2 + step / 2;
  return Array.from({ length: count }, (_, index) => ({
    z: start + index * step,
    widthM: step * 0.62
  }));
}

function makeCabNose(widthM: number, heightM: number, material: THREE.Material): THREE.Mesh {
  const halfWidth = widthM * 0.47;
  const halfHeight = heightM * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth, -halfHeight);
  shape.lineTo(halfWidth, -halfHeight);
  shape.lineTo(halfWidth * 0.88, halfHeight * 0.82);
  shape.lineTo(halfWidth * 0.52, halfHeight);
  shape.lineTo(-halfWidth * 0.52, halfHeight);
  shape.lineTo(-halfWidth * 0.88, halfHeight * 0.82);
  shape.lineTo(-halfWidth, -halfHeight);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: widthM * 0.4, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 });
  geometry.center();
  geometry.rotateX(Math.PI / 2);
  return new THREE.Mesh(geometry, material);
}
