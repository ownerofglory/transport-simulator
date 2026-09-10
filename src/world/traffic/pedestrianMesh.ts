import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pick } from './trafficMeshUtils';

/**
 * A walking figure plus the joints needed to animate it. Built once per
 * spawned/pooled pedestrian; per-frame work is only writing rotations on the
 * limb pivots and bobbing the body.
 */
export type PedestrianRig = {
  root: THREE.Object3D;
  /** Bobs vertically; everything visible hangs off it. */
  body: THREE.Object3D;
  head: THREE.Object3D;
  /** Hip pivots; rotating one swings the whole leg. */
  legs: [THREE.Object3D, THREE.Object3D];
  /** Knee pivots, children of the hips — needed for a believable sitting pose. */
  shins: [THREE.Object3D, THREE.Object3D];
  /** Shoulder pivots. */
  arms: [THREE.Object3D, THREE.Object3D];
  /** Elbow pivots, children of the shoulders. */
  elbows: [THREE.Object3D, THREE.Object3D];
  hands: [THREE.Object3D, THREE.Object3D];
  /** Shoes, hung off the knees; rotated to keep the sole flat when seated. */
  feet: [THREE.Object3D, THREE.Object3D];
  /** Height scale, so a crowd isn't all one size. */
  scale: number;
  /** Per-person gait offsets keep a crowd from walking in lockstep. */
  phaseOffset: number;
  strideScale: number;
  swayScale: number;
  /** Which habit this person falls into while riding — see `poseSeated`. */
  idleVariant: 0 | 1 | 2;
};

// Joint heights of an unscaled rig, which stands about 1.62 m tall.
const HIP_HEIGHT_M = 0.86;
const SHOULDER_HEIGHT_M = 1.325;
// Chin clears the shoulder line, which is what leaves a neck to see.
const HEAD_HEIGHT_M = 1.52;
const THIGH_LENGTH_M = 0.4;
const SHIN_LENGTH_M = 0.37;
const UPPER_ARM_LENGTH_M = 0.3;
const FOREARM_LENGTH_M = 0.27;
const ANKLE_HEIGHT_M = HIP_HEIGHT_M - THIGH_LENGTH_M - SHIN_LENGTH_M;

/** Hip height of an unscaled rig, so a seated rider can be dropped onto a cushion. */
export const PEDESTRIAN_HIP_HEIGHT_M = HIP_HEIGHT_M;

// ---------------------------------------------------------------------------
// Shared geometry. Every rig reuses these, so a crowd only ever allocates cheap
// Group/Mesh wrappers. Static parts that share one material are merged here
// rather than added as separate meshes, which keeps the draw call count down
// while still giving the figure shoulders, hips, a neck and ears.
// ---------------------------------------------------------------------------

/** Rewrites a part's UVs to one plain patch, so a face map can't leak onto it. */
function flattenUV(geometry: THREE.BufferGeometry, u: number, v: number): THREE.BufferGeometry {
  const uv = geometry.getAttribute('uv');
  for (let index = 0; index < uv.count; index++) uv.setXY(index, u, v);
  uv.needsUpdate = true;
  return geometry;
}

function merged(parts: THREE.BufferGeometry[], name: string): THREE.BufferGeometry {
  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error(`Failed to merge ${name} geometry`);
  geometry.name = name;
  return geometry;
}

// Chest, deltoids and a collar in one piece. The cross-section is elliptical —
// people are wider than they are deep, and a plain capsule reads as a pipe.
const torsoGeometry = new THREE.LatheGeometry([
  [0, 0.94], [0.14, 0.94], [0.153, 0.98], [0.139, 1.08],
  [0.163, 1.23], [0.182, 1.29], [0.173, 1.325],
  [0.115, 1.355], [0.072, 1.37], [0, 1.37]
].map(([radius, y]) => new THREE.Vector2(radius, y)), 24).scale(1, 1, 0.72);
torsoGeometry.name = 'Torso';
const clothingTrimGeometry = merged([
  new THREE.BoxGeometry(0.007, 0.32, 0.006).translate(0, 1.16, 0.111),
  new THREE.BoxGeometry(0.06, 0.009, 0.006).translate(0.075, 1.245, 0.112),
  new THREE.BoxGeometry(0.064, 0.026, 0.012).rotateZ(0.48).translate(0.047, 1.342, 0.068),
  new THREE.BoxGeometry(0.064, 0.026, 0.012).rotateZ(-0.48).translate(-0.047, 1.342, 0.068)
], 'Clothing trim');

