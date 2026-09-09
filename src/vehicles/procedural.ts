import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addTangoExteriorDetails } from './tangoDetails';
import { makeSsbSurfaceTexture } from './surfaceTextures';
import { makeLabelTexture } from '../labels';
import type { VehicleKind } from '../domain/transport';
import { buildBusVehicle } from './blueprint/bus/buildBusFromBlueprint';
import { defaultBusBlueprint } from './blueprint/bus/defaultBusBlueprint';
import { buildSBahnVehicle } from './blueprint/sbahn/buildSBahnFromBlueprint';
import { defaultSBahnBlueprint } from './blueprint/sbahn/defaultSBahnBlueprint';
import {
  addCabinLight,
  addExteriorLightThrow,
  addOpaqueTransitInterior,
  addPantograph,
  addSlidingVehicleDoor,
  makeSetExteriorLightsOn,
  type ExteriorLightRig
} from './parts';
import type { ResolvedVehicleBuildContext, VehicleInstance } from './types';

const DOUBLE_FORMATION_LINES = new Set(['U1', 'U6', 'U7', 'U11', 'U12', 'U19']);

// The lower Tango apron bows forward in plan, fading into the flat lamp fascia.
function tangoApronBow(x: number, y: number): number {
  return 0.34 * Math.max(0, 1 - (x / 1.27) ** 2) * (1 - THREE.MathUtils.smoothstep(y, 0.75, 1.05));
}

// Rake of the planar Odessa cab face, in radians. Must stay in sync with the
// front ring of makeOdessaCabNose (0.25 m of setback over 2.0 m of height);
// every front-end trim piece is parented to a group carrying this rotation.
const ODESSA_CAB_FRONT_RAKE = Math.atan(0.125);

// Rake of the planar SkyTrain cab face, in radians. Must stay in sync with the
// front ring of makeSkyTrainNose (0.2 m of setback over 2.16 m of height); the
// window mask and every front-end trim piece parent to a group carrying it.
const SKYTRAIN_CAB_FRONT_RAKE = Math.atan(0.2 / 2.16);

// Rake of the planar VBK tram cab face, in radians. Must stay in sync with the
// front ring of makeKarlsruheTramCabNose (0.26 m of setback over 2.52 m of
// height); the upright screen of the classic Karlsruhe city car.
const KARLSRUHE_TRAM_CAB_FRONT_RAKE = Math.atan(0.26 / 2.52);

// Rake of the planar Citylink cab face, in radians. Must stay in sync with the
// front ring of makeCitylinkCabNose (0.52 m of setback over 2.42 m of height) —
// markedly steeper than the older tram, matching the Stadler front end.
const CITYLINK_CAB_FRONT_RAKE = Math.atan(0.52 / 2.42);

// Rake of the planar Cobra cab face, in radians. Must stay in sync with the
// front ring of makeCobraCabNose (0.3 m of setback over 2.32 m of height). The
// Be 5/6's screen is only lightly laid back; the strong forward impression
// comes from the blue roof cap overhanging it, which is separate geometry.
const COBRA_CAB_FRONT_RAKE = Math.atan(0.3 / 2.32);

// Materials and band placement for a low-floor articulated tram module. The
// module builder is shared by the two Karlsruhe cars and the Zürich Cobra; a
// livery only decides the palette, the band heights and the body width, so the
// cab ends stay the only per-vehicle geometry.
type ModernTramLivery = {
  body: THREE.Material;
  stripe: THREE.Material;
  roof: THREE.Material;
  band: THREE.Material;
  skirt: THREE.Material;
  glass: THREE.MeshStandardMaterial;
  metal: THREE.Material;
  stripeY: number;
  stripeHeightM: number;
  // Optional second side band, e.g. the Cobra's cantrail stripe above the windows.
  accentStripe?: { material: THREE.Material; y: number; heightM: number };
  door?: THREE.Material; // door leaves, when they are not body-coloured

  interior: ModernTramInterior;
};

// Saloon materials. The classic VBK car keeps a warmer, older cabin; the
// Citylink an anthracite/LED one, so both share the builder but not the palette.
type ModernTramInterior = {
  floor: THREE.Material;
  ceiling: THREE.Material;
  wall: THREE.Material;
  seatFabric: THREE.Material;
  seatShell: THREE.Material;
  metal: THREE.Material;
  accent: THREE.Material; // priority grab poles and door-button surrounds
  lightStrip: THREE.Material;
  threshold: THREE.Material; // contrasting door step edge
  seatXs?: number[]; // seat columns; defaults to 2+2 on a 2.65 m body
};

/**
 * Whether a Stadtbahn line runs a coupled double formation (4 Tango sections
 * instead of 2). Exported so other renderers (e.g. the Live 3D view) build the
 * same formation the ride/explore view does, keyed off the GTFS line label.
 */
export function isStadtbahnDoubleFormation(line: string | undefined): boolean {
  return !!line && DOUBLE_FORMATION_LINES.has(line.trim().toUpperCase());
}

class ProceduralTransitVehicleFactory {
  private readonly root = new THREE.Group();
  private readonly cars: THREE.Group[] = [];
  private readonly doors: VehicleInstance['doors'] = [];
  private readonly windowBands: THREE.Mesh[] = [];
  private readonly cabShells: THREE.Mesh[] = [];
  private readonly passengerShells: THREE.Mesh[] = [];
  private readonly cabDisplays: THREE.Mesh[] = [];
  private readonly headLampMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly tailLampMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly headlightBeams: THREE.SpotLight[] = [];
  private readonly tailGlows: THREE.PointLight[] = [];
  private readonly cabinLights: THREE.PointLight[] = [];
  private glassMaterial?: THREE.MeshStandardMaterial;
  private trainHalfLengthM = 20.15;

  constructor(private readonly context: ResolvedVehicleBuildContext) {}

  build(): VehicleInstance {
    const cityId = this.context.city?.id;
    const modeId = this.context.modeDefinition?.id;
    const vehicleKind = this.context.modeDefinition?.vehicleKind ?? 'stadtbahn';

    if (cityId === 'odessa' && modeId === 'tram') this.createOdessaTramVehicle();
    else if (cityId === 'lviv' && modeId === 'tram') this.createOdessaTramVehicle(); // Ukrainian tram stand-in; shares 3-section layout.
    else if (cityId === 'ulm' && modeId === 'tram') this.createUlmTramVehicle();
    else if (cityId === 'zurich' && modeId === 'tram') this.createZurichTramVehicle();
    else if (cityId === 'freiburg' && modeId === 'tram') this.createFreiburgTramVehicle();
    else if (cityId === 'freiburg' && modeId === 's-bahn') this.createBwegtRegionalRailVehicle();
    else if (cityId === 'baden-wuerttemberg-rail' && modeId === 'rail') this.createBwegtRegionalRailVehicle();
    else if (vehicleKind === 'bus') return this.createBusVehicle();
    else if (vehicleKind === 's-bahn') return this.createSBahnVehicle();
    else if (vehicleKind === 'skytrain') return this.createSkyTrainVehicle();
    else if (vehicleKind === 'zacke') this.createZackeVehicle();
    else if (vehicleKind === 'schwebebahn') this.createSchwebebahnVehicle();
    else if (vehicleKind === 'seilbahn') this.createSeilbahnVehicle();
    else if (vehicleKind === 'ferry') this.createFerryVehicle();
    else this.createStadtbahnVehicle();

    return this.createVehicleInstance();
  }

  private createVehicleInstance(): VehicleInstance {
    return {
      root: this.root,
      cars: this.cars,
      doors: this.doors,
      windowBands: this.windowBands,
      cabShells: this.cabShells,
      passengerShells: this.passengerShells,
      cabDisplays: this.cabDisplays,
      glassMaterial: this.glassMaterial,
      trainHalfLengthM: this.trainHalfLengthM,
      setExteriorLightsOn: makeSetExteriorLightsOn(this.lightRig)
    };
  }

  private get lightRig(): ExteriorLightRig {
    return {
      headLampMaterials: this.headLampMaterials,
      tailLampMaterials: this.tailLampMaterials,
      headlightBeams: this.headlightBeams,
      tailGlows: this.tailGlows,
      cabinLights: this.cabinLights
    };
  }

  // Mercedes-Benz Citaro city bus. Rendering is blueprint-driven (see
  // blueprint/bus/); this stays as the procedural fallback entry point and
  // simply builds the default SSB/VVS config.
  createBusVehicle(): VehicleInstance {
    return buildBusVehicle(defaultBusBlueprint, this.context);
  }

  // DB BR 430 S-Bahn. Rendering is blueprint-driven (see blueprint/sbahn/);
  // this stays as the procedural fallback entry point and simply builds the
  // default DB BR 430 config.
  createSBahnVehicle(): VehicleInstance {
    return buildSBahnVehicle(defaultSBahnBlueprint, this.context);
  }

