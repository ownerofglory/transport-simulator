import * as THREE from 'three';
import { makeLabelTexture } from '../../labels';
import type { VehicleBuildContext, VehicleInstance } from '../types';
import type { VehicleBlueprintConfig, VehicleDoorConfig, VehicleSectionConfig } from './VehicleBlueprintConfig';
import { buildBlueprintMaterials, resolveMaterial } from './materials';
import { buildBlueprintSection } from './sections';
import { buildBlueprintDoors } from './doors';
import { buildBlueprintPantograph, buildBlueprintRoofEquipment } from './roof';
import { buildBlueprintInterior } from './interior';

// Builds a runtime VehicleInstance from a declarative VehicleBlueprintConfig.
// This is the generic counterpart to the hand-written procedural builders in
// ../procedural.ts: instead of a bespoke method per vehicle, any JSON config
// matching VehicleBlueprintConfig produces a working vehicle.
export function buildVehicleFromBlueprint(config: VehicleBlueprintConfig, context: VehicleBuildContext): VehicleInstance {
  const root = new THREE.Group();
  root.name = `Vehicle blueprint ${config.id}`;
  const materials = buildBlueprintMaterials(config.materials);

  const cars: THREE.Group[] = [];
  const doors: VehicleInstance['doors'] = [];
  const windowBands: THREE.Mesh[] = [];
  const cabShells: THREE.Mesh[] = [];
  const passengerShells: THREE.Mesh[] = [];
  const cabDisplays: THREE.Mesh[] = [];

  const doubleFormation = Boolean(
    config.formation?.doubleFormationLines?.includes(context.route.line) && config.formation?.duplicateSetOffsetM
  );
  const offsets = doubleFormation ? [-(config.formation!.duplicateSetOffsetM ?? 0) / 2, (config.formation!.duplicateSetOffsetM ?? 0) / 2] : [0];

  for (const offset of offsets) {
    buildFormation(offset);
  }

  function buildFormation(centerOffsetM: number): void {
    config.sections.forEach((section, sectionIndex) => {
      const shiftedSection: VehicleSectionConfig = { ...section, center: section.center + centerOffsetM };
      const { group, passengerShells: shellMeshes, cabShells: cabMeshes, windowBands: bandMeshes } = buildBlueprintSection(
        shiftedSection,
        sectionIndex,
        config,
        materials,
        config.windows ?? []
      );
      passengerShells.push(...shellMeshes);
      cabShells.push(...cabMeshes);
      windowBands.push(...bandMeshes);

      const sectionDoors = (config.doors ?? []).filter((door) => door.section === sectionIndex);
      for (const door of sectionDoors) {
        doors.push(...buildBlueprintDoors(group, shiftedSection, door, materials));
      }

      buildBlueprintInterior(group, shiftedSection, sectionIndex, sectionDoors, materials, config.interior);

      if (section.cab) {
        const display = buildDestinationDisplayForCab(config, sectionIndex, section, materials, context);
        if (display) {
          group.add(display);
          cabDisplays.push(display);
        }
      }

      cars.push(group);
      root.add(group);
    });
  }

  for (const explicitDisplay of config.destinationDisplays ?? []) {
    const section = config.sections[explicitDisplay.section];
    if (!section) continue;
    const text = resolveDisplayText(explicitDisplay.text, context);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(explicitDisplay.widthM ?? 1.5, explicitDisplay.heightM ?? 0.32),
      new THREE.MeshBasicMaterial({
        map: makeLabelTexture(text, { width: 700, height: 128, bg: explicitDisplay.background ?? '#101216', fg: explicitDisplay.foreground ?? '#ffb300' }),
        side: THREE.DoubleSide
      })
    );
    mesh.position.set(...explicitDisplay.position);
    if (explicitDisplay.rotationY) mesh.rotation.y = explicitDisplay.rotationY;
    cars[explicitDisplay.section]?.add(mesh);
    cabDisplays.push(mesh);
  }

  for (const gangway of config.gangways ?? []) {
    const material = resolveMaterial(materials, gangway.material, 'dark');
    const bellows = new THREE.Mesh(
      new THREE.BoxGeometry(gangway.widthM ?? config.dimensions.widthM * 0.9, gangway.heightM ?? config.dimensions.heightM * 0.7, gangway.lengthM ?? 0.7),
      material
    );
    bellows.position.set(0, (gangway.heightM ?? config.dimensions.heightM * 0.7) / 2, gangway.z);
    root.add(bellows);
    passengerShells.push(bellows);
  }

  for (const bogie of config.bogies ?? []) {
    const material = resolveMaterial(materials, bogie.material, 'dark');
    const bogieMesh = new THREE.Mesh(new THREE.BoxGeometry(bogie.widthM ?? 2.0, 0.36, bogie.lengthM ?? 1.5), material);
    bogieMesh.position.set(0, 0.42, bogie.z);
    root.add(bogieMesh);
  }

  for (const pantograph of config.pantographs ?? []) {
    buildBlueprintPantograph(root, pantograph, materials);
  }

  for (const equipment of config.roofEquipment ?? []) {
    buildBlueprintRoofEquipment(root, equipment, materials);
  }

  const trainHalfLengthM = config.sections.reduce((max, section) => {
    const extents = offsets.map((offset) => Math.abs(section.center + offset) + section.length / 2);
    return Math.max(max, ...extents);
  }, 0);

  return {
    root,
    cars,
    doors,
    windowBands,
    cabShells,
    passengerShells,
    cabDisplays,
    glassMaterial: materials.glass,
    trainHalfLengthM
  };
}

function resolveDisplayText(text: string | undefined, context: VehicleBuildContext): string {
  if (text === 'route-line') return context.route.line;
  if (!text || text === 'route-destination') return `${context.route.line} ${context.route.destination}`;
  return text;
}

function buildDestinationDisplayForCab(
  config: VehicleBlueprintConfig,
  sectionIndex: number,
  section: VehicleSectionConfig,
  materials: Record<string, THREE.MeshStandardMaterial>,
  context: VehicleBuildContext
): THREE.Mesh | null {
  // Skip if an explicit destinationDisplays entry already targets this section.
  if (config.destinationDisplays?.some((display) => display.section === sectionIndex)) return null;
  const cabDirection = section.cab === 'front' ? -1 : 1;
  const text = `${context.route.line} ${context.route.destination}`;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.32),
    new THREE.MeshBasicMaterial({
      map: makeLabelTexture(text, { width: 700, height: 128, bg: '#101216', fg: '#ffb300' }),
      side: THREE.DoubleSide
    })
  );
  const heightM = section.heightM ?? config.dimensions.heightM;
  mesh.position.set(0, heightM * 0.86, cabDirection * (section.length / 2 + 0.06));
  if (cabDirection < 0) mesh.rotation.y = Math.PI;
  return mesh;
}
