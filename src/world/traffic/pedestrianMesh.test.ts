import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildPedestrian, poseStanding } from './pedestrianMesh';

function hairOf(rig: ReturnType<typeof buildPedestrian>): THREE.Mesh[] {
  return rig.head.children.filter((child): child is THREE.Mesh => child.name === 'Hair');
}

describe('pedestrian hair', () => {
  const crowd = Array.from({ length: 60 }, () => buildPedestrian());

  it('gives most of a crowd hair, and hangs it off the head', () => {
    const withHair = crowd.filter((rig) => hairOf(rig).length > 0);
    expect(withHair.length).toBeGreaterThan(crowd.length * 0.7);
    // Parented to the head so it turns with `head.rotation.y`, not the body.
    for (const rig of withHair) for (const hair of hairOf(rig)) expect(hair.parent).toBe(rig.head);
  });

  it('varies colour and length across the crowd', () => {
    const colours = new Set(crowd.flatMap((rig) => hairOf(rig).map((hair) => (hair.material as THREE.MeshStandardMaterial).color.getHex())));
    expect(colours.size).toBeGreaterThan(3);
    const longFalls = crowd.flatMap((rig) => hairOf(rig).filter((hair) => hair.scale.y !== 1));
    expect(new Set(longFalls.map((hair) => hair.scale.y)).size).toBeGreaterThan(1);
  });

  it('shares hair geometry and materials rather than building them per rig', () => {
    const hair = crowd.flatMap(hairOf);
    expect(new Set(hair.map((mesh) => mesh.geometry)).size).toBeLessThanOrEqual(4);
    expect(new Set(hair.map((mesh) => mesh.material)).size).toBeLessThanOrEqual(13);
  });

  it('keeps every hair piece behind the face and above the hips', () => {
    const centre = new THREE.Vector3();
    for (const rig of crowd) {
      rig.root.updateMatrixWorld(true);
      for (const hair of hairOf(rig)) {
        const box = new THREE.Box3().setFromObject(hair);
        // Sits on the crown and nape, never across the face (+Z is forward)...
        expect(box.getCenter(centre).z).toBeLessThanOrEqual(0.02);
        // ...and the longest fall stops well above the hips.
        expect(box.min.y).toBeGreaterThan(0.86 * rig.scale);
      }
    }
  });
});

describe('pedestrian assembly', () => {
  const named = (rig: ReturnType<typeof buildPedestrian>, name: string): THREE.Object3D => {
    let found: THREE.Object3D | undefined;
    rig.root.traverse((child) => { if (!found && child.name === name) found = child; });
    if (!found) throw new Error(`no ${name} in rig`);
    return found;
  };
  const boxOf = (object: THREE.Object3D) => new THREE.Box3().setFromObject(object);

  function standing() {
    const rig = buildPedestrian();
    poseStanding(rig);
    rig.root.scale.setScalar(1);
    rig.root.updateMatrixWorld(true);
    return rig;
  }

  it('stands with its soles on the ground', () => {
    const sole = boxOf(standing().feet[0]).min.y;
    expect(sole).toBeGreaterThan(-0.02);
    expect(sole).toBeLessThan(0.03);
  });

  it('hangs every segment from its own joint, leaving no gap to the next', () => {
    const rig = standing();
    const joints: [string, THREE.Object3D, string, THREE.Object3D][] = [
      ['Thigh', rig.legs[0], 'Shin', rig.shins[0]],
      ['Upper arm', rig.arms[0], 'Forearm', rig.elbows[0]]
    ];
    for (const [upperName, upperJoint, lowerName, lowerJoint] of joints) {
      const upperY = upperJoint.getWorldPosition(new THREE.Vector3()).y;
      const lowerY = lowerJoint.getWorldPosition(new THREE.Vector3()).y;
      // The segment starts at its own joint and runs down to the next one.
      expect(boxOf(named(rig, upperName)).max.y).toBeGreaterThan(upperY - 0.02);
      expect(boxOf(named(rig, upperName)).min.y).toBeLessThan(lowerY + 0.01);
      expect(boxOf(named(rig, lowerName)).max.y).toBeGreaterThan(lowerY - 0.02);
    }
  });

  it('keeps the arms against the torso rather than floating beside it', () => {
    const rig = standing();
    const torso = boxOf(named(rig, 'Torso'));
    const arm = boxOf(named(rig, 'Upper arm'));
    // Overlapping in x at shoulder height is what closes the armhole gap.
    expect(arm.min.x).toBeLessThan(torso.max.x);
    // Shoulder-to-shoulder stays in human range for a ~1.65 m figure.
    expect(torso.max.x - torso.min.x).toBeLessThan(0.44);
  });
});
