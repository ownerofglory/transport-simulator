import type { EngineInputEvent } from './EngineInputEvent';

/**
 * A mode of interaction with the engine (simulation, photo, and — later —
 * vehicle constructor). Only simulation and photo exist today; new workspaces
 * plug into the {@link WorkspaceManager} without touching existing ones.
 */
export interface Workspace {
  readonly id: string;

  enter(): void | Promise<void>;
  exit(): void | Promise<void>;

  /** Returns true if the event was consumed. */
  handleInput(event: EngineInputEvent): boolean;

  fixedUpdate?(dt: number): void;
  update?(dt: number): void;
}

/**
 * The narrow slice of runtime commands workspaces act on. `SimulatorRuntime`
 * satisfies this structurally, so workspaces stay decoupled from it (and from
 * React/Three.js) and are unit-testable with a plain fake.
 */
export interface WorkspaceTarget {
  readonly input: {
    setThrottle(value: number): void;
    setBrake(value: number): void;
    setLook(left: boolean, right: boolean): void;
    reset(): void;
  };
  adjustZoom(delta: number): void;
  enterPhotoMode(): void;
  exitPhotoMode(): void;
  cyclePhotoPreset(): void;
}
