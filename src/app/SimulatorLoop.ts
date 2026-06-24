import type { SimulatorState } from '../simulator/simulator-types';

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

  constructor(private readonly options: LoopOptions) {}

  /** Starts the animation loop if it is not already running. */
  start(): void {
    if (this.frameHandle) return;
    this.lastFrame = performance.now();
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
    this.terminalReachedAt = null;
  }

  /** Returns the latest simulator state known to the loop. */
  currentState(): SimulatorState | null {
    return this.state;
  }

  /** Per-frame callback used by requestAnimationFrame. */
  private readonly frame = (now: number): void => {
    // Clamp frame delta to 50 ms so tab stalls do not create huge simulation jumps.
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;

    if (this.state) {
      // Refresh auto time roughly once per minute instead of checking wall-clock every frame.
      if (this.options.getSelectedTime() === 'auto' && now - this.lastClockUpdateMs > 60_000) {
        this.options.onAutoTimeHour(this.options.getCurrentLocalHour());
        this.lastClockUpdateMs = now;
      }

      if (!this.options.getPaused()) {
        this.state = this.options.step(dt);
      }

      // Notify render/HUD code even while paused so camera/UI can stay in sync.
      this.options.onState(this.state, dt);

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
}
