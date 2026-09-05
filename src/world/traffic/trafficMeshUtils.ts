import * as THREE from 'three';

/** Random element of a list; used only at build time, never per frame. */
export function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Extrudes a side-view profile into a body shell.
 *
 * Profile points are (length, height) with the nose at +length. The result is
 * turned so the vehicle's length runs along +Z — the forward axis implied by
 * `poseAtDistance`, which yaws models with `atan2(dx, dz)` — its width along X,
 * and its height up from y=0. The bevel rounds every edge, which is what makes
 * an extruded silhouette read as a car body rather than a folded plate.
 */
export function extrudeProfile(points: [number, number][], widthM: number, bevelM = 0.04): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  // Bevel adds bevelThickness at each end, so the flat core is inset to keep the
  // overall width at widthM.
  const coreDepth = Math.max(widthM - bevelM * 2, 0.01);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: coreDepth,
    bevelEnabled: true,
    bevelThickness: bevelM,
    bevelSize: bevelM,
    bevelSegments: 2,
    curveSegments: 1
  });
  geometry.translate(0, 0, -coreDepth / 2);
  geometry.rotateY(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A cylinder with its axle baked onto the X axis, so a mesh/group holding it
 * spins realistically with `rotation.x` and needs no nested transform.
 */
export function axleCylinder(radiusM: number, widthM: number, segments: number): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radiusM, radiusM, widthM, segments);
  geometry.rotateZ(Math.PI / 2);
  return geometry;
}
