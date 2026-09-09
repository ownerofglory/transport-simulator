import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { makeSsbSurfaceTexture } from '../../surfaceTextures';
import { addCitaroDetails } from './citaroDetails';
import { makeLabelTexture } from '../../../labels';
import type { ResolvedVehicleBuildContext, VehicleInstance } from '../../types';
import {
  addCabinLight,
  addExteriorLightThrow,
  addOpaqueTransitInterior,
  addSlidingVehicleDoor,
  makeExteriorLightRig,
  makeSetExteriorLightsOn,
  type ExteriorLightRig
} from '../../parts';
import { makeStandardMaterial } from '../standardMaterial';
import type { BusBlueprintConfig, BusMaterialRole, BusSectionConfig } from './BusBlueprintConfig';

// Mercedes-Benz Citaro family renderer, driven by a BusBlueprintConfig.
// The config decides livery, formation, door/axle layout and articulation
// rules; the constants below are shared Citaro styling (window pitch, seat
// spacing, mirror/wiper geometry, ...). Geometry is an unchanged extraction of
// the former procedural bus builder — keep it visually byte-identical unless
// the task is about changing bus visuals.

type BusMaterials = Record<BusMaterialRole, THREE.MeshStandardMaterial>;
type BusSeatGeometry = Record<'cushion' | 'back' | 'headrest' | 'shell', THREE.BufferGeometry>;

type BusBuildState = {
  root: THREE.Group;
  cars: THREE.Group[];
  doors: VehicleInstance['doors'];
  windowBands: THREE.Mesh[];
  cabShells: THREE.Mesh[];
  passengerShells: THREE.Mesh[];
  cabDisplays: THREE.Mesh[];
  rig: ExteriorLightRig;
  seatGeometry?: BusSeatGeometry;
};

export function buildBusVehicle(config: BusBlueprintConfig, context: ResolvedVehicleBuildContext): VehicleInstance {
  const state: BusBuildState = {
    root: new THREE.Group(),
    cars: [],
    doors: [],
    windowBands: [],
    cabShells: [],
    passengerShells: [],
    cabDisplays: [],
    rig: makeExteriorLightRig()
  };
  const materials = makeBusMaterials(config.materials);
  if (config.detailStyle === 'ssb-citaro') {
    materials.seat.map = makeSsbSurfaceTexture('fabric');
    materials.seat.color.setHex(0xffffff);
    materials.floor.map = makeSsbSurfaceTexture('floor');
    materials.floor.color.setHex(0xaaaaaa);
    state.seatGeometry = {
      cushion: new RoundedBoxGeometry(0.46, 0.14, 0.6, 2, 0.04),
      back: new RoundedBoxGeometry(0.46, 0.56, 0.11, 2, 0.035),
      headrest: new RoundedBoxGeometry(0.44, 0.2, 0.1, 2, 0.035),
      shell: new RoundedBoxGeometry(0.49, 0.62, 0.07, 2, 0.025)
    };
  }
  const displayMaterial = context.makeInteriorDisplayMaterial();

  const articulated = isArticulatedFormation(config, context);
  const sections = articulated && config.articulated ? config.articulated.sections : [config.rigid.section];
  for (const section of sections) {
    state.cars.push(addBusSection(state, section, materials, displayMaterial, config, context));
  }
  if (articulated && config.articulated) addBusBellows(state, materials);
  const trainHalfLengthM = articulated && config.articulated ? config.articulated.halfLengthM : config.rigid.halfLengthM;

  addExteriorLightThrow(state.root, state.rig, trainHalfLengthM, config.headlightBeamHeightM);

  return {
    root: state.root,
    cars: state.cars,
    doors: state.doors,
    windowBands: state.windowBands,
    cabShells: state.cabShells,
    passengerShells: state.passengerShells,
    cabDisplays: state.cabDisplays,
    glassMaterial: materials.glass,
    trainHalfLengthM,
    setExteriorLightsOn: makeSetExteriorLightsOn(state.rig)
  };
}

function isArticulatedFormation(config: BusBlueprintConfig, context: ResolvedVehicleBuildContext): boolean {
  return isBusLineArticulated(config, context.route.line, context.city?.id);
}

/**
 * Whether a bus line runs an articulated ("bendy") unit under the given config
 * and city. Exported so other renderers (e.g. the Live 3D view) pick the same
 * formation the ride/explore view does from just a line label + optional city.
 */
