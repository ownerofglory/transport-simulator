import * as THREE from 'three';
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
    const interior = new THREE.MeshStandardMaterial({ color: 0xe3e0d6, roughness: 0.88 });
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x868b8f, roughness: 0.92 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x2f3235, roughness: 0.84 });
    const accentSeat = new THREE.MeshStandardMaterial({ color: 0xf2d21b, roughness: 0.82 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9a9fa1, roughness: 0.34, metalness: 0.72 });
    const displayMaterial = this.context.makeInteriorDisplayMaterial();
    this.glassMaterial = glass;

    const centers = [-18.9, -6.3, 6.3, 18.9];
    centers.forEach((center, index) => {
      const car = new THREE.Group();
      car.name = `Articulated car bwegt regional train section ${index + 1}`;
      car.userData.centerOffsetM = center;

      const body = new THREE.Mesh(new THREE.BoxGeometry(2.98, 3.26, 12.15), shell);
      body.position.y = 2.02;
      body.castShadow = true;
      car.add(body);
      this.passengerShells.push(body);

      const lowerYellow = new THREE.Mesh(new THREE.BoxGeometry(3.02, 0.32, 12.2), bwegtYellow);
      lowerYellow.position.y = 0.64;
      car.add(lowerYellow);
      this.passengerShells.push(lowerYellow);

      const roofBand = new THREE.Mesh(new THREE.BoxGeometry(2.88, 0.14, 12.05), dark);
      roofBand.position.y = 3.46;
      car.add(roofBand);
      this.passengerShells.push(roofBand);

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
      }

      if (index === 0 || index === centers.length - 1) {
        const cabEnd = index === 0 ? -1 : 1;
        const nose = this.makeCabNose(dark);
        nose.scale.set(1.16, 1.04, 0.76);
        nose.position.set(0, 2.02, cabEnd * 6.14);
        if (cabEnd > 0) nose.rotation.y = Math.PI;
        car.add(nose);
        this.cabShells.push(nose);

        const face = new THREE.Mesh(new THREE.BoxGeometry(2.78, 2.52, 0.12), dark);
        face.position.set(0, 1.94, cabEnd * 6.31);
        car.add(face);
        this.cabShells.push(face);

        const windscreen = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.96, 0.06), glass);
        windscreen.position.set(0, 2.58, cabEnd * 6.39);
        car.add(windscreen);

        const yellowMask = new THREE.Mesh(new THREE.BoxGeometry(2.86, 0.34, 0.1), bwegtYellow);
        yellowMask.position.set(0, 0.84, cabEnd * 6.25);
        car.add(yellowMask);

        const display = new THREE.Mesh(new THREE.PlaneGeometry(1.98, 0.4), new THREE.MeshBasicMaterial({
          map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 700, height: 128, bg: '#111', fg: '#f2d21b' }),
          side: THREE.DoubleSide
        }));
        display.position.set(0, 3.12, cabEnd * 6.47);
        if (cabEnd < 0) display.rotation.y = Math.PI;
        car.add(display);
      }

      const floor = new THREE.Mesh(new THREE.BoxGeometry(2.92, 0.12, 11.55), floorMaterial);
      floor.position.y = 1.12;
      car.add(floor);
      const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.08, 11.35), interior);
      ceiling.position.y = 3.28;
      car.add(ceiling);
      this.addOpaqueTransitInterior(car, 11.35, 1.34, interior, () => [-1.95, 1.95]);

      for (const z of [-4.2, -2.65, 0, 2.65, 4.2]) {
        for (const [x, material] of [[-0.98, seat], [-0.56, accentSeat], [0.56, accentSeat], [0.98, seat]] as const) {
          const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.13, 0.5), material);
          cushion.position.set(x, 1.36, z);
          car.add(cushion);
          const back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.66, 0.1), material);
          back.position.set(x, 1.7, z - 0.24);
          car.add(back);
        }
      }

      for (const z of [-1.95, 0, 1.95]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.0, 8), metal);
        pole.position.set(0, 2.08, z);
        car.add(pole);
      }

      const monitor = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5), displayMaterial);
      monitor.position.set(0, 2.92, 0.1);
      monitor.rotation.y = Math.PI;
      monitor.renderOrder = 18;
      car.add(monitor);

      for (const z of [-3.95, 3.95]) {
        const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.4, 1.7), dark);
        bogie.position.set(0, 0.48, z);
        car.add(bogie);
      }

      this.cars.push(car);
      this.root.add(car);
    });

    this.trainHalfLengthM = 25.6;
    this.addPantograph(new THREE.Vector3(0, 3.82, 6.6), dark);
    return this.createVehicleInstance();
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

  createOdessaTramVehicle(): VehicleInstance {
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.46, metalness: 0.14 });
    const black = new THREE.MeshStandardMaterial({ color: 0x15191d, roughness: 0.18, metalness: 0.34 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf0c31b, roughness: 0.42, metalness: 0.08 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc92f2f, roughness: 0.42, metalness: 0.06 });
    const roofGrey = new THREE.MeshStandardMaterial({ color: 0xa8adb0, roughness: 0.58, metalness: 0.1 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x98c4d7, transparent: true, opacity: 0.42, roughness: 0.05, side: THREE.DoubleSide });
    const floor = new THREE.MeshStandardMaterial({ color: 0x767a7e, roughness: 0.92 });
    const interior = new THREE.MeshStandardMaterial({ color: 0xe0e1dc, roughness: 0.84 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x355d74, roughness: 0.88 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x93989a, roughness: 0.36, metalness: 0.74 });
    const displayMat = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 700, height: 128, bg: '#101216', fg: '#ffb300' }),
      side: THREE.DoubleSide
    });
    this.glassMaterial = glass;
    const interiorDisplayMat = this.context.makeInteriorDisplayMaterial();

    const sections = [
      { center: -8.7, length: 8.4, cab: -1 as -1 | 0 | 1 },
      { center: 0, length: 7.2, cab: 0 as -1 | 0 | 1 },
      { center: 8.7, length: 8.4, cab: 1 as -1 | 0 | 1 }
    ];

    for (const section of sections) {
      const car = new THREE.Group();
      car.name = `Articulated car Odessa K1T306 section ${section.center}`;
      car.userData.centerOffsetM = section.center;
      const lowerSkirt = new THREE.Mesh(new THREE.BoxGeometry(2.48, 0.34, section.length - 0.08), red);
      lowerSkirt.position.y = 0.56;
      car.add(lowerSkirt);
      this.passengerShells.push(lowerSkirt);
      const sideBody = new THREE.Mesh(new THREE.BoxGeometry(2.38, 2.52, section.length), white);
      sideBody.position.y = 1.74;
      sideBody.castShadow = true;
      car.add(sideBody);
      this.passengerShells.push(sideBody);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.2, section.length - 0.12), roofGrey);
      roof.position.y = 3.08;
      car.add(roof);
      this.passengerShells.push(roof);

      for (const side of [-1, 1] as const) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.12, section.length - 0.2), black);
        band.position.set(side * 1.23, 2.26, 0);
        car.add(band);
        this.windowBands.push(band);

        for (const z of section.cab === 0 ? [-1.65, 0, 1.65] : [-2.15, 1.7]) {
          const window = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.92, 1.18), glass);
          window.position.set(side * 1.245, 2.26, z);
          car.add(window);
        }

        const doorCenters = section.cab === 0 ? [-1.6, 1.6] : [section.cab < 0 ? 1.7 : -1.7];
        for (const doorZ of doorCenters) {
          this.addSlidingVehicleDoor(car, side * 1.245, doorZ, yellow, glass, black, 1.62, 1.95);
          const yellowFrame = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.1, 1.78), yellow);
          yellowFrame.position.set(side * 1.215, 1.74, doorZ);
          car.add(yellowFrame);

          if (side < 0) {
            const accessibility = new THREE.Mesh(
              new THREE.PlaneGeometry(0.48, 0.2),
              new THREE.MeshBasicMaterial({
                map: makeLabelTexture('♿  P', { width: 256, height: 96, bg: '#1d4e89', fg: '#ffffff' }),
                side: THREE.DoubleSide,
                transparent: true
              })
            );
            accessibility.position.set(side * 1.14, 1.02, doorZ);
            accessibility.rotation.y = Math.PI / 2;
            car.add(accessibility);
          }
        }
      }

      const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.08, section.length - 0.26), floor);
      floorMesh.position.y = 0.98;
      car.add(floorMesh);
      const ceilingMesh = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.08, section.length - 0.34), interior);
      ceilingMesh.position.y = 2.96;
      car.add(ceilingMesh);
      this.addOpaqueTransitInterior(car, section.length - 0.34, 1.08, interior, () => {
        if (section.cab === 0) return [-1.6, 1.6];
        return [section.cab < 0 ? 1.7 : -1.7];
      });

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

      if (section.cab !== 0) {
        const cabDir = section.cab;
        const nose = this.makeCabNose(yellow);
        nose.scale.set(1.04, 1.02, 0.82);
        nose.position.set(0, 1.82, cabDir * (section.length / 2 - 0.1));
        if (cabDir > 0) nose.rotation.y = Math.PI;
        car.add(nose);
        this.cabShells.push(nose);
        const face = new THREE.Mesh(new THREE.BoxGeometry(2.08, 1.96, 0.12), black);
        face.position.set(0, 2.1, cabDir * (section.length / 2 + 0.12));
        car.add(face);
        this.cabShells.push(face);
        const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.72, 1.08, 0.08), glass);
        windscreen.position.set(0, 2.46, cabDir * (section.length / 2 + 0.18));
        windscreen.rotation.x = cabDir * -0.2;
        car.add(windscreen);
        const routeDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.44, 0.32), displayMat);
        routeDisplay.position.set(0, 3.02, cabDir * (section.length / 2 + 0.21));
        if (cabDir < 0) routeDisplay.rotation.y = Math.PI;
        routeDisplay.renderOrder = 20;
        car.add(routeDisplay);
        this.cabDisplays.push(routeDisplay);
        const crest = new THREE.Mesh(
          new THREE.PlaneGeometry(0.32, 0.32),
          new THREE.MeshBasicMaterial({
            map: makeLabelTexture('⚓', { width: 128, height: 128, bg: '#0d2f6d', fg: '#f3d04a' }),
            side: THREE.DoubleSide,
            transparent: true
          })
        );
        crest.position.set(-0.48, 1.36, cabDir * (section.length / 2 + 0.2));
        if (cabDir < 0) crest.rotation.y = Math.PI;
        car.add(crest);
        const fleet = new THREE.Mesh(
          new THREE.PlaneGeometry(0.58, 0.16),
          new THREE.MeshBasicMaterial({
            map: makeLabelTexture('7013', { width: 256, height: 96, bg: '#111', fg: '#ffffff' }),
            side: THREE.DoubleSide
          })
        );
        fleet.position.set(0.58, 1.36, cabDir * (section.length / 2 + 0.2));
        if (cabDir < 0) fleet.rotation.y = Math.PI;
        car.add(fleet);
        for (const x of [-0.68, 0.68]) {
          const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.08), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf8f3cf, emissiveIntensity: 2 }));
          headlight.position.set(x, 1.08, cabDir * (section.length / 2 + 0.22));
          car.add(headlight);
        }
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

    for (const z of [-4.35, 4.35]) {
      const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.18, 2.18, 0.72), black);
      bellows.position.set(0, 1.8, z);
      this.root.add(bellows);
      this.passengerShells.push(bellows);
    }
    for (const z of [-8.25, 0, 8.25]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.36, 1.42), black);
      bogie.position.set(0, 0.42, z);
      this.root.add(bogie);
    }
    const roofEquipment = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.2, 6.8), roofGrey);
    roofEquipment.position.set(0, 3.3, -0.4);
    this.root.add(roofEquipment);
    this.addPantograph(new THREE.Vector3(0, 3.52, 1.3), metal);
    this.trainHalfLengthM = 13.2;
    return this.createVehicleInstance();
  }

  createZurichTramVehicle(): VehicleInstance {
    const shell = new THREE.MeshStandardMaterial({ color: 0xf7f8fa, roughness: 0.4, metalness: 0.14 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x0066b3, roughness: 0.34, metalness: 0.08 });
    const lightBlue = new THREE.MeshStandardMaterial({ color: 0x2e92d4, roughness: 0.34, metalness: 0.06 });
    const black = new THREE.MeshStandardMaterial({ color: 0x14191f, roughness: 0.2, metalness: 0.3 });
    const silver = new THREE.MeshStandardMaterial({ color: 0xc7cdd2, roughness: 0.46, metalness: 0.2 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9dc7d9, transparent: true, opacity: 0.42, roughness: 0.05, side: THREE.DoubleSide });
    const floor = new THREE.MeshStandardMaterial({ color: 0x6f767b, roughness: 0.92 });
    const ceiling = new THREE.MeshStandardMaterial({ color: 0xe1e5e8, roughness: 0.86 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x1f5f87, roughness: 0.88 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa1a5, roughness: 0.34, metalness: 0.72 });
    const ledPanel = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 700, height: 128, bg: '#0e1317', fg: '#ffb300' }),
      side: THREE.DoubleSide
    });
    const interiorDisplayMat = this.context.makeInteriorDisplayMaterial();
    this.glassMaterial = glass;

    // Generic VBZ tram visual inspired by the white-blue Zürich fleet.
    const sections = [
      { center: -13.1, length: 6.8, end: -1 as -1 | 0 | 1 },
      { center: -6.55, length: 5.1, end: 0 as -1 | 0 | 1 },
      { center: 0, length: 6.4, end: 0 as -1 | 0 | 1 },
      { center: 6.55, length: 5.1, end: 0 as -1 | 0 | 1 },
      { center: 13.1, length: 6.8, end: 1 as -1 | 0 | 1 }
    ];

    for (const section of sections) {
      const car = new THREE.Group();
      car.name = `Articulated car Zurich tram section ${section.center}`;
      car.userData.centerOffsetM = section.center;

      const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.48, 0.32, section.length - 0.08), silver);
      skirt.position.y = 0.56;
      car.add(skirt);
      this.passengerShells.push(skirt);

      const body = new THREE.Mesh(new THREE.BoxGeometry(2.38, 2.6, section.length), shell);
      body.position.y = 1.82;
      body.castShadow = true;
      car.add(body);
      this.passengerShells.push(body);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.2, section.length - 0.1), silver);
      roof.position.y = 3.18;
      car.add(roof);
      this.passengerShells.push(roof);

      for (const side of [-1, 1] as const) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.14, section.length - 0.18), black);
        band.position.set(side * 1.24, 2.32, 0);
        car.add(band);
        this.windowBands.push(band);

        const windowCount = section.length > 6 ? 3 : 2;
        for (let index = 0; index < windowCount; index++) {
          const z = -section.length * 0.27 + (index * (section.length * 0.54)) / Math.max(1, windowCount - 1);
          const windowLength = windowCount === 3 && index === 1 ? 1.38 : 1.02;
          const win = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.9, windowLength), glass);
          win.position.set(side * 1.255, 2.32, z);
          car.add(win);
        }

        if (section.end === 0 || (section.end < 0 && side < 0) || (section.end > 0 && side > 0)) {
          const doorZ = section.length > 6 ? 0.64 : 0;
          this.addSlidingVehicleDoor(car, side * 1.255, doorZ, blue, glass, black, 1.52, 1.98);
          const blueAccent = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.12, 1.66), lightBlue);
          blueAccent.position.set(side * 1.225, 1.77, doorZ);
          car.add(blueAccent);
        }
      }

      const interiorFloor = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.08, section.length - 0.28), floor);
      interiorFloor.position.y = 0.98;
      car.add(interiorFloor);
      const interiorCeiling = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.08, section.length - 0.34), ceiling);
      interiorCeiling.position.y = 3.02;
      car.add(interiorCeiling);
      this.addOpaqueTransitInterior(car, section.length - 0.34, 1.08, ceiling, (side) => {
        if (section.end === 0 || (section.end < 0 && side < 0) || (section.end > 0 && side > 0)) return [section.length > 6 ? 0.64 : 0];
        return [];
      });

      for (const z of section.length > 6 ? [-1.6, 1.6] : [-1.0, 1.0]) {
        for (const x of [-0.76, 0.76]) {
          const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.56), seat);
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
        const cabDirection = section.end;
        const frontPanel = new THREE.Mesh(this.makeCabNose(blue).geometry.clone(), blue);
        frontPanel.scale.set(1.04, 1.02, 0.84);
        frontPanel.position.set(0, 1.9, cabDirection * (section.length / 2 - 0.16));
        if (cabDirection > 0) frontPanel.rotation.y = Math.PI;
        car.add(frontPanel);
        this.cabShells.push(frontPanel);

        const face = new THREE.Mesh(new THREE.BoxGeometry(2.14, 1.96, 0.12), black);
        face.position.set(0, 2.16, cabDirection * (section.length / 2 + 0.12));
        car.add(face);
        this.cabShells.push(face);

        const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.84, 1.02, 0.08), glass);
        windscreen.position.set(0, 2.46, cabDirection * (section.length / 2 + 0.18));
        windscreen.rotation.x = cabDirection * -0.18;
        car.add(windscreen);

        const routeDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.34), ledPanel);
        routeDisplay.position.set(0, 3.04, cabDirection * (section.length / 2 + 0.22));
        if (cabDirection < 0) routeDisplay.rotation.y = Math.PI;
        routeDisplay.renderOrder = 20;
        car.add(routeDisplay);
        this.cabDisplays.push(routeDisplay);

        for (const x of [-0.68, 0.68]) {
          const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.08), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf7f4d4, emissiveIntensity: 2.0 }));
          headlight.position.set(x, 1.12, cabDirection * (section.length / 2 + 0.22));
          car.add(headlight);
        }
      } else {
        const internalDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.74, 0.42), interiorDisplayMat);
        internalDisplay.position.set(0, 2.8, 0);
        internalDisplay.rotation.y = Math.PI;
        internalDisplay.renderOrder = 18;
        car.add(internalDisplay);
      }

      this.cars.push(car);
      this.root.add(car);
    }

    for (const z of [-9.8, -3.3, 3.3, 9.8]) {
      const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.18, 2.24, 0.72), black);
      bellows.position.set(0, 1.84, z);
      this.root.add(bellows);
      this.passengerShells.push(bellows);
    }
    for (const z of [-9.95, -3.35, 3.35, 9.95]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.36, 1.5), black);
      bogie.position.set(0, 0.42, z);
      this.root.add(bogie);
    }
    const roofHvac = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.22, 8.2), silver);
    roofHvac.position.set(0, 3.38, -0.2);
    this.root.add(roofHvac);
    this.addPantograph(new THREE.Vector3(0, 3.6, 2.4), metal);
    this.trainHalfLengthM = 16.1;
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

  createStadtbahnVehicle(): VehicleInstance {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffdf00, roughness: 0.52, metalness: 0.05 });
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
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xf6c900, roughness: 0.48 });
    const interiorWallMat = new THREE.MeshStandardMaterial({ color: 0xd9d5ca, roughness: 0.88 });
    const interiorFloorMat = new THREE.MeshStandardMaterial({ color: 0x686d6d, roughness: 0.94 });
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x11151b, roughness: 0.8 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x8a8f91, roughness: 0.4, metalness: 0.65 });
    const interiorDisplayMat = this.context.makeInteriorDisplayMaterial();

    const doubleFormation = isStadtbahnDoubleFormation(this.context.route.line);
    const carCenters = doubleFormation ? [-29.85, -9.95, 9.95, 29.85] : [-9.95, 9.95];
    const cabDirections: (-1 | 1)[] = doubleFormation ? [-1, 1, -1, 1] : [-1, 1];
    this.trainHalfLengthM = doubleFormation ? 40.05 : 20.15;
    carCenters.forEach((center, index) => {
      this.cars.push(this.addTangoCar(center, cabDirections[index], bodyMat, glassMat, doorMat, blackMat, roofMat, interiorWallMat, interiorFloorMat, metalMat, interiorDisplayMat));
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

    const destinationMaterial = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 512, height: 128, bg: '#111', fg: '#ffd900' }),
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });
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
    metalMat: THREE.Material,
    interiorDisplayMat: THREE.Material
  ): THREE.Group {
    const car = new THREE.Group();
    car.name = `Articulated car ${centerZ}`;
    car.userData.centerOffsetM = centerZ;
    car.position.z = centerZ;
    const lowerSkirt = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.24, 17.75), blackMat);
    lowerSkirt.position.y = 0.43;
    lowerSkirt.castShadow = true;
    car.add(lowerSkirt);
    const body = new THREE.Mesh(this.makeTangoBody(), bodyMat);
    body.position.y = 0.52;
    body.castShadow = true;
    car.add(body);
    // The real DT8 roof deck is light grey; only the side fairings stay yellow.
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.24, 16.9), roofMat);
    roof.position.y = 3.34;
    roof.castShadow = true;
    car.add(roof);
    for (const side of [-1, 1]) {
      const roofFairing = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.36, 16.35), bodyMat);
      roofFairing.position.set(side * 1.12, 3.36, 0);
      roofFairing.castShadow = true;
      car.add(roofFairing);
    }

    // Raked Stadler Tango front end: profile-extruded nose, black mask band, tilted windscreen.
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

    const wiper = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.8, 0.03), blackMat);
    wiper.position.set(-0.3, 1.78, cabDirection * 10.0);
    wiper.rotation.set(faceTilt, 0, cabDirection * 0.5);
    car.add(wiper);
    this.cabShells.push(wiper);

    const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.24, 0.14), blackMat);
    bumper.position.set(0, 0.5, cabDirection * 10.06);
    car.add(bumper);
    this.cabShells.push(bumper);

    // Corner light clusters: round LED headlamp, indicator and tail lamp, as on the DT8.12.
    const headlightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4c7, emissiveIntensity: 0.55 });
    const indicatorMat = new THREE.MeshStandardMaterial({ color: 0xffb340, emissive: 0xff9d1e, emissiveIntensity: 1.4 });
    const tailLampMat = new THREE.MeshStandardMaterial({ color: 0x8c1f1c, emissive: 0x7a1512, emissiveIntensity: 0.35 });
    const lampHousingMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.34, metalness: 0.4 });
    this.headLampMaterials.push(headlightMat);
    this.tailLampMaterials.push(tailLampMat);
    for (const x of [-1, 1] as const) {
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.08), lampHousingMat);
      housing.position.set(x * 0.82, 1.0, cabDirection * 10.06);
      car.add(housing);
      this.cabShells.push(housing);
      const headlight = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 18), headlightMat);
      headlight.rotation.x = Math.PI / 2;
      headlight.position.set(x * 0.72, 1.08, cabDirection * 10.09);
      car.add(headlight);
      const indicator = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.055, 14), indicatorMat);
      indicator.rotation.x = Math.PI / 2;
      indicator.position.set(x * 0.95, 1.08, cabDirection * 10.09);
      car.add(indicator);
      const tailLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.055, 14), tailLampMat);
      tailLamp.rotation.x = Math.PI / 2;
      tailLamp.position.set(x * 0.84, 0.86, cabDirection * 10.09);
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
    frontLogo.position.set(-0.55, 1.36, cabDirection * 10.06);
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
    cabNumber.position.set(0.62, 1.36, cabDirection * 10.06);
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

    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.08, 16.6), interiorFloorMat);
    floor.position.y = 1.02;
    car.add(floor);
    this.addInteriorShell(car, cabZ, cabDirection, interiorWallMat, blackMat, glassMat, doorMat);
    this.addPassengerSeating(car, cabDirection, metalMat, doorMat);
    this.addInteriorDisplays(car, cabDirection, interiorDisplayMat, blackMat);

    for (const z of [-5.1, 0, 5.1]) {
      const hvac = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.24, 2.25), roofMat);
      hvac.position.set(0, 3.57, z);
      car.add(hvac);
      for (let vent = -2; vent <= 2; vent++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.03, 0.07), blackMat);
        slat.position.set(0, 3.7, z + vent * 0.28);
        car.add(slat);
      }
    }

    for (const z of [-5.8, 5.8]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.38, 1.85), blackMat);
      bogie.position.set(0, 0.43, z);
      car.add(bogie);
      for (const x of [-0.92, 0.92]) {
        for (const wheelZ of [z - 0.58, z + 0.58]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.2, 24), blackMat);
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(x, 0.37, wheelZ);
          car.add(wheel);
        }
      }
    }

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
    accentMaterial: THREE.Material
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

    const cushionMaterial = new THREE.MeshStandardMaterial({ color: 0x416b80, roughness: 0.9 });
    const backMaterial = new THREE.MeshStandardMaterial({ color: 0x365f74, roughness: 0.88 });
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x343b3e, roughness: 0.75, metalness: 0.18 });
    const cushions = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.13, 0.5), cushionMaterial, seats.length);
    const backrests = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.66, 0.12), backMaterial, seats.length);
    const pedestals = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.34, 0.2), baseMaterial, seats.length);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const priorityBlue = new THREE.Color(0x557f91);
    const standardBlue = new THREE.Color(0x416b80);
    seats.forEach((seat, index) => {
      matrix.makeTranslation(seat.x, 1.3, seat.z);
      cushions.setMatrixAt(index, matrix);
      cushions.setColorAt(index, seat.priority ? priorityBlue : standardBlue);
      rotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), seat.facing * -0.08);
      matrix.compose(new THREE.Vector3(seat.x, 1.66, seat.z - seat.facing * 0.285), rotation, new THREE.Vector3(1, 1, 1));
      backrests.setMatrixAt(index, matrix);
      matrix.makeTranslation(seat.x, 1.15, seat.z - seat.facing * 0.08);
      pedestals.setMatrixAt(index, matrix);
    });
    cushions.name = 'SSB paired seat cushions';
    backrests.name = 'SSB paired seat backrests';
    pedestals.name = 'SSB cantilever seat supports';
    cushions.castShadow = true;
    backrests.castShadow = true;
    car.add(cushions, backrests, pedestals);

    const leaningPads = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.12, 0.7, 0.52),
      new THREE.MeshStandardMaterial({ color: 0x496e7d, roughness: 0.9 }),
      multiPurposeRows.size
    );
    [...multiPurposeRows].forEach((z, index) => {
      matrix.makeTranslation(1.18, 1.62, z);
      leaningPads.setMatrixAt(index, matrix);
    });
    leaningPads.name = 'SSB multipurpose-area leaning pads';
    car.add(leaningPads);

    const foldingSeatMaterial = new THREE.MeshStandardMaterial({ color: 0x537b8d, roughness: 0.9 });
    for (const z of [-4.05, -3.48, 3.55, 4.12]) {
      const foldingSeat = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.46), foldingSeatMaterial);
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
    overheadDisplayFront.rotation.y = 0;
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

  private makeTangoNose(): THREE.ExtrudeGeometry {
    // Side profile of the raked Tango front, drawn in (forward, height) and extruded
    // across the car width so the whole cab leans back like the real DT8.12 face.
    const profile = new THREE.Shape();
    profile.moveTo(0, 0.4);
    profile.lineTo(0.8, 0.4);
    profile.lineTo(0.94, 0.62);
    profile.lineTo(0.9, 1.42);
    profile.lineTo(0.52, 2.86);
    profile.quadraticCurveTo(0.42, 3.14, 0.14, 3.22);
    profile.lineTo(0, 3.22);
    profile.closePath();
    const geometry = new THREE.ExtrudeGeometry(profile, {
      depth: 2.34,
      bevelEnabled: true,
      bevelThickness: 0.09,
      bevelSize: 0.09,
      bevelSegments: 3
    });
    geometry.translate(0, 0, -1.17);
    // Map the profile's forward axis onto +z and the extrusion depth onto the width.
    geometry.rotateY(-Math.PI / 2);
    return geometry;
  }

  private makeTangoCabMask(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-1.09, -0.8);
    shape.lineTo(1.09, -0.8);
    shape.lineTo(0.82, 0.72);
    shape.quadraticCurveTo(0.72, 0.86, 0.5, 0.88);
    shape.lineTo(-0.5, 0.88);
    shape.quadraticCurveTo(-0.72, 0.86, -0.82, 0.72);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
    geometry.translate(0, 0, -0.03);
    return geometry;
  }

  private makeTangoWindscreen(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.99, -0.68);
    shape.lineTo(0.99, -0.68);
    shape.lineTo(0.74, 0.6);
    shape.quadraticCurveTo(0.64, 0.7, 0.46, 0.72);
    shape.lineTo(-0.46, 0.72);
    shape.quadraticCurveTo(-0.64, 0.7, -0.74, 0.6);
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
