import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { addBR430ExteriorDetails, makeBR430ExteriorLabels } from './br430Exterior';
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
import { withSideWindowCutouts } from '../../windowCutouts';
import { registerSeatAnchors, yawForFacing } from '../../interiorSeating';
import type { SBahnBlueprintConfig, SBahnMaterialRole } from './SBahnBlueprintConfig';

// DB BR 430-family S-Bahn renderer, driven by an SBahnBlueprintConfig.
// The config decides livery, formation, layout, logo and display colors; the
// constants below are fixed BR 430 styling (body cross-section, nose profile,
// cab detailing, ...). Geometry is an unchanged extraction of the former
// procedural S-Bahn builder — keep it visually byte-identical unless the task
// is about changing S-Bahn visuals.

type SBahnMaterials = Record<SBahnMaterialRole, THREE.MeshStandardMaterial> & {
  // Resolved trim roles: each falls back to `accent` when the config omits it,
  // so a single-accent livery (BR 430) behaves exactly as before.
  lowerBand: THREE.MeshStandardMaterial;
  belt: THREE.MeshStandardMaterial;
  door: THREE.MeshStandardMaterial;
  nose: THREE.MeshStandardMaterial;
};

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
  if (config.exteriorDetailStyle === 'br430') m.glass.depthWrite = false;
  const exteriorPaintMaterials: THREE.MeshStandardMaterial[] = config.exteriorDetailStyle === 'br430'
    ? [m.shell, m.nose, m.belt, m.door]
    : [];
  const exteriorLabels = config.exteriorDetailStyle === 'br430'
    ? makeBR430ExteriorLabels(context.definition.line, context.definition.destination)
    : null;
  const cabWindscreenMaterial = exteriorLabels ? makeBR430WindscreenMaterial() : m.glass;
  const sharedDisplayMaterial = context.makeInteriorDisplayMaterial();
  const displayMaterial = exteriorLabels ? sharedDisplayMaterial.clone() : sharedDisplayMaterial;
  if (exteriorLabels) displayMaterial.side = THREE.FrontSide;
  const interior = makeSBahnInteriorMaterials(m);
  const seatGeometry = exteriorLabels ? {
    cushion: new RoundedBoxGeometry(0.42, 0.14, 0.56, 2, 0.04),
    back: new RoundedBoxGeometry(0.42, 0.54, 0.12, 2, 0.035),
    headrest: new RoundedBoxGeometry(0.42, 0.16, 0.14, 2, 0.04),
    armrest: new RoundedBoxGeometry(0.045, 0.065, 0.42, 2, 0.02),
    shell: new RoundedBoxGeometry(0.46, 0.64, 0.065, 2, 0.025)
  } : undefined;
  rig.headLampMaterials.push(m.headlight);
  rig.tailLampMaterials.push(m.tailLamp);

  const { carCenters } = config.formation;
  const { doorZs, windowZs, seatRowZs, seatXs, poleZs, bogieZs } = config.layout;

  carCenters.forEach((center, index) => {
    const car = new THREE.Group();
    car.name = `${config.formation.sectionNamePrefix} ${index + 1}`;
    car.userData.centerOffsetM = center;
    if (exteriorLabels) {
      car.userData.passengerCameraLocal = [0.2, 2.3, -4.4];
      car.userData.passengerLookAtLocal = [0.05, 2.25, 7.5];
    }
    const sideWindows = windowZs.map((z) => ({ y: 2.43, height: 0.88, z, width: 1.08 }));
    const body = new THREE.Mesh(makeSBahn430Body(16.15), exteriorLabels ? withSideWindowCutouts(m.shell, sideWindows) : m.shell);
    if (exteriorLabels) exteriorPaintMaterials.push(body.material);
    body.castShadow = true;
    car.add(body);
    passengerShells.push(body);

    // The BR 430 roof rolls inward above the window band; a low central HVAC
    // pod leaves the curved shoulders visible instead of reading as a box.
    const roofPod = new THREE.Mesh(exteriorLabels
      ? new RoundedBoxGeometry(1.68, 0.18, 4.8, 2, 0.06)
      : new THREE.BoxGeometry(1.68, 0.18, 4.8), m.metal);
    roofPod.name = 'S-Bahn roof HVAC pod';
    roofPod.position.set(0, 3.77, index % 2 === 0 ? 0.65 : -0.65);
    roofPod.castShadow = true;
    car.add(roofPod);
    passengerShells.push(roofPod);
    for (let slat = -7; slat <= 7; slat++) {
      const grille = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.025, 0.055), m.dark);
      grille.position.set(0, 3.875, roofPod.position.z + slat * 0.28);
      car.add(grille);
    }
    const lowerBand = new THREE.Mesh(new THREE.BoxGeometry(3.08, config.bands?.lowerHeightM ?? 0.28, 16.22), m.lowerBand);
    lowerBand.position.y = config.bands?.lowerY ?? 0.62;
    car.add(lowerBand);
    passengerShells.push(lowerBand);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(3.09, config.bands?.beltHeightM ?? 0.18, 16.23), m.belt);
    belt.position.y = config.bands?.beltY ?? 1.72;
    car.add(belt);
    passengerShells.push(belt);
    for (const side of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.08, 14.5), exteriorLabels
        ? new THREE.MeshStandardMaterial({ color: 0x252b2e, transparent: true, opacity: 0.32, roughness: 0.31, depthWrite: false })
        : m.dark);
      band.position.set(side * 1.535, 2.43, 0);
      car.add(band);
      windowBands.push(band);
      for (const z of windowZs) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.88, 1.08), m.glass);
        window.position.set(side * 1.55, 2.43, z);
        car.add(window);
      }
      for (const z of doorZs) {
        addSlidingVehicleDoor(doors, car, side * 1.55, z, m.door, m.glass, m.dark, 1.72, 2.05);
      }
    }
    if (index === 0 || index === carCenters.length - 1) {
      // The Stuttgart BR 430 cab tapers in plan view and rolls into the lower
      // skirt, with a wide black windscreen band and slim vertical LED lamps.
      const cabEnd = (index === 0 ? -1 : 1) as -1 | 1;
      const faceTilt = -cabEnd * 0.197;
      const nose = new THREE.Mesh(makeSBahn430Nose(), m.nose);
      nose.name = 'BR430 rounded cab shell';
      nose.position.z = cabEnd * 8.0;
      if (cabEnd < 0) nose.rotation.y = Math.PI;
      nose.castShadow = true;
      car.add(nose);
      cabShells.push(nose);

      const mask = new THREE.Mesh(makeSBahn430Mask(), m.dark);
      mask.name = 'BR430 rounded windscreen mask';
      mask.position.set(0, 2.58, cabEnd * 8.76);
      mask.rotation.x = faceTilt;
      if (cabEnd < 0) mask.rotation.y = Math.PI;
      car.add(mask);
      cabShells.push(mask);

      const windscreen = new THREE.Mesh(makeSBahn430Windscreen(), cabWindscreenMaterial);
      windscreen.name = 'BR430 curved windscreen';
      windscreen.position.set(0, 2.5, cabEnd * 8.82);
      windscreen.rotation.x = faceTilt;
      if (cabEnd < 0) windscreen.rotation.y = Math.PI;
      car.add(windscreen);

      const roundLamps = config.cabLampStyle === 'round';
      for (const side of [-1, 1] as const) {
        // BR 430 stacks a vertical LED bar over a tail dot in one slim housing;
        // the CDMX cars carry two large round clusters side by side instead.
        const housing = roundLamps
          ? new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.07, 20), m.dark)
          : new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.8, 0.08, 4, 0.07), m.dark);
        if (roundLamps) housing.rotation.x = Math.PI / 2;
        housing.position.set(side * 1.12, roundLamps ? 1.34 : 1.32, cabEnd * 8.88);
        car.add(housing);
        cabShells.push(housing);

        const headBar = roundLamps
          ? new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.055, 20), m.headlight)
          : new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.43, 0.06, 3, 0.035), m.headlight);
        if (roundLamps) headBar.rotation.x = Math.PI / 2;
        headBar.position.set(side * (roundLamps ? 1.24 : 1.12), roundLamps ? 1.34 : 1.18, cabEnd * 8.92);
        car.add(headBar);
        const tailDot = roundLamps
          ? new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.055, 16), m.tailLamp)
          : new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.17, 0.06, 3, 0.035), m.tailLamp);
        if (roundLamps) tailDot.rotation.x = Math.PI / 2;
        tailDot.position.set(side * (roundLamps ? 0.98 : 1.12), roundLamps ? 1.34 : 1.56, cabEnd * 8.92);
        car.add(tailDot);
        cabShells.push(headBar, tailDot);

        const cabWindow = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 1.0), m.glass);
        cabWindow.position.set(side * 1.55, 2.43, cabEnd * 7.35);
        car.add(cabWindow);
      }

      const frontApron = new THREE.Mesh(makeSBahn430Apron(), m.dark);
      frontApron.name = 'BR430 bowed lower cab apron';
      frontApron.position.set(0, 0.65, cabEnd * 8.76);
      if (cabEnd < 0) frontApron.rotation.y = Math.PI;
      frontApron.castShadow = true;
      car.add(frontApron);
      cabShells.push(frontApron);

      const logo = new THREE.Mesh(
        exteriorLabels ? new THREE.CircleGeometry(0.22, 32) : new THREE.PlaneGeometry(0.4, 0.28),
        new THREE.MeshBasicMaterial({
          map: makeLabelTexture(config.logo.text, { width: 160, height: 112, bg: config.logo.background, fg: config.logo.foreground }),
          side: THREE.DoubleSide
        })
      );
      logo.name = exteriorLabels ? 'BR430 green S cab emblem' : 'S-Bahn cab operator logo';
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
        addSBahnSeat(car, x, z, rowIndex % 2 === 0 ? 1 : -1, interior, config.seatOrientation === 'longitudinal', seatGeometry);
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
    monitor.name = 'S-Bahn next-stop monitor';
    car.add(monitor);
    if (exteriorLabels) {
      const reverseMonitor = monitor.clone();
      reverseMonitor.position.z = 0.218;
      reverseMonitor.rotation.set(0, 0, 0);
      car.add(reverseMonitor);
    }
    const monitorBracket = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.27, 8), m.metal);
    monitorBracket.position.set(0, 3.18, 0.15);
    car.add(monitorBracket);
    for (const z of bogieZs) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.42, 1.8), m.dark);
      bogie.position.set(0, 0.48, z);
      car.add(bogie);
    }
    if (exteriorLabels) {
      addBR430ExteriorDetails(car, config, index === 0 ? -1 : index === carCenters.length - 1 ? 1 : 0,
        passengerShells, cabShells, { dark: m.dark, metal: m.metal, accent: m.accent, ...exteriorLabels });
    }
    cars.push(car);
    root.add(car);
  });

  const trainHalfLengthM = config.formation.halfLengthM;
  if (config.pantograph) {
    addPantograph(root, new THREE.Vector3(config.pantograph.x, config.pantograph.y, config.pantograph.z), m.dark);
  }
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
    exteriorPaintMaterials,
    trainHalfLengthM,
    setExteriorLightsOn: makeSetExteriorLightsOn(rig),
    dispose: () => {
      disposeSBahnVehicle(root, displayMaterial);
      if (exteriorLabels) {
        displayMaterial.dispose();
        for (const material of Object.values(exteriorLabels)) (material as THREE.MeshBasicMaterial).map?.dispose();
      }
    }
  };
}

