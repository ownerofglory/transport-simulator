import * as THREE from 'three';
import { axleCylinder, extrudeProfile, pick } from './trafficMeshUtils';

export type TrafficKind = 'car' | 'truck' | 'cyclist';

/**
 * A built vehicle plus the handles needed to animate it. Everything here is
 * created once per spawned/pooled vehicle; the per-frame work is only writing
 * `rotation` on these existing nodes.
 */
export type TrafficRig = {
  root: THREE.Object3D;
  /** Spun about their own axle from distance travelled, so wheels never skid. */
  wheels: THREE.Object3D[];
  wheelRadiusM: number;
  /** Cyclist legs, cycled with the wheels. */
  cranks: THREE.Object3D[];
};

export type TrafficKindSpec = {
  id: TrafficKind;
  weight: number; // relative spawn frequency
  minSpeedMps: number;
  maxSpeedMps: number;
  /** ORS routing profile this kind is routed with (e.g. `driving-hgv` keeps trucks off weight-restricted roads). */
  profile: string;
  buildRig(): TrafficRig;
};

// Geometries and materials are module singletons, built once and shared by every
// spawned/pooled vehicle of a kind — spawning only ever creates cheap
// Group/Mesh wrappers around them, never new geometry or materials.

const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x141b24, roughness: 0.12, metalness: 0.6 });
const tyreMaterial = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.8 });
const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x33383f, roughness: 0.7 });
// Lamp materials are shared, so the day/night flip below recolours every vehicle
// on the road in two writes instead of walking the scene graph.
const headlampMaterial = new THREE.MeshStandardMaterial({ color: 0xf6f2e2, emissive: 0xfff0c2, emissiveIntensity: 0 });
const taillampMaterial = new THREE.MeshStandardMaterial({ color: 0x8e1c1c, emissive: 0xff2a1a, emissiveIntensity: 0 });

/** Turns every road vehicle's lamps on/off with the world's daylight factor. */
export function setTrafficLampsOn(on: boolean): void {
  headlampMaterial.emissiveIntensity = on ? 1.4 : 0;
  taillampMaterial.emissiveIntensity = on ? 0.9 : 0;
}

// Deep enough to straddle the body surface: the extrude bevel pushes the shell
// a few centimetres past the raw profile, so a shallow lamp sitting on the
// profile edge ends up buried inside it.
const lampGeometry = new THREE.BoxGeometry(0.3, 0.13, 0.16);

// ---------------------------------------------------------------------------
// Car — four body variants sharing one builder, so traffic isn't the same
// silhouette in different paint. Each variant is a side-view profile (nose at
// +z after extrudeProfile's rotation), a matching glazing band, its own wheel
// size/spacing, and lamp positions chosen where that profile is full-depth.

type CarVariantDef = {
  name: string;
  body: [number, number][];
  glass: [number, number][];
  widthM: number;
  skirt: { widthM: number; heightM: number; lengthM: number; yM: number };
  wheelRadiusM: number;
  wheelWidthM: number;
  wheelPositions: [number, number][];
  headlamp: [number, number, number];
  taillamp: [number, number, number];
};

