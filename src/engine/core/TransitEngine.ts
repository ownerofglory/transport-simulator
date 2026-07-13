import type * as THREE from 'three';
import type { EngineSystem } from './EngineSystem';

/**
 * Owns the scene graph render and the ordered set of {@link EngineSystem}s.
 *
 * Incremental adoption: today the scene/camera/renderer are still created and
 * owned by the legacy `TransitWorld` and injected here, and systems are
 * extracted from the world one at a time (starting with a LegacyWorldSystem
 * adapter). The renderer is therefore *not* disposed here yet — its current
 * owner (the world) disposes it — so we don't double-dispose. Once
 * EnvironmentSystem and friends own creation, the engine will own the renderer
 * outright per the target architecture.
 */
export class TransitEngine {
  private readonly systems: EngineSystem[] = [];

  constructor(
    readonly scene: THREE.Scene,
    readonly camera: THREE.PerspectiveCamera,
    readonly renderer: THREE.WebGLRenderer
  ) {}

  register(system: EngineSystem): void {
    this.systems.push(system);
  }

  /** Fixed-step pass for deterministic systems. */
  fixedUpdate(dt: number): void {
    for (const system of this.systems) {
      system.fixedUpdate?.(dt);
    }
  }

  /** Per-frame pass: update visual systems, then render once. */
  update(dt: number, alpha: number): void {
    for (const system of this.systems) {
      system.update?.(dt, alpha);
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Disposes systems in reverse registration order (LIFO ownership). */
  dispose(): void {
    for (const system of [...this.systems].reverse()) {
      system.dispose();
    }
    this.systems.length = 0;
  }
}