function makeSBahnMaterials(configMaterials: SBahnBlueprintConfig['materials']): SBahnMaterials {
  const materials = {} as SBahnMaterials;
  for (const role of Object.keys(configMaterials) as SBahnMaterialRole[]) {
    const config = configMaterials[role];
    if (config) materials[role] = makeStandardMaterial(config);
  }
  // An omitted trim role reuses the accent instance rather than a copy of it, so
  // liveries that don't split their trim allocate exactly what they did before.
  for (const role of ['lowerBand', 'belt', 'door', 'nose'] as const) {
    if (!materials[role]) materials[role] = materials.accent;
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
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
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
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
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

type SBahnSeatGeometry = Record<'cushion' | 'back' | 'headrest' | 'armrest' | 'shell', THREE.BufferGeometry>;

function addSBahnSeat(
  car: THREE.Group,
  x: number,
  z: number,
  facing: -1 | 1,
  m: SBahnInteriorMaterials,
  longitudinal = false,
  geometry?: SBahnSeatGeometry
): void {
  const seat = new THREE.Group();
  seat.name = 'S-Bahn passenger seat';
  const cushion = new THREE.Mesh(geometry?.cushion ?? new THREE.BoxGeometry(0.42, 0.14, 0.56), m.seatFabric);
  cushion.position.set(0, 1.39, 0);
  seat.add(cushion);

  const back = new THREE.Mesh(geometry?.back ?? new THREE.BoxGeometry(0.42, 0.54, 0.12), m.seatFabric);
  back.position.set(0, 1.7, -facing * 0.23);
  seat.add(back);
  const headrest = new THREE.Mesh(geometry?.headrest ?? new THREE.BoxGeometry(0.42, 0.16, 0.14), m.seatHeadrest);
  headrest.position.set(0, 2.04, -facing * 0.25);
  seat.add(headrest);

  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(geometry?.armrest ?? new THREE.BoxGeometry(0.045, 0.55, 0.58), m.seatTrim);
    edge.position.set(side * 0.22, 1.64, -facing * 0.01);
    seat.add(edge);
  }
  if (geometry) {
    const shell = new THREE.Mesh(geometry.shell, m.seatTrim);
    shell.name = 'BR430 molded seat back';
    shell.position.set(0, 1.75, -facing * 0.32);
    seat.add(shell);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.47), m.displayHousing);
  base.position.set(0, 1.23, 0);
  seat.add(base);
  seat.position.set(x, 0, z);
  // A bench along the wall is the same seat turned to face the aisle. Rotating
  // about the seat origin keeps the cushion over the same floor patch.
  if (longitudinal) seat.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
  car.add(seat);
  registerSeatAnchors(car, [{ x, y: 1.46, z, yaw: longitudinal ? seat.rotation.y : yawForFacing(facing) }]);
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
  // The extruded side profile is bowed afterwards so the cab face curves across
  // its width instead of reading as a flat slab from chase and overhead views.
  const profile = new THREE.Shape();
  profile.moveTo(0, 0.38);
  profile.lineTo(0.42, 0.38);
  profile.quadraticCurveTo(0.64, 0.4, 0.74, 0.62);
  profile.quadraticCurveTo(0.82, 1.12, 0.79, 1.9);
  profile.quadraticCurveTo(0.7, 2.56, 0.5, 3.22);
  profile.quadraticCurveTo(0.39, 3.51, 0.1, 3.6);
  profile.lineTo(0, 3.6);
  profile.closePath();
  const geometry = new THREE.ExtrudeGeometry(profile, {
    depth: 2.56,
    curveSegments: 16,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.11,
    bevelSegments: 7
  });
  geometry.translate(0, 0, -1.28);
  geometry.rotateY(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const widthRatio = Math.min(1, Math.abs(x) / 1.42);
    const faceRatio = THREE.MathUtils.clamp(z / 0.82, 0, 1);
    position.setZ(index, z + 0.2 * (1 - widthRatio * widthRatio) * faceRatio);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeSBahn430Mask(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-1.16, -0.68);
  shape.quadraticCurveTo(0, -0.8, 1.16, -0.68);
  shape.quadraticCurveTo(1.28, -0.61, 1.24, -0.43);
  shape.lineTo(1.02, 0.54);
  shape.quadraticCurveTo(0.96, 0.66, 0.78, 0.69);
  shape.lineTo(-0.82, 0.68);
  shape.quadraticCurveTo(-0.98, 0.66, -1.06, 0.56);
  shape.lineTo(-1.24, -0.43);
  shape.quadraticCurveTo(-1.28, -0.61, -1.16, -0.68);
  shape.closePath();
  // A real frame, not a dark filled plate behind the transparent pane. The
  // filled plate produced a visible horizontal band through the windscreen.
  const opening = new THREE.Path();
  opening.moveTo(-1.06, -0.55);
  opening.lineTo(-0.9, 0.44);
  opening.quadraticCurveTo(-0.84, 0.54, -0.68, 0.56);
  opening.lineTo(0.68, 0.56);
  opening.quadraticCurveTo(0.84, 0.54, 0.9, 0.44);
  opening.lineTo(1.06, -0.55);
  opening.quadraticCurveTo(0, -0.65, -1.06, -0.55);
  opening.closePath();
  shape.holes.push(opening);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.06, curveSegments: 16, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.025, bevelSegments: 5 });
  geometry.translate(0, 0, -0.03);
  bowCabFace(geometry, 1.3, 0.11);
  return geometry;
}