// Pelvis: bridges the gap between the torso and two free-hanging legs.
const pelvisGeometry = new THREE.SphereGeometry(0.155, 14, 10).scale(1, 0.78, 0.8).translate(0, 0.93, 0);

// A head is an egg, not a ball: narrower across than tall. Hair caps are built
// on the same proportions a shade larger, or the crown pokes through them.
const HEAD_RADIUS_M = 0.115;
const HEAD_SHAPE: [number, number, number] = [0.94, 1.08, 1];

// Skull, neck and ears. Only the skull keeps its sphere UVs; everything else is
// pinned to a plain patch at the back of the head.
const headGeometry = merged([
  new THREE.SphereGeometry(HEAD_RADIUS_M, 18, 14).scale(...HEAD_SHAPE),
  flattenUV(new THREE.SphereGeometry(0.019, 10, 8).scale(0.65, 1.35, 1).translate(0, -0.005, 0.11), 0.75, 0.52),
  flattenUV(new THREE.CylinderGeometry(0.058, 0.072, 0.17, 10).translate(0, -0.15, 0), 0.75, 0.42),
  flattenUV(new THREE.SphereGeometry(0.03, 6, 5).scale(0.4, 1, 0.76).translate(0.109, 0.012, -0.012), 0.75, 0.42),
  flattenUV(new THREE.SphereGeometry(0.03, 6, 5).scale(0.4, 1, 0.76).translate(-0.109, 0.012, -0.012), 0.75, 0.42)
], 'Head');

/**
 * A limb segment that tapers from `topR` to `bottomR` and ends in a ball at the
 * far joint. Two capsules of different thickness meet in a notch that reads as a
 * broken limb; a taper into a joint ball reads as a knee or an elbow.
 */
function limbGeometry(topR: number, bottomR: number, segmentM: number, topBall = false): THREE.BufferGeometry {
  const parts = [
    new THREE.CylinderGeometry(topR, bottomR, segmentM, 10, 1, true).translate(0, -segmentM / 2, 0),
    new THREE.SphereGeometry(bottomR, 10, 7).translate(0, -segmentM, 0)
  ];
  // A ball in the socket too, where the parent body has no mass to hide the
  // cylinder's open top — otherwise a raised arm tears away from the shoulder.
  if (topBall) parts.push(new THREE.SphereGeometry(topR, 10, 7));
  return merged(parts, 'Limb');
}

const thighGeometry = limbGeometry(0.086, 0.063, THIGH_LENGTH_M);
const shinGeometry = limbGeometry(0.062, 0.045, SHIN_LENGTH_M);
// A rounded last, laid along +Z, instead of a cuboid block. Sat so the sole
// meets the ground the rig is standing on.
const shoeGeometry = merged([
  new THREE.CapsuleGeometry(0.049, 0.14, 3, 8).rotateX(Math.PI / 2).scale(0.92, 0.78, 1).translate(0, 0, 0.036)
], 'Shoe');

const upperArmGeometry = limbGeometry(0.056, 0.045, UPPER_ARM_LENGTH_M, true);
const foreArmGeometry = limbGeometry(0.045, 0.035, FOREARM_LENGTH_M);
const handGeometry = merged([
  new THREE.SphereGeometry(0.042, 12, 8).scale(0.78, 1.18, 0.48),
  new THREE.CapsuleGeometry(0.012, 0.024, 3, 8).rotateZ(-0.4).translate(0.027, 0.008, 0)
], 'Hand');
// Short sleeves: forearm and hand are one skin-coloured piece, so a bare arm
// costs one mesh rather than two.
const bareForeArmGeometry = merged([
  limbGeometry(0.045, 0.035, FOREARM_LENGTH_M),
  handGeometry.clone().translate(0, -FOREARM_LENGTH_M - 0.03, 0)
], 'Bare forearm');

