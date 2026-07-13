/**
 * A unit of engine behavior with an explicit lifecycle. Systems are registered
 * on {@link TransitEngine} and driven by its loop.
 *
 * - `fixedUpdate` runs on the fixed simulation step (deterministic work).
 * - `update` runs once per rendered frame with an interpolation `alpha`
 *   (visual/camera/lighting work).
 * - `dispose` releases every Three.js resource the system owns.
 */
export interface EngineSystem {
  initialize?(): void | Promise<void>;
  fixedUpdate?(dt: number): void;
  update?(dt: number, alpha: number): void;
  dispose(): void;
}
