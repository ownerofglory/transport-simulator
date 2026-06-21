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

export class SimulatorLoop {
  private frameHandle = 0;
  private lastFrame = performance.now();
  private lastClockUpdateMs = 0;
  private terminalReachedAt: number | null = null;
  private state: SimulatorState | null = null;

  constructor(private readonly options: LoopOptions) {}

  start(): void {
    if (this.frameHandle) return;
    this.lastFrame = performance.now();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.frameHandle) return;
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  setState(state: SimulatorState | null): void {
    this.state = state;
    this.terminalReachedAt = null;
  }

  currentState(): SimulatorState | null {
    return this.state;
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;

    if (this.state) {
      if (this.options.getSelectedTime() === 'auto' && now - this.lastClockUpdateMs > 60_000) {
        this.options.onAutoTimeHour(this.options.getCurrentLocalHour());
        this.lastClockUpdateMs = now;
      }
      if (!this.options.getPaused()) {
        this.state = this.options.step(dt);
      }
      this.options.onState(this.state, dt);

      if (this.state.tripComplete) {
        this.terminalReachedAt ??= now;
        if (now - this.terminalReachedAt >= this.options.turnaroundMs) {
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
