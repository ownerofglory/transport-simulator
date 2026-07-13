/**
 * Transient driver/look input, owned by the engine rather than React.
 *
 * Holding a control (throttle, brake, look) must never travel through React
 * state, otherwise every held frame would re-render the shell. The runtime owns
 * one instance and forwards changes to the simulator/world via {@link onChange}.
 *
 * This class has no React or Three.js dependency and is unit-tested directly.
 */
export type InputStateListener = (input: InputState) => void;

export class InputState {
  throttle = 0;
  brake = 0;
  lookX: -1 | 0 | 1 = 0;

  private listener: InputStateListener | null = null;

  /** Registers (or clears) the sink that applies input to the simulator/world. */
  onChange(listener: InputStateListener | null): void {
    this.listener = listener;
  }

  setThrottle(value: number): void {
    this.throttle = clamp01(value);
    this.emit();
  }

  setBrake(value: number): void {
    this.brake = clamp01(value);
    this.emit();
  }

  setLook(left: boolean, right: boolean): void {
    // Opposing or matching keys cancel out; otherwise -1 looks left, +1 right.
    this.lookX = left === right ? 0 : left ? -1 : 1;
    this.emit();
  }

  reset(): void {
    this.throttle = 0;
    this.brake = 0;
    this.lookX = 0;
    this.emit();
  }

  private emit(): void {
    this.listener?.(this);
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