const CAR_VARIANT_DEFS: CarVariantDef[] = [
  {
    // Saloon: long bonnet and boot either side of a low, raked greenhouse.
    name: 'sedan',
    body: [
      [2.12, 0.4],
      [2.16, 0.82],
      [1.74, 0.96],
      [0.88, 1.0],
      [0.42, 1.42],
      [-0.68, 1.45],
      [-1.26, 1.06],
      [-1.96, 1.0],
      [-2.16, 0.84],
      [-2.12, 0.4]
    ],
    glass: [
      [0.46, 1.36],
      [-0.68, 1.39],
      [-1.2, 1.07],
      [0.9, 1.03]
    ],
    widthM: 1.78,
    skirt: { widthM: 1.7, heightM: 0.18, lengthM: 3.9, yM: 0.38 },
    wheelRadiusM: 0.33,
    wheelWidthM: 0.22,
    wheelPositions: [
      [0.85, 1.42],
      [-0.85, 1.42],
      [0.85, -1.4],
      [-0.85, -1.4]
    ],
    headlamp: [0.58, 0.84, 2.12],
    taillamp: [0.6, 0.92, -2.08]
  },
  {
    // Hatchback: shorter overall, near-vertical tailgate instead of a boot.
    name: 'hatchback',
    body: [
      [1.62, 0.4],
      [1.66, 0.78],
      [1.32, 0.92],
      [0.6, 0.96],
      [0.18, 1.4],
      [-0.5, 1.44],
      [-0.94, 1.42],
      [-1.5, 1.06],
      [-1.62, 0.42]
    ],
    glass: [
      [0.22, 1.34],
      [-0.5, 1.38],
      [-1.36, 1.08],
      [0.66, 1.0]
    ],
    widthM: 1.72,
    skirt: { widthM: 1.64, heightM: 0.17, lengthM: 3.1, yM: 0.38 },
    wheelRadiusM: 0.31,
    wheelWidthM: 0.21,
    wheelPositions: [
      [0.82, 1.12],
      [-0.82, 1.12],
      [0.82, -1.1],
      [-0.82, -1.1]
    ],
    headlamp: [0.56, 0.82, 1.62],
    taillamp: [0.58, 0.9, -1.58]
  },
  {
    // SUV/crossover: higher ride height, boxier and taller than the others.
    name: 'suv',
    body: [
      [2.0, 0.52],
      [2.06, 1.0],
      [1.7, 1.16],
      [0.86, 1.22],
      [0.5, 1.68],
      [-0.62, 1.72],
      [-1.3, 1.4],
      [-1.9, 1.32],
      [-2.08, 1.02],
      [-2.0, 0.52]
    ],
    glass: [
      [0.54, 1.62],
      [-0.62, 1.66],
      [-1.24, 1.36],
      [0.92, 1.28]
    ],
    widthM: 1.88,
    skirt: { widthM: 1.8, heightM: 0.22, lengthM: 3.9, yM: 0.5 },
    wheelRadiusM: 0.38,
    wheelWidthM: 0.25,
    wheelPositions: [
      [0.9, 1.32],
      [-0.9, 1.32],
      [0.9, -1.3],
      [-0.9, -1.3]
    ],
    headlamp: [0.62, 1.0, 2.0],
    taillamp: [0.64, 1.08, -1.96]
  },
  {
    // Estate/wagon: sedan front, roofline extended flat back to a vertical tailgate.
    name: 'wagon',
    body: [
      [2.12, 0.4],
      [2.16, 0.82],
      [1.74, 0.96],
      [0.88, 1.0],
      [0.42, 1.42],
      [-1.0, 1.46],
      [-1.72, 1.44],
      [-2.02, 1.0],
      [-2.18, 0.84],
      [-2.12, 0.4]
    ],
    glass: [
      [0.46, 1.36],
      [-1.0, 1.4],
      [-1.66, 1.36],
      [-1.94, 1.02],
      [0.9, 1.03]
    ],
    widthM: 1.78,
    skirt: { widthM: 1.7, heightM: 0.18, lengthM: 4.2, yM: 0.38 },
    wheelRadiusM: 0.33,
    wheelWidthM: 0.22,
    wheelPositions: [
      [0.85, 1.42],
      [-0.85, 1.42],
      [0.85, -1.5],
      [-0.85, -1.5]
    ],
    headlamp: [0.58, 0.84, 2.12],
    taillamp: [0.62, 0.92, -2.1]
  }
];

const carBodyMaterials = [0xb4b8bd, 0x1c1f26, 0x8b1e1e, 0x27436b, 0xe8e2d0, 0x4a4f57, 0x2f5d4a, 0xc9a227].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.35 })
);

type CarVariant = CarVariantDef & {
  bodyGeometry: THREE.BufferGeometry;
  glassGeometry: THREE.BufferGeometry;
  skirtGeometry: THREE.BufferGeometry;
  tyreGeometry: THREE.BufferGeometry;
  rimGeometry: THREE.BufferGeometry;
};

// Each variant's geometry is built once at module load, same as every other
// shared shape in this file — buildCar only ever wraps them in a fresh Group.
const CAR_VARIANTS: CarVariant[] = CAR_VARIANT_DEFS.map((def) => ({
  ...def,
  bodyGeometry: extrudeProfile(def.body, def.widthM, 0.06),
  // The glazing is a hair wider than the shell so it reads as a dark band
  // wrapping the cabin instead of z-fighting with the body sides.
  glassGeometry: extrudeProfile(def.glass, def.widthM + 0.04, 0.02),
  skirtGeometry: new THREE.BoxGeometry(def.skirt.widthM, def.skirt.heightM, def.skirt.lengthM),
  tyreGeometry: axleCylinder(def.wheelRadiusM, def.wheelWidthM, 14),
  rimGeometry: axleCylinder(def.wheelRadiusM * 0.58, def.wheelWidthM + 0.015, 10)
}));