function makeSBahn430Windscreen(): THREE.BufferGeometry {
  const columns = 12;
  const rows = 6;
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    const y = THREE.MathUtils.lerp(-0.57, 0.56, v);
    const halfWidth = THREE.MathUtils.lerp(1.08, 0.7, v) + Math.sin(v * Math.PI) * 0.035;
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const x = (u * 2 - 1) * halfWidth;
      const widthRatio = x / 1.1;
      const z = 0.135 * Math.max(0, 1 - widthRatio * widthRatio) + 0.012 * Math.sin(v * Math.PI);
      vertices.push(x, y, z);
      uvs.push(u, v);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeSBahn430Apron(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.9, -0.31);
  shape.quadraticCurveTo(-1.17, -0.3, -1.27, -0.08);
  shape.quadraticCurveTo(-1.3, 0.12, -1.15, 0.28);
  shape.quadraticCurveTo(-1.04, 0.36, -0.84, 0.37);
  shape.lineTo(0.84, 0.37);
  shape.quadraticCurveTo(1.04, 0.36, 1.15, 0.28);
  shape.quadraticCurveTo(1.3, 0.12, 1.27, -0.08);
  shape.quadraticCurveTo(1.17, -0.3, 0.9, -0.31);
  shape.quadraticCurveTo(0, -0.39, -0.9, -0.31);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.3,
    curveSegments: 18,
    bevelEnabled: true,
    bevelSize: 0.035,
    bevelThickness: 0.025,
    bevelSegments: 6
  });
  geometry.translate(0, 0, -0.15);
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const y = position.getY(index);
    const widthRatio = Math.min(1, Math.abs(x) / 1.3);
    const verticalFade = 1 - 0.35 * THREE.MathUtils.smoothstep(y, -0.31, 0.37);
    position.setZ(index, position.getZ(index) + 0.31 * (1 - widthRatio * widthRatio) * verticalFade);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function bowCabFace(geometry: THREE.BufferGeometry, halfWidth: number, amount: number): void {
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index++) {
    const widthRatio = Math.min(1, Math.abs(position.getX(index)) / halfWidth);
    position.setZ(index, position.getZ(index) + amount * (1 - widthRatio * widthRatio));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function makeBR430WindscreenMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: '#1d333d',
    transparent: true,
    opacity: 0.74,
    roughness: 0.07,
    metalness: 0.04,
    clearcoat: 0.72,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.65,
    depthWrite: true,
    side: THREE.DoubleSide
  });
}
