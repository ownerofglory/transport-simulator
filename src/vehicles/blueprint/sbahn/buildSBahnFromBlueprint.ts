import * as THREE from 'three';
import { makeLabelTexture } from '../../../labels';
import type { VehicleBuildContext, VehicleInstance } from '../../types';
import {
  addCabinLight,
  addExteriorLightThrow,
  addOpaqueTransitInterior,
  addPantograph,
  addSlidingVehicleDoor,
  makeExteriorLightRig,
  makeSetExteriorLightsOn,
  type ExteriorLightRig
} from '../../parts';
import { makeStandardMaterial } from '../standardMaterial';
import type { SBahnBlueprintConfig, SBahnMaterialRole } from './SBahnBlueprintConfig';

// DB BR 430-family S-Bahn renderer, driven by an SBahnBlueprintConfig.
// The config decides livery, formation, layout, logo and display colors; the
// constants below are fixed BR 430 styling (body cross-section, nose profile,
// cab detailing, ...). Geometry is an unchanged extraction of the former
// procedural S-Bahn builder — keep it visually byte-identical unless the task
// is about changing S-Bahn visuals.

type SBahnMaterials = Record<SBahnMaterialRole, THREE.MeshStandardMaterial>;

export function buildSBahnVehicle(config: SBahnBlueprintConfig, context: VehicleBuildContext): VehicleInstance {
  const root = new THREE.Group();
  const cars: THREE.Group[] = [];
  const doors: VehicleInstance['doors'] = [];
  const windowBands: THREE.Mesh[] = [];
  const cabShells: THREE.Mesh[] = [];
  const passengerShells: THREE.Mesh[] = [];
  const cabDisplays: THREE.Mesh[] = [];
  const rig: ExteriorLightRig = makeExteriorLightRig();

  const m = makeSBahnMaterials(config.materials);
  const displayMaterial = context.makeInteriorDisplayMaterial();
  rig.headLampMaterials.push(m.headlight);
  rig.tailLampMaterials.push(m.tailLamp);

  const { carCenters } = config.formation;
  const { doorZs, windowZs, seatRowZs, seatXs, poleZs, bogieZs } = config.layout;

  carCenters.forEach((center, index) => {
    const car = new THREE.Group();
    car.name = `${config.formation.sectionNamePrefix} ${index + 1}`;
    car.userData.centerOffsetM = center;
    const body = new THREE.Mesh(makeSBahn430Body(16.15), m.shell);
    body.castShadow = true;
    car.add(body);
    passengerShells.push(body);

    // The BR 430 roof rolls inward above the window band; a low central HVAC
    // pod leaves the curved shoulders visible instead of reading as a box.
    const roofPod = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.18, 4.8), m.metal);
    roofPod.position.set(0, 3.77, index % 2 === 0 ? 0.65 : -0.65);
    roofPod.castShadow = true;
    car.add(roofPod);
    passengerShells.push(roofPod);
    for (let slat = -7; slat <= 7; slat++) {
      const grille = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.025, 0.055), m.dark);
      grille.position.set(0, 3.875, roofPod.position.z + slat * 0.28);
      car.add(grille);
    }
    const lowerRed = new THREE.Mesh(new THREE.BoxGeometry(3.08, 0.28, 16.22), m.accent);
    lowerRed.position.y = 0.62;
    car.add(lowerRed);
    passengerShells.push(lowerRed);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(3.09, 0.18, 16.23), m.accent);
    belt.position.y = 1.72;
    car.add(belt);
    passengerShells.push(belt);
    for (const side of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.08, 14.5), m.dark);
      band.position.set(side * 1.535, 2.43, 0);
      car.add(band);
      windowBands.push(band);
      for (const z of windowZs) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.88, 1.08), m.glass);
        window.position.set(side * 1.55, 2.43, z);
        car.add(window);
      }
      for (const z of doorZs) {
        addSlidingVehicleDoor(doors, car, side * 1.55, z, m.accent, m.glass, m.dark, 1.72, 2.05);
      }
    }
    if (index === 0 || index === carCenters.length - 1) {
      // BR 430 front: flat, slightly raked red nose with a wide black
      // windscreen band, vertical LED light bars and a top destination display.
      const cabEnd = (index === 0 ? -1 : 1) as -1 | 1;
      const faceTilt = -cabEnd * 0.197;
      const nose = new THREE.Mesh(makeSBahn430Nose(), m.accent);
      nose.position.z = cabEnd * 8.0;
      if (cabEnd < 0) nose.rotation.y = Math.PI;
      nose.castShadow = true;
      car.add(nose);
      cabShells.push(nose);

      const mask = new THREE.Mesh(makeSBahn430Mask(), m.dark);
      mask.position.set(0, 2.58, cabEnd * 8.76);
      mask.rotation.x = faceTilt;
      car.add(mask);
      cabShells.push(mask);

      const windscreen = new THREE.Mesh(makeSBahn430Windscreen(), m.glass);
      windscreen.position.set(0, 2.5, cabEnd * 8.82);
      windscreen.rotation.x = faceTilt;
      car.add(windscreen);

      for (const side of [-1, 1] as const) {
        const housing = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.78, 0.07), m.dark);
        housing.position.set(side * 1.12, 1.32, cabEnd * 8.88);
        car.add(housing);
        cabShells.push(housing);
        const headBar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.055), m.headlight);
        headBar.position.set(side * 1.12, 1.18, cabEnd * 8.92);
        car.add(headBar);
        const tailDot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.055), m.tailLamp);
        tailDot.position.set(side * 1.12, 1.56, cabEnd * 8.92);
        car.add(tailDot);
        cabShells.push(headBar, tailDot);

        const cabWindow = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 1.0), m.glass);
        cabWindow.position.set(side * 1.55, 2.43, cabEnd * 7.35);
        car.add(cabWindow);
      }

      const frontSkirt = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.3, 0.16), m.dark);
      frontSkirt.position.set(0, 0.52, cabEnd * 8.72);
      car.add(frontSkirt);
      cabShells.push(frontSkirt);

      const logo = new THREE.Mesh(
        new THREE.PlaneGeometry(0.4, 0.28),
        new THREE.MeshBasicMaterial({
          map: makeLabelTexture(config.logo.text, { width: 160, height: 112, bg: config.logo.background, fg: config.logo.foreground }),
          side: THREE.DoubleSide
        })
      );
      logo.position.set(0, 1.5, cabEnd * 8.9);
      if (cabEnd < 0) logo.rotation.y = Math.PI;
      car.add(logo);
      cabShells.push(logo);

      const displayAssembly = new THREE.Group();
      displayAssembly.name = `S-Bahn cab route display assembly ${cabEnd}`;
      displayAssembly.position.set(0, 3.06, cabEnd * 8.76);
      displayAssembly.rotation.y = cabEnd < 0 ? Math.PI : 0;
      const tilted = new THREE.Group();
      tilted.rotation.x = -0.197;
      displayAssembly.add(tilted);
      const recess = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.4, 0.03), m.dark);
      tilted.add(recess);
      cabShells.push(recess);
      const display = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.32), new THREE.MeshBasicMaterial({
        map: makeLabelTexture(`${context.route.line} ${context.route.destination}`, {
          width: 700,
          height: 128,
          bg: config.destinationDisplay.background,
          fg: config.destinationDisplay.foreground
        }),
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
      }));
      display.position.z = 0.025;
      display.renderOrder = 20;
      tilted.add(display);
      car.add(displayAssembly);
      cabDisplays.push(display);
    }
    const floor = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.12, 15.5), m.floor);
    floor.position.y = 1.12;
    car.add(floor);
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.68, 0.08, 15.35), m.interior);
    ceiling.position.y = 3.32;
    car.add(ceiling);
    addCabinLight(rig, car, 3.0, -4.5);
    addCabinLight(rig, car, 3.0, 4.5);
    addOpaqueTransitInterior(car, 15.35, 1.4, m.interior, () => doorZs);
    for (const z of seatRowZs) {
      for (const x of seatXs) {
        const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.13, 0.52), m.seat);
        cushion.position.set(x, 1.37, z);
        car.add(cushion);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.68, 0.11), m.seat);
        back.position.set(x, 1.72, z - 0.25);
        car.add(back);
      }
    }
    for (const z of poleZs) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2, 8), m.metal);
      pole.position.set(0, 2.1, z);
      car.add(pole);
    }
    const monitor = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.54), displayMaterial);
    monitor.position.set(0, 2.94, 0.15);
    monitor.rotation.y = Math.PI;
    monitor.renderOrder = 18;
    car.add(monitor);
    for (const z of bogieZs) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.42, 1.8), m.dark);
      bogie.position.set(0, 0.48, z);
      car.add(bogie);
    }
    cars.push(car);
    root.add(car);
  });

  const trainHalfLengthM = config.formation.halfLengthM;
  addPantograph(root, new THREE.Vector3(config.pantograph.x, config.pantograph.y, config.pantograph.z), m.dark);
  addExteriorLightThrow(root, rig, trainHalfLengthM, config.headlightBeamHeightM);

  return {
    root,
    cars,
    doors,
    windowBands,
    cabShells,
    passengerShells,
    cabDisplays,
    glassMaterial: m.glass,
    trainHalfLengthM,
    setExteriorLightsOn: makeSetExteriorLightsOn(rig)
  };
}