function makeWheel(tyre: THREE.BufferGeometry, rim: THREE.BufferGeometry): THREE.Group {
  const wheel = new THREE.Group();
  wheel.add(new THREE.Mesh(tyre, tyreMaterial), new THREE.Mesh(rim, rimMaterial));
  return wheel;
}

function buildCar(): TrafficRig {
  const variant = pick(CAR_VARIANTS);
  const root = new THREE.Group();
  root.name = `Traffic car (${variant.name})`;

  const body = new THREE.Mesh(variant.bodyGeometry, pick(carBodyMaterials));
  body.castShadow = true;
  const glass = new THREE.Mesh(variant.glassGeometry, glassMaterial);
  const skirt = new THREE.Mesh(variant.skirtGeometry, trimMaterial);
  skirt.position.y = variant.skirt.yM;
  root.add(body, glass, skirt);

  for (const [[x, y, z], material] of [
    [variant.headlamp, headlampMaterial],
    [[-variant.headlamp[0], variant.headlamp[1], variant.headlamp[2]], headlampMaterial],
    [variant.taillamp, taillampMaterial],
    [[-variant.taillamp[0], variant.taillamp[1], variant.taillamp[2]], taillampMaterial]
  ] as [[number, number, number], THREE.Material][]) {
    const lamp = new THREE.Mesh(lampGeometry, material);
    lamp.position.set(x, y, z);
    root.add(lamp);
  }

  const wheels: THREE.Object3D[] = [];
  for (const [x, z] of variant.wheelPositions) {
    const wheel = makeWheel(variant.tyreGeometry, variant.rimGeometry);
    wheel.position.set(x, variant.wheelRadiusM, z);
    root.add(wheel);
    wheels.push(wheel);
  }
  return { root, wheels, wheelRadiusM: variant.wheelRadiusM, cranks: [] };
}

// ---------------------------------------------------------------------------
// Truck

const TRUCK_WHEEL_RADIUS_M = 0.46;
// Cab-over profile: steep grille, tall raked screen, flat roof.
const truckCabGeometry = extrudeProfile(
  [
    [1.12, 0.62],
    [1.16, 1.3],
    [1.06, 1.62],
    [0.92, 2.56],
    [-1.1, 2.62],
    [-1.1, 0.62]
  ],
  2.24,
  0.06
);
const truckGlassGeometry = extrudeProfile(
  [
    [0.88, 2.46],
    [-0.34, 2.5],
    [-0.34, 1.74],
    [1.0, 1.7]
  ],
  2.28,
  0.02
);
const truckBoxGeometry = new THREE.BoxGeometry(2.36, 2.1, 5.1);
const truckChassisGeometry = new THREE.BoxGeometry(2.1, 0.26, 7.2);
const truckTyreGeometry = axleCylinder(TRUCK_WHEEL_RADIUS_M, 0.3, 14);
const truckRimGeometry = axleCylinder(0.24, 0.315, 10);
const truckCabMaterials = [0xd0d3d6, 0x2b3a4a, 0xb0783c, 0x8f2222, 0x336655].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.3 })
);
const truckBoxMaterials = [0xe9e9e3, 0xd8d2c4, 0xc4ccd4].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.72 })
);

// Front axle under the cab, then a twin rear axle under the box.
const TRUCK_WHEEL_POSITIONS: [number, number][] = [
  [1.06, 2.5],
  [-1.06, 2.5],
  [1.06, -1.2],
  [-1.06, -1.2],
  [1.06, -2.3],
  [-1.06, -2.3]
];

function buildTruck(): TrafficRig {
  const root = new THREE.Group();
  root.name = 'Traffic truck';

  const cab = new THREE.Mesh(truckCabGeometry, pick(truckCabMaterials));
  cab.castShadow = true;
  cab.position.z = 2.5;
  const glass = new THREE.Mesh(truckGlassGeometry, glassMaterial);
  glass.position.z = 2.5;
  const box = new THREE.Mesh(truckBoxGeometry, pick(truckBoxMaterials));
  box.castShadow = true;
  box.position.set(0, 1.85, -1.15); // abuts the cab exactly, leaving no slit
  const chassis = new THREE.Mesh(truckChassisGeometry, trimMaterial);
  chassis.position.y = 0.7;
  root.add(cab, glass, box, chassis);

  for (const x of [0.62, -0.62]) {
    const lamp = new THREE.Mesh(lampGeometry, headlampMaterial);
    lamp.position.set(x, 1.02, 3.68);
    root.add(lamp);
  }
  for (const x of [0.72, -0.72]) {
    const lamp = new THREE.Mesh(lampGeometry, taillampMaterial);
    lamp.position.set(x, 1.05, -3.72);
    root.add(lamp);
  }

  const wheels: THREE.Object3D[] = [];
  for (const [x, z] of TRUCK_WHEEL_POSITIONS) {
    const wheel = makeWheel(truckTyreGeometry, truckRimGeometry);
    wheel.position.set(x, TRUCK_WHEEL_RADIUS_M, z);
    root.add(wheel);
    wheels.push(wheel);
  }
  return { root, wheels, wheelRadiusM: TRUCK_WHEEL_RADIUS_M, cranks: [] };
}

