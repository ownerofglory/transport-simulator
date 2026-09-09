import * as THREE from 'three';
import { pick } from './trafficMeshUtils';

/**
 * A walking figure plus the joints needed to animate it. Built once per
 * spawned/pooled pedestrian; per-frame work is only writing `rotation.x` on the
 * four limb pivots and bobbing the body.
 */
export type PedestrianRig = {
  root: THREE.Object3D;
  /** Bobs vertically; everything visible hangs off it. */
  body: THREE.Object3D;
  head: THREE.Object3D;
  legs: [THREE.Object3D, THREE.Object3D];
  arms: [THREE.Object3D, THREE.Object3D];
  /** Height scale, so a crowd isn't all one size. */
  scale: number;
  /** Per-person gait offsets keep a crowd from walking in lockstep. */
  phaseOffset: number;
  strideScale: number;
  swayScale: number;
};

// Geometry/materials are module singletons, shared by every spawned/pooled
// pedestrian — spawning only ever creates cheap Group/Mesh wrappers.
const torsoGeometry = new THREE.CapsuleGeometry(0.16, 0.4, 3, 8);
const headGeometry = new THREE.SphereGeometry(0.115, 10, 8);
const legGeometry = new THREE.CapsuleGeometry(0.075, 0.6, 3, 6);
const armGeometry = new THREE.CapsuleGeometry(0.055, 0.48, 3, 6);
const bagGeometry = new THREE.BoxGeometry(0.22, 0.26, 0.12);
const handGeometry = new THREE.SphereGeometry(0.052, 6, 5);
const shoeGeometry = new THREE.BoxGeometry(0.11, 0.06, 0.23);

const topMaterials = [0x2b3a4a, 0x8b1e1e, 0x2f6b3a, 0x4a4f57, 0xd4a72c, 0x5b4636, 0x3a3f5c, 0xdfe3e8, 0x7a4b7d].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.72 })
);
const legMaterials = [0x2a2f3a, 0x3d4350, 0x1f2530, 0x5a5347, 0x27436b].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.78 })
);
const skinMaterials = [0xd8ad85, 0xb07a4f, 0x8a5a34, 0xf0c9a4, 0x6b4423].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
);
const bagMaterials = [0x8b1e1e, 0x2b3a4a, 0x3f3f3f].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
const shoeMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.85 });

const HIP_HEIGHT_M = 0.86;
const SHOULDER_HEIGHT_M = 1.3;

/** A limb hanging from a joint, so rotating the pivot swings it from the top. */
function limb(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  jointY: number,
  x: number,
  lengthM: number,
  end?: { geometry: THREE.BufferGeometry; material: THREE.Material; z: number }
): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, jointY, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = -lengthM / 2;
  pivot.add(mesh);
  // Sleeves and trousers share the top's colour, so a limb only reads as a limb
  // once it ends in a contrasting hand or shoe.
  if (end) {
    const cap = new THREE.Mesh(end.geometry, end.material);
    cap.position.set(0, -lengthM / 2 - 0.02, end.z);
    pivot.add(cap);
  }
  return pivot;
}

export function buildPedestrian(): PedestrianRig {
  const root = new THREE.Group();
  root.name = 'Pedestrian';
  const body = new THREE.Group();
  root.add(body);

  const topMaterial = pick(topMaterials);
  const legMaterial = pick(legMaterials);

  const skinMaterial = pick(skinMaterials);
  const torso = new THREE.Mesh(torsoGeometry, topMaterial);
  torso.castShadow = true;
  torso.position.y = 1.12;
  const head = new THREE.Mesh(headGeometry, skinMaterial);
  head.position.y = 1.5;
  body.add(torso, head);

  const shoe = { geometry: shoeGeometry, material: shoeMaterial, z: 0.05 };
  const hand = { geometry: handGeometry, material: skinMaterial, z: 0 };
  const legs: [THREE.Object3D, THREE.Object3D] = [
    limb(legGeometry, legMaterial, HIP_HEIGHT_M, 0.09, 0.68, shoe),
    limb(legGeometry, legMaterial, HIP_HEIGHT_M, -0.09, 0.68, shoe)
  ];
  const arms: [THREE.Object3D, THREE.Object3D] = [
    limb(armGeometry, topMaterial, SHOULDER_HEIGHT_M, 0.21, 0.56, hand),
    limb(armGeometry, topMaterial, SHOULDER_HEIGHT_M, -0.21, 0.56, hand)
  ];
  body.add(...legs, ...arms);

  // A third of the crowd carries something, which breaks up the silhouette.
  if (Math.random() < 0.34) {
    const bag = new THREE.Mesh(bagGeometry, pick(bagMaterials));
    bag.position.set(0.24, 1.12, -0.1);
    body.add(bag);
  }

  const scale = 0.9 + Math.random() * 0.18;
  root.scale.setScalar(scale);
  return {
    root,
    body,
    head,
    legs,
    arms,
    scale,
    phaseOffset: Math.random() * Math.PI * 2,
    strideScale: 0.9 + Math.random() * 0.2,
    swayScale: 0.75 + Math.random() * 0.5
  };
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
  // Arms counter-swing against the legs, and less far.
  rig.arms[0].rotation.x = -swing * 0.34;
  rig.arms[1].rotation.x = swing * 0.34;
  // The body rises on each footfall — twice per stride.
  rig.body.position.y = Math.abs(Math.cos(phase)) * 0.022;
  rig.body.rotation.z = Math.sin(phase * 0.5) * 0.018 * rig.swayScale;
  rig.head.rotation.y = Math.sin(phase * 0.25 + rig.phaseOffset) * 0.12;
}