function makeSBahnMaterials(configMaterials: SBahnBlueprintConfig['materials']): SBahnMaterials {
  const materials = {} as SBahnMaterials;
  for (const role of Object.keys(configMaterials) as SBahnMaterialRole[]) {
    materials[role] = makeStandardMaterial(configMaterials[role]);
  }
  return materials;
}

function makeSBahn430Body(lengthM: number): THREE.ExtrudeGeometry {
  // Aluminium body profile: nearly vertical sides up to the cant rail, then
  // broad curved shoulders and a shallow crown around the rooftop equipment.
  const crossSection = new THREE.Shape();
  crossSection.moveTo(-1.51, 0.4);
  crossSection.lineTo(1.51, 0.4);
  crossSection.lineTo(1.51, 3.02);
  crossSection.quadraticCurveTo(1.49, 3.25, 1.35, 3.43);
  crossSection.quadraticCurveTo(1.16, 3.64, 0.72, 3.69);
  crossSection.quadraticCurveTo(0.34, 3.73, 0, 3.73);
  crossSection.quadraticCurveTo(-0.34, 3.73, -0.72, 3.69);
  crossSection.quadraticCurveTo(-1.16, 3.64, -1.35, 3.43);
  crossSection.quadraticCurveTo(-1.49, 3.25, -1.51, 3.02);
  crossSection.closePath();

  const geometry = new THREE.ExtrudeGeometry(crossSection, {
    depth: lengthM,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.025,
    bevelSegments: 2,
    curveSegments: 8
  });
  geometry.translate(0, 0, -lengthM / 2);
  return geometry;
}