// ---------------------------------------------------------------------------
// Cyclist

const CYCLIST_LEG_REST_RAD = 0.24; // legs hang down and a little forward, toward the pedals
const BIKE_WHEEL_RADIUS_M = 0.34;
const BIKE_WHEEL_BASE_M = 0.53; // wheel centres fore/aft of the model origin
// A thin torus reads as a spoked wheel at street distance for a fraction of the
// triangles real spokes would cost.
const bikeWheelGeometry = new THREE.TorusGeometry(BIKE_WHEEL_RADIUS_M, 0.028, 6, 16);
bikeWheelGeometry.rotateY(Math.PI / 2); // torus lies in its own XY plane; face it along the bike
const bikeHubGeometry = axleCylinder(0.035, 0.08, 6);
const bikeBarGeometry = axleCylinder(0.022, 0.42, 6);
// Unit-height tubes, stretched with scale.y to span two points.
const bikeTubeGeometry = new THREE.CylinderGeometry(0.026, 0.026, 1, 6);
const riderArmGeometry = new THREE.CylinderGeometry(0.048, 0.048, 1, 6);
const riderTorsoGeometry = new THREE.CapsuleGeometry(0.16, 0.34, 3, 8);
const riderHeadGeometry = new THREE.SphereGeometry(0.115, 10, 8);
const riderLegGeometry = new THREE.CapsuleGeometry(0.065, 0.36, 3, 6);
const bikeFrameMaterials = [0xc23b3b, 0x2f6b3a, 0x2c2c2c, 0xd4a72c, 0x2a5b8c].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.5 })
);
const riderMaterials = [0x3a4a5c, 0xb5432f, 0x2f6b3a, 0x4a4f57, 0xd4a72c].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
);
const skinMaterials = [0xd8ad85, 0xb07a4f, 0x8a5a34, 0xf0c9a4, 0x6b4423].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
);

// Bike geometry, in the (z, y) side plane. Everything else is hung off these.
const BOTTOM_BRACKET: [number, number] = [0, 0.29];
const SEAT_TOP: [number, number] = [-0.16, 0.78];
const BAR_TOP: [number, number] = [0.42, 0.82];
const HIP: [number, number] = [-0.13, 0.82];
const SHOULDER: [number, number] = [0.14, 1.12];

/**
 * A unit-height tube stretched and tilted to span two points of the bike's side
 * plane, optionally offset sideways (for the paired arms).
 */
function spanTube(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  from: [number, number],
  to: [number, number],
  x = 0
): THREE.Mesh {
  const tube = new THREE.Mesh(geometry, material);
  const dz = to[0] - from[0];
  const dy = to[1] - from[1];
  tube.scale.y = Math.hypot(dz, dy);
  tube.position.set(x, (from[1] + to[1]) / 2, (from[0] + to[0]) / 2);
  // The tube's own axis is +Y; tip it in the ZY plane to point from→to.
  tube.rotation.x = Math.atan2(dz, dy);
  return tube;
}

