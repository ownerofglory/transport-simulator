import * as THREE from 'three';
import { makeLabelTexture } from '../../labels';
import type { ResolvedVehicleBuildContext, VehicleInstance } from '../types';
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
export function buildVehicleFromBlueprint(config: VehicleBlueprintConfig, context: ResolvedVehicleBuildContext): VehicleInstance {
  const root = new THREE.Group();
  root.name = `Vehicle blueprint ${config.id}`;
  const materials = buildBlueprintMaterials(config.materials);

  const cars: THREE.Group[] = [];
  const doors: VehicleInstance['doors'] = [];
  const windowBands: THREE.Mesh[] = [];
  const cabShells: THREE.Mesh[] = [];
  const passengerShells: THREE.Mesh[] = [];
  const cabDisplays: THREE.Mesh[] = [];
  const exteriorLampMaterials: { material: THREE.MeshStandardMaterial; nightIntensity: number }[] = [];

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
        exteriorLampMaterials.push(...buildCabLamps(group, section, config, materials));
      }

      cars.push(group);
      root.add(group);
    });
  }

  // PassengerCameraRig reads its anchor from the car's userData, so the config's
  // passenger anchor only takes effect once it is copied onto the car. The rig
  // picks trainCars[2] (falling back to the middle car), so an anchor aimed at
  // another section is ignored — configs must target the car the rig will pick.
  const passengerAnchor = config.cameraAnchors?.passenger;
  if (passengerAnchor) {
    const anchorCar = cars[passengerAnchor.section ?? 0];
    if (anchorCar) {
      anchorCar.userData.passengerCameraLocal = passengerAnchor.position;
      if (passengerAnchor.lookAt) anchorCar.userData.passengerLookAtLocal = passengerAnchor.lookAt;
    }
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
    root.add(buildBogie(bogie, materials));
  }

  for (const coupler of config.couplers ?? []) {
    const material = resolveMaterial(materials, coupler.material, 'metal');
    const endSection = coupler.end === 'front' ? config.sections.find((section) => section.cab === 'front') : config.sections.find((section) => section.cab === 'rear');
    if (!endSection) continue;
    const direction = coupler.end === 'front' ? -1 : 1;
    const shank = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.62), material);
    shank.name = `${coupler.end} coupler shank`;
    shank.position.set(0, 0.46, endSection.center + direction * (endSection.length / 2 + 0.28));
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.22, 8), material);
    head.name = `${coupler.end} coupler head`;
    head.rotation.x = Math.PI / 2;
    head.position.set(0, 0.46, endSection.center + direction * (endSection.length / 2 + 0.64));
    root.add(shank, head);
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
    trainHalfLengthM,
    setExteriorLightsOn(on: boolean) {
      for (const { material, nightIntensity } of exteriorLampMaterials) {
        material.emissiveIntensity = on ? nightIntensity : nightIntensity * 0.12;
      }
    }
  };
}

function buildBogie(
  bogie: NonNullable<VehicleBlueprintConfig['bogies']>[number],
  materials: Record<string, THREE.MeshStandardMaterial>
): THREE.Group {
  const group = new THREE.Group();
  group.name = `Detailed bogie ${bogie.z}`;
  const width = bogie.widthM ?? 2;
  const length = bogie.lengthM ?? 1.5;
  const frameMaterial = resolveMaterial(materials, bogie.material, 'dark');
  const wheelMaterial = resolveMaterial(materials, 'metal', bogie.material ?? 'dark');
  const frame = new THREE.Mesh(new THREE.BoxGeometry(width, 0.3, length), frameMaterial);
  frame.position.y = 0.46;
  group.add(frame);

  for (const axleZ of [-length * 0.31, length * 0.31]) {
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, width * 0.92, 8), wheelMaterial);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(0, 0.3, axleZ);
    group.add(axle);
    for (const side of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.115, 12), wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * width * 0.43, 0.3, axleZ);
      wheel.castShadow = true;
      group.add(wheel);
    }
  }
  for (const side of [-1, 1]) {
    const suspension = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.28, 8), frameMaterial);
    suspension.position.set(side * width * 0.27, 0.73, 0);
    group.add(suspension);
  }
  group.position.z = bogie.z;
  return group;
}

function buildCabLamps(
  group: THREE.Group,
  section: VehicleSectionConfig,
  config: VehicleBlueprintConfig,
  materials: Record<string, THREE.MeshStandardMaterial>
): { material: THREE.MeshStandardMaterial; nightIntensity: number }[] {
  if (!section.cab) return [];
  const direction = section.cab === 'front' ? -1 : 1;
  const width = section.widthM ?? config.dimensions.widthM;
  const height = section.heightM ?? config.dimensions.heightM;
  const material = new THREE.MeshStandardMaterial({
    color: section.cab === 'front' ? 0xfff5d6 : 0x9b1714,
    emissive: section.cab === 'front' ? 0xffe0a0 : 0x8c120f,
    emissiveIntensity: 0.18,
    roughness: 0.22,
    metalness: 0.08,
    envMapIntensity: 0.9
  });
  const lamps: { material: THREE.MeshStandardMaterial; nightIntensity: number }[] = [];
  for (const x of [-width * 0.27, width * 0.27]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), material);
    lamp.name = section.cab === 'front' ? 'Headlamp' : 'Tail lamp';
    lamp.position.set(x, height * 0.37, direction * (section.length / 2 + 0.17));
    group.add(lamp);
  }
  lamps.push({ material, nightIntensity: section.cab === 'front' ? 2.2 : 1.45 });
  return lamps;
}

function resolveDisplayText(text: string | undefined, context: ResolvedVehicleBuildContext): string {
  if (text === 'route-line') return context.route.line;
  if (!text || text === 'route-destination') return `${context.route.line} ${context.route.destination}`;
  return text;
}

function buildDestinationDisplayForCab(
  config: VehicleBlueprintConfig,
  sectionIndex: number,
  section: VehicleSectionConfig,
  materials: Record<string, THREE.MeshStandardMaterial>,
  context: ResolvedVehicleBuildContext
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