const bagGeometry = merged([
  new THREE.BoxGeometry(0.22, 0.26, 0.12),
  new THREE.BoxGeometry(0.04, 0.44, 0.018).rotateZ(0.28).translate(-0.07, 0.33, -0.03)
], 'Shoulder bag');
const phoneGeometry = new THREE.BoxGeometry(0.07, 0.13, 0.012);

// Hair sits on the head as a skull cap plus, for longer styles, a fall or bun.
// Caps are cut spheres so a hairline reads without a texture.
// A cut sphere tipped back: the cut angle sets how much scalp is covered and
// the tilt decides where the hairline lands. These two put it just above the
// brows at the front and down on the nape at the back.
const HAIR_TILT_RAD = -0.65;
const hairCapGeometry = new THREE.SphereGeometry(HEAD_RADIUS_M * 1.06, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.458)
  .scale(...HEAD_SHAPE);
const buzzCapGeometry = new THREE.SphereGeometry(HEAD_RADIUS_M * 1.03, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.43)
  .scale(...HEAD_SHAPE);
const hairFallGeometry = new THREE.CapsuleGeometry(0.1, 0.14, 3, 8);
const hairBunGeometry = new THREE.SphereGeometry(0.056, 8, 6);

// ---------------------------------------------------------------------------
// Shared materials.
// ---------------------------------------------------------------------------

const topMaterials = [
  0x2b3a4a, 0x8b1e1e, 0x2f6b3a, 0x4a4f57, 0xd4a72c, 0x5b4636, 0x3a3f5c, 0xdfe3e8, 0x7a4b7d,
  0x1f2a33, 0x9fb0bd, 0x6d7b52, 0xc96a3c
].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.72 }));
const legMaterials = [0x2a2f3a, 0x3d4350, 0x1f2530, 0x5a5347, 0x27436b, 0x6f6a60].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.78 })
);
const bagMaterials = [0x8b1e1e, 0x2b3a4a, 0x3f3f3f].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
const shoeMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.85 });
const phoneMaterial = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.35, metalness: 0.4 });
// Black through brown and blond to grey and white, plus a couple of dyed reds.
const hairMaterials = [
  0x14100c, 0x241a12, 0x241a12, 0x3d2a1a, 0x3d2a1a, 0x5a3b22, 0x5a3b22, 0x7a5228,
  0xa87c3c, 0xd0ae6a, 0x8c3a1c, 0x9c9a96, 0xd9d6d0
].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.88 }));

type Rgb = [number, number, number];
const SKIN_TONES: Rgb[] = [[216, 173, 133], [176, 122, 79], [138, 90, 52], [240, 201, 164], [107, 68, 35]];
const IRIS_COLORS: Rgb[] = [[62, 44, 30], [74, 96, 112], [46, 34, 24], [88, 104, 84], [40, 28, 20]];

const skinMaterials = SKIN_TONES.map(
  (rgb) => new THREE.MeshStandardMaterial({ color: new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255), roughness: 0.8 })
);

// ---------------------------------------------------------------------------
// Faces are baked into a small data texture per skin tone rather than modelled.
// Eyes, brows and a mouth cost three extra meshes per person otherwise, and a
// crowd of 45 cannot afford that; a 256x128 map costs one texture per tone.
// ---------------------------------------------------------------------------

const FACE_W = 320;
const FACE_H = 160;
// The head sphere maps u=0.25 to +Z, and DataTexture is not flipped, so a
// feature at (u, v) lands at pixel (u*W, v*H) with v=1 at the crown.
const FACE_U = 0.25;

function paintEllipse(pixels: Uint8Array, u: number, v: number, rx: number, ry: number, rgb: Rgb, alpha = 1): void {
  const cx = u * FACE_W;
  const cy = v * FACE_H;
  const fromX = Math.max(0, Math.floor(cx - rx));
  const toX = Math.min(FACE_W - 1, Math.ceil(cx + rx));
  const fromY = Math.max(0, Math.floor(cy - ry));
  const toY = Math.min(FACE_H - 1, Math.ceil(cy + ry));
  for (let y = fromY; y <= toY; y++) {
    for (let x = fromX; x <= toX; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const falloff = 1 - (nx * nx + ny * ny);
      if (falloff <= 0) continue;
      // Soft edge: features are only a few pixels across, so a hard cutoff
      // aliases badly once the head is close to the camera.
      const blend = alpha * Math.min(1, falloff * 3.4);
      const index = (y * FACE_W + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        pixels[index + channel] = Math.round(pixels[index + channel] * (1 - blend) + rgb[channel] * blend);
      }
    }
  }
}