export function isBusLineArticulated(config: BusBlueprintConfig, line: string | undefined, cityId: string | undefined): boolean {
  const rules = config.articulated;
  if (!rules) return false;
  const cityMatches = cityId === undefined ? rules.applyWhenCityUnknown : rules.cityIds.includes(cityId);
  if (!cityMatches) return false;
  const normalized = (line ?? '').trim().toUpperCase();
  return rules.lines.includes(normalized) || rules.linePrefixes.some((prefix) => normalized.startsWith(prefix));
}

function makeBusMaterials(configMaterials: BusBlueprintConfig['materials']): BusMaterials {
  const materials = {} as BusMaterials;
  for (const role of Object.keys(configMaterials) as BusMaterialRole[]) {
    materials[role] = makeStandardMaterial(configMaterials[role]);
  }
  return materials;
}

// Builds one rigid low-floor bus body centred on its own local z=0 so the
// articulated renderer can bend the two sections independently along the route.
function addBusSection(
  state: BusBuildState,
  section: BusSectionConfig,
  m: BusMaterials,
  displayMaterial: THREE.Material,
  config: BusBlueprintConfig,
  context: ResolvedVehicleBuildContext
): THREE.Group {
  const L = section.lengthM;
  const half = L / 2;
  const car = new THREE.Group();
  car.name = section.name;
  car.userData.centerOffsetM = section.centerOffsetM;

  const detailed = config.detailStyle === 'ssb-citaro';
  const body = new THREE.Mesh(detailed ? new RoundedBoxGeometry(2.55, 2.62, L, 2, 0.1) : new THREE.BoxGeometry(2.55, 2.62, L), m.body);
  body.name = 'Citaro body shell';
  body.position.y = 1.82;
  body.castShadow = true;
  car.add(body);
  state.passengerShells.push(body);

  // Dark lower skirt / bumper strip and a rounded roof cap for a Citaro profile.
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.58, 0.62, L - 0.1), m.skirt);
  skirt.position.y = 0.72;
  car.add(skirt);
  const roofCap = new THREE.Mesh(detailed ? new RoundedBoxGeometry(2.34, 0.2, L - 0.3, 2, 0.08) : new THREE.BoxGeometry(2.34, 0.2, L - 0.3), m.roof);
  roofCap.position.y = 3.19;
  car.add(roofCap);
  state.passengerShells.push(skirt, roofCap);

  addBusSideWindows(state, car, m, half, section.doorZs, section.cab === 'front');
  for (const z of section.doorZs) {
    addSlidingVehicleDoor(state.doors, car, -1.315, z, m.body, m.glass, m.black, 1.62, 1.95);
  }
  for (const z of section.axleZs) addBusWheels(car, m, z, detailed);

  // Roof air-conditioning pod, offset toward the non-cab end.
  const acLength = Math.min(3.2, L * 0.32);
  const acPod = new THREE.Mesh(detailed ? new RoundedBoxGeometry(1.8, 0.26, acLength, 2, 0.1) : new THREE.BoxGeometry(1.8, 0.26, acLength), m.black);
  acPod.position.set(0, 3.34, section.cab === 'front' ? -half * 0.45 : half * 0.35);
  car.add(acPod);

  // Interior floor, ceiling, walls, seating, grab rails and fittings.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.08, L - 0.7), m.floor);
  floor.position.y = 1.02;
  floor.name = 'Citaro textured saloon floor';
  car.add(floor);
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.08, L - 0.8), m.interior);
  ceiling.position.y = 3.0;
  car.add(ceiling);
  addOpaqueTransitInterior(car, L - 0.8, 1.18, m.interior, (side) => side < 0 ? section.doorZs : []);
  addBusSeating(car, m, half, section.doorZs, section.cab === 'front', section.rear === 'tail', state.seatGeometry);
  addBusInteriorFittings(car, m, half, section.cab === 'front');

  if (section.cab === 'front') {
    addBusFrontEnd(state, car, m, displayMaterial, half, config, context);
  } else {
    addBusGangwayRing(car, m, half, 1);
  }
  if (section.rear === 'tail') {
    addBusRearEnd(state, car, m, -half);
  } else {
    addBusGangwayRing(car, m, -half, -1);
  }

  addCabinLight(state.rig, car, 2.78, section.cab === 'front' ? -half * 0.3 : 0);
  if (detailed) addCitaroDetails(car, section, state.passengerShells, m);
  state.root.add(car);
  return car;
}