  createBwegtRegionalRailVehicle(): VehicleInstance {
    const shell = new THREE.MeshStandardMaterial({ color: 0xf1f2ec, roughness: 0.42, metalness: 0.08 });
    const bwegtYellow = new THREE.MeshStandardMaterial({ color: 0xf2d21b, roughness: 0.38, metalness: 0.06 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1f2327, roughness: 0.28, metalness: 0.22 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x95becb, transparent: true, opacity: 0.42, roughness: 0.06, side: THREE.DoubleSide });
    const interior = new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: 0.86 });
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, map: this.makeBwegtFloorTexture() });
    const aisleMaterial = new THREE.MeshStandardMaterial({ color: 0xa8acab, roughness: 0.94 });
    const vestibuleFloor = new THREE.MeshStandardMaterial({ color: 0x34393b, roughness: 0.9 });
    const seat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, map: this.makeBwegtSeatFabricTexture() });
    const seatShell = new THREE.MeshStandardMaterial({ color: 0x3b4043, roughness: 0.6, metalness: 0.12 });
    const seatTrim = new THREE.MeshStandardMaterial({ color: 0xc5cbca, roughness: 0.42, metalness: 0.38 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9a9fa1, roughness: 0.34, metalness: 0.72 });
    const headlight = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff5d2, emissiveIntensity: 0.55, roughness: 0.22 });
    const tailLamp = new THREE.MeshStandardMaterial({ color: 0x8d201d, emissive: 0x7a1512, emissiveIntensity: 0.35, roughness: 0.32 });
    const ceilingLight = new THREE.MeshStandardMaterial({ color: 0xfffdf2, emissive: 0xfffae1, emissiveIntensity: 0.8, roughness: 0.35 });
    const displayHousing = new THREE.MeshStandardMaterial({ color: 0x20262a, roughness: 0.34, metalness: 0.26 });
    const displayMaterial = this.context.makeInteriorDisplayMaterial();
    this.glassMaterial = glass;
    this.headLampMaterials.push(headlight);
    this.tailLampMaterials.push(tailLamp);

    const centers = [-18.9, -6.3, 6.3, 18.9];
    centers.forEach((center, index) => {
      const car = new THREE.Group();
      car.name = `Articulated car bwegt regional train section ${index + 1}`;
      car.userData.centerOffsetM = center;

      const body = new THREE.Mesh(this.makeBwegtRegionalBody(12.15), shell);
      body.castShadow = true;
      car.add(body);
      this.passengerShells.push(body);

      const lowerSkirt = new THREE.Mesh(new THREE.BoxGeometry(3.02, 0.32, 12.2), dark);
      lowerSkirt.position.y = 0.62;
      car.add(lowerSkirt);
      this.passengerShells.push(lowerSkirt);

      const yellowRoofStripe = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 12.04), bwegtYellow);
      yellowRoofStripe.position.y = 3.25;
      car.add(yellowRoofStripe);
      this.passengerShells.push(yellowRoofStripe);

      const roofEquipment = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.16, 3.2), dark);
      roofEquipment.position.set(0, 3.78, index % 2 === 0 ? 1.0 : -1.0);
      car.add(roofEquipment);
      for (let slat = -4; slat <= 4; slat++) {
        const grille = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.022, 0.055), metal);
        grille.position.set(0, 3.88, roofEquipment.position.z + slat * 0.3);
        car.add(grille);
      }

      for (const side of [-1, 1] as const) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.14, 10.8), dark);
        band.position.set(side * 1.515, 2.42, 0);
        car.add(band);
        this.windowBands.push(band);
        for (const z of [-4.55, -3.0, -0.95, 0.95, 3.0, 4.55]) {
          const window = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.92, 1.22), glass);
          window.position.set(side * 1.53, 2.42, z);
          car.add(window);
        }
        this.addSlidingVehicleDoor(car, side * 1.53, -1.95, bwegtYellow, glass, dark, 1.72, 2.05);
        this.addSlidingVehicleDoor(car, side * 1.53, 1.95, bwegtYellow, glass, dark, 1.72, 2.05);
        const livery = new THREE.Mesh(
          new THREE.PlaneGeometry(1.25, 0.35),
          new THREE.MeshBasicMaterial({ map: makeLabelTexture('bwegt', { width: 384, height: 108, bg: '#f1f2ec', fg: '#30363b' }), side: THREE.DoubleSide })
        );
        livery.position.set(side * 1.535, 1.28, index % 2 === 0 ? -4.45 : 4.45);
        livery.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        car.add(livery);
      }

      if (index === 0 || index === centers.length - 1) {
        const cabEnd = (index === 0 ? -1 : 1) as -1 | 1;
        const nose = new THREE.Mesh(this.makeBwegtRegionalCabNose(), shell);
        nose.position.z = cabEnd * 6.02;
        if (cabEnd < 0) nose.rotation.y = Math.PI;
        car.add(nose);
        this.cabShells.push(nose);

        const face = new THREE.Mesh(new THREE.BoxGeometry(2.58, 1.15, 0.12), dark);
        face.position.set(0, 2.72, cabEnd * 7.26);
        car.add(face);
        this.cabShells.push(face);

        const windscreen = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.94), glass);
        windscreen.position.set(0, 2.75, cabEnd * 7.33);
        if (cabEnd < 0) windscreen.rotation.y = Math.PI;
        car.add(windscreen);

        const yellowBrow = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.48, 0.13), bwegtYellow);
        yellowBrow.position.set(0, 3.34, cabEnd * 7.12);
        car.add(yellowBrow);
        this.cabShells.push(yellowBrow);

        const lowerMask = new THREE.Mesh(new THREE.BoxGeometry(2.54, 0.46, 0.24), dark);
        lowerMask.position.set(0, 1.0, cabEnd * 7.26);
        car.add(lowerMask);
        this.cabShells.push(lowerMask);

        for (const side of [-1, 1] as const) {
          const lampHousing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.08), dark);
          lampHousing.position.set(side * 0.98, 1.78, cabEnd * 7.36);
          car.add(lampHousing);
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.075, 0.045), headlight);
          lamp.position.set(side * 0.98, 1.78, cabEnd * 7.415);
          car.add(lamp);
          const tail = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.075, 0.05), tailLamp);
          tail.position.set(side * 0.72, 1.78, cabEnd * 7.42);
          car.add(tail);
        }

        const couplerShroud = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.52, 0.36), dark);
        couplerShroud.position.set(0, 0.75, cabEnd * 7.3);
        car.add(couplerShroud);
        const coupler = this.makeCoupler();
        coupler.position.set(0, 0.78, cabEnd * 7.38);
        if (cabEnd > 0) coupler.rotation.y = Math.PI;
        car.add(coupler);

        const display = new THREE.Mesh(new THREE.PlaneGeometry(1.98, 0.4), new THREE.MeshBasicMaterial({
          map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 700, height: 128, bg: '#111', fg: '#f2d21b' }),
          side: THREE.DoubleSide
        }));
        display.position.set(0, 3.34, cabEnd * 7.41);
        if (cabEnd < 0) display.rotation.y = Math.PI;
        car.add(display);
      }

      const floor = new THREE.Mesh(new THREE.BoxGeometry(2.92, 0.12, 11.55), floorMaterial);
      floor.position.y = 1.12;
      car.add(floor);
      const aisle = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.018, 11.32), aisleMaterial);
      aisle.position.y = 1.19;
      car.add(aisle);
      for (const z of [-1.95, 1.95]) {
        const vestibule = new THREE.Mesh(new THREE.BoxGeometry(2.76, 0.022, 1.68), vestibuleFloor);
        vestibule.position.set(0, 1.2, z);
        car.add(vestibule);
      }
      const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.08, 11.35), interior);
      ceiling.position.y = 3.28;
      car.add(ceiling);
      this.addOpaqueTransitInterior(car, 11.35, 1.34, interior, () => [-1.95, 1.95]);
      this.addBwegtRegionalCeiling(car, ceilingLight, seatTrim);
      this.addBwegtRegionalVestibules(car, bwegtYellow, displayHousing, glass, metal);
      this.addBwegtRegionalLuggageRacks(car, metal, seatTrim);

      [-4.2, -2.65, 0, 2.65, 4.2].forEach((z, rowIndex) => {
        const facing = rowIndex % 2 === 0 ? 1 : -1;
        for (const x of [-0.98, -0.56, 0.56, 0.98]) {
          this.addBwegtRegionalSeat(car, x, z, facing, seat, seatShell, seatTrim);
        }
      });

      for (const z of [-1.95, 1.95]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.0, 8), metal);
        pole.position.set(0, 2.08, z);
        car.add(pole);
      }

      const monitorHousing = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.64, 0.12), displayHousing);
      monitorHousing.position.set(0, 2.92, 0.13);
      car.add(monitorHousing);
      const monitor = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5), displayMaterial);
      monitor.position.set(0, 2.92, 0.062);
      monitor.rotation.y = Math.PI;
      monitor.renderOrder = 18;
      car.add(monitor);
      const forwardMonitor = monitor.clone();
      forwardMonitor.position.z = 0.198;
      forwardMonitor.rotation.y = 0;
      car.add(forwardMonitor);
      const monitorBracket = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.24, 8), metal);
      monitorBracket.position.set(0, 3.16, 0.13);
      car.add(monitorBracket);

      for (const z of [-3.95, 3.95]) {
        this.addBwegtRegionalBogie(car, z, dark, metal);
      }

      this.cars.push(car);
      this.root.add(car);
    });

    this.trainHalfLengthM = 26.45;
    this.addPantograph(new THREE.Vector3(0, 3.82, 6.6), dark);
    addExteriorLightThrow(this.root, this.lightRig, this.trainHalfLengthM, 1.72);
    return this.createVehicleInstance();
  }

  private addBwegtRegionalSeat(
    car: THREE.Group,
    x: number,
    z: number,
    facing: -1 | 1,
    fabric: THREE.Material,
    shell: THREE.Material,
    trim: THREE.Material
  ): void {
    const seat = new THREE.Group();
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.39, 0.13, 0.54), fabric);
    cushion.position.set(0, 1.36, 0);
    seat.add(cushion);

    const backShell = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.7, 0.07), shell);
    backShell.position.set(0, 1.72, -facing * 0.29);
    seat.add(backShell);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.58, 0.075), fabric);
    back.position.set(0, 1.7, -facing * 0.335);
    seat.add(back);
    const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.1), shell);
    headrest.position.set(0, 2.06, -facing * 0.31);
    seat.add(headrest);

    for (const side of [-1, 1] as const) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.6, 0.57), trim);
      edge.position.set(side * 0.215, 1.68, -facing * 0.02);
      seat.add(edge);
    }
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.22), shell);
    pedestal.position.set(0, 1.2, 0);
    seat.add(pedestal);
    seat.position.set(x, 0, z);
    car.add(seat);
  }

  private addBwegtRegionalCeiling(car: THREE.Group, light: THREE.Material, trim: THREE.Material): void {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.026, 10.84), trim);
    vent.position.set(0, 3.23, 0);
    car.add(vent);
    for (const x of [-0.82, 0.82]) {
      const lightStrip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 10.84), light);
      lightStrip.position.set(x, 3.24, 0);
      car.add(lightStrip);
    }
    for (let z = -5.05; z <= 5.05; z += 0.34) {
      const grille = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.014, 0.04), trim);
      grille.position.set(0, 3.208, z);
      car.add(grille);
    }
  }

  private addBwegtRegionalVestibules(
    car: THREE.Group,
    yellow: THREE.Material,
    dark: THREE.Material,
    glass: THREE.Material,
    metal: THREE.Material
  ): void {
    for (const doorZ of [-1.95, 1.95]) {
      for (const side of [-1, 1] as const) {
        const partition = new THREE.Mesh(new THREE.BoxGeometry(0.025, 1.62, 0.58), glass);
        partition.position.set(side * 1.16, 2.0, doorZ - 0.62);
        car.add(partition);
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.82, 0.16), dark);
        panel.position.set(side * 1.19, 2.02, doorZ + 0.62);
        car.add(panel);
        const yellowPost = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.8, 0.08), yellow);
        yellowPost.position.set(side * 1.17, 2.02, doorZ + 0.52);
        car.add(yellowPost);
        const handrail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.52, 8), metal);
        handrail.position.set(side * 1.09, 2.0, doorZ - 0.66);
        car.add(handrail);
      }
      const secondClass = new THREE.Mesh(
        new THREE.PlaneGeometry(0.34, 0.3),
        new THREE.MeshBasicMaterial({ map: makeLabelTexture('2', { width: 96, height: 96, bg: '#f2d21b', fg: '#202428' }), side: THREE.DoubleSide })
      );
      secondClass.position.set(0.76, 2.84, doorZ + 0.7);
      secondClass.rotation.y = Math.PI;
      car.add(secondClass);
    }
  }

  private addBwegtRegionalLuggageRacks(car: THREE.Group, metal: THREE.Material, trim: THREE.Material): void {
    for (const side of [-1, 1] as const) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 10.4), trim);
      shelf.position.set(side * 1.12, 2.88, 0);
      car.add(shelf);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.2, 10.2), metal);
      guard.position.set(side * 0.94, 3.0, 0);
      car.add(guard);
      for (let z = -4.8; z <= 4.8; z += 1.2) {
        this.addBwegtRailBetween(
          car,
          new THREE.Vector3(side * 1.34, 2.55, z),
          new THREE.Vector3(side * 0.98, 2.97, z),
          metal
        );
      }
    }
  }

  private addBwegtRailBetween(car: THREE.Group, start: THREE.Vector3, end: THREE.Vector3, material: THREE.Material): void {
    const direction = end.clone().sub(start);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, direction.length(), 8), material);
    rail.position.copy(start).add(end).multiplyScalar(0.5);
    rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    car.add(rail);
  }

  private makeBwegtSeatFabricTexture(): THREE.DataTexture {
    const size = 32;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = (y * size + x) * 4;
        const stripe = y % 8 === 2;
        const motif = (x % 16 === 4 || x % 16 === 5 || x % 16 === 9) && (y % 16 === 10 || y % 16 === 11);
        const fleck = (x * 13 + y * 7) % 19 === 0;
        const tone = stripe ? 98 : fleck ? 72 : 48;
        pixels[index] = motif ? 242 : tone;
        pixels[index + 1] = motif ? 210 : tone + 2;
        pixels[index + 2] = motif ? 27 : tone + 5;
        pixels[index + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 6);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  private makeBwegtFloorTexture(): THREE.DataTexture {
    const size = 32;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = (y * 32 + x) * 4;
        const seed = (x * 19 + y * 23 + x * y * 3) % 31;
        const tone = seed < 3 ? 168 : seed > 27 ? 228 : 201;
        pixels[index] = tone;
        pixels[index + 1] = tone + 2;
        pixels[index + 2] = tone + 1;
        pixels[index + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 22);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  private makeBwegtRegionalBody(lengthM: number): THREE.ExtrudeGeometry {
    const crossSection = new THREE.Shape();
    crossSection.moveTo(-1.5, 0.46);
    crossSection.lineTo(1.5, 0.46);
    crossSection.lineTo(1.5, 2.95);
    crossSection.quadraticCurveTo(1.48, 3.22, 1.28, 3.45);
    crossSection.quadraticCurveTo(1.02, 3.68, 0.54, 3.72);
    crossSection.lineTo(-0.54, 3.72);
    crossSection.quadraticCurveTo(-1.02, 3.68, -1.28, 3.45);
    crossSection.quadraticCurveTo(-1.48, 3.22, -1.5, 2.95);
    crossSection.closePath();
    const geometry = new THREE.ExtrudeGeometry(crossSection, {
      depth: lengthM,
      bevelEnabled: true,
      bevelSize: 0.03,
      bevelThickness: 0.03,
      bevelSegments: 2,
      curveSegments: 8
    });
    geometry.translate(0, 0, -lengthM / 2);
    return geometry;
  }

  private makeBwegtRegionalCabNose(): THREE.ExtrudeGeometry {
    const profile = new THREE.Shape();
    profile.moveTo(0, 0.46);
    profile.lineTo(0.5, 0.46);
    profile.lineTo(0.96, 0.7);
    profile.quadraticCurveTo(1.25, 0.98, 1.34, 1.48);
    profile.lineTo(1.4, 2.58);
    profile.quadraticCurveTo(1.38, 3.13, 1.08, 3.43);
    profile.quadraticCurveTo(0.76, 3.7, 0.26, 3.73);
    profile.lineTo(0, 3.73);
    profile.closePath();
    const geometry = new THREE.ExtrudeGeometry(profile, {
      depth: 2.9,
      bevelEnabled: true,
      bevelSize: 0.06,
      bevelThickness: 0.06,
      bevelSegments: 3,
      curveSegments: 8
    });
    geometry.translate(0, 0, -1.45);
    geometry.rotateY(-Math.PI / 2);
    return geometry;
  }

  private addBwegtRegionalBogie(car: THREE.Group, z: number, dark: THREE.Material, metal: THREE.Material): void {
    const bogie = new THREE.Group();
    bogie.position.z = z;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.58, 0.28, 1.7), dark);
    frame.position.y = 0.58;
    bogie.add(frame);
    const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 0.26), metal);
    crossBeam.position.set(0, 0.76, 0);
    bogie.add(crossBeam);
    for (const axleZ of [-0.52, 0.52]) {
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.36, 10), metal);
      axle.rotation.z = Math.PI / 2;
      axle.position.set(0, 0.42, axleZ);
      bogie.add(axle);
      for (const side of [-1, 1] as const) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.13, 16), dark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * 1.18, 0.42, axleZ);
        bogie.add(wheel);
      }
    }
    car.add(bogie);
  }

  // Stuttgart Zahnradbahn ("Zacke") rack railcar, styled after the DT8 Stadtbahn:
  // the same Tango body profile, raked nose, black cab mask and corner light
  // clusters, on its own rack-drive underframe with cabs at both ends.
  createZackeVehicle(): VehicleInstance {
    const bodyLen = 14.8;
    const bodyHalf = bodyLen / 2;
    const car = new THREE.Group();
    car.name = 'Rack railcar SSB ZT 4';
    car.userData.centerOffsetM = 0;

    const yellow = new THREE.MeshStandardMaterial({ color: 0xffdf00, roughness: 0.52, metalness: 0.05 });
    const black = new THREE.MeshStandardMaterial({ color: 0x17232b, roughness: 0.38 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x91c7dd, roughness: 0.08, metalness: 0.02, transparent: true, opacity: 0.58, depthWrite: true, side: THREE.DoubleSide });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xbfc1bd, roughness: 0.64, metalness: 0.12 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xf6c900, roughness: 0.48 });
    const interiorWall = new THREE.MeshStandardMaterial({ color: 0xd9d5ca, roughness: 0.88 });
    const interiorFloor = new THREE.MeshStandardMaterial({ color: 0x606565, roughness: 0.94 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a8f91, roughness: 0.4, metalness: 0.65 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x416b80, roughness: 0.9 });
    const lightStrip = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff2d2, emissiveIntensity: 0.85 });
    const headlightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4c7, emissiveIntensity: 0.55 });
    const indicatorMat = new THREE.MeshStandardMaterial({ color: 0xffb340, emissive: 0xff9d1e, emissiveIntensity: 1.4 });
    const tailLampMat = new THREE.MeshStandardMaterial({ color: 0x8c1f1c, emissive: 0x7a1512, emissiveIntensity: 0.35 });
    const lampHousingMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.34, metalness: 0.4 });
    this.glassMaterial = glass;
    this.headLampMaterials.push(headlightMat);
    this.tailLampMaterials.push(tailLampMat);

    // DT8-profile shell: black lower skirt, Tango cross-section body, light grey
    // roof deck with yellow side fairings and a slatted HVAC pod.
    const lowerSkirt = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.24, bodyLen - 0.5), black);
    lowerSkirt.position.y = 0.43;
    lowerSkirt.castShadow = true;
    car.add(lowerSkirt);
    const body = new THREE.Mesh(this.makeTangoBody(bodyLen), yellow);
    body.position.y = 0.52;
    body.castShadow = true;
    car.add(body);
    this.passengerShells.push(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.24, bodyLen - 1.4), roofMat);
    roof.position.y = 3.34;
    roof.castShadow = true;
    car.add(roof);
    for (const side of [-1, 1]) {
      const roofFairing = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.36, bodyLen - 1.8), yellow);
      roofFairing.position.set(side * 1.12, 3.36, 0);
      car.add(roofFairing);
    }
    const hvac = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.24, 2.25), roofMat);
    hvac.position.set(0, 3.57, -2.6);
    car.add(hvac);
    for (let vent = -2; vent <= 2; vent++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.03, 0.07), black);
      slat.position.set(0, 3.7, -2.6 + vent * 0.28);
      car.add(slat);
    }

    const doorZs = [-3.7, 3.7];
    for (const side of [-1, 1] as const) {
      // Window band sweeps the full body side, DT8-style, with a separate cab
      // side window near each end and door jambs/headers framing the openings.
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.08, bodyLen - 1.0), black);
      band.position.set(side * 1.345, 2.31, 0);
      car.add(band);
      this.windowBands.push(band);
      for (const z of [-5.9, -4.9, -1.55, 0, 1.55, 4.9, 5.9]) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.8, 0.95), glass);
        window.position.set(side * 1.365, 2.26, z);
        car.add(window);
      }
      for (const end of [-1, 1] as const) {
        const cabSideWindow = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.82, 0.9), glass);
        cabSideWindow.position.set(side * 1.36, 2.3, end * (bodyHalf - 0.75));
        car.add(cabSideWindow);
      }
      for (const z of doorZs) {
        for (const edge of [-1, 1]) {
          const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.11, 2.03, 0.09), black);
          jamb.position.set(side * 1.38, 1.69, z + edge * 0.765);
          car.add(jamb);
        }
        const doorHeader = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 1.62), black);
        doorHeader.position.set(side * 1.38, 2.67, z);
        car.add(doorHeader);
        this.addSlidingVehicleDoor(car, side * 1.34, z, doorMat, glass, black, 1.5, 1.95);
      }
    }

    // Both ends carry the raked Tango cab: profile-extruded nose, tilted black
    // mask and windscreen, wiper, bumper and DT8 round corner light clusters.
    const noseTilt = 0.258;
    const destinationMaterial = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 512, height: 128, bg: '#111', fg: '#ffd900' }),
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });
    for (const end of [-1, 1] as const) {
      const faceTilt = -end * noseTilt;
      const nose = new THREE.Mesh(this.makeTangoNose(), yellow);
      nose.position.z = end * (bodyHalf - 0.07);
      if (end < 0) nose.rotation.y = Math.PI;
      nose.castShadow = true;
      car.add(nose);
      this.cabShells.push(nose);

      const cabMask = new THREE.Mesh(this.makeTangoCabMask(), black);
      cabMask.position.set(0, 2.14, end * (bodyHalf + 0.74));
      cabMask.rotation.x = faceTilt;
      car.add(cabMask);
      this.cabShells.push(cabMask);

      const windscreen = new THREE.Mesh(this.makeTangoWindscreen(), glass);
      windscreen.position.set(0, 2.16, end * (bodyHalf + 0.8));
      windscreen.rotation.x = faceTilt;
      car.add(windscreen);

      const wiper = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.8, 0.03), black);
      wiper.position.set(-0.3, 1.78, end * (bodyHalf + 0.88));
      wiper.rotation.set(faceTilt, 0, end * 0.5);
      car.add(wiper);
      this.cabShells.push(wiper);

      const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.24, 0.14), black);
      bumper.position.set(0, 0.5, end * (bodyHalf + 0.94));
      car.add(bumper);
      this.cabShells.push(bumper);

      for (const x of [-1, 1] as const) {
        const housing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.08), lampHousingMat);
        housing.position.set(x * 0.82, 1.0, end * (bodyHalf + 0.94));
        car.add(housing);
        this.cabShells.push(housing);
        const headlight = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 18), headlightMat);
        headlight.rotation.x = Math.PI / 2;
        headlight.position.set(x * 0.72, 1.08, end * (bodyHalf + 0.97));
        car.add(headlight);
        const indicator = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.055, 14), indicatorMat);
        indicator.rotation.x = Math.PI / 2;
        indicator.position.set(x * 0.95, 1.08, end * (bodyHalf + 0.97));
        car.add(indicator);
        const tailLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.055, 14), tailLampMat);
        tailLamp.rotation.x = Math.PI / 2;
        tailLamp.position.set(x * 0.84, 0.86, end * (bodyHalf + 0.97));
        car.add(tailLamp);
        this.cabShells.push(headlight, indicator, tailLamp);
      }

      // Route display recessed in the mask band above the windscreen, tilted with
      // the nose rake exactly like the Stadtbahn cab display.
      const assembly = new THREE.Group();
      assembly.position.set(0, 2.72, end * (bodyHalf + 0.68));
      assembly.rotation.y = end < 0 ? Math.PI : 0;
      const tilted = new THREE.Group();
      tilted.rotation.x = -noseTilt;
      assembly.add(tilted);
      const recess = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.4, 0.03), black);
      tilted.add(recess);
      const display = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.3), destinationMaterial);
      display.position.z = 0.025;
      display.renderOrder = 20;
      tilted.add(display);
      car.add(assembly);
      this.cabShells.push(recess);
      this.cabDisplays.push(display);

      // Rear-view mirrors and SSB front markings, as on the DT8 face.
      for (const side of [-1, 1] as const) {
        const mirrorArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.05), black);
        mirrorArm.position.set(side * 1.38, 2.6, end * (bodyHalf - 0.3));
        car.add(mirrorArm);
        const mirrorHead = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.17), black);
        mirrorHead.position.set(side * 1.48, 2.55, end * (bodyHalf - 0.3));
        car.add(mirrorHead);
      }
      const frontLogo = new THREE.Mesh(
        new THREE.PlaneGeometry(0.58, 0.22),
        new THREE.MeshBasicMaterial({ map: makeLabelTexture('SSB', { width: 288, height: 96, bg: '#ffdf00', fg: '#ffffff' }), side: THREE.DoubleSide })
      );
      frontLogo.position.set(-0.55, 1.36, end * (bodyHalf + 0.94));
      if (end < 0) frontLogo.rotation.y = Math.PI;
      car.add(frontLogo);
      this.cabShells.push(frontLogo);
      const cabNumber = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, 0.1),
        new THREE.MeshBasicMaterial({
          map: makeLabelTexture(end < 0 ? '1001' : '1002', { width: 192, height: 64, bg: '#ffdf00', fg: '#17232b' }),
          side: THREE.DoubleSide
        })
      );
      cabNumber.position.set(0.62, 1.36, end * (bodyHalf + 0.94));
      if (end < 0) cabNumber.rotation.y = Math.PI;
      car.add(cabNumber);
      this.cabShells.push(cabNumber);
    }

    // Rack-drive underframe: two rail bogies and a central toothed pinion — the
    // defining feature of a cog railway — inside a gearbox housing.
    for (const z of [-(bodyHalf - 1.9), bodyHalf - 1.9]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.38, 1.85), black);
      bogie.position.set(0, 0.43, z);
      car.add(bogie);
      for (const wz of [z - 0.58, z + 0.58]) {
        for (const wx of [-0.92, 0.92]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.2, 24), black);
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(wx, 0.37, wz);
          car.add(wheel);
        }
      }
    }
    const gearbox = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.0), black);
    gearbox.position.set(0, 0.42, 0);
    car.add(gearbox);
    const pinionHub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 18), metal);
    pinionHub.rotation.z = Math.PI / 2;
    pinionHub.position.set(0, 0.24, 0);
    car.add(pinionHub);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.14), metal);
      tooth.position.set(0, 0.24 + Math.sin(a) * 0.34, Math.cos(a) * 0.34);
      car.add(tooth);
    }

    // Interior: floor, ceiling, walls, DT8-blue transverse seating and metal rails.
    const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.08, bodyLen - 1.6), interiorFloor);
    floorMesh.position.y = 1.02;
    car.add(floorMesh);
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.08, bodyLen - 1.8), interiorWall);
    ceiling.position.y = 3.14;
    car.add(ceiling);
    this.addOpaqueTransitInterior(car, bodyLen - 1.8, 1.2, interiorWall, (side) => side < 0 ? doorZs : []);

    const seatEnd = bodyHalf - 1.9;
    for (let z = -seatEnd; z <= seatEnd; z += 1.35) {
      if (doorZs.some((d) => Math.abs(z - d) < 0.8)) continue;
      for (const x of [-0.94, -0.54, 0.54, 0.94]) {
        const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.13, 0.5), seat);
        cushion.position.set(x, 1.35, z);
        car.add(cushion);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.62, 0.1), seat);
        back.position.set(x, 1.68, z - 0.24);
        car.add(back);
      }
    }
    const lit = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, bodyLen - 2.6), lightStrip);
    lit.position.set(0, 3.08, 0);
    car.add(lit);
    for (const side of [-1, 1] as const) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, bodyLen - 2.8, 8), metal);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(side * 0.95, 2.88, 0);
      car.add(rail);
    }
    for (const z of [-3.7, 0, 3.7]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.9, 8), metal);
      pole.position.set(0, 2.06, z);
      car.add(pole);
    }
    const monitor = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.44), this.context.makeInteriorDisplayMaterial());
    monitor.position.set(0, 2.88, 0.1);
    monitor.rotation.y = Math.PI;
    monitor.renderOrder = 18;
    car.add(monitor);

    this.addPantograph(new THREE.Vector3(0, 3.6, 2.6), metal);

    this.addCabinLight(car, 2.95, -4.4);
    this.addCabinLight(car, 2.95, 4.4);
    this.trainHalfLengthM = bodyHalf + 1.05;
    this.cars.push(car);
    this.root.add(car);
    this.addExteriorLightThrow(this.trainHalfLengthM, 1.35);
    return this.createVehicleInstance();
  }

  createSchwebebahnVehicle(): VehicleInstance {
    const shell = new THREE.MeshStandardMaterial({ color: 0xeaf3f6, roughness: 0.34, metalness: 0.08 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x61c7d9, roughness: 0.32, metalness: 0.06 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x26323a, roughness: 0.32 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xaed6e2, transparent: true, opacity: 0.42, roughness: 0.06, side: THREE.DoubleSide });
    const interior = new THREE.MeshStandardMaterial({ color: 0xe6e5dc, roughness: 0.9 });
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x8d9499, roughness: 0.94 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x2f6d8b, roughness: 0.84 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a3, roughness: 0.36, metalness: 0.72 });
    const displayMaterial = this.context.makeInteriorDisplayMaterial();
    this.glassMaterial = glass;

    const centers = [-8.8, 8.8];
    centers.forEach((center, index) => {
      const car = new THREE.Group();
      car.name = `Suspended car GTW 15 section ${index + 1}`;
      car.userData.centerOffsetM = center;
      car.userData.passengerCameraLocal = [0.12, 1.98, -4.9];
      car.userData.passengerLookAtLocal = [0, 1.9, 6.8];

      const body = new THREE.Mesh(new THREE.BoxGeometry(2.65, 2.55, 15.9), shell);
      body.position.y = 1.52;
      body.castShadow = true;
      car.add(body);
      this.passengerShells.push(body);

      const accentBand = new THREE.Mesh(new THREE.BoxGeometry(2.72, 0.28, 16.0), accent);
      accentBand.position.y = 0.55;
      car.add(accentBand);
      this.passengerShells.push(accentBand);

      const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.22, 15.7), dark);
      skirt.position.y = 0.32;
      car.add(skirt);
      this.passengerShells.push(skirt);

      const hangerFrame = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.26, 6.2), dark);
      hangerFrame.position.set(0, 3.05, 0);
      car.add(hangerFrame);
      for (const z of [-2.6, 2.6]) {
        const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.1, 0.14), metal);
        hanger.position.set(0, 2.12, z);
        car.add(hanger);
      }
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.26, 4.4), dark);
      bogie.position.set(0, 4.15, 0);
      car.add(bogie);

      for (const side of [-1, 1]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.05, 14.2), dark);
        band.position.set(side * 1.36, 1.95, 0);
        car.add(band);
        this.windowBands.push(band);
        for (const z of [-5.8, -3.9, -1.3, 1.3, 3.9, 5.8]) {
          const window = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.88, 1.25), glass);
          window.position.set(side * 1.39, 1.95, z);
          car.add(window);
        }
        this.addSlidingVehicleDoor(car, side * 1.39, -2.6, accent, glass, dark, 1.38, 1.9);
        this.addSlidingVehicleDoor(car, side * 1.39, 2.6, accent, glass, dark, 1.38, 1.9);
      }

      const windscreen = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.0, 0.08), glass);
      windscreen.position.set(0, 1.95, 8.02);
      car.add(windscreen);
      const rearWindow = windscreen.clone();
      rearWindow.position.z = -8.02;
      car.add(rearWindow);

      const nose = new THREE.Mesh(new THREE.BoxGeometry(2.28, 2.28, 0.18), accent);
      nose.position.set(0, 1.5, 8.1);
      car.add(nose);
      this.cabShells.push(nose);
      const tail = nose.clone();
      tail.position.z = -8.1;
      car.add(tail);
      this.cabShells.push(tail);

      const frontDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.72, 0.38), new THREE.MeshBasicMaterial({
        map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 640, height: 128, bg: '#111', fg: '#ffffff' }),
        side: THREE.DoubleSide
      }));
      frontDisplay.position.set(0, 2.48, 8.18);
      car.add(frontDisplay);
      const rearDisplay = frontDisplay.clone();
      rearDisplay.position.z = -8.18;
      rearDisplay.rotation.y = Math.PI;
      car.add(rearDisplay);

      const floor = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 15.2), floorMaterial);
      floor.position.y = 0.72;
      car.add(floor);
      const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.36, 0.08, 15.0), interior);
      ceiling.position.y = 2.72;
      car.add(ceiling);
      this.addOpaqueTransitInterior(car, 15.0, 1.18, interior, () => [-2.6, 2.6]);

      for (const z of [-5.6, -4.0, -1.3, 1.3, 4.0, 5.6]) {
        for (const x of [-0.85, 0.85]) {
          const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.58), seat);
          cushion.position.set(x, 1.05, z);
          car.add(cushion);
          const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.11), seat);
          back.position.set(x, 1.36, z - 0.26);
          car.add(back);
        }
      }

      for (const z of [-2.6, 0, 2.6]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.9, 8), metal);
        pole.position.set(0, 1.82, z);
        car.add(pole);
      }

      const monitor = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.48), displayMaterial);
      monitor.position.set(0, 2.46, 5.1);
      monitor.rotation.y = Math.PI;
      monitor.renderOrder = 18;
      car.add(monitor);

      this.cars.push(car);
      this.root.add(car);
    });

    this.trainHalfLengthM = 17.4;
    return this.createVehicleInstance();
  }

  // Historic 1929 Stuttgart Standseilbahn car. Its defining feature is the
  // terraced body: three teak passenger compartments stepped up toward the uphill
  // end so the floors stay usable on the incline. Runs on a funicular truck with a
  // central cable grip.
  //
  // The stepped shell lives in an inner group so its tall end can be pointed at the
  // uphill end of the route regardless of travel direction (the player runs forward,
  // the counterbalancing opposing car runs in reverse). See OpposingTrafficLayer,
  // which flips the cloned shell by a further 180°.
  createSeilbahnVehicle(): VehicleInstance {
    const car = new THREE.Group();
    car.name = 'Historic Stuttgart funicular car (1929)';
    car.userData.centerOffsetM = 0;
    // Anchored interior camera seated on the centreline of the middle compartment,
    // looking straight down the aisle and out through the leading windscreen.
    car.userData.passengerCameraLocal = [0, 2.34, -0.4];
    car.userData.passengerLookAtLocal = [0, 2.2, 9];
    const body = new THREE.Group();
    body.name = 'Funicular step body';
    car.add(body);

    const teak = new THREE.MeshStandardMaterial({ color: 0x7b4b2a, roughness: 0.74 });
    const mahogany = new THREE.MeshStandardMaterial({ color: 0x4f301f, roughness: 0.82 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc7a04c, roughness: 0.34, metalness: 0.72 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xc2e0e7, transparent: true, opacity: 0.4, roughness: 0.08, side: THREE.DoubleSide });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.5, metalness: 0.4 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2cf, emissive: 0xffe6a8, emissiveIntensity: 0.7 });
    const headlightMat = new THREE.MeshStandardMaterial({ color: 0xfff7e0, emissive: 0xfff0c0, emissiveIntensity: 0.5 });
    this.glassMaterial = glass;
    this.headLampMaterials.push(headlightMat);

    // Three compartments stepped up toward +z. Each carries its own body, glazing,
    // roof, plank floor, benches and a brass ceiling lamp.
    const compartments = [
      { center: -3.25, floorY: 0.78 },
      { center: 0, floorY: 1.2 },
      { center: 3.25, floorY: 1.62 }
    ];
    const compLen = 3.05;
    const destinationMap = makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 640, height: 128, bg: '#3a2417', fg: '#f4d79a' });

    compartments.forEach((comp, index) => {
      const shell = new THREE.Mesh(new THREE.BoxGeometry(2.24, 2.36, compLen), teak);
      shell.position.set(0, comp.floorY + 1.16, comp.center);
      shell.castShadow = true;
      body.add(shell);
      this.passengerShells.push(shell);

      // Overhanging mahogany roof stepped to this compartment's height.
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.2, compLen + 0.28), mahogany);
      roof.position.set(0, comp.floorY + 2.46, comp.center);
      body.add(roof);
      this.passengerShells.push(roof);

      for (const side of [-1, 1] as const) {
        const lowerBelt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, compLen), mahogany);
        lowerBelt.position.set(side * 1.08, comp.floorY + 0.32, comp.center);
        body.add(lowerBelt);
        const header = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, compLen), mahogany);
        header.position.set(side * 1.08, comp.floorY + 2.18, comp.center);
        body.add(header);
        for (const dz of [-0.75, 0.75]) {
          const window = new THREE.Mesh(new THREE.BoxGeometry(0.075, 1.16, 1.2), glass);
          window.position.set(side * 1.12, comp.floorY + 1.26, comp.center + dz);
          body.add(window);
        }
        // Teak mullions framing the glazing.
        for (const dz of [-1.45, 0, 1.45]) {
          const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.34, 0.12), mahogany);
          mullion.position.set(side * 1.08, comp.floorY + 1.26, comp.center + dz);
          body.add(mullion);
        }
      }

      // Plank floor, longitudinal benches, brass poles and a ceiling lamp.
      for (let z = comp.center - 1.35; z <= comp.center + 1.35; z += 0.46) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.028, 0.3), teak);
        plank.position.set(0, comp.floorY + 0.07, z);
        body.add(plank);
      }
      for (const side of [-1, 1] as const) {
        const benchBase = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, compLen - 0.5), mahogany);
        benchBase.position.set(side * 0.6, comp.floorY + 0.34, comp.center);
        body.add(benchBase);
        const benchBack = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.72, compLen - 0.5), teak);
        benchBack.position.set(side * 0.76, comp.floorY + 0.72, comp.center);
        body.add(benchBack);
      }
      for (const dz of [-0.95, 0.95]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 1.95, 10), brass);
        pole.position.set(0.78, comp.floorY + 1.05, comp.center + dz);
        body.add(pole);
      }
      const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.05, 12), brass);
      lampBase.position.set(0, comp.floorY + 2.3, comp.center);
      body.add(lampBase);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), lampMat);
      lamp.position.set(0, comp.floorY + 2.18, comp.center);
      body.add(lamp);

      // Low riser closing just the step face between compartments, so the saloon
      // stays open overhead and passengers can see out along the whole car.
      if (index < compartments.length - 1) {
        const next = compartments[index + 1];
        const stepDiff = next.floorY - comp.floorY;
        const riser = new THREE.Mesh(new THREE.BoxGeometry(2.24, stepDiff + 0.5, 0.12), mahogany);
        riser.position.set(0, comp.floorY + 0.55 + stepDiff / 2, (comp.center + next.center) / 2);
        body.add(riser);
      }
    });

    // End cabs: raked windscreen, a lit route board and a brass headlamp on the
    // downhill/uphill faces of the outer compartments.
    const ends = [
      { z: compartments[0].center - compLen / 2, floorY: compartments[0].floorY, dir: -1 as const },
      { z: compartments[2].center + compLen / 2, floorY: compartments[2].floorY, dir: 1 as const }
    ];
    for (const end of ends) {
      const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.82, 1.2, 0.075), glass);
      windscreen.position.set(0, end.floorY + 1.3, end.z + end.dir * 0.04);
      body.add(windscreen);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.3), new THREE.MeshBasicMaterial({ map: destinationMap, side: THREE.DoubleSide }));
      board.position.set(0, end.floorY + 2.16, end.z + end.dir * 0.16);
      if (end.dir < 0) board.rotation.y = Math.PI;
      body.add(board);
      this.cabDisplays.push(board);
      const headlamp = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 14), headlightMat);
      headlamp.rotation.x = Math.PI / 2;
      headlamp.position.set(0, end.floorY + 0.55, end.z + end.dir * 0.14);
      body.add(headlamp);
      const buffer = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.24, 0.16), iron);
      buffer.position.set(0, end.floorY + 0.1, end.z + end.dir * 0.12);
      body.add(buffer);
    }

    // Funicular running gear: an inclined chassis beam, two rail-wheel axles and a
    // central cable grip clamping onto the haulage rope.
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.2, 9.0), iron);
    chassis.position.set(0, 0.55, 0);
    chassis.rotation.x = -0.14; // parallel to the mean grade so it reads as a funicular truck.
    body.add(chassis);
    for (const axle of [{ z: -3.3, y: 0.32 }, { z: 3.3, y: 1.16 }]) {
      for (const x of [-0.92, 0.92]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.12, 18), iron);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, axle.y, axle.z);
        body.add(wheel);
      }
    }
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.34, 0.7), iron);
    grip.position.set(0, 0.42, 0);
    body.add(grip);

    // Point the tall end uphill: if the route loses elevation from start to end the
    // player drives downhill, so the stepped shell is spun to face the other way.
    const points = this.context.route.controlPoints;
    const descending = points.length > 1 && points[points.length - 1][1] < points[0][1];
    if (descending) body.rotation.y = Math.PI;

    this.addCabinLight(body, compartments[1].floorY + 1.9);
    this.trainHalfLengthM = 5.4;
    this.cars.push(car);
    this.root.add(car);
    this.addExteriorLightThrow(this.trainHalfLengthM, 1.0);
    return this.createVehicleInstance();
  }

  createFerryVehicle(): VehicleInstance {
    const vessel = new THREE.Group();
    vessel.name = 'Articulated car Bodensee ferry';
    vessel.userData.centerOffsetM = 0;
    const hullWhite = new THREE.MeshStandardMaterial({ color: 0xf2f4f5, roughness: 0.5, metalness: 0.08 });
    const hullBlue = new THREE.MeshStandardMaterial({ color: 0x1f5e88, roughness: 0.44, metalness: 0.1 });
    const deckGrey = new THREE.MeshStandardMaterial({ color: 0xaeb6bb, roughness: 0.92 });
    const roofWhite = new THREE.MeshStandardMaterial({ color: 0xe7ecee, roughness: 0.58, metalness: 0.08 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a2228, roughness: 0.32, metalness: 0.26 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xa8d1dc, transparent: true, opacity: 0.4, roughness: 0.08, side: THREE.DoubleSide });
    const waterline = new THREE.MeshStandardMaterial({ color: 0xcf2f2a, roughness: 0.48 });
    const displayMat = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 700, height: 128, bg: '#0f1418', fg: '#ffffff' }),
      side: THREE.DoubleSide
    });
    this.glassMaterial = glass;

    const lowerHull = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.5, 26.8), hullWhite);
    lowerHull.position.y = 0.78;
    vessel.add(lowerHull);
    this.passengerShells.push(lowerHull);

    const waterlineStripe = new THREE.Mesh(new THREE.BoxGeometry(5.28, 0.16, 26.92), waterline);
    waterlineStripe.position.y = 0.12;
    vessel.add(waterlineStripe);
    this.passengerShells.push(waterlineStripe);

    const passengerDeck = new THREE.Mesh(new THREE.BoxGeometry(4.9, 2.3, 20.2), hullWhite);
    passengerDeck.position.y = 2.22;
    vessel.add(passengerDeck);
    this.passengerShells.push(passengerDeck);

    const bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(4.25, 1.25, 8.4), hullWhite);
    bridgeDeck.position.set(0, 3.88, -5.1);
    vessel.add(bridgeDeck);
    this.cabShells.push(bridgeDeck);

    const sideBand = new THREE.Mesh(new THREE.BoxGeometry(5.02, 0.28, 20.3), hullBlue);
    sideBand.position.y = 2.48;
    vessel.add(sideBand);
    this.passengerShells.push(sideBand);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.65, 0.18, 19.8), roofWhite);
    roof.position.y = 3.52;
    vessel.add(roof);
    this.passengerShells.push(roof);

    const bridgeRoof = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.16, 8.0), roofWhite);
    bridgeRoof.position.set(0, 4.58, -5.1);
    vessel.add(bridgeRoof);
    this.cabShells.push(bridgeRoof);

    const interiorFloor = new THREE.Mesh(new THREE.BoxGeometry(4.56, 0.08, 19.2), deckGrey);
    interiorFloor.position.y = 1.3;
    vessel.add(interiorFloor);
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.08, 19.0), roofWhite);
    ceiling.position.y = 3.2;
    vessel.add(ceiling);
    this.addOpaqueTransitInterior(vessel, 18.8, 2.3, hullWhite, () => []);

    for (const side of [-1, 1] as const) {
      const windowBand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.04, 18.3), dark);
      windowBand.position.set(side * 2.48, 2.45, 0);
      vessel.add(windowBand);
      this.windowBands.push(windowBand);
      for (const z of [-7.2, -4.8, -2.4, 0, 2.4, 4.8, 7.2]) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.9, 1.55), glass);
        window.position.set(side * 2.52, 2.45, z);
        vessel.add(window);
      }
    }

    for (const x of [-1.35, 1.35]) {
      const bridgeWindow = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.72, 0.08), glass);
      bridgeWindow.position.set(x, 4.05, -9.34);
      vessel.add(bridgeWindow);
    }
    const frontBridgeWindow = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.86, 0.08), glass);
    frontBridgeWindow.position.set(0, 4.0, -9.34);
    vessel.add(frontBridgeWindow);

    const sternWindow = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.92, 0.08), glass);
    sternWindow.position.set(0, 2.42, 10.04);
    vessel.add(sternWindow);

    const display = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.38), displayMat);
    display.position.set(0, 4.56, -9.42);
    vessel.add(display);
    this.cabDisplays.push(display);

    for (const z of [-6.8, -3.4, 0, 3.4, 6.8]) {
      for (const x of [-1.3, 1.3]) {
        const bench = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.16, 0.9), hullBlue);
        bench.position.set(x, 1.7, z);
        vessel.add(bench);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.74, 0.1), hullBlue);
        back.position.set(x, 2.05, z - 0.38);
        vessel.add(back);
      }
    }

    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 1.1, 14), dark);
    funnel.position.set(0, 4.15, 5.4);
    vessel.add(funnel);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 10), dark);
    mast.position.set(0, 5.25, -1.8);
    vessel.add(mast);

    this.trainHalfLengthM = 13.6;
    this.cars.push(vessel);
    this.root.add(vessel);
    return this.createVehicleInstance();
  }

  createUlmTramVehicle(): VehicleInstance {
    const shell = new THREE.MeshStandardMaterial({ color: 0xf4f5f3, roughness: 0.42, metalness: 0.16 });
    const lightGrey = new THREE.MeshStandardMaterial({ color: 0xb8bec2, roughness: 0.52, metalness: 0.12 });
    const glossyBlack = new THREE.MeshStandardMaterial({ color: 0x161b1f, roughness: 0.18, metalness: 0.32 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x60b5e5, roughness: 0.34, metalness: 0.08 });
    const doorBlue = new THREE.MeshStandardMaterial({ color: 0x0066a8, roughness: 0.36, metalness: 0.1 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9bc8d8, transparent: true, opacity: 0.42, roughness: 0.06, side: THREE.DoubleSide });
    const floor = new THREE.MeshStandardMaterial({ color: 0x72787d, roughness: 0.92 });
    const ceiling = new THREE.MeshStandardMaterial({ color: 0xe1e3e4, roughness: 0.86 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x2d667f, roughness: 0.88 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x93999b, roughness: 0.36, metalness: 0.72 });
    const ledPanel = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 700, height: 128, bg: '#101417', fg: '#ffb300' }),
      side: THREE.DoubleSide
    });
    const interiorDisplayMat = this.context.makeInteriorDisplayMaterial();
    this.glassMaterial = glass;

    const sections = [
      { center: -12.4, length: 6.6, end: -1 as -1 | 0 | 1 },
      { center: -6.2, length: 5.2, end: 0 as -1 | 0 | 1 },
      { center: 0, length: 6.0, end: 0 as -1 | 0 | 1 },
      { center: 6.2, length: 5.2, end: 0 as -1 | 0 | 1 },
      { center: 12.4, length: 6.6, end: 1 as -1 | 0 | 1 }
    ];

    for (const section of sections) {
      const car = new THREE.Group();
      car.name = `Articulated car Ulm Avenio section ${section.center}`;
      car.userData.centerOffsetM = section.center;

      const cabDepth = section.end === 0 ? 0 : 1.7;
      const bodyLength = section.length - cabDepth;
      const bodyCenterZ = -section.end * cabDepth / 2;

      const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.34, bodyLength - 0.1), glossyBlack);
      skirt.position.set(0, 0.56, bodyCenterZ);
      car.add(skirt);
      this.passengerShells.push(skirt);

      const body = new THREE.Mesh(this.makeModernTramBody(2.4, 3.22, bodyLength), shell);
      body.position.z = bodyCenterZ;
      body.castShadow = true;
      car.add(body);
      this.passengerShells.push(body);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.11, bodyLength - 0.24), lightGrey);
      roof.position.set(0, 3.25, bodyCenterZ);
      car.add(roof);
      this.passengerShells.push(roof);

      for (const side of [-1, 1] as const) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.12, bodyLength - 0.2), glossyBlack);
        band.position.set(side * 1.22, 2.28, bodyCenterZ);
        car.add(band);
        this.windowBands.push(band);

        const windowCount = bodyLength > 6 ? 3 : 2;
        for (let index = 0; index < windowCount; index++) {
          const z = bodyCenterZ - bodyLength * 0.28 + (index * (bodyLength * 0.56)) / Math.max(1, windowCount - 1);
          const win = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.88, windowCount === 3 && index === 1 ? 1.25 : 0.98), glass);
          win.position.set(side * 1.24, 2.28, z);
          car.add(win);
        }

        const lowerStripe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.18, bodyLength - 0.16), doorBlue);
        lowerStripe.position.set(side * 1.215, 0.9, bodyCenterZ);
        car.add(lowerStripe);

        // Avenio M is bidirectional; every module carries passenger access on
        // both sides. Slim blue jambs match the SWU livery without hiding the body.
        const doorZ = section.length > 6 ? 0.55 : 0;
        this.addSlidingVehicleDoor(car, side * 1.245, doorZ, shell, glass, glossyBlack, 1.48, 1.95);
        for (const edge of [-0.78, 0.78]) {
          const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.08, 0.08), doorBlue);
          jamb.position.set(side * 1.215, 1.75, doorZ + edge);
          car.add(jamb);
        }
      }

      const interiorFloor = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, section.length - 0.28), floor);
      interiorFloor.position.y = 0.98;
      car.add(interiorFloor);
      const interiorCeiling = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.08, section.length - 0.34), ceiling);
      interiorCeiling.position.y = 2.98;
      car.add(interiorCeiling);
      this.addOpaqueTransitInterior(car, section.length - 0.34, 1.08, ceiling, () => [section.length > 6 ? 0.55 : 0]);

      for (const z of section.length > 6 ? [-1.55, 1.55] : [-1.0, 1.0]) {
        for (const x of [-0.74, 0.74]) {
          const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.54), seat);
          cushion.position.set(x, 1.28, z);
          car.add(cushion);
          const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.11), seat);
          back.position.set(x, 1.62, z - 0.26);
          car.add(back);
        }
      }
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.8, 10), metal);
      pole.position.set(0, 1.95, 0);
      car.add(pole);

      if (section.end !== 0) {
        const cab = new THREE.Group();
        cab.position.z = section.end * (section.length / 2 - cabDepth);
        if (section.end < 0) cab.rotation.y = Math.PI;
        car.add(cab);

        const cabShell = new THREE.Mesh(this.makeAvenioCabNose(), shell);
        cabShell.castShadow = true;
        cab.add(cabShell);
        this.cabShells.push(cabShell);

        const face = new THREE.Mesh(this.makeAvenioCabMask(), glossyBlack);
        face.position.set(0, 2.14, 1.58);
        face.rotation.x = -0.17;
        cab.add(face);
        this.cabShells.push(face);

        const windscreenMaterial = glass.clone();
        windscreenMaterial.depthWrite = false;
        const windscreen = new THREE.Mesh(this.makeAvenioWindscreen(), windscreenMaterial);
        windscreen.position.set(0, 2.22, 1.605);
        windscreen.rotation.x = -0.17;
        windscreen.renderOrder = 10;
        cab.add(windscreen);
        this.cabShells.push(windscreen);

        const routeDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.58, 0.28), ledPanel);
        routeDisplay.position.set(0, 2.73, 1.72);
        routeDisplay.rotation.x = -0.17;
        routeDisplay.renderOrder = 30;
        cab.add(routeDisplay);
        this.cabDisplays.push(routeDisplay);

        const lowerMask = new THREE.Mesh(this.makeCabAccentPanel(1.98, 1.82, 0.55), blue);
        lowerMask.position.set(0, 1.3, 1.735);
        lowerMask.rotation.x = -0.06;
        cab.add(lowerMask);
        this.cabShells.push(lowerMask);

        const headlightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf8f4d0, emissiveIntensity: 2.0 });
        for (const x of [-0.66, 0.66]) {
          const headlight = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.045, 16), headlightMat);
          headlight.rotation.x = Math.PI / 2;
          headlight.position.set(x, 1.23, 1.78);
          cab.add(headlight);
        }
      } else {
        const internalDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.42), interiorDisplayMat);
        internalDisplay.position.set(0, 2.76, 0);
        internalDisplay.rotation.y = Math.PI;
        internalDisplay.renderOrder = 18;
        car.add(internalDisplay);
      }

      this.cars.push(car);
      this.root.add(car);
    }

    for (const z of [-9.3, -3.1, 3.1, 9.3]) {
      const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.18, 2.24, 0.7), glossyBlack);
      bellows.position.set(0, 1.84, z);
      this.root.add(bellows);
      this.passengerShells.push(bellows);
    }

    for (const z of [-9.35, -3.15, 3.15, 9.35]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.36, 1.5), glossyBlack);
      bogie.position.set(0, 0.42, z);
      this.root.add(bogie);
    }

    for (const z of [-6.2, 0, 6.2]) {
      const roofHvac = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 2.9), lightGrey);
      roofHvac.position.set(0, 3.39, z);
      this.root.add(roofHvac);
    }
    this.addPantograph(new THREE.Vector3(0, 3.58, 2.2), metal);

    this.trainHalfLengthM = 15.6;
    return this.createVehicleInstance();
  }

  // Tatra-Yug K-1M6 "Odissey MAX": three low-floor modules in the Odesa city
  // livery — yellow shoulder band, white waist, red lower body — with a black
  // wraparound cab mask and a yellow front end.
  createOdessaTramVehicle(): VehicleInstance {
    const white = new THREE.MeshStandardMaterial({ color: 0xf6f5f1, roughness: 0.4, metalness: 0.12 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.34, metalness: 0.1 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd9262c, roughness: 0.36, metalness: 0.06 });
    const black = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.2, metalness: 0.34 });
    const underframe = new THREE.MeshStandardMaterial({ color: 0x262a2e, roughness: 0.74, metalness: 0.18 });
    const roofGrey = new THREE.MeshStandardMaterial({ color: 0xacb1b4, roughness: 0.58, metalness: 0.12 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x7fa8bd, transparent: true, opacity: 0.4, roughness: 0.05, side: THREE.DoubleSide });
    const floor = new THREE.MeshStandardMaterial({ color: 0x767a7e, roughness: 0.92 });
    const interior = new THREE.MeshStandardMaterial({ color: 0xe0e1dc, roughness: 0.84 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x355d74, roughness: 0.88 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x93989a, roughness: 0.36, metalness: 0.74 });
    // Front-facing only: with the cab bodywork hidden in passenger view the
    // destination film would otherwise read back-to-front from inside.
    const displayMat = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 700, height: 128, bg: '#101216', fg: '#ffb300' })
    });
    const headlightMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, emissive: 0xfff2ca, emissiveIntensity: 0.55, roughness: 0.16 });
    const tailLampMat = new THREE.MeshStandardMaterial({ color: 0x8e1518, emissive: 0xd42020, emissiveIntensity: 0.35, roughness: 0.24 });
    this.headLampMaterials.push(headlightMat);
    this.tailLampMaterials.push(tailLampMat);
    this.glassMaterial = glass;
    const interiorDisplayMat = this.context.makeInteriorDisplayMaterial();

    // The yellow shoulder band is two chords rather than one, because a single
    // flat strip either sinks into or floats off the rounded roof edge of
    // makeModernTramBody. Each entry is a chord of that curve: offset, height
    // and tilt matching the tangent there.
    const shoulderSegments = [
      { x: 1.184, y: 2.93, height: 0.24, tilt: 0.316 },
      { x: 1.099, y: 3.115, height: 0.19, tilt: 0.579 }
    ];
    const cabDepth = 1.9;

    const sections = [
      { center: -8.7, length: 8.4, cab: -1 as -1 | 0 | 1 },
      { center: 0, length: 7.2, cab: 0 as -1 | 0 | 1 },
      { center: 8.7, length: 8.4, cab: 1 as -1 | 0 | 1 }
    ];

    for (const section of sections) {
      const car = new THREE.Group();
      car.name = `Articulated car Odessa K-1M6 section ${section.center}`;
      car.userData.centerOffsetM = section.center;

      const bodyLength = section.cab === 0 ? section.length : section.length - cabDepth;
      const bodyCenterZ = (-section.cab * cabDepth) / 2;
      // Doors sit toward the articulation on the cab modules and either side of
      // the centre on the middle module.
      const doorCenters = section.cab === 0 ? [-1.6, 1.6] : [section.cab < 0 ? 1.7 : -1.7];

      const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.3, bodyLength - 0.1), underframe);
      skirt.position.set(0, 0.42, bodyCenterZ);
      car.add(skirt);
      this.passengerShells.push(skirt);

      const body = new THREE.Mesh(this.makeModernTramBody(2.4, 3.2, bodyLength), white);
      body.position.z = bodyCenterZ;
      body.castShadow = true;
      car.add(body);
      this.passengerShells.push(body);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.11, bodyLength - 0.2), roofGrey);
      roof.position.set(0, 3.21, bodyCenterZ);
      car.add(roof);
      this.passengerShells.push(roof);

      for (const side of [-1, 1] as const) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, bodyLength), black);
        band.position.set(side * 1.23, 2.32, bodyCenterZ);
        car.add(band);
        this.windowBands.push(band);

        // Yellow shoulder band above the glazing, following the roof radius.
        for (const segment of shoulderSegments) {
          const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.06, segment.height, bodyLength), yellow);
          shoulder.position.set(side * segment.x, segment.y, bodyCenterZ);
          shoulder.rotation.z = side * segment.tilt;
          car.add(shoulder);
          this.passengerShells.push(shoulder);
        }

        const redBand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.72, bodyLength), red);
        redBand.position.set(side * 1.215, 0.92, bodyCenterZ);
        car.add(redBand);
        this.passengerShells.push(redBand);

        const pinstripe = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.05, bodyLength), yellow);
        pinstripe.position.set(side * 1.218, 1.33, bodyCenterZ);
        car.add(pinstripe);
        this.passengerShells.push(pinstripe);

        const windows =
          section.cab === 0
            ? [
                { z: 0, length: 1.5 },
                { z: -3.0, length: 0.86 },
                { z: 3.0, length: 0.86 }
              ]
            : [
                { z: bodyCenterZ - section.cab * 1.62, length: 1.44 },
                { z: bodyCenterZ - section.cab * 2.86, length: 0.9 },
                { z: bodyCenterZ + section.cab * 1.14, length: 1.28 }
              ];
        for (const window of windows) {
          const pane = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.94, window.length), glass);
          pane.position.set(side * 1.248, 2.32, window.z);
          car.add(pane);
        }

        for (const doorZ of doorCenters) {
          this.addSlidingVehicleDoor(car, side * 1.248, doorZ, yellow, glass, black, 1.62, 1.98);
          // Recessed black surround so the yellow leaves read as doors from a
          // distance instead of merging into the shoulder band.
          for (const edge of [-0.86, 0.86]) {
            const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.14, 0.09), black);
            jamb.position.set(side * 1.216, 1.76, doorZ + edge);
            car.add(jamb);
            this.passengerShells.push(jamb);
          }
          const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 1.81), black);
          lintel.position.set(side * 1.216, 2.85, doorZ);
          car.add(lintel);
          this.passengerShells.push(lintel);

          if (side < 0) {
            const accessibility = new THREE.Mesh(
              new THREE.PlaneGeometry(0.36, 0.2),
              new THREE.MeshBasicMaterial({
                map: makeLabelTexture('♿', { width: 192, height: 96, bg: '#1d4e89', fg: '#ffffff' }),
                side: THREE.DoubleSide,
                transparent: true
              })
            );
            accessibility.position.set(side * 1.26, 1.06, doorZ + 0.98);
            accessibility.rotation.y = Math.PI / 2;
            car.add(accessibility);
            this.passengerShells.push(accessibility);
          }
        }
      }

      const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.08, section.length - 0.26), floor);
      floorMesh.position.y = 0.98;
      car.add(floorMesh);
      const ceilingMesh = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.08, section.length - 0.34), interior);
      ceilingMesh.position.y = 2.96;
      car.add(ceilingMesh);
      this.addOpaqueTransitInterior(car, section.length - 0.34, 1.08, interior, () => doorCenters);

      for (const z of section.cab === 0 ? [-2.2, 0, 2.2] : [-2.0, 2.0]) {
        for (const x of [-0.78, 0.78]) {
          const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.54), seat);
          cushion.position.set(x, 1.28, z);
          car.add(cushion);
          const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.11), seat);
          back.position.set(x, 1.62, z - 0.26);
          car.add(back);
        }
      }
      for (const z of section.cab === 0 ? [-1.6, 1.6] : [0]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.8, 10), metal);
        pole.position.set(0, 1.94, z);
        car.add(pole);
      }
      this.addCabinLight(car, 2.86);

      if (section.cab !== 0) {
        const cab = new THREE.Group();
        cab.position.z = section.cab * (section.length / 2 - cabDepth);
        if (section.cab < 0) cab.rotation.y = Math.PI;
        car.add(cab);

        // The opaque cab bodywork is a passenger shell, not a cab shell: it has
        // to disappear in passenger view too, or the forward view from the front
        // module is a solid wall. Only the windscreen stays behind as a cab
        // shell, so it is there for passengers and gone for the driver.
        const nose = new THREE.Mesh(this.makeOdessaCabNose(), yellow);
        nose.castShadow = true;
        cab.add(nose);
        this.passengerShells.push(nose);

        // Carries the grey roof cap over the sloping cab top; without it the
        // cap's cut end is visible above the nose from ahead.
        const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.11, 1.2), roofGrey);
        cabRoof.position.set(0, 3.2, 0.45);
        cabRoof.rotation.x = 0.109;
        cab.add(cabRoof);
        this.passengerShells.push(cabRoof);

        // Everything on the front end mounts to this group, which lies on the
        // planar cab face, so trim stays flush no matter how the rake changes.
        const front = new THREE.Group();
        front.position.set(0, 1.725, 1.837);
        front.rotation.x = -ODESSA_CAB_FRONT_RAKE;
        cab.add(front);

        const addFrontTrim = (mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh => {
          mesh.position.set(x, y, z);
          front.add(mesh);
          this.passengerShells.push(mesh);
          return mesh;
        };

        // Black wraparound mask carrying the windscreen and destination film.
        addFrontTrim(new THREE.Mesh(this.makeOdessaCabMask(), black), 0, 0.44, 0);

        const windscreenMaterial = glass.clone();
        windscreenMaterial.depthWrite = false;
        const windscreen = new THREE.Mesh(this.makeOdessaWindscreen(), windscreenMaterial);
        windscreen.position.set(0, 0.36, 0.04);
        windscreen.renderOrder = 10;
        front.add(windscreen);
        this.cabShells.push(windscreen);

        const routeDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.26), displayMat);
        routeDisplay.position.set(0, 0.97, 0.09);
        routeDisplay.renderOrder = 30;
        front.add(routeDisplay);
        this.cabDisplays.push(routeDisplay);

        // Lamp clusters, city crest and fleet plate sit on the yellow apron
        // below the mask; the red valance and its white separator close it off.
        for (const x of [-0.8, 0.8]) {
          addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.2, 0.06), black), x, -0.58, 0.03);
          addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.09, 0.05), headlightMat), x, -0.54, 0.07);
          addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.05), tailLampMat), x, -0.64, 0.07);
        }

        addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.05), white), 0, -0.86, 0.03);
        addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.3, 0.05), red), 0, -1.04, 0.03);
        addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.16, 0.12), yellow), 0, -1.26, 0.04);
        addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.2, 0.34), underframe), 0, -1.44, -0.06);

        const crest = new THREE.Mesh(
          new THREE.PlaneGeometry(0.26, 0.26),
          new THREE.MeshBasicMaterial({
            map: makeLabelTexture('⚓', { width: 128, height: 128, bg: '#0d2f6d', fg: '#f3d04a' }),
            side: THREE.DoubleSide,
            transparent: true
          })
        );
        addFrontTrim(crest, -0.26, -0.58, 0.05);
        const fleet = new THREE.Mesh(
          new THREE.PlaneGeometry(0.42, 0.13),
          new THREE.MeshBasicMaterial({
            map: makeLabelTexture('7013', { width: 256, height: 96, bg: '#14181c', fg: '#ffffff' }),
            side: THREE.DoubleSide
          })
        );
        addFrontTrim(fleet, 0.26, -0.58, 0.05);
      } else {
        const interiorDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.68, 0.42), interiorDisplayMat);
        interiorDisplay.position.set(0, 2.74, 0);
        interiorDisplay.rotation.y = Math.PI;
        interiorDisplay.renderOrder = 18;
        car.add(interiorDisplay);
      }

      this.cars.push(car);
      this.root.add(car);
    }

    // Centred on, and slightly wider than, the 0.9 m gap between modules so no
    // extruded end cap shows through the articulation.
    for (const z of [-4.05, 4.05]) {
      const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.42, 2.5, 0.96), black);
      bellows.position.set(0, 1.9, z);
      this.root.add(bellows);
      this.passengerShells.push(bellows);
    }
    for (const z of [-8.25, 0, 8.25]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.36, 1.42), underframe);
      bogie.position.set(0, 0.42, z);
      this.root.add(bogie);
    }
    for (const z of [-8.4, 0.6]) {
      const roofEquipment = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.2, 4.4), roofGrey);
      roofEquipment.position.set(0, 3.34, z);
      this.root.add(roofEquipment);
    }
    this.addPantograph(new THREE.Vector3(0, 3.52, 4.6), metal);
    this.addExteriorLightThrow(13.2, 1.38);
    this.trainHalfLengthM = 13.2;
    return this.createVehicleInstance();
  }

  // VBZ's Be 5/6 "Cobra": five bodies over three bogies, ~36 m, in the Zürich
  // house livery — white sides with a blue band below the windows and a blue
  // cantrail line, blue door leaves, and a blue roof cap that overhangs the
  // black wraparound cab mask.
  createZurichTramVehicle(): VehicleInstance {
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.4, metalness: 0.12 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x0f6ab8, roughness: 0.32, metalness: 0.08 });
    const roofGrey = new THREE.MeshStandardMaterial({ color: 0xc6ccd1, roughness: 0.58, metalness: 0.18 });
    const black = new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.22, metalness: 0.3 });
    const skirtGrey = new THREE.MeshStandardMaterial({ color: 0x4b5157, roughness: 0.56, metalness: 0.22 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9dc7d9, transparent: true, opacity: 0.42, roughness: 0.05, side: THREE.DoubleSide });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa1a5, roughness: 0.34, metalness: 0.72 });
    const amber = new THREE.MeshStandardMaterial({ color: 0xd98214, roughness: 0.4 });
    const headlightMat = new THREE.MeshStandardMaterial({ color: 0xfffaf0, emissive: 0xfff0c8, emissiveIntensity: 0.55 });
    const tailLampMat = new THREE.MeshStandardMaterial({ color: 0x8f1418, emissive: 0xd42020, emissiveIntensity: 0.35 });
    const displayMat = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 700, height: 128, bg: '#0c0e10', fg: '#ffb300' }),
      side: THREE.DoubleSide
    });
    const interiorDisplayMat = this.context.makeInteriorDisplayMaterial();
    this.glassMaterial = glass;
    this.headLampMaterials.push(headlightMat);
    this.tailLampMaterials.push(tailLampMat);

    const livery: ModernTramLivery = {
      body: white,
      stripe: blue,
      roof: roofGrey,
      band: black,
      skirt: skirtGrey,
      door: blue,
      glass,
      metal,
      // Blue band from the underframe up to just below the windows. It has to
      // reach the bottom of the body side, not the top of the skirt: the skirt
      // is inboard of the shell, so a shorter band leaves a white strip showing.
      stripeY: 1.02,
      stripeHeightM: 0.92,
      // Cantrail line, kept high enough that the saloon header hides its inner
      // face — the window band is see-through in interior views.
      accentStripe: { material: blue, y: 2.9, heightM: 0.1 },
      // Swiss-tram cabin: light grey lining, blue moquette, stainless fittings.
      interior: {
        floor: new THREE.MeshStandardMaterial({ map: this.makeTramFloorTexture(), color: 0x9aa0a4, roughness: 0.94 }),
        ceiling: new THREE.MeshStandardMaterial({ color: 0xecf0f2, roughness: 0.88 }),
        wall: new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.86 }),
        seatFabric: new THREE.MeshStandardMaterial({ map: this.makeTramSeatFabricTexture([30, 74, 128], [176, 198, 220]), roughness: 0.9 }),
        seatShell: new THREE.MeshStandardMaterial({ color: 0x585e64, roughness: 0.62 }),
        metal: new THREE.MeshStandardMaterial({ color: 0xc0c6ca, roughness: 0.3, metalness: 0.76 }),
        accent: new THREE.MeshStandardMaterial({ color: 0xb9c0c4, roughness: 0.32, metalness: 0.7 }),
        lightStrip: new THREE.MeshStandardMaterial({ color: 0xf6f9ff, emissive: 0xeef4ff, emissiveIntensity: 0.7, roughness: 0.5 }),
        threshold: new THREE.MeshStandardMaterial({ color: 0xe0b200, roughness: 0.6 }),
        // 2+1 across a 2.4 m body: a pair to port, singles to starboard.
        seatXs: [-0.83, -0.45, 0.83]
      }
    };

    // Cab module, short suspended link, centre module, link, cab module:
    // ~36.4 m over the ends with 0.7 m articulation gaps.
    const sections = [
      { center: -13.7, length: 9.0, end: -1 as -1 | 0 | 1 },
      { center: -6.4, length: 4.2, end: 0 as -1 | 0 | 1 },
      { center: 0, length: 7.2, end: 0 as -1 | 0 | 1 },
      { center: 6.4, length: 4.2, end: 0 as -1 | 0 | 1 },
      { center: 13.7, length: 9.0, end: 1 as -1 | 0 | 1 }
    ];
    const bodyWidthM = 2.4;

    for (const section of sections) {
      const car = new THREE.Group();
      car.name = `Articulated car Zurich Cobra section ${section.center}`;
      car.userData.centerOffsetM = section.center;

      const cabDepth = section.end === 0 ? 0 : 2.0;
      const bodyLength = section.length - cabDepth;
      const bodyCenterZ = (-section.end * cabDepth) / 2;

      // Cab modules take a door just behind the cab and one at the articulation
      // end; the centre module a pair; the short link modules none.
      const doorZs =
        section.end !== 0
          ? [bodyCenterZ + section.end * 2.6, bodyCenterZ - section.end * 2.2]
          : section.length > 6
            ? [-2.5, 2.5]
            : [];
      const windowZs =
        section.end !== 0
          ? [-0.95, 0.2, 1.35].map((z) => section.end * z)
          : section.length > 6
            ? [-1.2, 0, 1.2]
            : [-0.9, 0.9];

      this.addModernTramModule(car, livery, {
        // The saloon stops at the cab bulkhead rather than running the full
        // section: the Cobra's nose is drawn in far too hard at the roof to
        // cover a lining sized for the whole module.
        sectionLength: bodyLength,
        saloonCenterZ: bodyCenterZ,
        bodyLength,
        bodyCenterZ,
        doorZs,
        doorWidthM: 1.3,
        bodyWidthM,
        windowZs,
        windowLengthM: section.end === 0 && section.length < 6 ? 1.5 : 1.1
      });

      if (section.end !== 0) {
        const cab = new THREE.Group();
        cab.position.z = section.end * (section.length / 2 - cabDepth);
        if (section.end < 0) cab.rotation.y = Math.PI;
        car.add(cab);

        const nose = new THREE.Mesh(this.makeCobraCabNose(), white);
        nose.castShadow = true;
        cab.add(nose);
        this.passengerShells.push(nose);

        // The Cobra's signature: a blue cap that follows the falling nose roof
        // and overhangs the screen. Sloped to match the nose's top ring chord,
        // and wide enough to cover the nose roof edge — a narrower cap leaves
        // the white roof corners poking out either side of it.
        const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.14, 2.0), blue);
        cabRoof.position.set(0, 3.1, 0.92);
        cabRoof.rotation.x = 0.26;
        cab.add(cabRoof);
        this.passengerShells.push(cabRoof);

        // Everything on the front end mounts to this group, which lies on the
        // planar cab face, so trim stays flush no matter how the rake changes.
        const front = new THREE.Group();
        front.position.set(0, 1.66, 1.81);
        front.rotation.x = -COBRA_CAB_FRONT_RAKE;
        cab.add(front);

        const addFrontTrim = (mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh => {
          mesh.position.set(x, y, z);
          front.add(mesh);
          this.passengerShells.push(mesh);
          return mesh;
        };

        addFrontTrim(new THREE.Mesh(this.makeCobraCabMask(), black), 0, 0.3, 0);

        const windscreenMaterial = glass.clone();
        windscreenMaterial.depthWrite = false;
        const windscreen = new THREE.Mesh(this.makeCobraWindscreen(), windscreenMaterial);
        windscreen.position.set(0, 0.16, 0.04);
        windscreen.renderOrder = 10;
        front.add(windscreen);
        this.cabShells.push(windscreen);

        // Sits inside the mask, above the screen: any higher and the overhanging
        // blue cap covers the film from ahead.
        const routeDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.26), displayMat);
        routeDisplay.position.set(0, 0.92, 0.09); // clear of the mask's +0.061 front face
        routeDisplay.renderOrder = 30;
        front.add(routeDisplay);
        this.cabDisplays.push(routeDisplay);

        // Casing behind the destination film. The cab mask is a passenger shell
        // and hides in interior views, which would otherwise leave passengers
        // reading the film's mirrored back face. A cab shell hides in cab view
        // only, so the driver still sees the line ahead.
        const displayCasing = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.34, 0.06), black);
        displayCasing.position.set(0, 0.92, 0.03);
        front.add(displayCasing);
        this.cabShells.push(displayCasing);

        // Apron, top to bottom: the white band sweeping under the screen, the
        // blue side band carried around the front, then the black lamp panel.
        // The white band only reads against the blue, so the order matters.
        addFrontTrim(new THREE.Mesh(this.makeCabAccentPanel(2.0, 2.06, 0.22), white), 0, -0.52, 0.02);
        addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.32, 0.1), blue), 0, -0.79, 0.01);
        addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.28, 0.1), black), 0, -1.05, 0.0);
        for (const x of [-0.68, 0.68]) {
          addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.05), headlightMat), x - 0.1, -1.01, 0.06);
          addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.05), amber), x + 0.11, -1.01, 0.06);
          addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.05), tailLampMat), x, -1.12, 0.06);
        }
        const fleet = new THREE.Mesh(
          new THREE.PlaneGeometry(0.46, 0.15),
          new THREE.MeshBasicMaterial({
            map: makeLabelTexture('3002', { width: 256, height: 96, bg: '#1c2126', fg: '#f2f4f6' }),
            side: THREE.DoubleSide
          })
        );
        addFrontTrim(fleet, 0, -1.04, 0.06);
        addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.32), black), 0, -1.2, -0.1);

        // Next-stop display on the cab bulkhead, facing back down the saloon.
        // Shares the one interior-display material, so every module stays in sync.
        const bulkheadDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.38), interiorDisplayMat);
        bulkheadDisplay.position.set(0, 2.74, section.end * 2.42);
        bulkheadDisplay.rotation.y = section.end === 1 ? Math.PI : 0;
        bulkheadDisplay.renderOrder = 18;
        car.add(bulkheadDisplay);
      } else if (section.center === 0) {
        const interiorDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.54, 0.4), interiorDisplayMat);
        interiorDisplay.position.set(0, 2.76, 0);
        interiorDisplay.rotation.y = Math.PI;
        interiorDisplay.renderOrder = 18;
        car.add(interiorDisplay);

        // The passenger rig anchors to cars[2] — the centre module on a five-body
        // Cobra — so seat the view there, at the rear of the module and in the
        // 2+1 aisle, looking forward down the whole tram.
        car.userData.passengerCameraLocal = [0.19, 2.05, -3.3];
        car.userData.passengerLookAtLocal = [0.19, 1.86, 24];
      }

      this.cars.push(car);
      this.root.add(car);
    }

    // Centred on, and slightly wider than, the 0.7 m articulation gaps.
    for (const z of [-8.85, -3.95, 3.95, 8.85]) {
      const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.5, 0.76), black);
      bellows.position.set(0, 1.9, z);
      this.root.add(bellows);
      this.passengerShells.push(bellows);
    }
    // Be 5/6: motor bogies under the two cab modules, one under the centre body;
    // the short link modules hang between them.
    for (const z of [-13.2, 0, 13.2]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.36, 1.5), black);
      bogie.position.set(0, 0.42, z);
      this.root.add(bogie);
    }
    for (const z of [-11.6, -0.2, 11.6]) {
      const roofEquipment = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.2, 3.4), skirtGrey);
      roofEquipment.position.set(0, 3.36, z);
      this.root.add(roofEquipment);
    }
    this.addPantograph(new THREE.Vector3(0, 3.56, 2.4), metal);
    this.addExteriorLightThrow(18.2, 1.35);
    this.trainHalfLengthM = 18.2;
    return this.createVehicleInstance();
  }

  createFreiburgTramVehicle(): VehicleInstance {
    const shell = new THREE.MeshStandardMaterial({ color: 0xf7f8f4, roughness: 0.42, metalness: 0.12 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd51e2b, roughness: 0.34, metalness: 0.06 });
    const darkRed = new THREE.MeshStandardMaterial({ color: 0xa81420, roughness: 0.36, metalness: 0.06 });
    const black = new THREE.MeshStandardMaterial({ color: 0x171c1c, roughness: 0.2, metalness: 0.3 });
    const silver = new THREE.MeshStandardMaterial({ color: 0xc4cbc6, roughness: 0.48, metalness: 0.18 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9ac5d1, transparent: true, opacity: 0.42, roughness: 0.05, side: THREE.DoubleSide });
    const floor = new THREE.MeshStandardMaterial({ color: 0x707673, roughness: 0.92 });
    const ceiling = new THREE.MeshStandardMaterial({ color: 0xe4e7e1, roughness: 0.86 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x384f67, roughness: 0.88 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9ba39d, roughness: 0.34, metalness: 0.72 });
    const ledPanel = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 700, height: 128, bg: '#0f1413', fg: '#ffb300' }),
      side: THREE.DoubleSide
    });
    const interiorDisplayMat = this.context.makeInteriorDisplayMaterial();
    this.glassMaterial = glass;

    // Seven-module, 42-metre CAF Urbos 100 in the VAG red/white house livery.
    const sections = [
      { center: -18, length: 6.8, end: -1 as -1 | 0 | 1 },
      { center: -12, length: 4.8, end: 0 as -1 | 0 | 1 },
      { center: -6, length: 6.0, end: 0 as -1 | 0 | 1 },
      { center: 0, length: 4.8, end: 0 as -1 | 0 | 1 },
      { center: 6, length: 6.0, end: 0 as -1 | 0 | 1 },
      { center: 12, length: 4.8, end: 0 as -1 | 0 | 1 },
      { center: 18, length: 6.8, end: 1 as -1 | 0 | 1 }
    ];

    for (const section of sections) {
      const car = new THREE.Group();
      car.name = `Articulated car Freiburg tram section ${section.center}`;
      car.userData.centerOffsetM = section.center;

      const cabDepth = section.end === 0 ? 0 : 1.8;
      const bodyLength = section.length - cabDepth;
      const bodyCenterZ = -section.end * cabDepth / 2;

      const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.44, 0.32, bodyLength - 0.08), darkRed);
      skirt.position.set(0, 0.56, bodyCenterZ);
      car.add(skirt);
      this.passengerShells.push(skirt);

      const body = new THREE.Mesh(this.makeModernTramBody(2.4, 3.2, bodyLength), shell);
      body.position.z = bodyCenterZ;
      body.castShadow = true;
      car.add(body);
      this.passengerShells.push(body);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.11, bodyLength - 0.22), silver);
      roof.position.set(0, 3.23, bodyCenterZ);
      car.add(roof);
      this.passengerShells.push(roof);

      for (const side of [-1, 1] as const) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.14, bodyLength - 0.18), black);
        band.position.set(side * 1.23, 2.3, bodyCenterZ);
        car.add(band);
        this.windowBands.push(band);

        const windowCount = bodyLength > 6 ? 3 : 2;
        for (let index = 0; index < windowCount; index++) {
          const z = bodyCenterZ - bodyLength * 0.27 + (index * (bodyLength * 0.54)) / Math.max(1, windowCount - 1);
          const windowLength = windowCount === 3 && index === 1 ? 1.32 : 1.0;
          const win = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.9, windowLength), glass);
          win.position.set(side * 1.245, 2.3, z);
          car.add(win);
        }

        const redBelt = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.24, bodyLength - 0.14), red);
        redBelt.position.set(side * 1.218, 0.94, bodyCenterZ);
        car.add(redBelt);

        const doorZ = section.length > 6 ? 0.62 : 0;
        this.addSlidingVehicleDoor(car, side * 1.248, doorZ, shell, glass, black, 1.5, 1.98);
        for (const edge of [-0.8, 0.8]) {
          const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.1, 0.08), red);
          jamb.position.set(side * 1.218, 1.76, doorZ + edge);
          car.add(jamb);
        }
      }

      const interiorFloor = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, section.length - 0.28), floor);
      interiorFloor.position.y = 0.98;
      car.add(interiorFloor);
      const interiorCeiling = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.08, section.length - 0.34), ceiling);
      interiorCeiling.position.y = 3.0;
      car.add(interiorCeiling);
      this.addOpaqueTransitInterior(car, section.length - 0.34, 1.08, ceiling, () => [section.length > 6 ? 0.62 : 0]);

      for (const z of section.length > 6 ? [-1.52, 1.52] : [-0.98, 0.98]) {
        for (const x of [-0.74, 0.74]) {
          const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.54), seat);
          cushion.position.set(x, 1.28, z);
          car.add(cushion);
          const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.11), seat);
          back.position.set(x, 1.62, z - 0.26);
          car.add(back);
        }
      }
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.82, 10), metal);
      pole.position.set(0, 1.96, 0);
      car.add(pole);

      if (section.end !== 0) {
        const cab = new THREE.Group();
        cab.position.z = section.end * (section.length / 2 - cabDepth);
        if (section.end < 0) cab.rotation.y = Math.PI;
        car.add(cab);

        const cabShell = new THREE.Mesh(this.makeUrbosCabNose(), shell);
        cabShell.castShadow = true;
        cab.add(cabShell);
        this.cabShells.push(cabShell);

        const redSurround = new THREE.Mesh(this.makeUrbosCabMask(), red);
        redSurround.position.set(0, 2.13, 1.48);
        redSurround.rotation.x = -0.2;
        redSurround.scale.set(1.1, 1.08, 1);
        cab.add(redSurround);
        this.cabShells.push(redSurround);

        const face = new THREE.Mesh(this.makeUrbosCabMask(), black);
        face.position.set(0, 2.12, 1.505);
        face.rotation.x = -0.2;
        cab.add(face);
        this.cabShells.push(face);

        const windscreenMaterial = glass.clone();
        windscreenMaterial.depthWrite = false;
        const windscreen = new THREE.Mesh(this.makeUrbosWindscreen(), windscreenMaterial);
        windscreen.position.set(0, 2.2, 1.535);
        windscreen.rotation.x = -0.2;
        windscreen.renderOrder = 10;
        cab.add(windscreen);
        this.cabShells.push(windscreen);

        const routeDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 0.28), ledPanel);
        routeDisplay.position.set(0, 2.72, 1.72);
        routeDisplay.rotation.x = -0.2;
        routeDisplay.renderOrder = 30;
        cab.add(routeDisplay);
        this.cabDisplays.push(routeDisplay);

        const logo = new THREE.Mesh(
          new THREE.PlaneGeometry(0.52, 0.22),
          new THREE.MeshBasicMaterial({
            map: makeLabelTexture('VAG', { width: 256, height: 108, bg: '#d51e2b', fg: '#ffffff' }),
            side: THREE.DoubleSide
          })
        );
        logo.position.set(0, 1.14, 1.725);
        logo.rotation.x = -0.04;
        cab.add(logo);

        const smile = new THREE.Mesh(
          new THREE.TubeGeometry(
            new THREE.QuadraticBezierCurve3(
              new THREE.Vector3(-0.76, 0, 0),
              new THREE.Vector3(0, -0.16, 0),
              new THREE.Vector3(0.76, 0, 0)
            ),
            16,
            0.035,
            8,
            false
          ),
          shell
        );
        smile.position.set(0, 0.99, 1.735);
        cab.add(smile);

        const headlightMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2ca, emissiveIntensity: 1.8 });
        for (const x of [-0.68, 0.68]) {
          const headlight = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), headlightMaterial);
          headlight.scale.set(1.25, 0.6, 0.35);
          headlight.position.set(x, 1.55, 1.68);
          cab.add(headlight);
        }
      } else {
        const internalDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.72, 0.42), interiorDisplayMat);
        internalDisplay.position.set(0, 2.78, 0);
        internalDisplay.rotation.y = Math.PI;
        internalDisplay.renderOrder = 18;
        car.add(internalDisplay);
      }

      this.cars.push(car);
      this.root.add(car);
    }

    for (const z of [-15, -9, -3, 3, 9, 15]) {
      const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.18, 2.22, 0.7), black);
      bellows.position.set(0, 1.82, z);
      this.root.add(bellows);
      this.passengerShells.push(bellows);
    }
    for (const z of [-17.2, -10.3, -3.4, 3.4, 10.3, 17.2]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.36, 1.48), black);
      bogie.position.set(0, 0.42, z);
      this.root.add(bogie);
    }
    for (const z of [-12, 0, 12]) {
      const roofHvac = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.2, 3.5), silver);
      roofHvac.position.set(0, 3.37, z);
      this.root.add(roofHvac);
    }
    this.addPantograph(new THREE.Vector3(0, 3.58, 4.2), metal);
    this.trainHalfLengthM = 21.4;
    return this.createVehicleInstance();
  }

  // One articulated module of a low-floor tram: dark skirt, liveried body, dark
  // window band with strip glazing, the livery band(s), both-side doorways and
  // the opaque interior. Shared by the Karlsruhe cars and the Zürich Cobra; the
  // cab ends are added by the callers.
  //
  // Every side offset derives from the body half-width so a narrower car (the
  // 2.4 m Cobra against the 2.65 m KVV cars) keeps its trim flush. Window panes
  // are auto-spaced by default; `windowZs` overrides that where a module's door
  // positions leave the automatic spacing nothing usable to work with.
  private addModernTramModule(
    car: THREE.Group,
    livery: ModernTramLivery,
    layout: {
      sectionLength: number;
      bodyLength: number;
      bodyCenterZ: number;
      doorZs: number[];
      doorWidthM: number;
      bodyWidthM?: number;
      windowZs?: number[];
      windowLengthM?: number;
      saloonCenterZ?: number;
    }
  ): void {
    const { sectionLength, bodyLength, bodyCenterZ, doorZs, doorWidthM } = layout;
    const bodyWidthM = layout.bodyWidthM ?? 2.65;
    const halfWidth = bodyWidthM / 2;

    const skirt = new THREE.Mesh(new THREE.BoxGeometry(bodyWidthM - 0.05, 0.34, bodyLength - 0.1), livery.skirt);
    skirt.position.set(0, 0.56, bodyCenterZ);
    car.add(skirt);
    this.passengerShells.push(skirt);

    const body = new THREE.Mesh(this.makeModernTramBody(bodyWidthM, 3.3, bodyLength), livery.body);
    body.position.z = bodyCenterZ;
    body.castShadow = true;
    car.add(body);
    this.passengerShells.push(body);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(bodyWidthM - 0.63, 0.12, bodyLength - 0.2), livery.roof);
    roof.position.set(0, 3.32, bodyCenterZ);
    car.add(roof);
    this.passengerShells.push(roof);

    for (const side of [-1, 1] as const) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, bodyLength - 0.18), livery.band);
      band.position.set(side * (halfWidth + 0.007), 2.2, bodyCenterZ);
      car.add(band);
      this.windowBands.push(band);

      for (const stripeSpec of [
        { material: livery.stripe, y: livery.stripeY, heightM: livery.stripeHeightM },
        ...(livery.accentStripe ? [livery.accentStripe] : [])
      ]) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.09, stripeSpec.heightM, bodyLength - 0.14), stripeSpec.material);
        stripe.position.set(side * (halfWidth + 0.005), stripeSpec.y, bodyCenterZ);
        car.add(stripe);
      }

      const windowZs =
        layout.windowZs?.map((z) => bodyCenterZ + z) ??
        (() => {
          const windowCount = Math.max(2, Math.round((bodyLength - 1.6) / 2.4));
          const windowSpan = bodyLength - 2.3;
          return Array.from({ length: windowCount }, (_, index) => bodyCenterZ - windowSpan / 2 + (index * windowSpan) / Math.max(1, windowCount - 1))
            // Skip panes that would land inside a doorway.
            .filter((z) => !doorZs.some((doorZ) => Math.abs(z - doorZ) < doorWidthM * 0.8));
        })();
      for (const z of windowZs) {
        const pane = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.88, layout.windowLengthM ?? 1.24), livery.glass);
        pane.position.set(side * (halfWidth + 0.015), 2.2, z);
        car.add(pane);
      }

      for (const doorZ of doorZs) {
        this.addSlidingVehicleDoor(car, side * (halfWidth + 0.02), doorZ, livery.door ?? livery.body, livery.glass, livery.band, doorWidthM, 1.98);
        for (const edge of [-1, 1] as const) {
          const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.1, 0.08), livery.band);
          jamb.position.set(side * (halfWidth - 0.007), 1.76, doorZ + edge * (doorWidthM / 2 + 0.06));
          car.add(jamb);
        }
      }
    }

    this.addModernTramInterior(car, livery.interior, {
      sectionLength,
      bodyLength,
      bodyCenterZ,
      doorZs,
      bodyWidthM,
      saloonCenterZ: layout.saloonCenterZ
    });
    this.addCabinLight(car, 2.9, bodyCenterZ);
  }

  // Saloon of one tram module: textured floor with contrasting door thresholds,
  // lit ceiling, side lining, longitudinal grab rails with hanging handles,
  // doorway stanchions and 2+2 transverse seat rows filling the bays between
  // doors. Everything is kept off the centreline above seat-back height so the
  // anchored passenger camera keeps a clear view down the car.
  private addModernTramInterior(
    car: THREE.Group,
    interior: ModernTramInterior,
    layout: {
      sectionLength: number;
      bodyLength: number;
      bodyCenterZ: number;
      doorZs: number[];
      bodyWidthM?: number;
      saloonCenterZ?: number;
    }
  ): void {
    const { sectionLength, bodyLength, bodyCenterZ, doorZs } = layout;
    // Lining sits 0.125 m inboard of the shell on each side; every fitting below
    // is placed relative to it so a narrower body keeps the same clearances.
    const halfWidth = (layout.bodyWidthM ?? 2.65) / 2;
    const saloonHalfWidth = halfWidth - 0.125;

    // Floor, ceiling and lining run `sectionLength` about the car origin unless
    // the caller recentres them. A cab module whose saloon is much shorter than
    // its section must, or the lining over-runs the bulkhead and its header
    // pokes out through the nose roof.
    const saloonCenterZ = layout.saloonCenterZ ?? 0;
    let saloon = car;
    if (saloonCenterZ !== 0) {
      saloon = new THREE.Group();
      saloon.position.z = saloonCenterZ;
      car.add(saloon);
    }

    const floorPanel = new THREE.Mesh(new THREE.BoxGeometry(saloonHalfWidth * 2 - 0.1, 0.08, sectionLength - 0.28), interior.floor);
    floorPanel.position.y = 0.98;
    saloon.add(floorPanel);

    const ceilingPanel = new THREE.Mesh(new THREE.BoxGeometry(saloonHalfWidth * 2 - 0.14, 0.08, sectionLength - 0.34), interior.ceiling);
    ceilingPanel.position.y = 2.98;
    saloon.add(ceilingPanel);
    this.addOpaqueTransitInterior(saloon, sectionLength - 0.34, saloonHalfWidth, interior.wall, () =>
      doorZs.map((doorZ) => doorZ - saloonCenterZ)
    );

    // Centre vent flanked by two continuous light strips.
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, bodyLength - 0.6), interior.wall);
    vent.position.set(0, 2.93, bodyCenterZ);
    car.add(vent);
    for (const side of [-1, 1] as const) {
      const lightStrip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.032, bodyLength - 0.5), interior.lightStrip);
      lightStrip.position.set(side * (saloonHalfWidth - 0.48), 2.94, bodyCenterZ);
      car.add(lightStrip);

      // Longitudinal grab rail with hanging handles down each side.
      const railX = side * (saloonHalfWidth - 0.2);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, bodyLength - 0.5, 8), interior.metal);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(railX, 2.52, bodyCenterZ);
      car.add(rail);
      for (let z = bodyCenterZ - bodyLength / 2 + 1.1; z < bodyCenterZ + bodyLength / 2 - 0.6; z += 1.15) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.2, 0.035), interior.metal);
        strap.position.set(railX, 2.4, z);
        car.add(strap);
        const grip = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.016, 6, 12), interior.accent);
        grip.position.set(railX, 2.25, z);
        car.add(grip);
      }

      for (const doorZ of doorZs) {
        // Contrasting step edge in the doorway, plus a stanchion and a door button.
        const threshold = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 1.5), interior.threshold);
        threshold.position.set(side * (saloonHalfWidth - 0.09), 1.03, doorZ);
        car.add(threshold);

        const stanchion = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 1.9, 10), interior.accent);
        stanchion.position.set(side * (saloonHalfWidth - 0.16), 1.98, doorZ - 0.95);
        car.add(stanchion);

        const button = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.1), interior.accent);
        button.position.set(side * (saloonHalfWidth - 0.07), 1.62, doorZ + 0.86);
        car.add(button);
      }
    }

    // 2+2 transverse rows. The saloon is split into bays by the doorways and
    // each bay is filled with as many rows as fit, centred in the bay, so no
    // stretch of the car (in particular the run up to the cab) is left bare.
    const doorClearanceM = 1.0;
    const bayEdges = [
      bodyCenterZ - bodyLength / 2 + 0.5,
      ...doorZs.flatMap((doorZ) => [doorZ - doorClearanceM, doorZ + doorClearanceM]),
      bodyCenterZ + bodyLength / 2 - 0.5
    ].sort((a, b) => a - b);

    const rowPitchM = 0.9;
    let row = 0;
    for (let edge = 0; edge + 1 < bayEdges.length; edge += 2) {
      const from = bayEdges[edge];
      const span = bayEdges[edge + 1] - from;
      const rows = Math.floor(span / rowPitchM);
      if (rows < 1) continue;
      const start = from + (span - rows * rowPitchM) / 2 + rowPitchM / 2;
      for (let index = 0; index < rows; index++, row++) {
        const z = start + index * rowPitchM;
        const facing: -1 | 1 = row % 2 === 0 ? 1 : -1;
        // 2+2 pulled outboard to leave a ~0.6 m gangway down the middle. Narrow
        // bodies pass their own columns (the 2.4 m Cobra seats 2+1).
        for (const x of interior.seatXs ?? [-0.92, -0.5, 0.5, 0.92]) {
          this.addModernTramSeat(car, x, z, facing, interior);
        }
      }
    }
  }

  private addModernTramSeat(
    car: THREE.Group,
    x: number,
    z: number,
    facing: -1 | 1,
    interior: ModernTramInterior
  ): void {
    const seat = new THREE.Group();
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.11, 0.46), interior.seatFabric);
    cushion.position.set(0, 1.3, 0);
    seat.add(cushion);
    const backShell = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.62, 0.06), interior.seatShell);
    backShell.position.set(0, 1.66, -facing * 0.24);
    seat.add(backShell);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.05), interior.seatFabric);
    back.position.set(0, 1.64, -facing * 0.205);
    seat.add(back);
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.14), interior.seatShell);
    pedestal.position.set(0, 1.13, 0);
    seat.add(pedestal);
    seat.position.set(x, 0, z);
    car.add(seat);
  }

  // VBK's classic articulated city tram: three bodies on four bogies in the KVV
  // house livery — golden-yellow sides with a red shoulder band under a dark grey
  // roof — and a blunt, near-upright cab carrying a wide amber destination film.
  createKarlsruheTramVehicle(): VehicleInstance {
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf3c400, roughness: 0.36, metalness: 0.1 });
    const red = new THREE.MeshStandardMaterial({ color: 0xe2001a, roughness: 0.34, metalness: 0.06 });
    const roofGrey = new THREE.MeshStandardMaterial({ color: 0x3c4145, roughness: 0.6, metalness: 0.16 });
    const black = new THREE.MeshStandardMaterial({ color: 0x191d20, roughness: 0.24, metalness: 0.28 });
    const skirtGrey = new THREE.MeshStandardMaterial({ color: 0x6b7176, roughness: 0.56, metalness: 0.2 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x91c7dd, transparent: true, opacity: 0.42, roughness: 0.06, side: THREE.DoubleSide });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a2, roughness: 0.36, metalness: 0.7 });
    const amber = new THREE.MeshStandardMaterial({ color: 0xd98214, roughness: 0.4 });
    const headlightMat = new THREE.MeshStandardMaterial({ color: 0xfffaf0, emissive: 0xfff0c8, emissiveIntensity: 0.55 });
    const tailLampMat = new THREE.MeshStandardMaterial({ color: 0x8f1418, emissive: 0xd42020, emissiveIntensity: 0.35 });
    const displayMat = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 700, height: 128, bg: '#0c0e10', fg: '#ff9d1c' }),
      side: THREE.DoubleSide
    });
    const interiorDisplayMat = this.context.makeInteriorDisplayMaterial();
    this.glassMaterial = glass;
    this.headLampMaterials.push(headlightMat);
    this.tailLampMaterials.push(tailLampMat);

    const livery: ModernTramLivery = {
      body: yellow,
      stripe: red,
      roof: roofGrey,
      band: black,
      skirt: skirtGrey,
      glass,
      metal,
      stripeY: 2.8, // shoulder band, just above the window band
      stripeHeightM: 0.18,
      // Older VBK cabin: cream lining, blue moquette, warm lighting.
      interior: {
        floor: new THREE.MeshStandardMaterial({ map: this.makeTramFloorTexture(), roughness: 0.94 }),
        ceiling: new THREE.MeshStandardMaterial({ color: 0xe6e3da, roughness: 0.88 }),
        wall: new THREE.MeshStandardMaterial({ color: 0xd9d5c8, roughness: 0.86 }),
        seatFabric: new THREE.MeshStandardMaterial({ map: this.makeTramSeatFabricTexture([44, 72, 116], [214, 196, 82]), roughness: 0.9 }),
        seatShell: new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.6 }),
        metal: new THREE.MeshStandardMaterial({ color: 0xb4b9bb, roughness: 0.32, metalness: 0.74 }),
        accent: new THREE.MeshStandardMaterial({ color: 0xe2b400, roughness: 0.44, metalness: 0.2 }),
        lightStrip: new THREE.MeshStandardMaterial({ color: 0xfff6e2, emissive: 0xfff0cc, emissiveIntensity: 0.7, roughness: 0.5 }),
        threshold: new THREE.MeshStandardMaterial({ color: 0xe2b400, roughness: 0.6 })
      }
    };

    // Three bodies, ~35.6 m over the couplers; 0.9 m articulation gaps.
    const sections = [
      { center: -11.7, length: 12.2, end: -1 as -1 | 0 | 1 },
      { center: 0, length: 9.4, end: 0 as -1 | 0 | 1 },
      { center: 11.7, length: 12.2, end: 1 as -1 | 0 | 1 }
    ];

    for (const section of sections) {
      const car = new THREE.Group();
      car.name = `Articulated car Karlsruhe VBK tram section ${section.center}`;
      car.userData.centerOffsetM = section.center;

      const cabDepth = section.end === 0 ? 0 : 1.9;
      const bodyLength = section.length - cabDepth;
      const bodyCenterZ = (-section.end * cabDepth) / 2;
      const doorZs = section.end === 0 ? [-2.4, 2.4] : [bodyCenterZ - 2.7, bodyCenterZ + 2.7];

      this.addModernTramModule(car, livery, { sectionLength: section.length, bodyLength, bodyCenterZ, doorZs, doorWidthM: 1.5 });

      if (section.end !== 0) {
        const cab = new THREE.Group();
        cab.position.z = section.end * (section.length / 2 - cabDepth);
        if (section.end < 0) cab.rotation.y = Math.PI;
        car.add(cab);

        const nose = new THREE.Mesh(this.makeKarlsruheTramCabNose(), yellow);
        nose.castShadow = true;
        cab.add(nose);
        this.passengerShells.push(nose);

        // Carries the roof cap over the cab; without it the cap's cut end shows from ahead.
        const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 1.9), roofGrey);
        cabRoof.position.set(0, 3.25, 0.9);
        cabRoof.rotation.x = 0.07;
        cab.add(cabRoof);
        this.passengerShells.push(cabRoof);

        // The shoulder band wraps around the front end on the prototype.
        const frontStripe = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.18, 0.12), red);
        frontStripe.position.set(0, 2.82, 1.6);
        cab.add(frontStripe);
        this.passengerShells.push(frontStripe);

        // Everything on the front end mounts to this group, which lies on the
        // planar cab face, so trim stays flush no matter how the rake changes.
        const front = new THREE.Group();
        front.position.set(0, 1.76, 1.73);
        front.rotation.x = -KARLSRUHE_TRAM_CAB_FRONT_RAKE;
        cab.add(front);

        const addFrontTrim = (mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh => {
          mesh.position.set(x, y, z);
          front.add(mesh);
          this.passengerShells.push(mesh);
          return mesh;
        };

        addFrontTrim(new THREE.Mesh(this.makeKarlsruheTramCabMask(), black), 0, 0.36, 0);

        const windscreenMaterial = glass.clone();
        windscreenMaterial.depthWrite = false;
        const windscreen = new THREE.Mesh(this.makeKarlsruheTramWindscreen(), windscreenMaterial);
        windscreen.position.set(0, 0.34, 0.04);
        windscreen.renderOrder = 10;
        front.add(windscreen);
        this.cabShells.push(windscreen);

        const routeDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.74, 0.26), displayMat);
        routeDisplay.position.set(0, 1.0, 0.09); // clear of the mask's +0.061 front face
        routeDisplay.renderOrder = 30;
        front.add(routeDisplay);
        this.cabDisplays.push(routeDisplay);

        // Casing behind the destination film. The cab mask is a passenger shell
        // and hides in interior views, which would otherwise leave passengers
        // reading the film's mirrored back face. A cab shell hides in cab view
        // only, so the driver still sees the line ahead.
        const displayCasing = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.34, 0.06), black);
        displayCasing.position.set(0, 1.0, 0.03);
        front.add(displayCasing);
        this.cabShells.push(displayCasing);

        // Lamp clusters with amber indicators, fleet plate and grey bumper on the apron.
        for (const x of [-0.86, 0.86]) {
          addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.24, 0.06), black), x, -0.6, 0.03);
          addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.11, 0.05), headlightMat), x - 0.11, -0.56, 0.07);
          addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.11, 0.05), amber), x + 0.13, -0.56, 0.07);
          addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, 0.05), tailLampMat), x, -0.69, 0.07);
        }
        const fleet = new THREE.Mesh(
          new THREE.PlaneGeometry(0.5, 0.16),
          new THREE.MeshBasicMaterial({
            map: makeLabelTexture('247', { width: 256, height: 96, bg: '#f3c400', fg: '#14181c' }),
            side: THREE.DoubleSide
          })
        );
        addFrontTrim(fleet, 0, -0.62, 0.05);
        addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.22, 0.12), skirtGrey), 0, -1.08, 0.02);
        addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.34), black), 0, -1.26, -0.08);

        // Next-stop display on the cab bulkhead, facing back down the saloon.
        // Shares the one interior-display material, so every module stays in sync.
        const bulkheadDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.66, 0.4), interiorDisplayMat);
        bulkheadDisplay.position.set(0, 2.74, section.end * 4.02);
        bulkheadDisplay.rotation.y = section.end === 1 ? Math.PI : 0;
        bulkheadDisplay.renderOrder = 18;
        car.add(bulkheadDisplay);
      } else {
        const interiorDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.72, 0.42), interiorDisplayMat);
        interiorDisplay.position.set(0, 2.76, 0);
        interiorDisplay.rotation.y = Math.PI;
        interiorDisplay.renderOrder = 18;
        car.add(interiorDisplay);
      }

      // The passenger rig anchors to cars[2]; seat it in the saloon behind the
      // front cab so the view down the car reads correctly.
      if (section.end === 1) {
        car.userData.passengerCameraLocal = [0.24, 2.02, -2.4];
        car.userData.passengerLookAtLocal = [0, 1.86, 24];
      }

      this.cars.push(car);
      this.root.add(car);
    }

    // Centred on, and slightly wider than, the 0.9 m articulation gaps.
    for (const z of [-5.15, 5.15]) {
      const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.44, 2.5, 0.96), black);
      bellows.position.set(0, 1.9, z);
      this.root.add(bellows);
      this.passengerShells.push(bellows);
    }
    for (const z of [-14.6, -5.15, 5.15, 14.6]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.36, 1.5), black);
      bogie.position.set(0, 0.42, z);
      this.root.add(bogie);
    }
    for (const z of [-9.6, 0, 9.6]) {
      const roofEquipment = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.2, 3.6), black);
      roofEquipment.position.set(0, 3.36, z);
      this.root.add(roofEquipment);
    }
    this.addPantograph(new THREE.Vector3(0, 3.56, 6.4), metal);
    this.addExteriorLightThrow(17.8, 1.35);
    this.trainHalfLengthM = 17.8;
    return this.createVehicleInstance();
  }

  // AVG's Stadler CITYLINK tram-train (Vossloh España design lineage): the same
  // KVV yellow, but with the red band carried low along the skirt, a black roof
  // and a steeply raked black wraparound cab mask over a rounded nose.
  createKarlsruheCitylinkVehicle(): VehicleInstance {
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf4b200, roughness: 0.32, metalness: 0.12 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd81e2d, roughness: 0.34, metalness: 0.06 });
    const roofBlack = new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.52, metalness: 0.2 });
    const black = new THREE.MeshStandardMaterial({ color: 0x14181b, roughness: 0.18, metalness: 0.34 });
    const underframe = new THREE.MeshStandardMaterial({ color: 0x4a5054, roughness: 0.62, metalness: 0.22 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x91c7dd, transparent: true, opacity: 0.42, roughness: 0.05, side: THREE.DoubleSide });
    const metal = new THREE.MeshStandardMaterial({ color: 0xa2a8aa, roughness: 0.34, metalness: 0.72 });
    const headlightMat = new THREE.MeshStandardMaterial({ color: 0xfffdf6, emissive: 0xfff4d4, emissiveIntensity: 0.55 });
    const tailLampMat = new THREE.MeshStandardMaterial({ color: 0x8f1418, emissive: 0xd42020, emissiveIntensity: 0.35 });
    const displayMat = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 700, height: 128, bg: '#0b0d0f', fg: '#ffb62c' }),
      side: THREE.DoubleSide
    });
    const interiorDisplayMat = this.context.makeInteriorDisplayMaterial();
    this.glassMaterial = glass;
    this.headLampMaterials.push(headlightMat);
    this.tailLampMaterials.push(tailLampMat);

    const livery: ModernTramLivery = {
      body: yellow,
      stripe: red,
      roof: roofBlack,
      band: black,
      skirt: underframe,
      glass,
      metal,
      stripeY: 1.02, // skirt-level band, as on the Citylink
      stripeHeightM: 0.34,
      // Current Stadler cabin: anthracite lining, LED strips, patterned moquette.
      interior: {
        floor: new THREE.MeshStandardMaterial({ map: this.makeTramFloorTexture(), color: 0x8d9296, roughness: 0.94 }),
        ceiling: new THREE.MeshStandardMaterial({ color: 0xf0f1ef, roughness: 0.86 }),
        wall: new THREE.MeshStandardMaterial({ color: 0x9fa5a9, roughness: 0.8 }),
        seatFabric: new THREE.MeshStandardMaterial({ map: this.makeTramSeatFabricTexture([38, 62, 104], [120, 152, 190]), roughness: 0.9 }),
        seatShell: new THREE.MeshStandardMaterial({ color: 0x2c3134, roughness: 0.52 }),
        metal: new THREE.MeshStandardMaterial({ color: 0xc2c7c9, roughness: 0.28, metalness: 0.8 }),
        accent: new THREE.MeshStandardMaterial({ color: 0xf0c020, roughness: 0.4, metalness: 0.22 }),
        lightStrip: new THREE.MeshStandardMaterial({ color: 0xf4fbff, emissive: 0xe8f4ff, emissiveIntensity: 0.85, roughness: 0.42 }),
        threshold: new THREE.MeshStandardMaterial({ color: 0xf0c020, roughness: 0.56 })
      }
    };

    // Three bodies, ~36.6 m over the couplers; 0.9 m articulation gaps.
    const sections = [
      { center: -12.0, length: 12.6, end: -1 as -1 | 0 | 1 },
      { center: 0, length: 9.6, end: 0 as -1 | 0 | 1 },
      { center: 12.0, length: 12.6, end: 1 as -1 | 0 | 1 }
    ];

    for (const section of sections) {
      const car = new THREE.Group();
      car.name = `Articulated car Karlsruhe AVG Citylink section ${section.center}`;
      car.userData.centerOffsetM = section.center;

      const cabDepth = section.end === 0 ? 0 : 2.05;
      const bodyLength = section.length - cabDepth;
      const bodyCenterZ = (-section.end * cabDepth) / 2;
      const doorZs = section.end === 0 ? [-2.5, 2.5] : [bodyCenterZ - 2.8, bodyCenterZ + 2.8];

      this.addModernTramModule(car, livery, { sectionLength: section.length, bodyLength, bodyCenterZ, doorZs, doorWidthM: 1.6 });

      if (section.end !== 0) {
        const cab = new THREE.Group();
        cab.position.z = section.end * (section.length / 2 - cabDepth);
        if (section.end < 0) cab.rotation.y = Math.PI;
        car.add(cab);

        const nose = new THREE.Mesh(this.makeCitylinkCabNose(), yellow);
        nose.castShadow = true;
        cab.add(nose);
        this.passengerShells.push(nose);

        const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.12, 1.75), roofBlack);
        cabRoof.position.set(0, 3.22, 0.82);
        cabRoof.rotation.x = 0.13;
        cab.add(cabRoof);
        this.passengerShells.push(cabRoof);

        const front = new THREE.Group();
        front.position.set(0, 1.71, 1.72);
        front.rotation.x = -CITYLINK_CAB_FRONT_RAKE;
        cab.add(front);

        const addFrontTrim = (mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh => {
          mesh.position.set(x, y, z);
          front.add(mesh);
          this.passengerShells.push(mesh);
          return mesh;
        };

        // Black wraparound mask: sweeps up around the screen and down over the nose.
        addFrontTrim(new THREE.Mesh(this.makeCitylinkCabMask(), black), 0, 0.2, 0);

        const windscreenMaterial = glass.clone();
        windscreenMaterial.depthWrite = false;
        const windscreen = new THREE.Mesh(this.makeCitylinkWindscreen(), windscreenMaterial);
        windscreen.position.set(0, 0.44, 0.04);
        windscreen.renderOrder = 10;
        front.add(windscreen);
        this.cabShells.push(windscreen);

        // The Citylink's mask reaches far higher and lower than the other cab
        // masks, so every piece mounted on it has to clear its +0.061 front face
        // or the black surround swallows it.
        const routeDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.24), displayMat);
        routeDisplay.position.set(0, 0.95, 0.09);
        routeDisplay.renderOrder = 30;
        front.add(routeDisplay);
        this.cabDisplays.push(routeDisplay);

        // Casing behind the film so passengers do not read its mirrored back
        // face once the cab mask hides in interior views (see the VBK tram).
        const displayCasing = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.32, 0.06), black);
        displayCasing.position.set(0, 0.95, 0.03);
        front.add(displayCasing);
        this.cabShells.push(displayCasing);

        // Slim lamp strips low in the black nose, AVG mark and fleet plate between them.
        for (const x of [-0.72, 0.72]) {
          addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.05), headlightMat), x, -0.52, 0.09);
          addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.05), tailLampMat), x, -0.66, 0.09);
        }
        const logo = new THREE.Mesh(
          new THREE.PlaneGeometry(0.56, 0.2),
          new THREE.MeshBasicMaterial({
            map: makeLabelTexture('AVG', { width: 256, height: 96, bg: '#14181b', fg: '#ffffff' }),
            side: THREE.DoubleSide
          })
        );
        addFrontTrim(logo, 0, -0.5, 0.09);
        const fleet = new THREE.Mesh(
          new THREE.PlaneGeometry(0.4, 0.13),
          new THREE.MeshBasicMaterial({
            map: makeLabelTexture('401', { width: 256, height: 96, bg: '#14181b', fg: '#d0d4d6' }),
            side: THREE.DoubleSide
          })
        );
        addFrontTrim(fleet, 0, -0.7, 0.09);
        addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.2, 0.12), red), 0, -1.02, 0.05);
        addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.2, 0.34), underframe), 0, -1.16, -0.08);

        // Next-stop display on the cab bulkhead, facing back down the saloon.
        const bulkheadDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.66, 0.4), interiorDisplayMat);
        bulkheadDisplay.position.set(0, 2.74, section.end * 4.05);
        bulkheadDisplay.rotation.y = section.end === 1 ? Math.PI : 0;
        bulkheadDisplay.renderOrder = 18;
        car.add(bulkheadDisplay);
      } else {
        const interiorDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.72, 0.42), interiorDisplayMat);
        interiorDisplay.position.set(0, 2.76, 0);
        interiorDisplay.rotation.y = Math.PI;
        interiorDisplay.renderOrder = 18;
        car.add(interiorDisplay);
      }

      if (section.end === 1) {
        car.userData.passengerCameraLocal = [0.24, 2.02, -2.4];
        car.userData.passengerLookAtLocal = [0, 1.86, 24];
      }

      this.cars.push(car);
      this.root.add(car);
    }

    for (const z of [-5.25, 5.25]) {
      const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.44, 2.5, 0.96), black);
      bellows.position.set(0, 1.9, z);
      this.root.add(bellows);
      this.passengerShells.push(bellows);
    }
    for (const z of [-15.2, -5.25, 5.25, 15.2]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.36, 1.52), underframe);
      bogie.position.set(0, 0.42, z);
      this.root.add(bogie);
    }
    for (const z of [-10.0, 0, 10.0]) {
      const roofEquipment = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.22, 3.8), roofBlack);
      roofEquipment.position.set(0, 3.37, z);
      this.root.add(roofEquipment);
    }
    this.addPantograph(new THREE.Vector3(0, 3.58, 6.8), metal);
    this.addExteriorLightThrow(18.3, 1.4);
    this.trainHalfLengthM = 18.3;
    return this.createVehicleInstance();
  }

  // TransLink SkyTrain (Bombardier Innovia Metro Mark III): a four-car
  // walk-through automated train. It is driverless, so the front is a
  // full-height panoramic window over a standing area rather than a cab, and it
  // takes power from a track-level rail — there is no pantograph.
  createSkyTrainVehicle(): VehicleInstance {
    const white = new THREE.MeshStandardMaterial({ color: 0xf3f5f7, roughness: 0.38, metalness: 0.16 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x0033a0, roughness: 0.34, metalness: 0.12 });
    const cyan = new THREE.MeshStandardMaterial({ color: 0x35b3e0, roughness: 0.34, metalness: 0.1 });
    const black = new THREE.MeshStandardMaterial({ color: 0x13171b, roughness: 0.2, metalness: 0.34 });
    const silver = new THREE.MeshStandardMaterial({ color: 0xb6bcc1, roughness: 0.44, metalness: 0.34 });
    const underframe = new THREE.MeshStandardMaterial({ color: 0x24282c, roughness: 0.74, metalness: 0.2 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x8fbcd4, transparent: true, opacity: 0.4, roughness: 0.05, side: THREE.DoubleSide });
    const floor = new THREE.MeshStandardMaterial({ color: 0x6d7276, roughness: 0.92 });
    const interior = new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: 0.84 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x1f4fa0, roughness: 0.9 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xa8adb0, roughness: 0.32, metalness: 0.76 });
    const displayMat = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 700, height: 128, bg: '#0b0e12', fg: '#ffd23a' })
    });
    const headlightMat = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, emissive: 0xfff4d6, emissiveIntensity: 0.55, roughness: 0.16 });
    const tailLampMat = new THREE.MeshStandardMaterial({ color: 0x8e1518, emissive: 0xd42020, emissiveIntensity: 0.35, roughness: 0.24 });
    this.headLampMaterials.push(headlightMat);
    this.tailLampMaterials.push(tailLampMat);
    this.glassMaterial = glass;
    const interiorDisplayMat = this.context.makeInteriorDisplayMaterial();

    const cabDepth = 1.6;
    const carLength = 16.6;
    const halfCar = carLength / 2;
    // Chords of the rounded roof edge in makeModernTramBody; a single flat strip
    // would either sink into or float off the curve.
    const shoulderSegments = [
      { x: 1.309, y: 3.08, height: 0.26, tilt: 0.316 },
      { x: 1.224, y: 3.265, height: 0.2, tilt: 0.579 }
    ];

    const sections = [
      { center: -25.5, cab: -1 as -1 | 0 | 1 },
      { center: -8.5, cab: 0 as -1 | 0 | 1 },
      { center: 8.5, cab: 0 as -1 | 0 | 1 },
      { center: 25.5, cab: 1 as -1 | 0 | 1 }
    ];

    for (const section of sections) {
      const car = new THREE.Group();
      car.name = `Articulated car SkyTrain Mark III section ${section.center}`;
      car.userData.centerOffsetM = section.center;

      const bodyLength = section.cab === 0 ? carLength : carLength - cabDepth;
      const bodyCenterZ = (-section.cab * cabDepth) / 2;
      const doorCenters = [bodyCenterZ - 5.2, bodyCenterZ, bodyCenterZ + 5.2];

      const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.3, bodyLength - 0.1), underframe);
      skirt.position.set(0, 0.42, bodyCenterZ);
      car.add(skirt);
      this.passengerShells.push(skirt);

      const body = new THREE.Mesh(this.makeModernTramBody(2.6, 3.35, bodyLength), white);
      body.position.z = bodyCenterZ;
      body.castShadow = true;
      car.add(body);
      this.passengerShells.push(body);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.11, bodyLength - 0.2), silver);
      roof.position.set(0, 3.36, bodyCenterZ);
      car.add(roof);
      this.passengerShells.push(roof);

      for (const side of [-1, 1] as const) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.16, bodyLength), black);
        band.position.set(side * 1.33, 2.42, bodyCenterZ);
        car.add(band);
        this.windowBands.push(band);

        for (const segment of shoulderSegments) {
          const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.06, segment.height, bodyLength), white);
          shoulder.position.set(side * segment.x, segment.y, bodyCenterZ);
          shoulder.rotation.z = side * segment.tilt;
          car.add(shoulder);
          this.passengerShells.push(shoulder);
        }

        // TransLink blue skirt band with the light-blue separator above it.
        const blueBand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.78, bodyLength), blue);
        blueBand.position.set(side * 1.315, 0.95, bodyCenterZ);
        car.add(blueBand);
        this.passengerShells.push(blueBand);

        const accent = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.07, bodyLength), cyan);
        accent.position.set(side * 1.318, 1.4, bodyCenterZ);
        car.add(accent);
        this.passengerShells.push(accent);

        for (let index = 0; index < doorCenters.length; index++) {
          const doorZ = doorCenters[index];
          this.addSlidingVehicleDoor(car, side * 1.348, doorZ, white, glass, black, 1.5, 2.02);
          for (const edge of [-0.8, 0.8]) {
            const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.18, 0.09), black);
            jamb.position.set(side * 1.316, 1.78, doorZ + edge);
            car.add(jamb);
            this.passengerShells.push(jamb);
          }
          // Long side windows fill the bays between the three door pairs.
          const nextZ = doorCenters[index + 1];
          if (nextZ !== undefined) {
            const pane = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.98, nextZ - doorZ - 1.9), glass);
            pane.position.set(side * 1.348, 2.42, (doorZ + nextZ) / 2);
            car.add(pane);
          }
        }
        // End bays outside the first and last doors.
        for (const end of [-1, 1] as const) {
          const outer = bodyCenterZ + end * (bodyLength / 2 - 0.2);
          const inner = doorCenters[end < 0 ? 0 : doorCenters.length - 1] + end * 0.95;
          if (Math.abs(outer - inner) < 0.7) continue;
          const pane = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.98, Math.abs(outer - inner)), glass);
          pane.position.set(side * 1.348, 2.42, (outer + inner) / 2);
          car.add(pane);
        }
      }

      const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.08, carLength - 0.26), floor);
      floorMesh.position.y = 0.98;
      car.add(floorMesh);
      const ceilingMesh = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.08, carLength - 0.34), interior);
      ceilingMesh.position.y = 3.12;
      car.add(ceilingMesh);
      this.addOpaqueTransitInterior(car, carLength - 0.34, 1.18, interior, () => doorCenters);
      this.addSkyTrainInterior(car, bodyCenterZ, bodyLength, doorCenters, seat, metal, interior);
      this.addCabinLight(car, 3.0, -3.6);
      this.addCabinLight(car, 3.0, 3.6);

      if (section.cab === 0) {
        const interiorDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.4), interiorDisplayMat);
        interiorDisplay.position.set(0, 2.94, 0);
        interiorDisplay.rotation.y = Math.PI;
        interiorDisplay.renderOrder = 18;
        car.add(interiorDisplay);
      } else {
        const cab = new THREE.Group();
        cab.position.z = section.cab * (halfCar - cabDepth);
        if (section.cab < 0) cab.rotation.y = Math.PI;
        car.add(cab);

        // Opaque nose bodywork is a passenger shell so it clears in both interior
        // views; only the glazing stays a cab shell.
        const nose = new THREE.Mesh(this.makeSkyTrainNose(), white);
        nose.castShadow = true;
        cab.add(nose);
        this.passengerShells.push(nose);

        const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.11, 1.1), silver);
        cabRoof.position.set(0, 3.35, 0.42);
        cabRoof.rotation.x = 0.12;
        cab.add(cabRoof);
        this.passengerShells.push(cabRoof);

        // Front-end trim mounts to the planar cab face (see SKYTRAIN_CAB_FRONT_RAKE).
        const front = new THREE.Group();
        front.position.set(0, 1.904, 1.51);
        front.rotation.x = -SKYTRAIN_CAB_FRONT_RAKE;
        cab.add(front);

        const addFrontTrim = (mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh => {
          mesh.position.set(x, y, z);
          front.add(mesh);
          this.passengerShells.push(mesh);
          return mesh;
        };

        addFrontTrim(new THREE.Mesh(this.makeSkyTrainWindowMask(), black), 0, 0.22, 0);

        // The panoramic window reaches down to standing height — SkyTrain's
        // front-row view is the point of a driverless train.
        const windscreenMaterial = glass.clone();
        windscreenMaterial.depthWrite = false;
        const windscreen = new THREE.Mesh(this.makeSkyTrainWindscreen(), windscreenMaterial);
        windscreen.position.set(0, 0.14, 0.04);
        windscreen.renderOrder = 10;
        front.add(windscreen);
        this.cabShells.push(windscreen);

        const routeDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.24), displayMat);
        routeDisplay.position.set(0, 0.92, 0.09);
        routeDisplay.renderOrder = 30;
        front.add(routeDisplay);
        this.cabDisplays.push(routeDisplay);

        addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.62, 0.05), blue), 0, -1.08, 0.03);
        addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.07, 0.05), cyan), 0, -0.74, 0.03);
        addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.16, 0.14), underframe), 0, -1.44, 0.05);

        for (const x of [-0.88, 0.88]) {
          addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.18, 0.06), black), x, -0.86, 0.03);
          addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.09, 0.05), headlightMat), x, -0.83, 0.07);
          addFrontTrim(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.05), tailLampMat), x, -0.93, 0.07);
        }

        const roundel = new THREE.Mesh(
          new THREE.PlaneGeometry(0.86, 0.2),
          new THREE.MeshBasicMaterial({
            map: makeLabelTexture('SkyTrain', { width: 384, height: 96, bg: '#0033a0', fg: '#ffffff' }),
            side: THREE.DoubleSide
          })
        );
        addFrontTrim(roundel, 0, -1.12, 0.08);
      }

      this.cars.push(car);
      this.root.add(car);
    }

    // Open walk-through gangways: full-height bellows over the 0.4 m car gaps.
    for (const z of [-17, 0, 17]) {
      const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.66, 0.52), black);
      bellows.position.set(0, 1.96, z);
      this.root.add(bellows);
      this.passengerShells.push(bellows);
    }
    for (const center of [-25.5, -8.5, 8.5, 25.5]) {
      for (const offset of [-5.2, 5.2]) {
        const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.36, 1.9), underframe);
        bogie.position.set(0, 0.42, center + offset);
        this.root.add(bogie);
        // Linear induction motor plate between the running rails: SkyTrain has no
        // traction motors in the axles and no pantograph on the roof.
        const linearMotor = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 2.5), silver);
        linearMotor.position.set(0, 0.3, center + offset);
        this.root.add(linearMotor);
      }
      const collectorShoe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 1.4), metal);
      collectorShoe.position.set(1.2, 0.52, center);
      this.root.add(collectorShoe);
      for (const z of [center - 4.2, center + 4.2]) {
        const roofHvac = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.24, 3.2), silver);
        roofHvac.position.set(0, 3.5, z);
        this.root.add(roofHvac);
      }
    }
    this.addExteriorLightThrow(33.8, 1.5);
    this.trainHalfLengthM = 33.8;
    return this.createVehicleInstance();
  }

  // Perimeter bench seating, stanchions and overhead rails: SkyTrain seats along
  // the walls to leave the aisle clear, so the interior is mostly standing room.
  private addSkyTrainInterior(
    car: THREE.Group,
    bodyCenterZ: number,
    bodyLength: number,
    doorCenters: number[],
    seatMaterial: THREE.Material,
    metalMaterial: THREE.Material,
    trimMaterial: THREE.Material
  ): void {
    const bayEdges = [bodyCenterZ - bodyLength / 2 + 0.4, ...doorCenters, bodyCenterZ + bodyLength / 2 - 0.4];
    for (let index = 0; index < bayEdges.length - 1; index++) {
      const start = bayEdges[index] + (index === 0 ? 0.1 : 0.95);
      const end = bayEdges[index + 1] - (index === bayEdges.length - 2 ? 0.1 : 0.95);
      const length = end - start;
      if (length < 0.6) continue;
      for (const side of [-1, 1] as const) {
        const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.11, length), seatMaterial);
        cushion.position.set(side * 0.92, 1.29, (start + end) / 2);
        car.add(cushion);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.56, length), seatMaterial);
        back.position.set(side * 1.13, 1.6, (start + end) / 2);
        car.add(back);
        const armrest = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, length, 8), metalMaterial);
        armrest.rotation.x = Math.PI / 2;
        armrest.position.set(side * 0.7, 1.32, (start + end) / 2);
        car.add(armrest);
      }
    }

    for (const doorZ of doorCenters) {
      for (const x of [-0.62, 0.62]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 1.86, 10), metalMaterial);
        pole.position.set(x, 1.97, doorZ);
        car.add(pole);
      }
    }
    for (const x of [-0.66, 0.66]) {
      const grabRail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, bodyLength - 0.6, 8), metalMaterial);
      grabRail.rotation.x = Math.PI / 2;
      grabRail.position.set(x, 2.88, bodyCenterZ);
      car.add(grabRail);
    }
    const lightMaterial = new THREE.MeshStandardMaterial({
      color: 0xf8fbfd,
      emissive: 0xe6f1f8,
      emissiveIntensity: 1.6,
      roughness: 0.32
    });
    for (const x of [-0.78, 0.78]) {
      const lightStrip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, bodyLength - 0.5), lightMaterial);
      lightStrip.position.set(x, 3.07, bodyCenterZ);
      car.add(lightStrip);
    }
    const threshold = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.02, 0.14), trimMaterial);
    threshold.position.set(0, 1.03, bodyCenterZ);
    car.add(threshold);
  }

  createStadtbahnVehicle(): VehicleInstance {
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xffdf00, roughness: 0.34, metalness: 0.05, clearcoat: 0.42, clearcoatRoughness: 0.25 });
    bodyMat.name = 'SSB satin yellow paint';
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x17232b, roughness: 0.38 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x91c7dd,
      roughness: 0.08,
      metalness: 0.02,
      transparent: true,
      opacity: 0.58,
      depthWrite: true,
      side: THREE.DoubleSide
    });
    this.glassMaterial = glassMat;
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xbfc1bd, roughness: 0.64, metalness: 0.12 });
    const doorMat = new THREE.MeshPhysicalMaterial({ color: 0xf6c900, roughness: 0.38, clearcoat: 0.3, clearcoatRoughness: 0.28 });
    const interiorWallMat = new THREE.MeshStandardMaterial({ color: 0xd9d5ca, roughness: 0.88 });
    const interiorFloorMat = new THREE.MeshStandardMaterial({ map: makeSsbSurfaceTexture('floor'), roughness: 0.94 });
    const seatFabricMat = new THREE.MeshStandardMaterial({ map: makeSsbSurfaceTexture('fabric'), roughness: 0.96 });
    seatFabricMat.name = 'SSB woven blue upholstery';
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x11151b, roughness: 0.8 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x8a8f91, roughness: 0.4, metalness: 0.65 });
    const doorButtonMat = new THREE.MeshStandardMaterial({
      color: 0x5b7754,
      emissive: 0x84c66b,
      emissiveIntensity: 0.32,
      roughness: 0.42
    });
    // Each monitor has its own outward-facing screen; never show mirrored back faces.
    const interiorDisplayMat = this.context.makeInteriorDisplayMaterial().clone();
    interiorDisplayMat.side = THREE.FrontSide;
    const destinationMaterial = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 512, height: 128, bg: '#111', fg: '#ffd900' }),
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });

    const doubleFormation = isStadtbahnDoubleFormation(this.context.route.line);
    const carCenters = doubleFormation ? [-29.85, -9.95, 9.95, 29.85] : [-9.95, 9.95];
    const cabDirections: (-1 | 1)[] = doubleFormation ? [-1, 1, -1, 1] : [-1, 1];
    this.trainHalfLengthM = doubleFormation ? 40.05 : 20.15;
    carCenters.forEach((center, index) => {
      this.cars.push(
        this.addTangoCar(
          center,
          cabDirections[index],
          bodyMat,
          glassMat,
          doorMat,
          blackMat,
          roofMat,
          interiorWallMat,
          interiorFloorMat,
          seatFabricMat,
          metalMat,
          doorButtonMat,
          interiorDisplayMat,
          destinationMaterial
        )
      );
    });

    for (const z of doubleFormation ? [-19.9, 19.9] : [0]) {
      const gangway = new THREE.Mesh(new THREE.BoxGeometry(2.42, 2.48, 1.05), rubberMat);
      gangway.position.set(0, 1.78, z);
      gangway.castShadow = true;
      this.root.add(gangway);
    }

    if (doubleFormation) {
      const middleCouplerA = this.makeCoupler();
      middleCouplerA.position.set(0, 0.55, 0.55);
      this.root.add(middleCouplerA);
      const middleCouplerB = this.makeCoupler();
      middleCouplerB.position.set(0, 0.55, -0.55);
      middleCouplerB.rotation.y = Math.PI;
      this.root.add(middleCouplerB);
    }

    const couplerFront = this.makeCoupler();
    couplerFront.position.set(0, 0.55, -(doubleFormation ? 40.05 : 20.15));
    this.root.add(couplerFront);
    const couplerRear = this.makeCoupler();
    couplerRear.position.set(0, 0.55, doubleFormation ? 40.05 : 20.15);
    couplerRear.rotation.y = Math.PI;
    this.root.add(couplerRear);

    // The route display sits in the black mask band above the raked windscreen, so the
    // assembly is yawed to face outward and tilted to match the nose rake.
    const noseTilt = 0.258;
    const addCabRouteDisplay = (car: THREE.Group, cabDirection: -1 | 1, label: string) => {
      const assembly = new THREE.Group();
      assembly.name = `${label} cab route display assembly`;
      assembly.position.set(0, 2.72, cabDirection * 9.8);
      assembly.rotation.y = cabDirection < 0 ? Math.PI : 0;
      const tilted = new THREE.Group();
      tilted.rotation.x = -noseTilt;
      assembly.add(tilted);
      const recess = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.4, 0.03), blackMat);
      recess.name = `${label} cab display recess`;
      tilted.add(recess);
      const display = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.3), destinationMaterial);
      display.name = `${label} cab route display`;
      display.position.z = 0.025;
      display.renderOrder = 20;
      tilted.add(display);
      car.add(assembly);
      this.cabShells.push(recess);
      this.cabDisplays.push(display);
    };
    addCabRouteDisplay(this.cars[0], -1, 'Front');
    const rearCar = this.cars.at(-1);
    if (rearCar) addCabRouteDisplay(rearCar, 1, 'Rear');

    for (const z of doubleFormation ? [-15.3, 24.5] : [4.6]) {
      this.addPantograph(new THREE.Vector3(-0.2, 3.75, z), metalMat);
    }

    this.addExteriorLightThrow(this.trainHalfLengthM, 1.35);

    return this.createVehicleInstance();
  }

  // Shared part builders live in ./parts.ts; these thin wrappers keep the
  // factory's collector fields as the single place part output is gathered.
  private addExteriorLightThrow(halfLengthM: number, beamHeightM: number): void {
    addExteriorLightThrow(this.root, this.lightRig, halfLengthM, beamHeightM);
  }

  private addCabinLight(parent: THREE.Object3D, y: number, z = 0): void {
    addCabinLight(this.lightRig, parent, y, z);
  }

  private addSlidingVehicleDoor(
    car: THREE.Group,
    x: number,
    z: number,
    doorMaterial: THREE.Material,
    glassMaterial: THREE.Material,
    openingMaterial: THREE.Material,
    width: number,
    height: number
  ): void {
    addSlidingVehicleDoor(this.doors, car, x, z, doorMaterial, glassMaterial, openingMaterial, width, height);
  }

  private addOpaqueTransitInterior(
    car: THREE.Group,
    length: number,
    halfWidth: number,
    material: THREE.Material,
    doorZones: (side: -1 | 1) => number[]
  ): void {
    addOpaqueTransitInterior(car, length, halfWidth, material, doorZones);
  }

  private addTangoCar(
    centerZ: number,
    cabDirection: -1 | 1,
    bodyMat: THREE.Material,
    glassMat: THREE.Material,
    doorMat: THREE.Material,
    blackMat: THREE.Material,
    roofMat: THREE.Material,
    interiorWallMat: THREE.Material,
    interiorFloorMat: THREE.Material,
    seatFabricMat: THREE.Material,
    metalMat: THREE.Material,
    doorButtonMat: THREE.Material,
    interiorDisplayMat: THREE.Material,
    destinationMaterial: THREE.Material
  ): THREE.Group {
    const car = new THREE.Group();
    car.name = `Articulated car ${centerZ}`;
    car.userData.centerOffsetM = centerZ;
    // Car +Z follows travel; a rear-facing cab in a coupled set must not reverse the view.
    car.userData.passengerCameraLocal = [0.08, 2.3, -4.8];
    car.userData.passengerLookAtLocal = [0.05, 2.2, 7.5];
    car.position.z = centerZ;
    const lowerSkirt = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.24, 17.75), blackMat);
    lowerSkirt.position.y = 0.43;
    lowerSkirt.castShadow = true;
    car.add(lowerSkirt);
    this.passengerShells.push(lowerSkirt);
    const body = new THREE.Mesh(this.makeTangoBody(), bodyMat);
    body.position.y = 0.52;
    body.castShadow = true;
    car.add(body);
    this.passengerShells.push(body);
    // The real DT8 roof deck is light grey; only the side fairings stay yellow.
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.24, 16.9), roofMat);
    roof.position.y = 3.34;
    roof.castShadow = true;
    car.add(roof);
    this.passengerShells.push(roof);
    for (const side of [-1, 1]) {
      const roofFairing = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.36, 16.35), bodyMat);
      roofFairing.position.set(side * 1.12, 3.36, 0);
      roofFairing.castShadow = true;
      car.add(roofFairing);
      this.passengerShells.push(roofFairing);
    }

    // Rounded cab shoulders and a raked panoramic screen share the same end geometry.
    const cabZ = cabDirection * 9.38; // interior shell reference (dashboard/cab wall)
    const noseTilt = 0.258; // windscreen rake of the DT8 Tango face
    const faceTilt = -cabDirection * noseTilt;
    const nose = new THREE.Mesh(this.makeTangoNose(), bodyMat);
    nose.position.z = cabDirection * 9.05;
    if (cabDirection < 0) nose.rotation.y = Math.PI;
    nose.castShadow = true;
    car.add(nose);
    this.cabShells.push(nose);

    const cabMask = new THREE.Mesh(this.makeTangoCabMask(), blackMat);
    cabMask.position.set(0, 2.14, cabDirection * 9.86);
    cabMask.rotation.x = faceTilt;
    car.add(cabMask);
    this.cabShells.push(cabMask);

    const windscreen = new THREE.Mesh(this.makeTangoWindscreen(), glassMat);
    windscreen.position.set(0, 2.16, cabDirection * 9.92);
    windscreen.rotation.x = faceTilt;
    car.add(windscreen);

    const windshieldTrim = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), blackMat, 3);
    windshieldTrim.name = 'SSB windshield divider and dual wipers';
    const windshieldMatrix = new THREE.Matrix4();
    const windshieldPosition = new THREE.Vector3();
    const windshieldRotation = new THREE.Quaternion();
    const windshieldScale = new THREE.Vector3();
    for (const [index, x] of [-0.34, 0.34].entries()) {
      windshieldPosition.set(x, 1.78, cabDirection * 10.09);
      windshieldRotation.setFromEuler(new THREE.Euler(faceTilt, 0, (index === 0 ? 1 : -1) * cabDirection * 0.48));
      windshieldScale.set(0.035, 0.82, 0.03);
      windshieldMatrix.compose(windshieldPosition, windshieldRotation, windshieldScale);
      windshieldTrim.setMatrixAt(index, windshieldMatrix);
    }
    windshieldPosition.set(0, 2.18, cabDirection * 10.0);
    windshieldRotation.setFromEuler(new THREE.Euler(faceTilt, 0, 0));
    windshieldScale.set(0.032, 0.96, 0.028);
    windshieldMatrix.compose(windshieldPosition, windshieldRotation, windshieldScale);
    windshieldTrim.setMatrixAt(2, windshieldMatrix);
    windshieldTrim.instanceMatrix.needsUpdate = true;
    car.add(windshieldTrim);
    this.cabShells.push(windshieldTrim);

    const bumperGeometry = new RoundedBoxGeometry(2.28, 0.48, 0.32, 8, 0.15);
    const bumperVertices = bumperGeometry.getAttribute('position');
    for (let i = 0; i < bumperVertices.count; i++) {
      bumperVertices.setZ(i, bumperVertices.getZ(i) + tangoApronBow(bumperVertices.getX(i), bumperVertices.getY(i) + 0.65));
    }
    bumperGeometry.computeVertexNormals();
    const bumper = new THREE.Mesh(bumperGeometry, bodyMat);
    bumper.position.set(0, 0.65, cabDirection * 9.9);
    if (cabDirection < 0) bumper.rotation.y = Math.PI;
    car.add(bumper);
    this.cabShells.push(bumper);

    const couplerRecess = new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.43, 0.035, 4, 0.04), blackMat);
    couplerRecess.position.set(0, 0.62, cabDirection * (10.073 + tangoApronBow(0, 0.62)));
    car.add(couplerRecess);
    this.cabShells.push(couplerRecess);
    for (const side of [-1, 1]) {
      const points = Array.from({ length: 17 }, (_, index) => {
        const x = side * (0.305 + index * 0.75 / 16);
        return new THREE.Vector3(x, 0.92, cabDirection * (10.075 + tangoApronBow(x, 0.92)));
      });
      const panelJoint = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 16, 0.006, 4, false), blackMat);
      car.add(panelJoint);
      this.cabShells.push(panelJoint);
    }

    // Corner light clusters: round LED headlamp, indicator and tail lamp, as on the DT8.12.
    const headlightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4c7, emissiveIntensity: 0.55 });
    const indicatorMat = new THREE.MeshStandardMaterial({ color: 0xffb340, emissive: 0xff9d1e, emissiveIntensity: 1.4 });
    const tailLampMat = new THREE.MeshStandardMaterial({ color: 0x8c1f1c, emissive: 0x7a1512, emissiveIntensity: 0.35 });
    const lampHousingMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.34, metalness: 0.4 });
    this.headLampMaterials.push(headlightMat);
    this.tailLampMaterials.push(tailLampMat);
    for (const x of [-1, 1] as const) {
      const housing = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.21, 0.09, 5, 0.07), lampHousingMat);
      housing.position.set(x * 0.82, 1.12, cabDirection * 10.06);
      car.add(housing);
      this.cabShells.push(housing);
      const headlight = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 18), headlightMat);
      headlight.rotation.x = Math.PI / 2;
      headlight.position.set(x * 0.69, 1.12, cabDirection * 10.11);
      car.add(headlight);
      const indicator = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.055, 14), indicatorMat);
      indicator.rotation.x = Math.PI / 2;
      indicator.position.set(x * 0.97, 1.12, cabDirection * 10.11);
      car.add(indicator);
      const tailLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.055, 14), tailLampMat);
      tailLamp.rotation.x = Math.PI / 2;
      tailLamp.position.set(x * 0.85, 1.12, cabDirection * 10.11);
      car.add(tailLamp);
      this.cabShells.push(headlight, indicator, tailLamp);
    }

    // Rear-view mirrors just ahead of the cab side windows.
    for (const side of [-1, 1] as const) {
      const mirrorArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.05), blackMat);
      mirrorArm.position.set(side * 1.38, 2.6, cabDirection * 8.95);
      car.add(mirrorArm);
      const mirrorHead = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.17), blackMat);
      mirrorHead.position.set(side * 1.48, 2.55, cabDirection * 8.95);
      car.add(mirrorHead);
    }

    const frontLogo = new THREE.Mesh(
      new THREE.PlaneGeometry(0.58, 0.22),
      new THREE.MeshBasicMaterial({ map: makeLabelTexture('SSB', { width: 288, height: 96, bg: '#ffdf00', fg: '#ffffff' }), side: THREE.DoubleSide })
    );
    frontLogo.position.set(0, 1.27, cabDirection * 10.06);
    if (cabDirection < 0) frontLogo.rotation.y = Math.PI;
    car.add(frontLogo);
    this.cabShells.push(frontLogo);

    const cabNumber = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.1),
      new THREE.MeshBasicMaterial({
        map: makeLabelTexture(cabDirection < 0 ? '3501' : '3502', { width: 192, height: 64, bg: '#ffdf00', fg: '#17232b' }),
        side: THREE.DoubleSide
      })
    );
    cabNumber.position.set(-0.86 * cabDirection, 1.32, cabDirection * 10.06);
    if (cabDirection < 0) cabNumber.rotation.y = Math.PI;
    car.add(cabNumber);
    this.cabShells.push(cabNumber);

    for (const side of [-1, 1]) {
      const sideGroup = new THREE.Group();
      sideGroup.position.x = side * 1.345;
      // Band runs all the way into the cab side window, like the real DT8 glazing sweep.
      const windowBand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.08, 17.5), blackMat);
      windowBand.position.set(0, 2.31, cabDirection * 0.3);
      sideGroup.add(windowBand);
      this.windowBands.push(windowBand);
      for (const z of [-7.55, -3.45, -0.75, 5.45, 7.45]) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.8, z === -0.75 ? 1.7 : 1.9), glassMat);
        window.position.set(0.02, 2.26, z);
        sideGroup.add(window);
      }
      const cabSideWindow = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.82, 1.18), glassMat);
      cabSideWindow.position.set(0.015, 2.3, cabDirection * 8.33);
      sideGroup.add(cabSideWindow);
      for (const z of [-5.55, 3.15]) {
        for (const edge of [-1, 1]) {
          const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.11, 2.03, 0.09), blackMat);
          jamb.position.set(0.035, 1.69, z + edge * 0.765);
          sideGroup.add(jamb);
        }
        const doorHeader = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 1.62), blackMat);
        doorHeader.position.set(0.035, 2.67, z);
        sideGroup.add(doorHeader);
        const threshold = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 1.62), blackMat);
        threshold.position.set(0.035, 0.73, z);
        sideGroup.add(threshold);

        for (const direction of [-1, 1] as const) {
          const closedZ = z + direction * 0.36;
          const leafGroup = new THREE.Group();
          leafGroup.name = `Sliding door leaf ${side}/${z}/${direction}`;
          leafGroup.position.z = closedZ;
          for (const edge of [-1, 1] as const) {
            const stile = new THREE.Mesh(new THREE.BoxGeometry(0.125, 1.9, 0.1), doorMat);
            stile.position.set(0.055, 1.69, edge * 0.295);
            leafGroup.add(stile);
          }
          const doorGlass = new THREE.Mesh(new THREE.BoxGeometry(0.082, 1.5, 0.5), glassMat);
          doorGlass.position.set(0.05, 1.9, 0);
          leafGroup.add(doorGlass);
          const upperFrame = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.69), blackMat);
          upperFrame.position.set(0.06, 2.58, 0);
          leafGroup.add(upperFrame);
          const lowerFrame = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.22, 0.69), blackMat);
          lowerFrame.position.set(0.06, 0.9, 0);
          leafGroup.add(lowerFrame);
          const innerEdge = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.88, 0.035), blackMat);
          innerEdge.position.set(0.085, 1.69, -direction * 0.345);
          leafGroup.add(innerEdge);
          sideGroup.add(leafGroup);
          this.doors.push({ group: leafGroup, closedZ, direction });
        }
      }
      const logo = new THREE.Mesh(
        new THREE.PlaneGeometry(1.18, 0.4),
        new THREE.MeshBasicMaterial({ map: makeLabelTexture('SSB', { width: 256, height: 96, bg: '#ffdf00', fg: '#111' }) })
      );
      logo.position.set(side * 0.055, 1.15, cabDirection * 6.65);
      logo.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      sideGroup.add(logo);

      const fleetNumber = new THREE.Mesh(
        new THREE.PlaneGeometry(0.48, 0.15),
        new THREE.MeshBasicMaterial({ map: makeLabelTexture(cabDirection < 0 ? '3501' : '3502', { width: 256, height: 80, bg: '#ffdf00', fg: '#17232b' }) })
      );
      fleetNumber.position.set(side * 0.058, 0.9, cabDirection * 7.55);
      fleetNumber.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      sideGroup.add(fleetNumber);
      car.add(sideGroup);
    }

    const sideDisplays = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.54, 0.29), destinationMaterial, 2);
    const sideDisplayMatrix = new THREE.Matrix4();
    const sideDisplayPosition = new THREE.Vector3();
    const sideDisplayRotation = new THREE.Quaternion();
    for (const [index, side] of [-1, 1].entries()) {
      sideDisplayPosition.set(side * 1.408, 2.5, -0.75);
      sideDisplayRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), side > 0 ? Math.PI / 2 : -Math.PI / 2);
      sideDisplayMatrix.compose(sideDisplayPosition, sideDisplayRotation, new THREE.Vector3(1, 1, 1));
      sideDisplays.setMatrixAt(index, sideDisplayMatrix);
    }
    sideDisplays.name = 'SSB exterior side destination displays';
    sideDisplays.renderOrder = 20;
    sideDisplays.instanceMatrix.needsUpdate = true;
    car.add(sideDisplays);
    this.passengerShells.push(sideDisplays);

    const doorButtons = new THREE.InstancedMesh(new THREE.SphereGeometry(0.065, 10, 8), doorButtonMat, 4);
    const doorButtonMatrix = new THREE.Matrix4();
    let buttonIndex = 0;
    for (const side of [-1, 1]) {
      for (const z of [-5.55, 3.15]) {
        doorButtonMatrix.makeTranslation(side * 1.425, 1.64, z + 0.62);
        doorButtons.setMatrixAt(buttonIndex++, doorButtonMatrix);
      }
    }
    doorButtons.name = 'SSB illuminated exterior door buttons';
    doorButtons.userData.liveOverviewOmit = true;
    doorButtons.instanceMatrix.needsUpdate = true;
    car.add(doorButtons);

    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.08, 16.6), interiorFloorMat);
    floor.name = 'SSB speckled saloon floor';
    floor.receiveShadow = true;
    floor.position.y = 1.02;
    car.add(floor);
    this.addInteriorShell(car, cabZ, cabDirection, interiorWallMat, blackMat, glassMat, doorMat);
    this.addPassengerSeating(car, cabDirection, metalMat, doorMat, seatFabricMat);
    this.addInteriorDisplays(car, cabDirection, interiorDisplayMat, blackMat);
    addTangoExteriorDetails(car, this.passengerShells, metalMat, blackMat);

    const hvacCenters = [-5.1, 0, 5.1];
    const hvacUnits = new THREE.InstancedMesh(new THREE.BoxGeometry(1.72, 0.24, 2.25), roofMat, hvacCenters.length);
    const hvacMatrix = new THREE.Matrix4();
    hvacCenters.forEach((z, index) => {
      hvacMatrix.makeTranslation(0, 3.57, z);
      hvacUnits.setMatrixAt(index, hvacMatrix);
    });
    hvacUnits.name = 'SSB roof HVAC units';
    hvacUnits.instanceMatrix.needsUpdate = true;
    car.add(hvacUnits);

    const hvacVents = new THREE.InstancedMesh(new THREE.BoxGeometry(1.42, 0.03, 0.07), blackMat, hvacCenters.length * 5);
    let ventIndex = 0;
    for (const z of hvacCenters) {
      for (let vent = -2; vent <= 2; vent++) {
        hvacMatrix.makeTranslation(0, 3.7, z + vent * 0.28);
        hvacVents.setMatrixAt(ventIndex++, hvacMatrix);
      }
    }
    hvacVents.name = 'SSB roof HVAC vent slats';
    hvacVents.instanceMatrix.needsUpdate = true;
    car.add(hvacVents);

    const roofInsulators = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 0.2, 8), doorMat, 6);
    const roofMatrix = new THREE.Matrix4();
    let insulatorIndex = 0;
    for (const x of [-0.65, 0.65]) {
      for (const z of [-3.55, 0, 3.55]) {
        roofMatrix.makeTranslation(x, 3.62, z);
        roofInsulators.setMatrixAt(insulatorIndex++, roofMatrix);
      }
    }
    roofInsulators.name = 'SSB roof electrical insulators';
    roofInsulators.userData.liveOverviewOmit = true;
    roofInsulators.instanceMatrix.needsUpdate = true;
    car.add(roofInsulators);

    const bogieCenters = [-5.8, 5.8];
    const bogies = new THREE.InstancedMesh(new THREE.BoxGeometry(2.25, 0.38, 1.85), blackMat, bogieCenters.length);
    const runningGearMatrix = new THREE.Matrix4();
    bogieCenters.forEach((z, index) => {
      runningGearMatrix.makeTranslation(0, 0.43, z);
      bogies.setMatrixAt(index, runningGearMatrix);
    });
    bogies.name = 'SSB bogie frames';
    bogies.instanceMatrix.needsUpdate = true;
    car.add(bogies);

    const wheels = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.36, 0.36, 0.2, 24), blackMat, 8);
    const wheelRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    let wheelIndex = 0;
    for (const z of bogieCenters) {
      for (const x of [-0.92, 0.92]) {
        for (const wheelZ of [z - 0.58, z + 0.58]) {
          runningGearMatrix.compose(new THREE.Vector3(x, 0.37, wheelZ), wheelRotation, new THREE.Vector3(1, 1, 1));
          wheels.setMatrixAt(wheelIndex++, runningGearMatrix);
        }
      }
    }
    wheels.name = 'SSB steel wheels';
    wheels.instanceMatrix.needsUpdate = true;
    car.add(wheels);

    this.root.add(car);
    return car;
  }

  private addInteriorShell(
    car: THREE.Group,
    cabZ: number,
    cabDirection: -1 | 1,
    wallMaterial: THREE.Material,
    trimMaterial: THREE.Material,
    glassMaterial: THREE.Material,
    doorMaterial: THREE.Material
  ): void {
    const shell = new THREE.Group();
    shell.name = 'Opaque passenger and cab interior shell';
    const lowerWallSegments = [
      { centerZ: -7.3, length: 1.85 },
      { centerZ: -1.2, length: 7.06 },
      { centerZ: 6.1, length: 4.25 }
    ];

    for (const side of [-1, 1]) {
      for (const segment of lowerWallSegments) {
        const lowerWall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.76, segment.length), wallMaterial);
        lowerWall.position.set(side * 1.255, 1.42, segment.centerZ);
        shell.add(lowerWall);
        const sill = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, segment.length), trimMaterial);
        sill.position.set(side * 1.225, 1.83, segment.centerZ);
        shell.add(sill);
      }
      const upperWall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.48, 16.45), wallMaterial);
      upperWall.position.set(side * 1.145, 2.98, 0);
      shell.add(upperWall);
      const windowHeader = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 16.25), trimMaterial);
      windowHeader.position.set(side * 1.175, 2.72, 0);
      shell.add(windowHeader);
      for (const z of [-8.2, -6.55, -4.45, -2.05, 0.65, 2.1, 4.35, 6.45, 8.2]) {
        const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.86, 0.12), trimMaterial);
        mullion.position.set(side * 1.205, 2.28, z);
        shell.add(mullion);
      }
    }

    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 16.45), wallMaterial);
    ceiling.position.y = 3.18;
    shell.add(ceiling);
    const lightMaterial = new THREE.MeshStandardMaterial({
      color: 0xf7fbf2,
      emissive: 0xe8f4dd,
      emissiveIntensity: 1.7,
      roughness: 0.32
    });
    for (const x of [-0.7, 0.7]) {
      const lightStrip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 15.8), lightMaterial);
      lightStrip.position.set(x, 3.115, 0);
      shell.add(lightStrip);
    }
    this.addCabinLight(shell, 2.9, -4.2);
    this.addCabinLight(shell, 2.9, 4.2);

    // Clear glass draught screens keep the door vestibules open and bright, as on the DT8.12–15.
    for (const z of [-4.62, 2.22]) {
      for (const x of [-0.87, 0.87]) {
        const partition = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.48, 0.035), glassMaterial);
        partition.position.set(x, 1.94, z);
        shell.add(partition);
        const partitionRail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.52, 8), doorMaterial);
        partitionRail.position.set(x - Math.sign(x) * 0.3, 1.94, z);
        shell.add(partitionRail);
      }
    }

    for (const z of [-5.55, 3.15]) {
      const threshold = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.018, 0.12), doorMaterial);
      threshold.position.set(0, 1.075, z);
      shell.add(threshold);
    }
    // Keep the interior cab wall behind the raked nose shell so it never pokes
    // through the sloped front face (visible as a bar across the route display).
    const cabFaceZ = cabZ - cabDirection * 0.08;
    for (const x of [-1.06, 1.06]) {
      const cabPillar = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.42, 0.14), trimMaterial);
      cabPillar.position.set(x, 2.4, cabFaceZ);
      shell.add(cabPillar);
    }
    const cabHeader = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.28, 0.14), wallMaterial);
    cabHeader.position.set(0, 3.02, cabFaceZ);
    shell.add(cabHeader);
    const dashboard = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.48, 0.42), trimMaterial);
    dashboard.position.set(0, 1.5, cabZ + cabDirection * 0.27);
    shell.add(dashboard);
    const gangwayZ = -cabDirection * 9.03;
    for (const x of [-0.91, 0.91]) {
      const endWall = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.95, 0.12), wallMaterial);
      endWall.position.set(x, 2.02, gangwayZ);
      shell.add(endWall);
    }
    const endHeader = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.42, 0.12), wallMaterial);
    endHeader.position.set(0, 2.99, gangwayZ);
    shell.add(endHeader);
    car.add(shell);
  }

  private addPassengerSeating(
    car: THREE.Group,
    cabDirection: -1 | 1,
    metalMaterial: THREE.Material,
    accentMaterial: THREE.Material,
    fabricMaterial: THREE.Material
  ): void {
    const allRows: { z: number; facing: -1 | 1 }[] = [
      { z: -7.7, facing: 1 }, { z: -6.75, facing: -1 },
      { z: -4.25, facing: 1 }, { z: -3.25, facing: -1 },
      { z: -2.25, facing: 1 }, { z: -1.25, facing: -1 },
      { z: -0.25, facing: 1 }, { z: 0.75, facing: -1 },
      { z: 1.7, facing: -1 }, { z: 4.35, facing: 1 },
      { z: 5.35, facing: -1 }, { z: 6.35, facing: 1 }, { z: 7.35, facing: -1 }
    ];
    const rows = allRows.filter(({ z }) => !(cabDirection < 0 && z < -7.2) && !(cabDirection > 0 && z > 7.2));
    const multiPurposeRows = new Set([-6.75, -4.25, 1.7, 4.35]);
    const seats: { x: number; z: number; facing: -1 | 1; priority: boolean }[] = [];
    rows.forEach(({ z, facing }) => {
      for (const x of [-1.0, -0.58, 0.58, 1.0]) {
        if (x > 0 && multiPurposeRows.has(z)) continue;
        seats.push({ x, z, facing, priority: Math.abs(z + 4.25) < 0.1 || Math.abs(z - 4.35) < 0.1 });
      }
    });

    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x343b3e, roughness: 0.75, metalness: 0.18 });
    const cushions = new THREE.InstancedMesh(new RoundedBoxGeometry(0.38, 0.13, 0.5, 2, 0.035), fabricMaterial, seats.length);
    const backrests = new THREE.InstancedMesh(new RoundedBoxGeometry(0.38, 0.66, 0.12, 2, 0.035), fabricMaterial, seats.length);
    const seatShells = new THREE.InstancedMesh(
      new RoundedBoxGeometry(0.405, 0.7, 0.09, 2, 0.025),
      new THREE.MeshStandardMaterial({ color: 0xc6c9c7, roughness: 0.58 }), seats.length
    );
    const pedestals = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.34, 0.2), baseMaterial, seats.length);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const priorityBlue = new THREE.Color(0xc3dded);
    const standardBlue = new THREE.Color(0xffffff);
    seats.forEach((seat, index) => {
      matrix.makeTranslation(seat.x, 1.3, seat.z);
      cushions.setMatrixAt(index, matrix);
      cushions.setColorAt(index, seat.priority ? priorityBlue : standardBlue);
      rotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), seat.facing * -0.08);
      matrix.compose(new THREE.Vector3(seat.x, 1.66, seat.z - seat.facing * 0.285), rotation, new THREE.Vector3(1, 1, 1));
      backrests.setMatrixAt(index, matrix);
      backrests.setColorAt(index, seat.priority ? priorityBlue : standardBlue);
      matrix.compose(new THREE.Vector3(seat.x, 1.66, seat.z - seat.facing * 0.365), rotation, new THREE.Vector3(1, 1, 1));
      seatShells.setMatrixAt(index, matrix);
      matrix.makeTranslation(seat.x, 1.15, seat.z - seat.facing * 0.08);
      pedestals.setMatrixAt(index, matrix);
    });
    cushions.name = 'SSB paired seat cushions';
    backrests.name = 'SSB paired seat backrests';
    pedestals.name = 'SSB cantilever seat supports';
    seatShells.name = 'SSB molded seat shells';
    cushions.castShadow = true;
    backrests.castShadow = true;
    car.add(cushions, backrests, pedestals, seatShells);

    const leaningPads = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.12, 0.7, 0.52),
      fabricMaterial,
      multiPurposeRows.size
    );
    [...multiPurposeRows].forEach((z, index) => {
      matrix.makeTranslation(1.18, 1.62, z);
      leaningPads.setMatrixAt(index, matrix);
    });
    leaningPads.name = 'SSB multipurpose-area leaning pads';
    car.add(leaningPads);

    for (const z of [-4.05, -3.48, 3.55, 4.12]) {
      const foldingSeat = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.42, 0.46, 2, 0.03), fabricMaterial);
      foldingSeat.position.set(1.14, 1.38, z);
      foldingSeat.rotation.z = -0.12;
      car.add(foldingSeat);
    }

    const accessibilityPlaque = new THREE.Mesh(
      new THREE.PlaneGeometry(0.36, 0.36),
      new THREE.MeshBasicMaterial({
        map: makeLabelTexture('♿', { width: 160, height: 160, bg: '#f4f2e9', fg: '#1767a4' }),
        side: THREE.DoubleSide
      })
    );
    accessibilityPlaque.position.set(1.208, 2.22, -3.72);
    accessibilityPlaque.rotation.y = -Math.PI / 2;
    car.add(accessibilityPlaque);

    for (const x of [-0.95, 0.95]) {
      const overheadRail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 15.8, 8), metalMaterial);
      overheadRail.position.set(x, 2.88, 0);
      overheadRail.rotation.x = Math.PI / 2;
      car.add(overheadRail);
    }
    const grabLoopPositions = [-6.65, -3.25, -1.45, 0.45, 4.25, 6.15];
    const grabLoops = new THREE.InstancedMesh(
      new THREE.TorusGeometry(0.09, 0.018, 6, 10),
      metalMaterial,
      grabLoopPositions.length * 2
    );
    let grabLoopIndex = 0;
    for (const x of [-0.72, 0.72]) {
      for (const z of grabLoopPositions) {
        matrix.makeTranslation(x, 2.67, z);
        grabLoops.setMatrixAt(grabLoopIndex++, matrix);
      }
    }
    grabLoops.name = 'SSB interior hanging grab loops';
    grabLoops.userData.liveOverviewOmit = true;
    grabLoops.instanceMatrix.needsUpdate = true;
    car.add(grabLoops);

    const polePositions = [-6.42, -4.68, 2.28, 4.02];
    for (const z of polePositions) {
      for (const x of [-1.08, 1.08]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.75, 8), metalMaterial);
        pole.position.set(x, 1.98, z);
        car.add(pole);
      }
    }
    for (const z of [-5.55, 3.15]) {
      for (const x of [-0.48, 0.48]) {
        const doorGrabPole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.72, 8), accentMaterial);
        doorGrabPole.position.set(x, 1.98, z);
        car.add(doorGrabPole);
      }
    }
  }

  private addInteriorDisplays(
    car: THREE.Group,
    cabDirection: -1 | 1,
    displayMaterial: THREE.Material,
    casingMaterial: THREE.Material
  ): void {
    for (const side of [-1, 1]) {
      for (const z of [-5.55, 3.15]) {
        const casing = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.54, 1.92), casingMaterial);
        casing.position.set(side * 1.12, 2.88, z);
        car.add(casing);
        const display = new THREE.Mesh(new THREE.PlaneGeometry(1.78, 0.42), displayMaterial);
        display.name = 'SSB next-station door display';
        display.position.set(side * 1.075, 2.88, z);
        display.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        display.renderOrder = 18;
        car.add(display);
      }
    }
    const endZ = cabDirection * 8.3;
    const endCasing = new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.62, 0.1), casingMaterial);
    endCasing.position.set(0, 2.84, endZ + cabDirection * 0.045);
    car.add(endCasing);
    const endDisplay = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.48), displayMaterial);
    endDisplay.name = 'SSB next-station aisle display';
    endDisplay.position.set(0, 2.84, endZ - cabDirection * 0.015);
    endDisplay.rotation.y = cabDirection > 0 ? Math.PI : 0;
    endDisplay.renderOrder = 18;
    car.add(endDisplay);
    const overheadZ = -1.15;
    const overheadCasing = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.58, 0.12), casingMaterial);
    overheadCasing.position.set(0, 2.82, overheadZ);
    car.add(overheadCasing);
    const overheadDisplayRear = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.44), displayMaterial);
    overheadDisplayRear.name = 'SSB overhead next-station display';
    overheadDisplayRear.position.set(0, 2.82, overheadZ - 0.065);
    overheadDisplayRear.rotation.y = Math.PI;
    overheadDisplayRear.renderOrder = 18;
    car.add(overheadDisplayRear);
    const overheadDisplayFront = overheadDisplayRear.clone();
    overheadDisplayFront.position.z = overheadZ + 0.065;
    // Cloning a half-turn can re-express it as X/Z half-turns; reset all Euler axes.
    overheadDisplayFront.rotation.set(0, 0, 0);
    car.add(overheadDisplayFront);
  }

  private makeModernTramBody(widthM: number, heightM: number, depthM: number): THREE.ExtrudeGeometry {
    const halfWidth = widthM / 2;
    const crossSection = new THREE.Shape();
    crossSection.moveTo(-halfWidth, 0.5);
    crossSection.lineTo(halfWidth, 0.5);
    crossSection.lineTo(halfWidth, heightM - 0.42);
    crossSection.quadraticCurveTo(halfWidth - 0.02, heightM - 0.18, halfWidth - 0.18, heightM);
    crossSection.lineTo(-halfWidth + 0.18, heightM);
    crossSection.quadraticCurveTo(-halfWidth + 0.02, heightM - 0.18, -halfWidth, heightM - 0.42);
    crossSection.closePath();
    const geometry = new THREE.ExtrudeGeometry(crossSection, {
      depth: depthM,
      bevelEnabled: true,
      bevelSize: 0.025,
      bevelThickness: 0.025,
      bevelSegments: 2,
      curveSegments: 5
    });
    geometry.translate(0, 0, -depthM / 2);
    return geometry;
  }

  private makeAvenioCabNose(): THREE.BufferGeometry {
    return this.makeTaperedTramCab([
      { zBottom: 0, zShoulder: 0, zTop: 0, bottom: 0.5, shoulder: 2.8, top: 3.22, bottomHalf: 1.2, half: 1.2, roofHalf: 1.02 },
      { zBottom: 0.72, zShoulder: 0.72, zTop: 0.68, bottom: 0.48, shoulder: 2.78, top: 3.18, bottomHalf: 1.17, half: 1.15, roofHalf: 0.94 },
      { zBottom: 1.38, zShoulder: 1.34, zTop: 1.24, bottom: 0.47, shoulder: 2.68, top: 3.08, bottomHalf: 1.08, half: 1.04, roofHalf: 0.82 },
      { zBottom: 1.78, zShoulder: 1.68, zTop: 1.48, bottom: 0.5, shoulder: 2.5, top: 2.96, bottomHalf: 0.98, half: 0.94, roofHalf: 0.7 }
    ]);
  }

  private makeAvenioCabMask(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.98, -0.78);
    shape.lineTo(0.98, -0.78);
    shape.quadraticCurveTo(0.92, 0.62, 0.66, 0.94);
    shape.quadraticCurveTo(0.5, 1.08, 0.3, 1.1);
    shape.lineTo(-0.3, 1.1);
    shape.quadraticCurveTo(-0.5, 1.08, -0.66, 0.94);
    shape.quadraticCurveTo(-0.92, 0.62, -0.98, -0.78);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 8 });
    geometry.translate(0, 0, -0.03);
    return geometry;
  }

  private makeAvenioWindscreen(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.84, -0.52);
    shape.lineTo(0.84, -0.52);
    shape.quadraticCurveTo(0.78, 0.18, 0.58, 0.32);
    shape.lineTo(-0.58, 0.32);
    shape.quadraticCurveTo(-0.78, 0.18, -0.84, -0.52);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 8 });
    geometry.translate(0, 0, -0.0225);
    return geometry;
  }

  private makeUrbosCabNose(): THREE.BufferGeometry {
    return this.makeTaperedTramCab([
      { zBottom: 0, zShoulder: 0, zTop: 0, bottom: 0.5, shoulder: 2.78, top: 3.2, bottomHalf: 1.2, half: 1.2, roofHalf: 1.02 },
      { zBottom: 0.74, zShoulder: 0.74, zTop: 0.68, bottom: 0.48, shoulder: 2.76, top: 3.16, bottomHalf: 1.17, half: 1.14, roofHalf: 0.93 },
      { zBottom: 1.42, zShoulder: 1.38, zTop: 1.24, bottom: 0.46, shoulder: 2.64, top: 3.04, bottomHalf: 1.06, half: 1.0, roofHalf: 0.78 },
      { zBottom: 1.84, zShoulder: 1.66, zTop: 1.4, bottom: 0.54, shoulder: 2.42, top: 2.9, bottomHalf: 0.94, half: 0.9, roofHalf: 0.62 }
    ]);
  }

  private makeUrbosCabMask(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.92, -0.68);
    shape.quadraticCurveTo(-1.02, 0.52, -0.7, 0.9);
    shape.quadraticCurveTo(0, 1.14, 0.7, 0.9);
    shape.quadraticCurveTo(1.02, 0.52, 0.92, -0.68);
    shape.quadraticCurveTo(0, -0.86, -0.92, -0.68);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.065, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.025, bevelSegments: 3, curveSegments: 10 });
    geometry.translate(0, 0, -0.0325);
    return geometry;
  }

  private makeUrbosWindscreen(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.78, -0.5);
    shape.lineTo(0.78, -0.5);
    shape.quadraticCurveTo(0.8, 0.18, 0.56, 0.3);
    shape.quadraticCurveTo(0, 0.4, -0.56, 0.3);
    shape.quadraticCurveTo(-0.8, 0.18, -0.78, -0.5);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.014, bevelSegments: 2, curveSegments: 10 });
    geometry.translate(0, 0, -0.025);
    return geometry;
  }

  // Odissey MAX cab: a blunt, near-full-width front. The front ring keeps
  // bottom/shoulder/roof collinear so the whole face is one plane
  // (ODESSA_CAB_FRONT_RAKE) that the mask, windscreen and trim mount flush onto.
  private makeOdessaCabNose(): THREE.BufferGeometry {
    return this.makeTaperedTramCab([
      // Ring 0 sits slightly inside the body and marginally wider than it, so the
      // extruded body's white end cap never shows at the cab joint.
      { zBottom: -0.12, zShoulder: -0.12, zTop: -0.12, bottom: 0.5, shoulder: 2.78, top: 3.21, bottomHalf: 1.21, half: 1.21, roofHalf: 1.03 },
      { zBottom: 0.9, zShoulder: 0.86, zTop: 0.78, bottom: 0.48, shoulder: 2.72, top: 3.14, bottomHalf: 1.2, half: 1.19, roofHalf: 1.0 },
      { zBottom: 1.58, zShoulder: 1.42, zTop: 1.32, bottom: 0.46, shoulder: 2.6, top: 3.02, bottomHalf: 1.18, half: 1.17, roofHalf: 0.99 },
      { zBottom: 1.95, zShoulder: 1.7, zTop: 1.65, bottom: 0.5, shoulder: 2.5, top: 2.92, bottomHalf: 1.16, half: 1.14, roofHalf: 0.95 }
    ]);
  }

  private makeOdessaCabMask(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.99, -0.7);
    shape.lineTo(-1.01, 0.3);
    shape.quadraticCurveTo(-0.99, 0.66, -0.74, 0.74);
    shape.lineTo(0.74, 0.74);
    shape.quadraticCurveTo(0.99, 0.66, 1.01, 0.3);
    shape.lineTo(0.99, -0.7);
    shape.quadraticCurveTo(0, -0.88, -0.99, -0.7);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.026, bevelSegments: 3, curveSegments: 10 });
    geometry.translate(0, 0, -0.035);
    return geometry;
  }

  private makeOdessaWindscreen(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.85, -0.46);
    shape.quadraticCurveTo(0, -0.6, 0.85, -0.46);
    shape.lineTo(0.87, 0.3);
    shape.quadraticCurveTo(0, 0.4, -0.87, 0.3);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.014, bevelSegments: 2, curveSegments: 10 });
    geometry.translate(0, 0, -0.025);
    return geometry;
  }

  // Speckled vinyl saloon floor for the KVV cars, in the same spirit as the
  // regional-train floor but darker and cooler.
  private makeTramFloorTexture(): THREE.DataTexture {
    const size = 32;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = (y * size + x) * 4;
        const seed = (x * 17 + y * 29 + x * y * 5) % 37;
        const tone = seed < 4 ? 92 : seed > 32 ? 138 : 116;
        pixels[index] = tone;
        pixels[index + 1] = tone + 3;
        pixels[index + 2] = tone + 7;
        pixels[index + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(6, 16);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  // Flecked moquette; base and fleck colours differ per operator so the two
  // Karlsruhe cabins read as different generations of rolling stock.
  private makeTramSeatFabricTexture(base: [number, number, number], fleck: [number, number, number]): THREE.DataTexture {
    const size = 32;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = (y * size + x) * 4;
        const spot = (x * 11 + y * 5) % 13 === 0 || (x % 8 === 3 && y % 8 === 5);
        const source = spot ? fleck : base;
        const jitter = ((x * 7 + y * 13) % 11) - 5;
        pixels[index] = Math.max(0, Math.min(255, source[0] + jitter));
        pixels[index + 1] = Math.max(0, Math.min(255, source[1] + jitter));
        pixels[index + 2] = Math.max(0, Math.min(255, source[2] + jitter));
        pixels[index + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 3);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  // Classic VBK city tram cab: a blunt, near-upright front. The front ring's
  // face lies on one plane (KARLSRUHE_TRAM_CAB_FRONT_RAKE) that the mask,
  // windscreen, destination film and apron trim all mount flush onto.
  private makeKarlsruheTramCabNose(): THREE.BufferGeometry {
    return this.makeTaperedTramCab([
      // Ring 0 sits slightly inside the body and marginally wider than it, so the
      // extruded body's end cap never shows at the cab joint.
      { zBottom: -0.12, zShoulder: -0.12, zTop: -0.12, bottom: 0.5, shoulder: 2.7, top: 3.3, bottomHalf: 1.335, half: 1.335, roofHalf: 1.15 },
      { zBottom: 0.86, zShoulder: 0.84, zTop: 0.76, bottom: 0.48, shoulder: 2.66, top: 3.24, bottomHalf: 1.33, half: 1.32, roofHalf: 1.12 },
      { zBottom: 1.52, zShoulder: 1.4, zTop: 1.26, bottom: 0.46, shoulder: 2.58, top: 3.13, bottomHalf: 1.3, half: 1.28, roofHalf: 1.06 },
      { zBottom: 1.86, zShoulder: 1.68, zTop: 1.6, bottom: 0.5, shoulder: 2.5, top: 3.02, bottomHalf: 1.27, half: 1.25, roofHalf: 1.0 }
    ]);
  }

  private makeKarlsruheTramCabMask(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-1.06, -0.62);
    shape.lineTo(-1.08, 0.5);
    shape.quadraticCurveTo(-1.06, 0.84, -0.82, 0.92);
    shape.lineTo(0.82, 0.92);
    shape.quadraticCurveTo(1.06, 0.84, 1.08, 0.5);
    shape.lineTo(1.06, -0.62);
    shape.quadraticCurveTo(0, -0.76, -1.06, -0.62);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.026, bevelSegments: 3, curveSegments: 10 });
    geometry.translate(0, 0, -0.035);
    return geometry;
  }

  private makeKarlsruheTramWindscreen(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.94, -0.44);
    shape.quadraticCurveTo(0, -0.56, 0.94, -0.44);
    shape.lineTo(0.96, 0.5);
    shape.quadraticCurveTo(0, 0.62, -0.96, 0.5);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.014, bevelSegments: 2, curveSegments: 10 });
    geometry.translate(0, 0, -0.025);
    return geometry;
  }

  // Stadler CITYLINK cab: narrower and more strongly drawn in than the classic
  // tram, over a steeper face plane (CITYLINK_CAB_FRONT_RAKE).
  private makeCitylinkCabNose(): THREE.BufferGeometry {
    return this.makeTaperedTramCab([
      { zBottom: -0.12, zShoulder: -0.12, zTop: -0.12, bottom: 0.5, shoulder: 2.7, top: 3.3, bottomHalf: 1.335, half: 1.335, roofHalf: 1.15 },
      { zBottom: 0.92, zShoulder: 0.86, zTop: 0.72, bottom: 0.48, shoulder: 2.64, top: 3.2, bottomHalf: 1.32, half: 1.3, roofHalf: 1.08 },
      { zBottom: 1.62, zShoulder: 1.34, zTop: 1.12, bottom: 0.46, shoulder: 2.5, top: 3.04, bottomHalf: 1.26, half: 1.22, roofHalf: 0.96 },
      { zBottom: 1.98, zShoulder: 1.62, zTop: 1.46, bottom: 0.5, shoulder: 2.36, top: 2.92, bottomHalf: 1.18, half: 1.12, roofHalf: 0.84 }
    ]);
  }

  private makeCitylinkCabMask(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-1.02, -0.9);
    shape.quadraticCurveTo(-1.12, 0.3, -0.86, 0.78);
    shape.quadraticCurveTo(-0.5, 1.0, 0, 1.02);
    shape.quadraticCurveTo(0.5, 1.0, 0.86, 0.78);
    shape.quadraticCurveTo(1.12, 0.3, 1.02, -0.9);
    shape.quadraticCurveTo(0, -1.12, -1.02, -0.9);
    shape.closePath();
    // Same depth/bevel as the other cab masks so its front face lands at
    // z = +0.061 and the trim offsets below stay comparable across vehicles.
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.026, bevelSegments: 3, curveSegments: 12 });
    geometry.translate(0, 0, -0.035);
    return geometry;
  }

  private makeCitylinkWindscreen(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.88, -0.34);
    shape.quadraticCurveTo(0, -0.5, 0.88, -0.34);
    shape.lineTo(0.9, 0.52);
    shape.quadraticCurveTo(0, 0.68, -0.9, 0.52);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.014, bevelSegments: 2, curveSegments: 12 });
    geometry.translate(0, 0, -0.025);
    return geometry;
  }

  // Zürich Cobra cab: a 2.4 m body drawn in hard at the roof so the blue cap the
  // caller mounts above it reads as the overhanging dome of the real Be 5/6. The
  // front ring's bottom/shoulder/roof points are collinear in (z, y), giving the
  // one plane (COBRA_CAB_FRONT_RAKE) that the mask, screen and trim mount onto.
  private makeCobraCabNose(): THREE.BufferGeometry {
    return this.makeTaperedTramCab([
      { zBottom: -0.12, zShoulder: -0.12, zTop: -0.12, bottom: 0.5, shoulder: 2.7, top: 3.3, bottomHalf: 1.21, half: 1.21, roofHalf: 1.03 },
      { zBottom: 0.88, zShoulder: 0.84, zTop: 0.72, bottom: 0.48, shoulder: 2.66, top: 3.2, bottomHalf: 1.2, half: 1.19, roofHalf: 0.98 },
      { zBottom: 1.58, zShoulder: 1.38, zTop: 1.18, bottom: 0.46, shoulder: 2.58, top: 3.02, bottomHalf: 1.15, half: 1.14, roofHalf: 0.94 },
      { zBottom: 1.96, zShoulder: 1.7, zTop: 1.66, bottom: 0.5, shoulder: 2.5, top: 2.82, bottomHalf: 1.08, half: 1.08, roofHalf: 0.86 }
    ]);
  }

  private makeCobraCabMask(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.92, -0.36);
    shape.quadraticCurveTo(-1.0, 0.32, -0.94, 0.86);
    shape.quadraticCurveTo(-0.9, 1.1, -0.62, 1.14);
    shape.lineTo(0.62, 1.14);
    shape.quadraticCurveTo(0.9, 1.1, 0.94, 0.86);
    shape.quadraticCurveTo(1.0, 0.32, 0.92, -0.36);
    shape.quadraticCurveTo(0, -0.52, -0.92, -0.36);
    shape.closePath();
    // Same depth/bevel as the other cab masks, so the front face lands at
    // z = +0.061 and the trim offsets stay comparable across vehicles.
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.026, bevelSegments: 3, curveSegments: 12 });
    geometry.translate(0, 0, -0.035);
    return geometry;
  }

  private makeCobraWindscreen(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.84, -0.18);
    shape.quadraticCurveTo(0, -0.32, 0.84, -0.18);
    shape.lineTo(0.86, 0.62);
    shape.quadraticCurveTo(0, 0.76, -0.86, 0.62);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.014, bevelSegments: 2, curveSegments: 12 });
    geometry.translate(0, 0, -0.025);
    return geometry;
  }

  // SkyTrain Mark III nose: near-full-width and only lightly tapered, with the
  // front ring's bottom/shoulder/roof collinear so the face is one plane
  // (SKYTRAIN_CAB_FRONT_RAKE) that the window mask and trim mount flush onto.
  private makeSkyTrainNose(): THREE.BufferGeometry {
    return this.makeTaperedTramCab([
      { zBottom: -0.12, zShoulder: -0.12, zTop: -0.12, bottom: 0.5, shoulder: 2.9, top: 3.36, bottomHalf: 1.31, half: 1.31, roofHalf: 1.12 },
      { zBottom: 0.7, zShoulder: 0.66, zTop: 0.6, bottom: 0.48, shoulder: 2.85, top: 3.3, bottomHalf: 1.3, half: 1.29, roofHalf: 1.09 },
      { zBottom: 1.3, zShoulder: 1.16, zTop: 1.08, bottom: 0.46, shoulder: 2.76, top: 3.18, bottomHalf: 1.27, half: 1.25, roofHalf: 1.03 },
      { zBottom: 1.6, zShoulder: 1.4, zTop: 1.36, bottom: 0.5, shoulder: 2.66, top: 3.06, bottomHalf: 1.23, half: 1.21, roofHalf: 0.97 }
    ]);
  }

  private makeSkyTrainWindowMask(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-1.14, -0.84);
    shape.lineTo(-1.16, 0.62);
    shape.quadraticCurveTo(-1.14, 0.98, -0.88, 1.06);
    shape.lineTo(0.88, 1.06);
    shape.quadraticCurveTo(1.14, 0.98, 1.16, 0.62);
    shape.lineTo(1.14, -0.84);
    shape.quadraticCurveTo(0, -1.0, -1.14, -0.84);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.026, bevelSegments: 3, curveSegments: 10 });
    geometry.translate(0, 0, -0.035);
    return geometry;
  }

  private makeSkyTrainWindscreen(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-1.0, -0.68);
    shape.quadraticCurveTo(0, -0.8, 1.0, -0.68);
    shape.lineTo(1.02, 0.62);
    shape.quadraticCurveTo(0, 0.74, -1.02, 0.62);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.014, bevelSegments: 2, curveSegments: 10 });
    geometry.translate(0, 0, -0.025);
    return geometry;
  }

  private makeCabAccentPanel(widthBottom: number, widthTop: number, height: number): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-widthBottom / 2, -height / 2);
    shape.lineTo(widthBottom / 2, -height / 2);
    shape.lineTo(widthTop / 2, height / 2);
    shape.lineTo(-widthTop / 2, height / 2);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.045,
      bevelEnabled: true,
      bevelSize: 0.025,
      bevelThickness: 0.018,
      bevelSegments: 2
    });
    geometry.translate(0, 0, -0.0225);
    return geometry;
  }

  private makeTaperedTramCab(
    rings: Array<{
      zBottom: number;
      zShoulder: number;
      zTop: number;
      bottom: number;
      shoulder: number;
      top: number;
      bottomHalf: number;
      half: number;
      roofHalf: number;
    }>
  ): THREE.BufferGeometry {
    const vertices: number[] = [];
    const indices: number[] = [];
    const pointsPerRing = 6;

    for (const ring of rings) {
      vertices.push(
        -ring.bottomHalf, ring.bottom, ring.zBottom,
        ring.bottomHalf, ring.bottom, ring.zBottom,
        ring.half, ring.shoulder, ring.zShoulder,
        ring.roofHalf, ring.top, ring.zTop,
        -ring.roofHalf, ring.top, ring.zTop,
        -ring.half, ring.shoulder, ring.zShoulder
      );
    }

    for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex++) {
      const current = ringIndex * pointsPerRing;
      const next = (ringIndex + 1) * pointsPerRing;
      for (let point = 0; point < pointsPerRing; point++) {
        const following = (point + 1) % pointsPerRing;
        indices.push(current + point, current + following, next + following);
        indices.push(current + point, next + following, next + point);
      }
    }

    for (let point = 1; point < pointsPerRing - 1; point++) {
      indices.push(0, point + 1, point);
    }
    const front = (rings.length - 1) * pointsPerRing;
    for (let point = 1; point < pointsPerRing - 1; point++) {
      indices.push(front, front + point, front + point + 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  // Shared DT8 Tango body cross-section; depth defaults to a Stadtbahn car and is
  // overridable so shorter cars (e.g. the Zacke railcar) reuse the same profile.
  private makeTangoBody(depth = 18.25): THREE.ExtrudeGeometry {
    const crossSection = new THREE.Shape();
    crossSection.moveTo(-1.325, 0);
    crossSection.lineTo(1.325, 0);
    crossSection.lineTo(1.325, 2.08);
    crossSection.lineTo(1.17, 2.72);
    crossSection.lineTo(-1.17, 2.72);
    crossSection.lineTo(-1.325, 2.08);
    crossSection.closePath();
    const geometry = new THREE.ExtrudeGeometry(crossSection, {
      depth,
      bevelEnabled: true,
      bevelSize: 0.025,
      bevelThickness: 0.025,
      bevelSegments: 1
    });
    geometry.translate(0, 0, -depth / 2);
    return geometry;
  }

  private makeTangoNose(): THREE.BufferGeometry {
    // Side profile of the raked Tango front, drawn in (forward, height) and extruded
    // across the car width so the whole cab leans back like the real DT8.12 face.
    const profile = new THREE.Shape();
    profile.moveTo(0, 0.4);
    profile.lineTo(0.65, 0.4);
    profile.quadraticCurveTo(0.87, 0.4, 0.9, 0.65);
    profile.quadraticCurveTo(0.93, 1.02, 0.85, 1.42);
    profile.lineTo(0.52, 2.86);
    profile.bezierCurveTo(0.46, 3.1, 0.28, 3.22, 0.08, 3.22);
    profile.lineTo(0, 3.22);
    profile.closePath();
    const geometry = new THREE.ExtrudeGeometry(profile, {
      depth: 1.94,
      steps: 32,
      bevelEnabled: true,
      bevelThickness: 0.3,
      bevelSize: 0.1,
      bevelSegments: 12,
      curveSegments: 20
    });
    geometry.translate(0, 0, -0.97);
    // Map the profile's forward axis onto +z and the extrusion depth onto the width.
    geometry.rotateY(-Math.PI / 2);
    const vertices = geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) {
      const z = vertices.getZ(i);
      vertices.setZ(i, z + tangoApronBow(vertices.getX(i), vertices.getY(i)) * THREE.MathUtils.smoothstep(z, 0, 0.65));
    }
    // Extrusion duplicates vertices along bevel strips; weld them for continuous highlights.
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    const smooth = mergeVertices(geometry);
    smooth.computeVertexNormals();
    geometry.dispose();
    return smooth;
  }

  private makeTangoCabMask(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.78, -0.8);
    shape.quadraticCurveTo(-1.08, -0.8, -1.08, -0.5);
    shape.lineTo(-1.0, 0.6);
    shape.quadraticCurveTo(-0.98, 0.87, -0.68, 0.9);
    shape.quadraticCurveTo(0, 0.98, 0.68, 0.9);
    shape.quadraticCurveTo(0.98, 0.87, 1.0, 0.6);
    shape.lineTo(1.08, -0.5);
    shape.quadraticCurveTo(1.08, -0.8, 0.78, -0.8);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
    geometry.translate(0, 0, -0.03);
    return geometry;
  }

  private makeTangoWindscreen(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.73, -0.71);
    shape.quadraticCurveTo(-0.99, -0.71, -0.99, -0.46);
    shape.lineTo(-0.92, 0.56);
    shape.quadraticCurveTo(-0.9, 0.77, -0.63, 0.8);
    shape.quadraticCurveTo(0, 0.87, 0.63, 0.8);
    shape.quadraticCurveTo(0.9, 0.77, 0.92, 0.56);
    shape.lineTo(0.99, -0.46);
    shape.quadraticCurveTo(0.99, -0.71, 0.73, -0.71);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.015, bevelSegments: 2 });
    geometry.translate(0, 0, -0.025);
    return geometry;
  }

  private makeCabNose(material: THREE.Material): THREE.Mesh {
    const shape = new THREE.Shape();
    shape.moveTo(-1.18, -1.28);
    shape.lineTo(1.18, -1.28);
    shape.lineTo(1.04, 1.05);
    shape.lineTo(0.62, 1.36);
    shape.lineTo(-0.62, 1.36);
    shape.lineTo(-1.04, 1.05);
    shape.lineTo(-1.18, -1.28);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1.05, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
    geometry.center();
    geometry.rotateX(Math.PI / 2);
    return new THREE.Mesh(geometry, material);
  }

  private makeCoupler(): THREE.Group {
    const group = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.55 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9b9f9c, roughness: 0.38, metalness: 0.62 });
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.8), dark);
    arm.position.z = -0.25;
    group.add(arm);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.32, 0.2), metal);
    head.position.z = -0.7;
    group.add(head);
    for (const x of [-0.26, 0.26]) {
      const connector = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 16), dark);
      connector.rotation.x = Math.PI / 2;
      connector.position.set(x, 0.04, -0.82);
      group.add(connector);
    }
    return group;
  }

  private addPantograph(position: THREE.Vector3, material: THREE.Material): void {
    addPantograph(this.root, position, material);
  }
}

export function buildProceduralTransitVehicle(context: ResolvedVehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).build();
}

export function createStadtbahnVehicle(context: ResolvedVehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).createStadtbahnVehicle();
}

export function createBusVehicle(context: ResolvedVehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).createBusVehicle();
}

export function createSBahnVehicle(context: ResolvedVehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).createSBahnVehicle();
}

export function createTramVehicle(context: ResolvedVehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).build();
}

export function createZackeVehicle(context: ResolvedVehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).createZackeVehicle();
}

export function createSeilbahnVehicle(context: ResolvedVehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).createSeilbahnVehicle();
}

export function createFerryVehicle(context: ResolvedVehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).createFerryVehicle();
}

export function createKarlsruheTramVehicle(context: ResolvedVehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).createKarlsruheTramVehicle();
}

export function createKarlsruheCitylinkVehicle(context: ResolvedVehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).createKarlsruheCitylinkVehicle();
}
