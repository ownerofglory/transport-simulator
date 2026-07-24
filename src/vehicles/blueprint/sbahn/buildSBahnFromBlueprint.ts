import * as THREE from 'three';
import { makeLabelTexture } from '../../../labels';
import type { ResolvedVehicleBuildContext, VehicleInstance } from '../../types';
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

export function buildSBahnVehicle(config: SBahnBlueprintConfig, context: ResolvedVehicleBuildContext): VehicleInstance {
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
  const interior = makeSBahnInteriorMaterials(m);
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
    const floor = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.12, 15.5), interior.floor);
    floor.position.y = 1.12;
    car.add(floor);
    const aisle = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.018, 15.24), interior.aisle);
    aisle.position.y = 1.19;
    car.add(aisle);
    for (const z of doorZs) {
      const vestibuleFloor = new THREE.Mesh(new THREE.BoxGeometry(2.82, 0.02, 1.72), interior.vestibuleFloor);
      vestibuleFloor.position.set(0, 1.2, z);
      car.add(vestibuleFloor);
    }
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.68, 0.08, 15.35), m.interior);
    ceiling.position.y = 3.32;
    car.add(ceiling);
    addSBahnCeiling(car, interior);
    addCabinLight(rig, car, 3.04, -4.5);
    addCabinLight(rig, car, 3.04, 4.5);
    addOpaqueTransitInterior(car, 15.35, 1.4, m.interior, () => doorZs);
    addSBahnVestibulePartitions(car, doorZs, interior);
    addSBahnLuggageRacks(car, interior);
    seatRowZs.forEach((z, rowIndex) => {
      for (const x of seatXs) {
        addSBahnSeat(car, x, z, rowIndex % 2 === 0 ? 1 : -1, interior);
      }
    });
    for (const z of poleZs) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2, 8), m.metal);
      pole.position.set(0, 2.1, z);
      car.add(pole);
    }
    addSBahnHandrails(car, doorZs, m.metal);
    addSBahnVestibuleMarkings(car, doorZs, interior.floorMarking);
    const monitorHousing = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.68, 0.12), interior.displayHousing);
    monitorHousing.position.set(0, 2.96, 0.15);
    car.add(monitorHousing);
    const monitor = new THREE.Mesh(new THREE.PlaneGeometry(2.04, 0.48), displayMaterial);
    monitor.position.set(0, 2.96, 0.082);
    monitor.rotation.y = Math.PI;
    monitor.renderOrder = 18;
    car.add(monitor);
    const monitorBracket = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.27, 8), m.metal);
    monitorBracket.position.set(0, 3.18, 0.15);
    car.add(monitorBracket);
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
    setExteriorLightsOn: makeSetExteriorLightsOn(rig),
    dispose: () => disposeSBahnVehicle(root, displayMaterial)
  };
}

function makeSBahnMaterials(configMaterials: SBahnBlueprintConfig['materials']): SBahnMaterials {
  const materials = {} as SBahnMaterials;
  for (const role of Object.keys(configMaterials) as SBahnMaterialRole[]) {
    materials[role] = makeStandardMaterial(configMaterials[role]);
  }
  return materials;
}

type SBahnInteriorMaterials = {
  floor: THREE.MeshStandardMaterial;
  aisle: THREE.MeshStandardMaterial;
  vestibuleFloor: THREE.MeshStandardMaterial;
  ceilingVent: THREE.MeshStandardMaterial;
  ceilingLight: THREE.MeshStandardMaterial;
  displayHousing: THREE.MeshStandardMaterial;
  floorMarking: THREE.MeshBasicMaterial;
  seatFabric: THREE.MeshStandardMaterial;
  seatHeadrest: THREE.MeshStandardMaterial;
  seatTrim: THREE.MeshStandardMaterial;
  partitionGlass: THREE.MeshStandardMaterial;
};