function addBusSideWindows(
  state: BusBuildState,
  car: THREE.Group,
  m: BusMaterials,
  half: number,
  doorZs: number[],
  cabFront: boolean
): void {
  const bandStart = -half + 0.55;
  const bandEnd = cabFront ? half - 2.1 : half - 0.55; // leave the cab bay clear at the front.
  for (const side of [-1, 1] as const) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.14, bandEnd - bandStart), m.black);
    band.position.set(side * 1.3, 2.42, (bandStart + bandEnd) / 2);
    car.add(band);
    state.windowBands.push(band);
    for (let z = bandStart + 0.62; z < bandEnd - 0.4; z += 1.24) {
      // Skip glazing where a door interrupts the window band on the curb side.
      if (side < 0 && doorZs.some((doorZ) => Math.abs(z - doorZ) < 0.72)) continue;
      const window = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.9, 1.02), m.glass);
      window.position.set(side * 1.315, 2.42, z);
      car.add(window);
    }
  }
}

function addBusWheels(car: THREE.Group, m: BusMaterials, z: number, detailed: boolean): void {
  for (const x of [-1.24, 1.24]) {
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.24, 22), m.tyre);
    tyre.rotation.z = Math.PI / 2;
    tyre.position.set(x, 0.5, z);
    car.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.26, 14), m.hub);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(x, 0.5, z);
    car.add(hub);
    // Wheel-arch trim following the tyre crown.
    const arch = new THREE.Mesh(detailed
      ? new THREE.RingGeometry(0.475, 0.575, 24, 1, 0, Math.PI)
      : new THREE.BoxGeometry(0.16, 0.34, 1.18), m.skirt);
    arch.name = 'Citaro wheel arch';
    arch.position.set(x + Math.sign(x) * (detailed ? 0.14 : 0.06), detailed ? 0.5 : 0.86, z);
    if (detailed) arch.rotation.y = Math.sign(x) * Math.PI / 2;
    car.add(arch);
  }
}

function addBusSeating(
  car: THREE.Group,
  m: BusMaterials,
  half: number,
  doorZs: number[],
  cabFront: boolean,
  tail: boolean,
  geometry?: BusSeatGeometry
): void {
  const rowStart = cabFront ? -half + 1.0 : -half + 0.9;
  const rowEnd = tail ? half - 1.2 : half - 0.9;
  for (let z = rowStart; z <= rowEnd; z += 1.1) {
    if (cabFront && z > half - 2.4) continue; // keep the driver bay clear.
    if (doorZs.some((doorZ) => Math.abs(z - doorZ) < 0.66)) continue;
    for (const x of [-0.92, 0.92]) {
      const cushion = new THREE.Mesh(geometry?.cushion ?? new THREE.BoxGeometry(0.46, 0.14, 0.6), m.seat);
      cushion.name = 'Citaro upholstered seat cushion';
      cushion.position.set(x, 1.35, z);
      car.add(cushion);
      // Contoured moquette back with a darker headrest and an aisle grab handle.
      const back = new THREE.Mesh(geometry?.back ?? new THREE.BoxGeometry(0.46, 0.56, 0.11), m.seat);
      back.position.set(x, 1.66, z - 0.29);
      car.add(back);
      const headrest = new THREE.Mesh(geometry?.headrest ?? new THREE.BoxGeometry(0.44, 0.2, 0.1), m.seatBack);
      headrest.position.set(x, 1.98, z - 0.31);
      car.add(headrest);
      if (geometry) {
        const shell = new THREE.Mesh(geometry.shell, m.interior);
        shell.name = 'Citaro molded seat back';
        shell.position.set(x, 1.7, z - 0.375);
        car.add(shell);
      }
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 6, 12), m.grab);
      handle.rotation.x = Math.PI / 2;
      handle.position.set(x - Math.sign(x) * 0.24, 2.02, z - 0.3);
      car.add(handle);
    }
  }
  // Aisle stanchions carry the grab rail; each gets a red stop-request button.
  for (let z = rowStart + 0.5; z < rowEnd; z += 2.4) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.9, 10), m.grab);
    pole.position.set(0.62, 2.0, z);
    car.add(pole);
    const button = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.05), m.stopButton);
    button.position.set(0.7, 1.7, z);
    car.add(button);
  }
}

