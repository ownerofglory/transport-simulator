import * as THREE from 'three';

export type WindowCutout = { y: number; height: number; z: number; width: number };

/** Opens the opaque side shell behind glazing without rebuilding its curved roof and nose profile. */
export function withSideWindowCutouts<T extends THREE.MeshStandardMaterial>(paint: T, cutouts: WindowCutout[]): T {
  const shellPaint = paint.clone() as T;
  const condition = cutouts.map(({ y, height, z, width }) =>
    `(abs(vVehicleLocalPosition.y - ${y.toFixed(4)}) < ${(height / 2).toFixed(4)} && abs(vVehicleLocalPosition.z - ${z.toFixed(4)}) < ${(width / 2).toFixed(4)})`
  ).join(' || ');
  shellPaint.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVehicleLocalPosition;\nvarying vec3 vVehicleLocalNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVehicleLocalPosition = position;\nvVehicleLocalNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVehicleLocalPosition;\nvarying vec3 vVehicleLocalNormal;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nif (abs(vVehicleLocalNormal.x) > 0.85 && (${condition})) discard;`);
  };
  shellPaint.customProgramCacheKey = () => `vehicle-side-windows:${condition}`;
  return shellPaint;
}
