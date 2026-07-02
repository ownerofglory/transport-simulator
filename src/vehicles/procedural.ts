import * as THREE from 'three';
import { makeLabelTexture } from '../labels';
import type { VehicleKind } from '../domain/transport';
import type { VehicleBuildContext, VehicleInstance } from './types';

const DOUBLE_FORMATION_LINES = new Set(['U1', 'U6', 'U7', 'U11', 'U12', 'U19']);

class ProceduralTransitVehicleFactory {
  private readonly root = new THREE.Group();
  private readonly cars: THREE.Group[] = [];
  private readonly doors: VehicleInstance['doors'] = [];
  private readonly windowBands: THREE.Mesh[] = [];
  private readonly cabShells: THREE.Mesh[] = [];
  private readonly passengerShells: THREE.Mesh[] = [];
  private readonly cabDisplays: THREE.Mesh[] = [];
  private glassMaterial?: THREE.MeshStandardMaterial;
  private trainHalfLengthM = 20.15;

  constructor(private readonly context: VehicleBuildContext) {}

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
    else if (vehicleKind === 'bus') this.createBusVehicle();
    else if (vehicleKind === 's-bahn') this.createSBahnVehicle();
    else if (vehicleKind === 'zacke') this.createZackeVehicle();
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
      trainHalfLengthM: this.trainHalfLengthM
    };
  }

  createBusVehicle(): VehicleInstance {
    const car = new THREE.Group();
    car.name = 'Articulated car Mercedes-Benz city bus';
    car.userData.centerOffsetM = 0;
    const yellow = new THREE.MeshStandardMaterial({ color: 0xffdf00, roughness: 0.48, metalness: 0.04 });
    const black = new THREE.MeshStandardMaterial({ color: 0x151a1d, roughness: 0.36 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9bd2e1, transparent: true, opacity: 0.38, roughness: 0.08, depthWrite: true });
    const interior = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.88 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8b9293, roughness: 0.38, metalness: 0.65 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x315f77, roughness: 0.88 });
    const displayMaterial = this.context.makeInteriorDisplayMaterial();
    this.glassMaterial = glass;

    const body = new THREE.Mesh(new THREE.BoxGeometry(2.55, 2.85, 12.1), yellow);
    body.position.y = 1.72;
    body.castShadow = true;
    car.add(body);
    this.passengerShells.push(body);
    for (const side of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.18, 10.25), black);
      band.position.set(side * 1.3, 2.36, -0.25);
      car.add(band);
      this.windowBands.push(band);
      for (const z of [-4.65, -3.35, -1.55, 0.05, 2.85, 4.2]) {
        if (side < 0 && (Math.abs(z + 1.55) < 0.1 || Math.abs(z - 2.85) < 0.1)) continue;
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.92, 1.05), glass);
        window.position.set(side * 1.315, 2.36, z);
        car.add(window);
      }
    }
    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(2.22, 1.15, 0.08), glass);
    windscreen.position.set(0, 2.35, 6.09);
    car.add(windscreen);
    const destination = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 0.42), new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 640, height: 128, bg: '#111', fg: '#ffb900' }),
      side: THREE.DoubleSide
    }));
    destination.position.set(0, 2.98, 6.14);
    car.add(destination);
    this.addSlidingVehicleDoor(car, -1.315, -1.55, yellow, glass, black, 1.62, 1.9);
    this.addSlidingVehicleDoor(car, -1.315, 2.85, yellow, glass, black, 1.62, 1.9);
    for (const z of [-3.7, 3.7]) {
      for (const x of [-1.26, 1.26]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.18, 20), black);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.52, z);
        car.add(wheel);
      }
    }
    const roofUnit = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.25, 3.2), black);
    roofUnit.position.set(0, 3.28, -1.2);
    car.add(roofUnit);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.08, 11.4), interior);
    floor.position.y = 1.02;
    car.add(floor);
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.08, 11.3), interior);
    ceiling.position.y = 3.02;
    car.add(ceiling);
    this.addOpaqueTransitInterior(car, 11.3, 1.18, interior, (side) => side < 0 ? [-1.55, 2.85] : []);
    for (const z of [-4.35, -3.25, -2.15, 0.15, 1.25, 4.2]) {
      for (const x of [-0.92, 0.92]) {
        const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.62), seat);
        cushion.position.set(x, 1.35, z);
        car.add(cushion);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.7, 0.12), seat);
        back.position.set(x, 1.7, z - 0.3);
        car.add(back);
      }
    }
    for (const z of [-2.45, 0.2, 3.7]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.85, 8), metal);
      pole.position.set(0.65, 2.02, z);
      car.add(pole);
    }
    const dashboard = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.62, 0.75), black);
    dashboard.position.set(0, 1.42, 5.48);
    car.add(dashboard);
    const nextStopDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 0.44), displayMaterial);
    nextStopDisplay.position.set(0, 2.72, 4.75);
    nextStopDisplay.rotation.y = Math.PI;
    car.add(nextStopDisplay);
    this.trainHalfLengthM = 6.25;
    this.cars.push(car);
    this.root.add(car);
    return this.createVehicleInstance();
  }

  createSBahnVehicle(): VehicleInstance {
    const shell = new THREE.MeshStandardMaterial({ color: 0xdfe1df, roughness: 0.42, metalness: 0.1 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd71920, roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x202428, roughness: 0.38 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x8fb9c7, transparent: true, opacity: 0.42, roughness: 0.06, side: THREE.DoubleSide });
    const interior = new THREE.MeshStandardMaterial({ color: 0xe4e1d8, roughness: 0.88 });
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x8f9398, roughness: 0.9 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x315f78, roughness: 0.88 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x989d9e, roughness: 0.35, metalness: 0.7 });
    const displayMaterial = this.context.makeInteriorDisplayMaterial();
    this.glassMaterial = glass;
    const centers = [-25.2, -8.4, 8.4, 25.2];
    centers.forEach((center, index) => {
      const car = new THREE.Group();
      car.name = `Articulated car DB 423 section ${index + 1}`;
      car.userData.centerOffsetM = center;
      const body = new THREE.Mesh(new THREE.BoxGeometry(3.02, 3.3, 16.15), shell);
      body.position.y = 2.05;
      body.castShadow = true;
      car.add(body);
      this.passengerShells.push(body);
      const lowerRed = new THREE.Mesh(new THREE.BoxGeometry(3.08, 0.28, 16.22), red);
      lowerRed.position.y = 0.62;
      car.add(lowerRed);
      this.passengerShells.push(lowerRed);
      const belt = new THREE.Mesh(new THREE.BoxGeometry(3.09, 0.18, 16.23), red);
      belt.position.y = 1.72;
      car.add(belt);
      this.passengerShells.push(belt);
      for (const side of [-1, 1]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.08, 14.5), dark);
        band.position.set(side * 1.535, 2.43, 0);
        car.add(band);
        this.windowBands.push(band);
        for (const z of [-6.25, -4.85, -1.35, 0, 1.35, 4.85, 6.25]) {
          const window = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.88, 1.08), glass);
          window.position.set(side * 1.55, 2.43, z);
          car.add(window);
        }
        this.addSlidingVehicleDoor(car, side * 1.55, -3.15, red, glass, dark, 1.72, 2.05);
        this.addSlidingVehicleDoor(car, side * 1.55, 3.15, red, glass, dark, 1.72, 2.05);
      }
      if (index === 0 || index === centers.length - 1) {
        const cabEnd = index === 0 ? -1 : 1;
        const nose = this.makeCabNose(red);
        nose.scale.set(1.18, 1.08, 0.72);
        nose.position.set(0, 2.02, cabEnd * 8.18);
        if (cabEnd > 0) nose.rotation.y = Math.PI;
        car.add(nose);
        this.cabShells.push(nose);
        const cabFace = new THREE.Mesh(new THREE.BoxGeometry(2.82, 2.58, 0.16), red);
        cabFace.position.set(0, 1.9, cabEnd * 8.43);
        car.add(cabFace);
        this.cabShells.push(cabFace);
        const windscreen = new THREE.Mesh(new THREE.BoxGeometry(2.36, 0.92, 0.06), glass);
        windscreen.position.set(0, 2.6, cabEnd * 8.53);
        car.add(windscreen);
        const display = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 0.42), new THREE.MeshBasicMaterial({
          map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 700, height: 128, bg: '#111', fg: '#fff' }),
          side: THREE.DoubleSide
        }));
        display.position.set(0, 3.17, cabEnd * 8.63);
        if (cabEnd < 0) display.rotation.y = Math.PI;
        car.add(display);
      }
      const floor = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.12, 15.5), floorMaterial);
      floor.position.y = 1.12;
      car.add(floor);
      const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.68, 0.08, 15.35), interior);
      ceiling.position.y = 3.32;
      car.add(ceiling);
      this.addOpaqueTransitInterior(car, 15.35, 1.4, interior, () => [-3.15, 3.15]);
      for (const z of [-6.2, -5.1, -1.35, 0, 1.35, 5.1, 6.2]) {
        for (const x of [-1.04, -0.58, 0.58, 1.04]) {
          const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.13, 0.52), seat);
          cushion.position.set(x, 1.37, z);
          car.add(cushion);
          const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.68, 0.11), seat);
          back.position.set(x, 1.72, z - 0.25);
          car.add(back);
        }
      }
      for (const z of [-3.15, 0, 3.15]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2, 8), metal);
        pole.position.set(0, 2.1, z);
        car.add(pole);
      }
      const monitor = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.54), displayMaterial);
      monitor.position.set(0, 2.94, 0.15);
      monitor.rotation.y = Math.PI;
      monitor.renderOrder = 18;
      car.add(monitor);
      for (const z of [-5.2, 5.2]) {
        const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.42, 1.8), dark);
        bogie.position.set(0, 0.48, z);
        car.add(bogie);
      }
      this.cars.push(car);
      this.root.add(car);
    });
    this.trainHalfLengthM = 34.2;
    this.addPantograph(new THREE.Vector3(0, 3.86, 8.5), dark);
    return this.createVehicleInstance();
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

  createZackeVehicle(): VehicleInstance {
    const car = new THREE.Group();
    car.name = 'Articulated car S-ZT 4.2';
    car.userData.centerOffsetM = 0;
    const yellow = new THREE.MeshStandardMaterial({ color: 0xffdc00, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b2228, roughness: 0.38 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9ccbd7, transparent: true, opacity: 0.42, roughness: 0.06 });
    const floor = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.65, 3.1, 18.6), yellow);
    body.position.y = 1.88;
    car.add(body);
    this.passengerShells.push(body);
    for (const side of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.08, 15.8), dark);
      band.position.set(side * 1.35, 2.38, 0);
      car.add(band);
      this.windowBands.push(band);
      for (const z of [-6.8, -4.7, -2.4, 0, 2.4, 4.7, 6.8]) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.88, 1.55), glass);
        window.position.set(side * 1.37, 2.4, z);
        car.add(window);
      }
    }
    for (const end of [-1, 1]) {
      const windscreen = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.95, 0.08), glass);
      windscreen.position.set(0, 2.45, end * 9.34);
      car.add(windscreen);
    }
    const interiorFloor = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 17.5), floor);
    interiorFloor.position.y = 1.05;
    car.add(interiorFloor);
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 17.4), floor);
    ceiling.position.y = 3.18;
    car.add(ceiling);
    this.addOpaqueTransitInterior(car, 17.4, 1.2, floor, () => []);
    this.glassMaterial = glass;
    this.trainHalfLengthM = 9.5;
    this.cars.push(car);
    this.root.add(car);
    this.addPantograph(new THREE.Vector3(0, 3.55, 0), dark);
    return this.createVehicleInstance();
  }

  createSeilbahnVehicle(): VehicleInstance {
    const car = new THREE.Group();
    car.name = 'Articulated car 1929 teak funicular';
    car.userData.centerOffsetM = 0;
    const teak = new THREE.MeshStandardMaterial({ color: 0x7b4b2a, roughness: 0.74 });
    const mahogany = new THREE.MeshStandardMaterial({ color: 0x4f301f, roughness: 0.82 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc7a04c, roughness: 0.34, metalness: 0.72 });
    const cream = new THREE.MeshStandardMaterial({ color: 0xd9ccb1, roughness: 0.88 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xc2e0e7, transparent: true, opacity: 0.38, roughness: 0.08 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.24, 2.72, 9.9), teak);
    body.position.y = 1.67;
    car.add(body);
    this.passengerShells.push(body);
    for (const side of [-1, 1] as const) {
      const lowerBelt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 9.5), mahogany);
      lowerBelt.position.set(side * 1.08, 1.12, 0);
      car.add(lowerBelt);
      const header = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 9.5), mahogany);
      header.position.set(side * 1.08, 2.98, 0);
      car.add(header);
      for (const z of [-3.7, -1.85, 0, 1.85, 3.7]) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.075, 1.22, 1.28), glass);
        window.position.set(side * 1.13, 2.06, z);
        car.add(window);
        const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.42, 0.12), mahogany);
        mullion.position.set(side * 1.08, 2.04, z + 0.92);
        car.add(mullion);
      }
    }
    for (const end of [-1, 1] as const) {
      const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.24, 0.075), glass);
      windscreen.position.set(0, 2.04, end * 4.94);
      car.add(windscreen);
      const endFrame = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.18, 0.12), mahogany);
      endFrame.position.set(0, 3.01, end * 4.88);
      car.add(endFrame);
    }
    const floorBase = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.12, 9.05), mahogany);
    floorBase.position.y = 0.9;
    car.add(floorBase);
    for (let z = -4.15; z <= 4.15; z += 0.48) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.028, 0.28), teak);
      plank.position.set(0, 0.98, z);
      car.add(plank);
    }
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.08, 8.9), cream);
    ceiling.position.y = 3.02;
    car.add(ceiling);
    this.addOpaqueTransitInterior(car, 8.9, 1.0, mahogany, () => []);
    for (const side of [-1, 1] as const) {
      const benchBase = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.18, 8.15), mahogany);
      benchBase.position.set(side * 0.6, 1.14, 0);
      car.add(benchBase);
      const benchBack = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, 8.0), teak);
      benchBack.position.set(side * 0.77, 1.54, 0);
      car.add(benchBack);
      for (const z of [-3.1, -1.5, 0, 1.5, 3.1]) {
        const divider = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.76, 0.06), brass);
        divider.position.set(side * 0.7, 1.48, z);
        car.add(divider);
      }
    }
    for (const x of [-0.78, 0, 0.78]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.0, 10), brass);
      pole.position.set(x, 1.98, 0);
      car.add(pole);
    }
    const handrail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 7.9, 10), brass);
    handrail.rotation.z = Math.PI / 2;
    handrail.position.set(0, 2.6, 0);
    car.add(handrail);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.54, 0.24, 10.2), mahogany);
    roof.position.y = 3.14;
    car.add(roof);
    this.passengerShells.push(roof);
    this.glassMaterial = glass;
    this.trainHalfLengthM = 5;
    this.cars.push(car);
    this.root.add(car);
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
    const shell = new THREE.MeshStandardMaterial({ color: 0xf1f3f4, roughness: 0.42, metalness: 0.16 });
    const lightGrey = new THREE.MeshStandardMaterial({ color: 0xc6ccd2, roughness: 0.52, metalness: 0.12 });
    const glossyBlack = new THREE.MeshStandardMaterial({ color: 0x161b1f, roughness: 0.18, metalness: 0.32 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x76b8e8, roughness: 0.34, metalness: 0.08 });
    const doorBlue = new THREE.MeshStandardMaterial({ color: 0x3e8ec7, roughness: 0.36, metalness: 0.1 });
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

      const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.34, section.length - 0.1), lightGrey);
      skirt.position.y = 0.56;
      car.add(skirt);
      this.passengerShells.push(skirt);

      const body = new THREE.Mesh(new THREE.BoxGeometry(2.36, 2.56, section.length), shell);
      body.position.y = 1.78;
      body.castShadow = true;
      car.add(body);
      this.passengerShells.push(body);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.2, section.length - 0.1), lightGrey);
      roof.position.y = 3.14;
      car.add(roof);
      this.passengerShells.push(roof);

      for (const side of [-1, 1] as const) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.12, section.length - 0.2), glossyBlack);
        band.position.set(side * 1.22, 2.28, 0);
        car.add(band);
        this.windowBands.push(band);

        const windowCount = section.length > 6 ? 3 : 2;
        for (let index = 0; index < windowCount; index++) {
          const z = -section.length * 0.28 + (index * (section.length * 0.56)) / Math.max(1, windowCount - 1);
          const win = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.88, windowCount === 3 && index === 1 ? 1.25 : 0.98), glass);
          win.position.set(side * 1.24, 2.28, z);
          car.add(win);
        }

        if (section.end === 0 || (section.end < 0 && side < 0) || (section.end > 0 && side > 0)) {
          const doorZ = section.length > 6 ? 0.55 : 0;
          this.addSlidingVehicleDoor(car, side * 1.245, doorZ, doorBlue, glass, glossyBlack, 1.48, 1.95);
          const blueAccent = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.08, 1.62), blue);
          blueAccent.position.set(side * 1.215, 1.75, doorZ);
          car.add(blueAccent);
        }
      }

      const interiorFloor = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, section.length - 0.28), floor);
      interiorFloor.position.y = 0.98;
      car.add(interiorFloor);
      const interiorCeiling = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.08, section.length - 0.34), ceiling);
      interiorCeiling.position.y = 2.98;
      car.add(interiorCeiling);
      this.addOpaqueTransitInterior(car, section.length - 0.34, 1.08, ceiling, (side) => {
        if (section.end === 0 || (section.end < 0 && side < 0) || (section.end > 0 && side > 0)) {
          return [section.length > 6 ? 0.55 : 0];
        }
        return [];
      });

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
        const cabDirection = section.end;
        const frontPanel = new THREE.Mesh(this.makeCabNose(blue).geometry.clone(), blue);
        frontPanel.scale.set(1.02, 1.02, 0.82);
        frontPanel.position.set(0, 1.86, cabDirection * (section.length / 2 - 0.18));
        if (cabDirection > 0) frontPanel.rotation.y = Math.PI;
        car.add(frontPanel);
        this.cabShells.push(frontPanel);

        const face = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.92, 0.12), glossyBlack);
        face.position.set(0, 2.12, cabDirection * (section.length / 2 + 0.12));
        car.add(face);
        this.cabShells.push(face);

        const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.94, 0.08), glass);
        windscreen.position.set(0, 2.44, cabDirection * (section.length / 2 + 0.16));
        windscreen.rotation.x = cabDirection * -0.22;
        car.add(windscreen);

        const routeDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.58, 0.34), ledPanel);
        routeDisplay.position.set(0, 2.98, cabDirection * (section.length / 2 + 0.2));
        if (cabDirection < 0) routeDisplay.rotation.y = Math.PI;
        routeDisplay.renderOrder = 20;
        car.add(routeDisplay);
        this.cabDisplays.push(routeDisplay);

        const lowerMask = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.34, 0.1), lightGrey);
        lowerMask.position.set(0, 0.84, cabDirection * (section.length / 2 + 0.11));
        car.add(lowerMask);

        const headlightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf8f4d0, emissiveIntensity: 2.0 });
        for (const x of [-0.66, 0.66]) {
          const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.08), headlightMat);
          headlight.position.set(x, 1.1, cabDirection * (section.length / 2 + 0.22));
          car.add(headlight);
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

    const roofHvac = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.22, 7.8), lightGrey);
    roofHvac.position.set(0, 3.36, -0.4);
    this.root.add(roofHvac);
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
    const green = new THREE.MeshStandardMaterial({ color: 0x1e8f4f, roughness: 0.34, metalness: 0.06 });
    const darkGreen = new THREE.MeshStandardMaterial({ color: 0x12653a, roughness: 0.36, metalness: 0.06 });
    const black = new THREE.MeshStandardMaterial({ color: 0x171c1c, roughness: 0.2, metalness: 0.3 });
    const silver = new THREE.MeshStandardMaterial({ color: 0xc4cbc6, roughness: 0.48, metalness: 0.18 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9ac5d1, transparent: true, opacity: 0.42, roughness: 0.05, side: THREE.DoubleSide });
    const floor = new THREE.MeshStandardMaterial({ color: 0x707673, roughness: 0.92 });
    const ceiling = new THREE.MeshStandardMaterial({ color: 0xe4e7e1, roughness: 0.86 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x2f6e47, roughness: 0.88 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9ba39d, roughness: 0.34, metalness: 0.72 });
    const ledPanel = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 700, height: 128, bg: '#0f1413', fg: '#ffb300' }),
      side: THREE.DoubleSide
    });
    const interiorDisplayMat = this.context.makeInteriorDisplayMaterial();
    this.glassMaterial = glass;

    // Compact green-white VAG Freiburg tram inspired by the modern city fleet.
    const sections = [
      { center: -10.8, length: 6.4, end: -1 as -1 | 0 | 1 },
      { center: -5.4, length: 4.6, end: 0 as -1 | 0 | 1 },
      { center: 0, length: 5.8, end: 0 as -1 | 0 | 1 },
      { center: 5.4, length: 4.6, end: 0 as -1 | 0 | 1 },
      { center: 10.8, length: 6.4, end: 1 as -1 | 0 | 1 }
    ];

    for (const section of sections) {
      const car = new THREE.Group();
      car.name = `Articulated car Freiburg tram section ${section.center}`;
      car.userData.centerOffsetM = section.center;

      const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.32, section.length - 0.08), darkGreen);
      skirt.position.y = 0.56;
      car.add(skirt);
      this.passengerShells.push(skirt);

      const body = new THREE.Mesh(new THREE.BoxGeometry(2.36, 2.58, section.length), shell);
      body.position.y = 1.8;
      body.castShadow = true;
      car.add(body);
      this.passengerShells.push(body);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.2, section.length - 0.1), silver);
      roof.position.y = 3.16;
      car.add(roof);
      this.passengerShells.push(roof);

      for (const side of [-1, 1] as const) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.14, section.length - 0.18), black);
        band.position.set(side * 1.23, 2.3, 0);
        car.add(band);
        this.windowBands.push(band);

        const windowCount = section.length > 6 ? 3 : 2;
        for (let index = 0; index < windowCount; index++) {
          const z = -section.length * 0.27 + (index * (section.length * 0.54)) / Math.max(1, windowCount - 1);
          const windowLength = windowCount === 3 && index === 1 ? 1.32 : 1.0;
          const win = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.9, windowLength), glass);
          win.position.set(side * 1.245, 2.3, z);
          car.add(win);
        }

        if (section.end === 0 || (section.end < 0 && side < 0) || (section.end > 0 && side > 0)) {
          const doorZ = section.length > 6 ? 0.58 : 0;
          this.addSlidingVehicleDoor(car, side * 1.248, doorZ, green, glass, black, 1.5, 1.98);
          const greenAccent = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.1, 1.64), green);
          greenAccent.position.set(side * 1.218, 1.76, doorZ);
          car.add(greenAccent);
        }
      }

      const interiorFloor = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, section.length - 0.28), floor);
      interiorFloor.position.y = 0.98;
      car.add(interiorFloor);
      const interiorCeiling = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.08, section.length - 0.34), ceiling);
      interiorCeiling.position.y = 3.0;
      car.add(interiorCeiling);
      this.addOpaqueTransitInterior(car, section.length - 0.34, 1.08, ceiling, (side) => {
        if (section.end === 0 || (section.end < 0 && side < 0) || (section.end > 0 && side > 0)) return [section.length > 6 ? 0.58 : 0];
        return [];
      });

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
        const cabDirection = section.end;
        const frontPanel = new THREE.Mesh(this.makeCabNose(green).geometry.clone(), green);
        frontPanel.scale.set(1.03, 1.02, 0.84);
        frontPanel.position.set(0, 1.88, cabDirection * (section.length / 2 - 0.16));
        if (cabDirection > 0) frontPanel.rotation.y = Math.PI;
        car.add(frontPanel);
        this.cabShells.push(frontPanel);

        const face = new THREE.Mesh(new THREE.BoxGeometry(2.12, 1.94, 0.12), black);
        face.position.set(0, 2.14, cabDirection * (section.length / 2 + 0.12));
        car.add(face);
        this.cabShells.push(face);

        const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.98, 0.08), glass);
        windscreen.position.set(0, 2.44, cabDirection * (section.length / 2 + 0.18));
        windscreen.rotation.x = cabDirection * -0.18;
        car.add(windscreen);

        const routeDisplay = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 0.34), ledPanel);
        routeDisplay.position.set(0, 3.02, cabDirection * (section.length / 2 + 0.22));
        if (cabDirection < 0) routeDisplay.rotation.y = Math.PI;
        routeDisplay.renderOrder = 20;
        car.add(routeDisplay);
        this.cabDisplays.push(routeDisplay);
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

    for (const z of [-8.2, -2.7, 2.7, 8.2]) {
      const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.18, 2.22, 0.7), black);
      bellows.position.set(0, 1.82, z);
      this.root.add(bellows);
      this.passengerShells.push(bellows);
    }
    for (const z of [-8.35, -2.8, 2.8, 8.35]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.36, 1.48), black);
      bogie.position.set(0, 0.42, z);
      this.root.add(bogie);
    }
    const roofHvac = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.22, 7.1), silver);
    roofHvac.position.set(0, 3.36, -0.2);
    this.root.add(roofHvac);
    this.addPantograph(new THREE.Vector3(0, 3.58, 1.8), metal);
    this.trainHalfLengthM = 13.4;
    return this.createVehicleInstance();
  }

  createStadtbahnVehicle(): VehicleInstance {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffdf00, roughness: 0.52, metalness: 0.05 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.38 });
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
    const adMat = new THREE.MeshStandardMaterial({ color: 0x1d66ff, roughness: 0.5 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xd7d0bf, roughness: 0.72, metalness: 0.05 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xf6c900, roughness: 0.48 });
    const interiorWallMat = new THREE.MeshStandardMaterial({ color: 0xd9d5ca, roughness: 0.88 });
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x11151b, roughness: 0.8 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x8a8f91, roughness: 0.4, metalness: 0.65 });
    const interiorDisplayMat = this.context.makeInteriorDisplayMaterial();

    const doubleFormation = DOUBLE_FORMATION_LINES.has(this.context.route.line);
    const carCenters = doubleFormation ? [-29.85, -9.95, 9.95, 29.85] : [-9.95, 9.95];
    const cabDirections: (-1 | 1)[] = doubleFormation ? [-1, 1, -1, 1] : [-1, 1];
    this.trainHalfLengthM = doubleFormation ? 40.05 : 20.15;
    carCenters.forEach((center, index) => {
      this.cars.push(this.addTangoCar(center, cabDirections[index], bodyMat, glassMat, doorMat, blackMat, roofMat, adMat, interiorWallMat, metalMat, interiorDisplayMat));
    });

    for (const z of doubleFormation ? [-19.9, 19.9] : [0]) {
      const gangway = new THREE.Mesh(new THREE.BoxGeometry(2.42, 2.48, 1.05), rubberMat);
      gangway.position.set(0, 1.78, z);
      gangway.castShadow = true;
      this.root.add(gangway);
    }

    if (doubleFormation) {
      const middleCouplerA = this.makeCoupler();
      middleCouplerA.position.set(0, 0.25, 0.55);
      this.root.add(middleCouplerA);
      const middleCouplerB = this.makeCoupler();
      middleCouplerB.position.set(0, 0.25, -0.55);
      middleCouplerB.rotation.y = Math.PI;
      this.root.add(middleCouplerB);
    }

    const couplerFront = this.makeCoupler();
    couplerFront.position.set(0, 0.25, -(doubleFormation ? 40.05 : 20.15));
    this.root.add(couplerFront);
    const couplerRear = this.makeCoupler();
    couplerRear.position.set(0, 0.25, doubleFormation ? 40.05 : 20.15);
    couplerRear.rotation.y = Math.PI;
    this.root.add(couplerRear);

    const destinationFront = new THREE.Mesh(
      new THREE.PlaneGeometry(2.55, 0.58),
      new THREE.MeshBasicMaterial({
        map: makeLabelTexture(`${this.context.route.line} ${this.context.route.destination}`, { width: 512, height: 128, bg: '#111', fg: '#ffd900' }),
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
      })
    );
    destinationFront.name = 'Front cab route display';
    destinationFront.position.set(0, 2.78, -10.2);
    destinationFront.rotation.y = Math.PI;
    destinationFront.renderOrder = 20;
    this.cars[0].add(destinationFront);

    const destinationRear = destinationFront.clone();
    destinationRear.name = 'Rear cab route display';
    destinationRear.position.set(0, 2.78, 10.2);
    destinationRear.rotation.y = 0;
    this.cars.at(-1)?.add(destinationRear);
    this.cabDisplays.push(destinationFront, destinationRear);

    for (const z of doubleFormation ? [-15.3, 24.5] : [4.6]) {
      this.addPantograph(new THREE.Vector3(-0.2, 3.75, z), metalMat);
    }
    return this.createVehicleInstance();
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
    const side = Math.sign(x) || 1;
    const opening = new THREE.Mesh(new THREE.PlaneGeometry(width, height), openingMaterial);
    opening.position.set(x + side * 0.055, 1.75, z);
    opening.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    car.add(opening);
    for (const direction of [-1, 1] as const) {
      const closedZ = z + direction * width * 0.24;
      const leaf = new THREE.Group();
      leaf.position.z = closedZ;
      for (const edge of [-1, 1] as const) {
        const stile = new THREE.Mesh(new THREE.BoxGeometry(0.125, height - 0.08, width * 0.075), doorMaterial);
        stile.position.set(x + side * 0.03, 1.75, edge * width * 0.205);
        leaf.add(stile);
      }
      const crystal = new THREE.Mesh(new THREE.BoxGeometry(0.082, height * 0.8, width * 0.37), glassMaterial);
      crystal.position.set(x + side * 0.018, 1.9, 0);
      leaf.add(crystal);
      const frameTop = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, width * 0.48), doorMaterial);
      frameTop.position.set(x + side * 0.032, 2.64, 0);
      leaf.add(frameTop);
      const frameBottom = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.18, width * 0.48), doorMaterial);
      frameBottom.position.set(x + side * 0.032, 0.88, 0);
      leaf.add(frameBottom);
      car.add(leaf);
      this.doors.push({ group: leaf, closedZ, direction });
    }
  }

  private addOpaqueTransitInterior(
    car: THREE.Group,
    length: number,
    halfWidth: number,
    material: THREE.Material,
    doorZones: (side: -1 | 1) => number[]
  ): void {
    for (const side of [-1, 1] as const) {
      const exclusions = doorZones(side).map((center) => ({ start: center - 0.92, end: center + 0.92 })).sort((a, b) => a.start - b.start);
      let cursor = -length / 2;
      for (const exclusion of [...exclusions, { start: length / 2, end: length / 2 }]) {
        const end = Math.min(length / 2, exclusion.start);
        if (end - cursor > 0.18) {
          const lowerWall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.68, end - cursor), material);
          lowerWall.position.set(side * halfWidth, 1.42, (cursor + end) / 2);
          car.add(lowerWall);
        }
        cursor = Math.max(cursor, exclusion.end);
      }
      const header = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.38, length), material);
      header.position.set(side * (halfWidth - 0.03), 3.02, 0);
      car.add(header);
      for (let z = -length / 2 + 1.2; z < length / 2 - 0.6; z += 2.05) {
        if (exclusions.some((zone) => z >= zone.start && z <= zone.end)) continue;
        const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.1), material);
        mullion.position.set(side * halfWidth, 2.38, z);
        car.add(mullion);
      }
    }
  }

  private addTangoCar(
    centerZ: number,
    cabDirection: -1 | 1,
    bodyMat: THREE.Material,
    glassMat: THREE.Material,
    doorMat: THREE.Material,
    blackMat: THREE.Material,
    roofMat: THREE.Material,
    adMat: THREE.Material,
    interiorWallMat: THREE.Material,
    metalMat: THREE.Material,
    interiorDisplayMat: THREE.Material
  ): THREE.Group {
    const car = new THREE.Group();
    car.name = `Articulated car ${centerZ}`;
    car.userData.centerOffsetM = centerZ;
    car.position.z = centerZ;
    const lowerSkirt = new THREE.Mesh(new THREE.BoxGeometry(2.58, 0.38, 17.75), blackMat);
    lowerSkirt.position.y = 0.62;
    lowerSkirt.castShadow = true;
    car.add(lowerSkirt);
    const body = new THREE.Mesh(this.makeTangoBody(), bodyMat);
    body.position.y = 0.52;
    body.castShadow = true;
    car.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.24, 16.9), roofMat);
    roof.position.y = 3.34;
    roof.castShadow = true;
    car.add(roof);

    const cabZ = cabDirection * 9.56;
    const nose = this.makeCabNose(bodyMat);
    nose.position.set(0, 1.9, cabZ);
    if (cabDirection > 0) nose.rotation.y = Math.PI;
    nose.castShadow = true;
    car.add(nose);
    this.cabShells.push(nose);

    const cabMask = new THREE.Mesh(new THREE.BoxGeometry(2.28, 1.32, 0.075), blackMat);
    cabMask.position.set(0, 2.35, cabZ + cabDirection * 0.43);
    car.add(cabMask);
    this.cabShells.push(cabMask);

    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.76, 0.085), glassMat);
    windscreen.position.set(0, 2.48, cabZ + cabDirection * 0.48);
    windscreen.rotation.x = cabDirection * -0.12;
    car.add(windscreen);

    const lowerCabPanel = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.48, 0.1), blackMat);
    lowerCabPanel.position.set(0, 0.92, cabZ + cabDirection * 0.46);
    car.add(lowerCabPanel);

    const headlightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4c7, emissiveIntensity: 2.2 });
    const markerMat = new THREE.MeshStandardMaterial({ color: 0xff2d22, emissive: 0xaa0804, emissiveIntensity: 1.4 });
    for (const x of [-0.78, 0.78]) {
      const headlight = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 20), headlightMat);
      headlight.rotation.x = Math.PI / 2;
      headlight.position.set(x, 1.18, cabZ + cabDirection * 0.53);
      car.add(headlight);

      const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.065, 16), markerMat);
      marker.rotation.x = Math.PI / 2;
      marker.position.set(x, 1.48, cabZ + cabDirection * 0.54);
      car.add(marker);
    }

    for (const side of [-1, 1]) {
      const sideGroup = new THREE.Group();
      sideGroup.position.x = side * 1.345;
      const windowBand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.08, 15.9), blackMat);
      windowBand.position.set(0, 2.31, -cabDirection * 0.25);
      sideGroup.add(windowBand);
      this.windowBands.push(windowBand);
      for (const z of [-7.55, -3.45, -0.75, 5.45, 7.45]) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.8, z === -0.75 ? 1.7 : 1.9), glassMat);
        window.position.set(0.02, 2.26, z);
        sideGroup.add(window);
      }
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
      const ad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.78, 2.8), adMat);
      ad.position.set(0.07, 1.02, -0.6);
      sideGroup.add(ad);
      const logo = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.55),
        new THREE.MeshBasicMaterial({ map: makeLabelTexture('SSB', { width: 256, height: 96, bg: '#ffdf00', fg: '#111' }) })
      );
      logo.position.set(side * 0.055, 1.03, cabDirection * 6.7);
      logo.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      sideGroup.add(logo);
      car.add(sideGroup);
    }

    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.08, 16.6), roofMat);
    floor.position.y = 1.02;
    car.add(floor);
    this.addInteriorShell(car, cabZ, cabDirection, interiorWallMat, blackMat);
    this.addPassengerSeating(car, cabDirection, metalMat);
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
    trimMaterial: THREE.Material
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
    const cabFaceZ = cabZ + cabDirection * 0.53;
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

  private addPassengerSeating(car: THREE.Group, cabDirection: -1 | 1, metalMaterial: THREE.Material): void {
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

  private makeTangoBody(): THREE.ExtrudeGeometry {
    const crossSection = new THREE.Shape();
    crossSection.moveTo(-1.325, 0);
    crossSection.lineTo(1.325, 0);
    crossSection.lineTo(1.325, 2.08);
    crossSection.lineTo(1.17, 2.72);
    crossSection.lineTo(-1.17, 2.72);
    crossSection.lineTo(-1.325, 2.08);
    crossSection.closePath();
    const geometry = new THREE.ExtrudeGeometry(crossSection, {
      depth: 18.25,
      bevelEnabled: true,
      bevelSize: 0.025,
      bevelThickness: 0.025,
      bevelSegments: 1
    });
    geometry.translate(0, 0, -9.125);
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
    const mat = new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.55 });
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.8), mat);
    arm.position.z = -0.25;
    group.add(arm);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.28, 0.2), mat);
    head.position.z = -0.7;
    group.add(head);
    return group;
  }

  private addPantograph(position: THREE.Vector3, material: THREE.Material): void {
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.14, 0.72), material);
    base.position.copy(position);
    this.root.add(base);
    const points = [
      [new THREE.Vector3(-0.55, 0, -0.2), new THREE.Vector3(0, 0.78, 0)],
      [new THREE.Vector3(0.55, 0, -0.2), new THREE.Vector3(0, 0.78, 0)],
      [new THREE.Vector3(-0.55, 0, 0.2), new THREE.Vector3(0, 0.78, 0)],
      [new THREE.Vector3(0.55, 0, 0.2), new THREE.Vector3(0, 0.78, 0)]
    ] as const;
    for (const [a, b] of points) {
      const curve = new THREE.LineCurve3(a.clone().add(position), b.clone().add(position));
      const arm = new THREE.Mesh(new THREE.TubeGeometry(curve, 1, 0.025, 6), material);
      this.root.add(arm);
    }
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.055, 0.16), material);
    shoe.position.copy(position).add(new THREE.Vector3(0, 0.84, 0));
    this.root.add(shoe);
  }
}

export function buildProceduralTransitVehicle(context: VehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).build();
}

export function createStadtbahnVehicle(context: VehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).createStadtbahnVehicle();
}

export function createBusVehicle(context: VehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).createBusVehicle();
}

export function createSBahnVehicle(context: VehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).createSBahnVehicle();
}

export function createTramVehicle(context: VehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).build();
}

export function createZackeVehicle(context: VehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).createZackeVehicle();
}

export function createSeilbahnVehicle(context: VehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).createSeilbahnVehicle();
}

export function createFerryVehicle(context: VehicleBuildContext): VehicleInstance {
  return new ProceduralTransitVehicleFactory(context).createFerryVehicle();
}