function shade(rgb: Rgb, factor: number): Rgb {
  return [
    Math.max(0, Math.min(255, Math.round(rgb[0] * factor))),
    Math.max(0, Math.min(255, Math.round(rgb[1] * factor))),
    Math.max(0, Math.min(255, Math.round(rgb[2] * factor)))
  ];
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * amount),
    Math.round(a[1] + (b[1] - a[1]) * amount),
    Math.round(a[2] + (b[2] - a[2]) * amount)
  ];
}

function makeFaceTexture(toneIndex: number, beard: boolean): THREE.DataTexture {
  const skin = SKIN_TONES[toneIndex];
  const pixels = new Uint8Array(FACE_W * FACE_H * 4);
  for (let y = 0; y < FACE_H; y++) {
    // Faint top-down shading: brighter at the crown, cooler under the jaw.
    const lift = 0.94 + (y / FACE_H) * 0.1;
    const row = shade(skin, lift);
    for (let x = 0; x < FACE_W; x++) {
      const index = (y * FACE_W + x) * 4;
      pixels[index] = row[0];
      pixels[index + 1] = row[1];
      pixels[index + 2] = row[2];
      pixels[index + 3] = 255;
    }
  }

  const shadow = shade(skin, 0.9);
  // Features are kept soft and low-contrast on purpose. Hard dark eyes and
  // painted-on shading read as a mask at the distance a rider is actually seen
  // from, which is worse than no face at all.
  const eyeColor = mix(skin, IRIS_COLORS[toneIndex], 0.82);
  const browColor = mix(skin, IRIS_COLORS[toneIndex], 0.5);
  const lips = mix(skin, [168, 104, 98], 0.36);

  if (beard) paintEllipse(pixels, FACE_U, 0.42, 25, 15, mix(skin, [64, 58, 58], 0.5), 0.3);

  for (const side of [-1, 1]) {
    const eyeU = FACE_U + side * 0.052;
    paintEllipse(pixels, eyeU, 0.575, 5.6, 2.1, mix(skin, [236, 231, 219], 0.65), 0.8);
    paintEllipse(pixels, eyeU, 0.575, 2.1, 2.0, eyeColor, 0.9);
    // A single small catch-light is what keeps a soft eye from looking blank.
    paintEllipse(pixels, eyeU - side * 0.005, 0.586, 1.3, 1.3, [252, 250, 246], 0.4);
    paintEllipse(pixels, eyeU + side * 0.005, 0.627, 7.5, 1.6, browColor, 0.42);
  }

  // Nose and mouth are hints — a short shaded bridge, a tip, and a warmer lip line.
  paintEllipse(pixels, FACE_U, 0.523, 2.6, 5.5, shadow, 0.26);
  paintEllipse(pixels, FACE_U, 0.487, 4, 2.6, shadow, 0.3);
  paintEllipse(pixels, FACE_U, 0.412, 7, 2, lips, 0.62);

  const texture = new THREE.DataTexture(pixels, FACE_W, FACE_H);
  texture.name = `Pedestrian face ${toneIndex}${beard ? ' bearded' : ''}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// One material per (tone, beard) pair, built on first use and shared from then on.
const faceMaterials = new Map<string, THREE.MeshStandardMaterial>();

function faceMaterial(toneIndex: number, beard: boolean): THREE.MeshStandardMaterial {
  const key = `${toneIndex}:${beard}`;
  const existing = faceMaterials.get(key);
  if (existing) return existing;
  const material = new THREE.MeshStandardMaterial({ map: makeFaceTexture(toneIndex, beard), roughness: 0.8 });
  faceMaterials.set(key, material);
  return material;
}

// ---------------------------------------------------------------------------
// Rig assembly.
// ---------------------------------------------------------------------------

type HairStyle = 'bald' | 'buzz' | 'short' | 'long' | 'bun';

// Rough shares of a crowd. Bald is deliberately rare — it reads as a modelling
// gap rather than a haircut when it is common.
const HAIR_STYLES: HairStyle[] = [
  'bald', 'buzz', 'buzz', 'buzz', 'short', 'short', 'short', 'short', 'short', 'short',
  'long', 'long', 'long', 'long', 'long', 'bun', 'bun'
];

/**
 * Hangs hair off the head mesh, so it turns with the head rather than the body.
 * Geometry and materials are shared; a style only ever adds one or two meshes.
 */
function addHair(head: THREE.Object3D): void {
  const style = pick(HAIR_STYLES);
  if (style === 'bald') return;
  const material = pick(hairMaterials);

  const cap = new THREE.Mesh(style === 'buzz' ? buzzCapGeometry : hairCapGeometry, material);
  cap.name = 'Hair';
  cap.rotation.x = HAIR_TILT_RAD;
  head.add(cap);

  if (style === 'long') {
    const fall = new THREE.Mesh(hairFallGeometry, material);
    fall.name = 'Hair';
    // Sat behind the nape and tipped back, so the fall lies against the back
    // instead of disappearing inside the torso capsule.
    fall.position.set(0, -0.1, -0.098);
    fall.rotation.x = 0.16;
    // Shoulder-length to mid-back, flattened against the back.
    fall.scale.set(1, 0.85 + Math.random() * 0.85, 0.72);
    head.add(fall);
  } else if (style === 'bun') {
    const bun = new THREE.Mesh(hairBunGeometry, material);
    bun.name = 'Hair';
    bun.position.set(0, 0.05, -0.108);
    head.add(bun);
  }
}

/** A two-segment leg: hip pivot -> thigh, knee pivot -> shin + shoe. */
function buildLeg(material: THREE.Material, x: number): { hip: THREE.Group; knee: THREE.Group; foot: THREE.Object3D } {
  const hip = new THREE.Group();
  hip.position.set(x, HIP_HEIGHT_M, 0);
  const thigh = new THREE.Mesh(thighGeometry, material);
  thigh.name = 'Thigh';
  hip.add(thigh);

  const knee = new THREE.Group();
  knee.position.y = -THIGH_LENGTH_M;
  const shin = new THREE.Mesh(shinGeometry, material);
  shin.name = 'Shin';
  const shoe = new THREE.Mesh(shoeGeometry, shoeMaterial);
  shoe.name = 'Shoe';
  // Sole on the ground plane: the ankle sits ANKLE_HEIGHT_M up, the sole below it.
  shoe.position.y = -SHIN_LENGTH_M - (ANKLE_HEIGHT_M - 0.045);
  knee.add(shin, shoe);
  hip.add(knee);
  return { hip, knee, foot: shoe };
}

/**
 * A two-segment arm. Short sleeves merge the forearm and hand into one bare
 * piece; long sleeves keep the hand separate so it can stay skin-coloured.
 */
function buildArm(
  sleeve: THREE.Material,
  skin: THREE.Material,
  x: number,
  shortSleeves: boolean
): { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Object3D } {
  const shoulder = new THREE.Group();
  shoulder.position.set(x, SHOULDER_HEIGHT_M, 0);
  const upper = new THREE.Mesh(upperArmGeometry, sleeve);
  upper.name = 'Upper arm';
  shoulder.add(upper);

  const elbow = new THREE.Group();
  elbow.position.y = -UPPER_ARM_LENGTH_M;
  let hand: THREE.Object3D;
  if (shortSleeves) {
    const bare = new THREE.Mesh(bareForeArmGeometry, skin);
    bare.name = 'Forearm';
    elbow.add(bare);
    // The hand is baked into the bare forearm, so track its tip with an anchor.
    hand = new THREE.Object3D();
    hand.position.y = -FOREARM_LENGTH_M - 0.03;
    elbow.add(hand);
  } else {
    const fore = new THREE.Mesh(foreArmGeometry, sleeve);
    fore.name = 'Forearm';
    const palm = new THREE.Mesh(handGeometry, skin);
    palm.position.y = -FOREARM_LENGTH_M - 0.03;
    elbow.add(fore, palm);
    hand = palm;
  }
  hand.name = 'Hand';
  shoulder.add(elbow);
  return { shoulder, elbow, hand };
}

export function buildPedestrian(): PedestrianRig {
  const root = new THREE.Group();
  root.name = 'Pedestrian';
  const body = new THREE.Group();
  root.add(body);

  const toneIndex = Math.floor(Math.random() * SKIN_TONES.length);
  const skinMaterial = skinMaterials[toneIndex];
  const topMaterial = pick(topMaterials);
  const legMaterial = pick(legMaterials);
  const shortSleeves = Math.random() < 0.42;
  // A jacket or untucked shirt covers the hips; otherwise they read as trousers.
  const hipMaterial = Math.random() < 0.45 ? topMaterial : legMaterial;

  const torso = new THREE.Mesh(torsoGeometry, topMaterial);
  torso.name = 'Torso';
  torso.castShadow = true;
  const hips = new THREE.Mesh(pelvisGeometry, hipMaterial);
  hips.name = 'Hips';
  const head = new THREE.Mesh(headGeometry, faceMaterial(toneIndex, Math.random() < 0.2));
  head.name = 'Head';
  head.position.y = HEAD_HEIGHT_M;
  head.castShadow = true;
  addHair(head);
  body.add(torso, hips, head);

  const clothing = new THREE.Mesh(clothingTrimGeometry, pick(legMaterials));
  clothing.name = 'Collar, fastening and pocket seams';
  body.add(clothing);

  const rightLeg = buildLeg(legMaterial, 0.098);
  const leftLeg = buildLeg(legMaterial, -0.098);
  const legs: [THREE.Object3D, THREE.Object3D] = [rightLeg.hip, leftLeg.hip];
  const shins: [THREE.Object3D, THREE.Object3D] = [rightLeg.knee, leftLeg.knee];
  const feet: [THREE.Object3D, THREE.Object3D] = [rightLeg.foot, leftLeg.foot];

  const rightArm = buildArm(topMaterial, skinMaterial, 0.172, shortSleeves);
  const leftArm = buildArm(topMaterial, skinMaterial, -0.172, shortSleeves);
  const arms: [THREE.Object3D, THREE.Object3D] = [rightArm.shoulder, leftArm.shoulder];
  const elbows: [THREE.Object3D, THREE.Object3D] = [rightArm.elbow, leftArm.elbow];
  const hands: [THREE.Object3D, THREE.Object3D] = [rightArm.hand, leftArm.hand];
  body.add(...legs, ...arms);

  // A third of the crowd carries something, which breaks up the silhouette.
  if (Math.random() < 0.34) {
    const bag = new THREE.Mesh(bagGeometry, pick(bagMaterials));
    bag.name = 'Bag';
    // Bag at the hip, strap over the shoulder, tucked against the back.
    bag.position.set(0.215, 1.0, -0.14);
    bag.rotation.z = 0.06;
    body.add(bag);
  }

  const idleVariant = (Math.random() < 0.34 ? 2 : Math.random() < 0.5 ? 1 : 0) as 0 | 1 | 2;
  if (idleVariant === 2) {
    const phone = new THREE.Mesh(phoneGeometry, phoneMaterial);
    phone.name = 'Phone';
    phone.position.set(0, -0.02, 0.045);
    phone.rotation.x = -0.5;
    hands[0].add(phone);
  }

  const scale = 0.9 + Math.random() * 0.18;
  root.scale.setScalar(scale);
  const rig: PedestrianRig = {
    root,
    body,
    head,
    legs,
    shins,
    arms,
    elbows,
    hands,
    feet,
    scale,
    phaseOffset: Math.random() * Math.PI * 2,
    strideScale: 0.9 + Math.random() * 0.2,
    swayScale: 0.75 + Math.random() * 0.5,
    idleVariant
  };
  poseStanding(rig);
  return rig;
}

// ---------------------------------------------------------------------------
// Poses.
// ---------------------------------------------------------------------------

// Arms never hang perfectly straight, and a rod-straight arm is what makes a
// figure read as a mannequin.
const RESTING_ELBOW_RAD = -0.26;
const ARM_CLEARANCE_RAD = 0.07;
// Cushion-to-floor drop assumed when a car never registered its interior floor.
const DEFAULT_SEAT_DROP_M = 0.42;
// A seated shin leans this far forward of vertical, which is what leaves the
// feet slightly ahead of the knees rather than tucked under the seat.
const SEATED_SHIN_RAD = 0.22;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Two-segment arm IK: angles for the shoulder and elbow that put the hand
 * `dropM` below and `forwardM` ahead of the shoulder. Out-of-reach targets
 * resolve to a straight arm pointing at them.
 */
function reachArm(dropM: number, forwardM: number): [number, number] {
  const reach = UPPER_ARM_LENGTH_M + FOREARM_LENGTH_M;
  const distance = Math.min(Math.hypot(dropM, forwardM), reach - 0.005);
  const lineRad = Math.atan2(forwardM, dropM);
  const elbowInterior = Math.acos(
    clamp(
      (UPPER_ARM_LENGTH_M * UPPER_ARM_LENGTH_M + FOREARM_LENGTH_M * FOREARM_LENGTH_M - distance * distance) /
        (2 * UPPER_ARM_LENGTH_M * FOREARM_LENGTH_M),
      -1,
      1
    )
  );
  const offset = Math.asin(clamp((FOREARM_LENGTH_M * Math.sin(elbowInterior)) / Math.max(distance, 1e-4), -1, 1));
  return [-(lineRad - offset), -(Math.PI - elbowInterior)];
}

/**
 * Folds a rig into a seated pose. The caller places `root` so the hips land on
 * the cushion — see `PEDESTRIAN_HIP_HEIGHT_M`, which scales with `rig.scale`.
 *
 * `seatDropM` is the cushion-to-floor height of the seat the rider is taking,
 * in world metres. Transit seats sit lower than a chair, so the knees rise and
 * the thighs slope up as the seat gets lower — the same thing a person does —
 * instead of the feet being driven through the floor by a fixed pose.
 */
export function poseSeated(rig: PedestrianRig, seatDropM = DEFAULT_SEAT_DROP_M): void {
  const lean = 0.06 * (rig.phaseOffset > Math.PI ? 1 : -1);
  // Work in rig-local units: the root carries the per-person height scale.
  // The ankle, not the sole, is what has to land a foot's height above the floor.
  const ankleDropM = seatDropM / rig.scale - ANKLE_HEIGHT_M;
  const thighRad = clamp(
    Math.acos(clamp((ankleDropM - SHIN_LENGTH_M * Math.cos(SEATED_SHIN_RAD)) / THIGH_LENGTH_M, -1, 1)),
    1.1,
    2
  );
  const kneeDropM = THIGH_LENGTH_M * Math.cos(thighRad);
  const kneeForwardM = THIGH_LENGTH_M * Math.sin(thighRad);
  // Whatever drop the thigh could not absorb is taken up by the shin's lean.
  const shinRad = Math.acos(clamp((ankleDropM - kneeDropM) / SHIN_LENGTH_M, -1, 1));

  for (let side = 0; side < 2; side++) {
    // A slight splay keeps two riders on adjacent seats from looking cloned.
    const spread = side === 0 ? 1 : -1;
    rig.legs[side].rotation.set(-thighRad, spread * 0.07, spread * 0.05);
    // Knee and foot rotations are relative to their parent, so back out the
    // angles above; the sole ends up flat on the floor either way.
    rig.shins[side].rotation.set(thighRad - shinRad, 0, 0);
    rig.feet[side].rotation.set(shinRad, 0, 0);
  }

  const shoulderDropM = SHOULDER_HEIGHT_M - HIP_HEIGHT_M;
  for (let side = 0; side < 2; side++) {
    const inward = side === 0 ? -1 : 1;
    if (rig.idleVariant === 1) {
      // Arms folded across the waist.
      rig.arms[side].rotation.set(-0.24, 0, inward * -0.06);
      rig.elbows[side].rotation.set(-1.78, inward * 0.55, 0);
    } else if (rig.idleVariant === 2) {
      // Both hands up in front, close together, looking down at a phone.
      rig.arms[side].rotation.set(-0.5, 0, inward * 0.1);
      rig.elbows[side].rotation.set(-1.52, inward * 0.52, 0);
    } else {
      // Hands resting on the knees, wherever this seat put them.
      const [shoulderRad, elbowRad] = reachArm(shoulderDropM + kneeDropM, kneeForwardM);
      rig.arms[side].rotation.set(shoulderRad, 0, inward * 0.13);
      rig.elbows[side].rotation.set(elbowRad, 0, 0);
    }
  }

  rig.body.position.y = 0;
  rig.body.rotation.set(rig.idleVariant === 2 ? 0.05 : 0, 0, lean * 0.4);
  rig.head.rotation.set(rig.idleVariant === 2 ? 0.3 : 0, lean, 0);
}

/** Upright rider holding the overhead rail with one hand. */
export function poseStandingHold(rig: PedestrianRig): void {
  const holding = rig.phaseOffset > Math.PI ? 0 : 1;
  for (let side = 0; side < 2; side++) {
    rig.legs[side].rotation.set(0, 0, (side === 0 ? 1 : -1) * 0.04);
    rig.shins[side].rotation.set(0, 0, 0);
    rig.feet[side].rotation.set(0, 0, 0);
  }
  // Raised arm reaches up and slightly forward for the rail; the other hangs.
  rig.arms[holding].rotation.set(-2.3, 0, 0);
  rig.elbows[holding].rotation.set(-0.5, 0, 0);
  const free = holding === 0 ? 1 : 0;
  rig.arms[free].rotation.set(-0.12, 0, (free === 0 ? 1 : -1) * ARM_CLEARANCE_RAD);
  rig.elbows[free].rotation.set(RESTING_ELBOW_RAD, 0, 0);
  rig.body.position.y = 0;
  rig.body.rotation.set(0, 0, 0);
  rig.head.rotation.set(0, 0, 0);
}

/** Relaxed upright stance; also clears a seated or holding pose before walking. */
export function poseStanding(rig: PedestrianRig): void {
  for (let side = 0; side < 2; side++) {
    const outward = side === 0 ? 1 : -1;
    rig.legs[side].rotation.set(0, 0, 0);
    rig.shins[side].rotation.set(0, 0, 0);
    rig.feet[side].rotation.set(0, 0, 0);
    rig.arms[side].rotation.set(0, 0, outward * ARM_CLEARANCE_RAD);
    rig.elbows[side].rotation.set(RESTING_ELBOW_RAD, 0, 0);
  }
  rig.body.position.y = 0;
  rig.body.rotation.set(0, 0, 0);
  rig.head.rotation.set(0, 0, 0);
}

// One full stride (both legs) per this much ground covered. Tied to distance
// rather than time so feet never slide, whatever the walker's speed.
const STRIDE_M = 0.78;

/** Swings a pedestrian's limbs for the distance they have walked. */
export function animatePedestrian(rig: PedestrianRig, distanceM: number): void {
  const phase = (distanceM / (STRIDE_M * rig.scale * rig.strideScale)) * Math.PI + rig.phaseOffset;
  const swing = Math.sin(phase);
  rig.legs[0].rotation.x = swing * 0.52;
  rig.legs[1].rotation.x = -swing * 0.52;
  // The knee only flexes on the trailing leg, which is what stops a walk cycle
  // reading as a pair of stiff pendulums.
  rig.shins[0].rotation.x = Math.max(0, swing) * 0.62;
  rig.shins[1].rotation.x = Math.max(0, -swing) * 0.62;
  // Arms counter-swing against the legs, and less far.
  rig.arms[0].rotation.x = -swing * 0.34;
  rig.arms[1].rotation.x = swing * 0.34;
  // Elbows close as the arm comes forward and open as it falls back.
  rig.elbows[0].rotation.x = RESTING_ELBOW_RAD - Math.max(0, swing) * 0.5;
  rig.elbows[1].rotation.x = RESTING_ELBOW_RAD - Math.max(0, -swing) * 0.5;
  // The body rises on each footfall — twice per stride.
  rig.body.position.y = Math.abs(Math.cos(phase)) * 0.022;
  rig.body.rotation.z = Math.sin(phase * 0.5) * 0.018 * rig.swayScale;
  rig.head.rotation.y = Math.sin(phase * 0.25 + rig.phaseOffset) * 0.12;
}