// Ceiling light strip, longitudinal grab rails with hanging straps and, on the
// front section, the driver seat, wheel and glazed cab partition.
function addBusInteriorFittings(car: THREE.Group, m: BusMaterials, half: number, cabFront: boolean): void {
  const railStart = -half + 0.6;
  const railEnd = cabFront ? half - 2.3 : half - 0.6;
  const railLen = railEnd - railStart;
  const railMid = (railStart + railEnd) / 2;

  // Warm central ceiling light strip (lit by the shared cabin PointLight).
  const lightStrip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, railLen), m.lightStrip);
  lightStrip.position.set(0, 2.94, railMid);
  car.add(lightStrip);

  for (const side of [-1, 1] as const) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, railLen, 10), m.grab);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(side * 0.78, 2.22, railMid);
    car.add(rail);
    // Vertical drops linking the rail to the ceiling, plus hanging hand straps.
    for (let z = railStart + 0.5; z < railEnd; z += 1.5) {
      const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.72, 8), m.grab);
      drop.position.set(side * 0.78, 2.58, z);
      car.add(drop);
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 12), m.driver);
      strap.position.set(side * 0.78, 2.12, z + 0.7);
      car.add(strap);
    }
  }

  if (cabFront) {
    const cabZ = half - 1.5;
    // Glazed partition separating the driver from the saloon.
    const partition = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.06), m.interior);
    partition.position.set(-0.72, 1.95, cabZ - 0.3);
    car.add(partition);
    const partitionGlass = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.04), m.glass);
    partitionGlass.position.set(-0.72, 2.55, cabZ - 0.3);
    car.add(partitionGlass);
    // Driver seat.
    const seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), m.driver);
    seatBase.position.set(0.55, 1.42, cabZ - 0.2);
    car.add(seatBase);
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.12), m.driver);
    seatBack.position.set(0.55, 1.78, cabZ - 0.42);
    car.add(seatBack);
    // Steering wheel raked toward the driver.
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.03, 8, 20), m.driver);
    wheel.rotation.x = 1.15;
    wheel.position.set(0.55, 1.72, cabZ + 0.34);
    car.add(wheel);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), m.driver);
    column.rotation.x = 0.42;
    column.position.set(0.55, 1.55, cabZ + 0.4);
    car.add(column);
  }
}