function makeSBahnInteriorMaterials(m: SBahnMaterials): SBahnInteriorMaterials {
  const seatFabric = m.seat;
  seatFabric.map = makeSBahnSeatFabricTexture();
  seatFabric.needsUpdate = true;

  const floor = m.floor;
  floor.map = makeSBahnFloorTexture();
  floor.needsUpdate = true;

  const partitionGlass = m.glass.clone();
  partitionGlass.color.set('#dff2f5');
  partitionGlass.transparent = true;
  partitionGlass.opacity = 0.24;
  partitionGlass.depthWrite = false;
  partitionGlass.needsUpdate = true;

  return {
    floor,
    aisle: new THREE.MeshStandardMaterial({ color: '#4f585c', roughness: 0.93 }),
    vestibuleFloor: new THREE.MeshStandardMaterial({ color: '#3e484d', roughness: 0.92 }),
    ceilingVent: new THREE.MeshStandardMaterial({ color: '#6f7a7d', roughness: 0.58, metalness: 0.28 }),
    ceilingLight: new THREE.MeshStandardMaterial({
      color: '#fffdf4',
      emissive: '#fff8dc',
      emissiveIntensity: 0.75,
      roughness: 0.42
    }),
    displayHousing: new THREE.MeshStandardMaterial({ color: '#182126', roughness: 0.36, metalness: 0.32 }),
    floorMarking: new THREE.MeshBasicMaterial({ color: '#e9edeb', transparent: true, opacity: 0.82, side: THREE.DoubleSide }),
    seatFabric,
    seatHeadrest: new THREE.MeshStandardMaterial({ color: '#111d31', roughness: 0.78 }),
    seatTrim: new THREE.MeshStandardMaterial({ color: '#d9dfe0', roughness: 0.5, metalness: 0.12 }),
    partitionGlass
  };
}

function makeSBahnSeatFabricTexture(): THREE.DataTexture {
  const size = 24;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const brightDot = (x === 4 || x === 16) && (y === 4 || y === 16);
      const smallDot = (x === 10 || x === 22) && (y === 10 || y === 22);
      const weave = (x + y) % 5 === 0;
      pixels[index] = brightDot ? 150 : smallDot ? 110 : weave ? 76 : 255;
      pixels[index + 1] = brightDot ? 232 : smallDot ? 186 : weave ? 100 : 255;
      pixels[index + 2] = brightDot ? 255 : smallDot ? 246 : weave ? 128 : 255;
      pixels[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 7);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function makeSBahnFloorTexture(): THREE.DataTexture {
  const size = 32;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const seed = (x * 17 + y * 31 + x * y * 7) % 29;
      const tone = seed < 3 ? 184 : seed > 25 ? 232 : 207;
      pixels[index] = tone;
      pixels[index + 1] = tone + 2;
      pixels[index + 2] = tone + 2;
      pixels[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 28);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function addSBahnCeiling(car: THREE.Group, m: SBahnInteriorMaterials): void {
  const vent = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.024, 14.7), m.ceilingVent);
  vent.position.set(0, 3.265, 0);
  car.add(vent);
  for (const x of [-0.93, 0.93]) {
    const lightStrip = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.028, 14.7), m.ceilingLight);
    lightStrip.position.set(x, 3.27, 0);
    car.add(lightStrip);
  }
  for (let z = -7.05; z <= 7.05; z += 0.34) {
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.018, 0.035), m.seatTrim);
    grille.position.set(0, 3.245, z);
    car.add(grille);
  }
}

function addSBahnSeat(
  car: THREE.Group,
  x: number,
  z: number,
  facing: -1 | 1,
  m: SBahnInteriorMaterials
): void {
  const seat = new THREE.Group();
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.56), m.seatFabric);
  cushion.position.set(0, 1.39, 0);
  seat.add(cushion);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.54, 0.12), m.seatFabric);
  back.position.set(0, 1.7, -facing * 0.23);
  seat.add(back);
  const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.14), m.seatHeadrest);
  headrest.position.set(0, 2.04, -facing * 0.25);
  seat.add(headrest);

  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.55, 0.58), m.seatTrim);
    edge.position.set(side * 0.22, 1.64, -facing * 0.01);
    seat.add(edge);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.47), m.displayHousing);
  base.position.set(0, 1.23, 0);
  seat.add(base);
  seat.position.set(x, 0, z);
  car.add(seat);
}

