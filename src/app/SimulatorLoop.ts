import type { SimulatorState } from '../simulator/simulator-types';

// Deterministic simulation advances in fixed 1/60 s steps regardless of frame
// rate; the per-frame visual/render pass stays variable. MAX_FRAME_DELTA caps
// catch-up after a tab stall so the sim can't spiral.
const FIXED_STEP = 1 / 60;
const MAX_FRAME_DELTA = 0.05;
// Preserve the prior per-frame visual dt clamp for camera smoothing/doors.
const MAX_VISUAL_DELTA = 0.05;

type LoopOptions = {
  turnaroundMs: number;
  getPaused: () => boolean;
  getSelectedTime: () => 'auto' | number;
  getCurrentLocalHour: () => number;
  step: (dt: number) => SimulatorState;
  onAutoTimeHour: (hour: number) => void;
  onState: (state: SimulatorState, dt: number) => void;
  onTerminalTurnaround: () => void;
};

/** Owns the requestAnimationFrame loop that advances simulation and HUD/world updates. */
export class SimulatorLoop {
  private frameHandle = 0;
  private lastFrame = performance.now();
  private lastClockUpdateMs = 0;
  private terminalReachedAt: number | null = null;
  private state: SimulatorState | null = null;
  private previousState: SimulatorState | null = null;
  private visualState: SimulatorState | null = null;
  // Leftover simulation time not yet consumed by a fixed step.
  private accumulator = 0;

  constructor(private readonly options: LoopOptions) {}

  /** Starts the animation loop if it is not already running. */
  start(): void {
    if (this.frameHandle) return;
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  /** Stops the animation loop and clears the active RAF handle. */
  stop(): void {
    if (!this.frameHandle) return;
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  /** Replaces the active simulator state and clears any terminal turnaround timer. */
  setState(state: SimulatorState | null): void {
    this.state = state;
    this.previousState = state;
    this.visualState = state ? { ...state } : null;
    this.terminalReachedAt = null;
    this.accumulator = 0;
  }

  /** Returns the latest simulator state known to the loop. */
  currentState(): SimulatorState | null {
    return this.state;
  }

  /** Per-frame callback used by requestAnimationFrame. */
  private readonly frame = (now: number): void => {
    const frameDelta = Math.min((now - this.lastFrame) / 1000, MAX_FRAME_DELTA);
    this.lastFrame = now;

    if (this.state) {
      // Refresh auto time roughly once per minute instead of checking wall-clock every frame.
      if (this.options.getSelectedTime() === 'auto' && now - this.lastClockUpdateMs > 60_000) {
        this.options.onAutoTimeHour(this.options.getCurrentLocalHour());
        this.lastClockUpdateMs = now;
      }

      if (!this.options.getPaused()) {
        // Advance the deterministic simulation in fixed steps so its behavior is
        // independent of frame rate.
        this.accumulator += frameDelta;
        while (this.accumulator >= FIXED_STEP) {
          this.previousState = this.state;
          this.state = this.options.step(FIXED_STEP);
          this.accumulator -= FIXED_STEP;
        }
      }

      // Variable per-frame visual/render pass (runs even while paused so
      // camera/UI stay in sync).
      this.options.onState(this.interpolatedState(), Math.min(frameDelta, MAX_VISUAL_DELTA));

      if (this.state.tripComplete) {
        this.terminalReachedAt ??= now;

        if (now - this.terminalReachedAt >= this.options.turnaroundMs) {
          // Prevent repeated turnaround callbacks while route restart is being handled.
          this.terminalReachedAt = Number.POSITIVE_INFINITY;
          this.options.onTerminalTurnaround();
        }
      } else {
        this.terminalReachedAt = null;
      }
    }

    this.frameHandle = requestAnimationFrame(this.frame);
  };

  /** Smooths visual motion between deterministic simulation ticks. */
  private interpolatedState(): SimulatorState {
    const current = this.state!;
    const previous = this.previousState ?? current;
    const alpha = Math.min(1, this.accumulator / FIXED_STEP);
    const output = this.visualState ?? { ...current };
    Object.assign(output, current, {
      distanceM: previous.distanceM + (current.distanceM - previous.distanceM) * alpha,
      speedMps: previous.speedMps + (current.speedMps - previous.speedMps) * alpha
    });
    this.visualState = output;
    return output;
  }
}