function buildCyclist(): TrafficRig {
  const root = new THREE.Group();
  root.name = 'Traffic cyclist';
  const frameMaterial = pick(bikeFrameMaterials);
  const riderMaterial = pick(riderMaterials);
  const skinMaterial = pick(skinMaterials);

  const rearHub: [number, number] = [-BIKE_WHEEL_BASE_M, BIKE_WHEEL_RADIUS_M];
  const frontHub: [number, number] = [BIKE_WHEEL_BASE_M, BIKE_WHEEL_RADIUS_M];
  root.add(
    spanTube(bikeTubeGeometry, frameMaterial, BOTTOM_BRACKET, SEAT_TOP),
    spanTube(bikeTubeGeometry, frameMaterial, BOTTOM_BRACKET, BAR_TOP),
    spanTube(bikeTubeGeometry, frameMaterial, SEAT_TOP, BAR_TOP),
    spanTube(bikeTubeGeometry, frameMaterial, BOTTOM_BRACKET, rearHub),
    spanTube(bikeTubeGeometry, frameMaterial, SEAT_TOP, rearHub),
    spanTube(bikeTubeGeometry, frameMaterial, BAR_TOP, frontHub)
  );
  const handlebar = new THREE.Mesh(bikeBarGeometry, trimMaterial);
  handlebar.position.set(0, BAR_TOP[1], BAR_TOP[0]);
  root.add(handlebar);

  // Torso spans hip→shoulder, so the rider leans onto the bars by construction
  // rather than by a guessed rotation.
  const torso = new THREE.Mesh(riderTorsoGeometry, riderMaterial);
  torso.castShadow = true;
  torso.position.set(0, (HIP[1] + SHOULDER[1]) / 2, (HIP[0] + SHOULDER[0]) / 2);
  torso.rotation.x = Math.atan2(SHOULDER[0] - HIP[0], SHOULDER[1] - HIP[1]);
  const head = new THREE.Mesh(riderHeadGeometry, skinMaterial);
  head.position.set(0, SHOULDER[1] + 0.11, SHOULDER[0] + 0.09);
  root.add(torso, head);
  for (const x of [0.13, -0.13]) {
    root.add(spanTube(riderArmGeometry, riderMaterial, SHOULDER, [BAR_TOP[0] - 0.02, BAR_TOP[1] + 0.03], x));
  }

  // Legs pivot at the hip and swing; a real pedal circle would need IK, and at
  // street distance the swing alone reads as pedalling.
  const cranks: THREE.Object3D[] = [];
  for (const x of [0.085, -0.085]) {
    const crank = new THREE.Group();
    crank.position.set(x, HIP[1], HIP[0]);
    const leg = new THREE.Mesh(riderLegGeometry, riderMaterial);
    leg.position.y = -0.25;
    crank.add(leg);
    // Rest pose points the legs down and slightly forward, toward the pedals.
    crank.rotation.x = CYCLIST_LEG_REST_RAD;
    root.add(crank);
    cranks.push(crank);
  }

  const wheels: THREE.Object3D[] = [];
  for (const z of [BIKE_WHEEL_BASE_M, -BIKE_WHEEL_BASE_M]) {
    const wheel = new THREE.Group();
    wheel.add(new THREE.Mesh(bikeWheelGeometry, tyreMaterial), new THREE.Mesh(bikeHubGeometry, rimMaterial));
    wheel.position.set(0, BIKE_WHEEL_RADIUS_M, z);
    root.add(wheel);
    wheels.push(wheel);
  }
  return { root, wheels, wheelRadiusM: BIKE_WHEEL_RADIUS_M, cranks };
}

/**
 * Rolls a rig's wheels (and a cyclist's legs) for the distance it has travelled.
 * Driven by distance rather than time so wheels always match ground speed.
 */
export function animateTrafficRig(rig: TrafficRig, distanceM: number): void {
  const spin = distanceM / rig.wheelRadiusM;
  for (const wheel of rig.wheels) wheel.rotation.x = spin;
  // Legs swing about their seated rest pose, half a cycle apart, at the crank's
  // own rate — a bike's gearing turns the pedals far slower than the wheel.
  const pedal = spin * 0.32;
  for (let i = 0; i < rig.cranks.length; i++) {
    rig.cranks[i].rotation.x = CYCLIST_LEG_REST_RAD + Math.sin(pedal + i * Math.PI) * 0.42;
  }
}

export const TRAFFIC_KINDS: TrafficKindSpec[] = [
  { id: 'car', weight: 0.68, minSpeedMps: 8, maxSpeedMps: 13, profile: 'driving-car', buildRig: buildCar },
  { id: 'truck', weight: 0.14, minSpeedMps: 6, maxSpeedMps: 10, profile: 'driving-hgv', buildRig: buildTruck },
  { id: 'cyclist', weight: 0.18, minSpeedMps: 3.5, maxSpeedMps: 5.5, profile: 'cycling-regular', buildRig: buildCyclist }
];

export function pickWeightedKind(): TrafficKindSpec {
  const total = TRAFFIC_KINDS.reduce((sum, k) => sum + k.weight, 0);
  let r = Math.random() * total;
  for (const kind of TRAFFIC_KINDS) {
    if (r < kind.weight) return kind;
    r -= kind.weight;
  }
  return TRAFFIC_KINDS[0];
}