// Raked Citaro front: windscreen, black mask, destination display, headlight
// clusters (night-switchable), wing mirrors, wipers and a bumper.
function addBusFrontEnd(
  state: BusBuildState,
  car: THREE.Group,
  m: BusMaterials,
  displayMaterial: THREE.Material,
  frontZ: number,
  config: BusBlueprintConfig,
  context: ResolvedVehicleBuildContext
): void {
  state.rig.headLampMaterials.push(m.headlight);

  // Black mask panel wrapping the windscreen and destination display.
  const detailed = config.detailStyle === 'ssb-citaro';
  const mask = new THREE.Mesh(detailed
    ? new RoundedBoxGeometry(2.5, 1.68, 0.1, 2, 0.04)
    : new THREE.BoxGeometry(2.5, 1.9, 0.1), m.black);
  mask.position.set(0, detailed ? 2.45 : 2.62, frontZ + 0.02);
  car.add(mask);
  state.cabShells.push(mask);

  const windscreen = new THREE.Mesh(new THREE.BoxGeometry(2.18, 1.14, 0.06), m.glass);
  windscreen.position.set(0, 2.36, frontZ + 0.08);
  windscreen.rotation.x = -0.08;
  car.add(windscreen);

  // Destination roller-blind display above the windscreen.
  const destination = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 0.4), new THREE.MeshBasicMaterial({
    map: makeLabelTexture(`${context.route.line} ${context.route.destination}`, {
      width: 640,
      height: 128,
      bg: config.destinationDisplay.background,
      fg: config.destinationDisplay.foreground
    }),
    side: THREE.DoubleSide
  }));
  destination.position.set(0, 3.06, frontZ + 0.09);
  car.add(destination);

  // Lower bumper with two headlight clusters and amber indicators.
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.5, 0.24), m.skirt);
  bumper.position.set(0, 0.78, frontZ + 0.02);
  car.add(bumper);
  state.cabShells.push(bumper);
  if (detailed) {
    const badge = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 6, 24), m.hub);
    badge.name = 'Citaro front badge ring';
    badge.position.set(0, 1.45, frontZ + 0.13);
    car.add(badge);
    state.cabShells.push(badge);
    const star = new THREE.InstancedMesh(new THREE.BoxGeometry(0.013, 0.16, 0.014), m.hub, 3);
    star.name = 'Citaro three-point badge';
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < 3; index++) {
      const angle = index * Math.PI * 2 / 3;
      matrix.compose(new THREE.Vector3(Math.sin(angle) * 0.075, 1.45 + Math.cos(angle) * 0.075, frontZ + 0.13),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -angle), new THREE.Vector3(1, 1, 1));
      star.setMatrixAt(index, matrix);
    }
    star.instanceMatrix.needsUpdate = true;
    car.add(star);
    state.cabShells.push(star);
  }
  for (const side of [-1, 1] as const) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.08), m.headlight);
    head.position.set(side * 0.92, 1.02, frontZ + 0.1);
    car.add(head);
    const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.07), m.indicator);
    indicator.position.set(side * 1.16, 1.0, frontZ + 0.08);
    car.add(indicator);
    // Wing mirror on a stalk.
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), m.black);
    stalk.rotation.z = Math.PI / 2;
    stalk.position.set(side * 1.5, 2.66, frontZ - 0.35);
    car.add(stalk);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.24), m.black);
    mirror.position.set(side * 1.76, 2.66, frontZ - 0.35);
    car.add(mirror);
  }
  // Windscreen wiper.
  const wiper = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.04), m.black);
  wiper.position.set(-0.2, 1.86, frontZ + 0.12);
  wiper.rotation.z = 0.32;
  car.add(wiper);

  // Driver dashboard and passenger next-stop display, hidden in cab view.
  const dashboard = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.6, 0.72), m.black);
  dashboard.position.set(0, 1.44, frontZ - 0.62);
  car.add(dashboard);
  const nextStopDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 0.44), displayMaterial);
  nextStopDisplay.position.set(0, 2.74, frontZ - 1.35);
  nextStopDisplay.rotation.y = Math.PI;
  car.add(nextStopDisplay);
  state.cabDisplays.push(nextStopDisplay);
}

// Rear engine bay with tail-light clusters (night-switchable) and a bumper.
function addBusRearEnd(state: BusBuildState, car: THREE.Group, m: BusMaterials, rearZ: number): void {
  state.rig.tailLampMaterials.push(m.tailLamp);

  const engineHatch = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.05, 0.12), m.skirt);
  engineHatch.position.set(0, 1.2, rearZ - 0.02);
  car.add(engineHatch);
  const rearWindow = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 0.06), m.glass);
  rearWindow.position.set(0, 2.5, rearZ - 0.04);
  car.add(rearWindow);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.46, 0.22), m.skirt);
  bumper.position.set(0, 0.72, rearZ - 0.02);
  car.add(bumper);
  for (const side of [-1, 1] as const) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.5, 0.07), m.tailLamp);
    tail.position.set(side * 1.0, 1.02, rearZ - 0.06);
    car.add(tail);
  }
}

// Flat connection ring at an articulation joint; the bellows spans the gap.
function addBusGangwayRing(car: THREE.Group, m: BusMaterials, jointZ: number, sign: 1 | -1): void {
  const ring = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.5, 0.1), m.rubber);
  ring.position.set(0, 1.86, jointZ + sign * 0.02);
  car.add(ring);
  const aperture = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.0, 0.14), m.black);
  aperture.position.set(0, 1.7, jointZ + sign * 0.03);
  car.add(aperture);
}

// Rubber accordion bellows bridging the two articulated sections at the centre
// turntable (z=0). Added to the root so it stays over the bend point.
function addBusBellows(state: BusBuildState, m: BusMaterials): void {
  const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.42, 2.54, 0.72), m.rubber);
  bellows.position.set(0, 1.86, 0);
  bellows.castShadow = true;
  state.root.add(bellows);
  state.passengerShells.push(bellows);
  // Accordion ribs for the folded-rubber look.
  for (const z of [-0.24, 0, 0.24]) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.62, 0.06), m.black);
    rib.position.set(0, 1.86, z);
    state.root.add(rib);
  }
  // Low turntable plate at floor level between the sections.
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.1, 24), m.metal);
  plate.position.set(0, 0.62, 0);
  state.root.add(plate);
}
