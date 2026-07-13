import type * as THREE from 'three';

/**
 * A self-contained piece of the world (terrain, guideway, stations, landmarks,
 * opposing traffic, …).
 *
 * Contract — each layer:
 *   1. owns exactly one {@link THREE.Group} (`root`);
 *   2. adds all of its meshes beneath that group (never straight to the scene);
 *   3. owns its geometries, materials, textures, and listeners;
 *   4. removes its root and releases resources on {@link dispose};
 *   5. aborts unfinished async loading when the provided signal fires.
 *
 * The raw scene is intentionally not handed to layers; the world adds each
 * layer's `root` once.
 */
export interface WorldLayer {
  readonly root: THREE.Group;

  build(signal: AbortSignal): void | Promise<void>;
  setVisible(visible: boolean): void;
  dispose(): void;
}