function addSBahnVestibulePartitions(car: THREE.Group, doorZs: number[], m: SBahnInteriorMaterials): void {
  for (const doorZ of doorZs) {
    for (const side of [-1, 1] as const) {
      for (const offset of [-0.65, 0.65]) {
        const z = doorZ + offset;
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.025, 1.72, 0.58), m.partitionGlass);
        panel.position.set(side * 1.18, 2.03, z);
        car.add(panel);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.82, 8), m.seatTrim);
        post.position.set(side * 1.19, 2.03, z + Math.sign(offset) * 0.3);
        car.add(post);
        const lowerRail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.62), m.seatTrim);
        lowerRail.position.set(side * 1.19, 1.28, z);
        car.add(lowerRail);
        for (let y = 1.62; y <= 2.35; y += 0.18) {
          const dot = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.035), m.seatTrim);
          dot.position.set(side * 1.155, y, z);
          car.add(dot);
        }
      }
    }
  }
}

function addSBahnLuggageRacks(car: THREE.Group, m: SBahnInteriorMaterials): void {
  for (const side of [-1, 1] as const) {
    const rackX = side * 1.15;
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.045, 14.2), m.seatTrim);
    shelf.position.set(rackX, 2.91, 0);
    car.add(shelf);

    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.23, 14.0), m.seatTrim);
    guard.position.set(side * 0.93, 3.04, 0);
    car.add(guard);

    for (let z = -6.5; z <= 6.5; z += 1.3) {
      addCylinderBetween(
        car,
        new THREE.Vector3(side * 1.36, 2.57, z),
        new THREE.Vector3(side * 0.96, 3.0, z),
        m.seatTrim
      );
    }
  }
}

function addSBahnVestibuleMarkings(car: THREE.Group, doorZs: number[], material: THREE.Material): void {
  for (const doorZ of doorZs) {
    for (const side of [-1, 1] as const) {
      const centre = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.19, 20), material);
      centre.rotation.x = -Math.PI / 2;
      centre.position.set(side * 0.73, 1.215, doorZ);
      car.add(centre);

      const spoke = new THREE.Mesh(new THREE.PlaneGeometry(0.025, 0.38), material);
      spoke.rotation.x = -Math.PI / 2;
      spoke.position.set(side * 0.73, 1.216, doorZ);
      car.add(spoke);
    }
  }
}

function addSBahnHandrails(car: THREE.Group, doorZs: number[], material: THREE.Material): void {
  for (const side of [-1, 1] as const) {
    addCylinderBetween(car, new THREE.Vector3(side * 1.12, 2.76, -7.0), new THREE.Vector3(side * 1.12, 2.76, 7.0), material);
  }
  for (const doorZ of doorZs) {
    for (const side of [-1, 1] as const) {
      addCylinderBetween(
        car,
        new THREE.Vector3(side * 1.16, 1.24, doorZ - 0.56),
        new THREE.Vector3(side * 0.74, 2.78, doorZ - 0.12),
        material
      );
      addCylinderBetween(
        car,
        new THREE.Vector3(side * 1.16, 1.24, doorZ + 0.56),
        new THREE.Vector3(side * 0.74, 2.78, doorZ + 0.12),
        material
      );
    }
  }
}

function addCylinderBetween(car: THREE.Group, start: THREE.Vector3, end: THREE.Vector3, material: THREE.Material): void {
  const direction = end.clone().sub(start);
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, direction.length(), 8), material);
  rail.position.copy(start).add(end).multiplyScalar(0.5);
  rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  car.add(rail);
}

function disposeSBahnVehicle(root: THREE.Group, sharedDisplayMaterial: THREE.Material): void {
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      if (material !== sharedDisplayMaterial) materials.add(material);
    }
  });
  for (const material of materials) {
    if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose();
    material.dispose();
  }
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