function makeSBahn430Nose(): THREE.ExtrudeGeometry {
  // Side profile of the flat, slightly raked BR 430 front, extruded across the width.
  const profile = new THREE.Shape();
  profile.moveTo(0, 0.42);
  profile.lineTo(0.55, 0.42);
  profile.lineTo(0.72, 0.62);
  profile.lineTo(0.78, 1.9);
  profile.lineTo(0.52, 3.2);
  profile.quadraticCurveTo(0.42, 3.5, 0.12, 3.6);
  profile.lineTo(0, 3.6);
  profile.closePath();
  const geometry = new THREE.ExtrudeGeometry(profile, {
    depth: 2.7,
    bevelEnabled: true,
    bevelThickness: 0.09,
    bevelSize: 0.09,
    bevelSegments: 3
  });
  geometry.translate(0, 0, -1.35);
  geometry.rotateY(-Math.PI / 2);
  return geometry;
}

function makeSBahn430Mask(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-1.3, -0.66);
  shape.lineTo(1.3, -0.66);
  shape.lineTo(1.06, 0.56);
  shape.quadraticCurveTo(0.98, 0.66, 0.82, 0.68);
  shape.lineTo(-0.82, 0.68);
  shape.quadraticCurveTo(-0.98, 0.66, -1.06, 0.56);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
  geometry.translate(0, 0, -0.03);
  return geometry;
}

function makeSBahn430Windscreen(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-1.18, -0.56);
  shape.lineTo(1.18, -0.56);
  shape.lineTo(0.92, 0.44);
  shape.quadraticCurveTo(0.84, 0.54, 0.68, 0.56);
  shape.lineTo(-0.68, 0.56);
  shape.quadraticCurveTo(-0.84, 0.54, -0.92, 0.44);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.015, bevelSegments: 2 });
  geometry.translate(0, 0, -0.025);
  return geometry;
}
