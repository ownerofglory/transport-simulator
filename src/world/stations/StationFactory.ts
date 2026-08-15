import * as THREE from 'three';
import { orientAlongRoute } from './placement';
import type { StationPlacement } from './types';

/**
 * Scene scaffold shared by every station build.
 *
 * `root` is an untransformed group added to the layer root. Route-following
 * strips built with `makeRouteStrip` are already in world space, so they attach
 * to `root` directly. `local` is translated to the stop and rotated to its
 * heading; furniture, canopies, and signs that were authored around the origin
 * attach to `local`. This reproduces the legacy StationLayer split where
 * platforms were added to the layer root and everything else to a positioned,
 * rotated group — but under a single owning `root` for clean disposal.
 */
export type StationScaffold = {
  root: THREE.Group;
  local: THREE.Group;
};

export function createStationScaffold(name: string, placement: StationPlacement): StationScaffold {
  const root = new THREE.Group();
  root.name = name;
  const local = new THREE.Group();
  local.position.copy(placement.center);
  orientAlongRoute(local, placement.tangent);
  root.add(local);
  return { root, local };
}

/** Disposes geometries/materials under a station group. Materials shared across
 *  stops are owned by the provider and must be excluded from per-stop disposal. */
export function disposeStation(root: THREE.Object3D, sharedMaterials: Set<THREE.Material>): void {
  root.traverse((object) => {
    const mesh = object as Partial<THREE.Mesh> & Partial<THREE.Sprite>;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = (mesh as THREE.Mesh).material;
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const entry of materials) {
      if (!sharedMaterials.has(entry)) entry.dispose();
    }
  });
}
