/**
 * Runtime lifecycle as an explicit state machine.
 *
 * Replaces the ad-hoc `loaded` / `disposed` / terminal-timer booleans that used
 * to be scattered across the runtime. Pure and framework-free so it can be unit
 * tested without React or Three.js. Invalid transitions are ignored (the
 * reducer returns the same reference), which is what guards against e.g. a
 * terminal turnaround firing twice.
 */
export type RuntimeState =
  | { value: 'idle' }
  | { value: 'loading-engine' }
  | { value: 'ready' }
  | { value: 'loading-world'; sessionKey: string }
  | { value: 'running' }
  | { value: 'paused' }
  | { value: 'terminal-dwell'; enteredAt: number }
  | { value: 'failed'; error: Error }
  | { value: 'disposed' };

export type RuntimeStateValue = RuntimeState['value'];

export type RuntimeEvent =
  | { type: 'LOAD_ENGINE' }
  | { type: 'ENGINE_READY' }
  | { type: 'LOAD_WORLD'; sessionKey: string }
  | { type: 'WORLD_READY' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'TERMINAL_REACHED'; at: number }
  | { type: 'TURNAROUND_COMPLETE' }
  | { type: 'FAIL'; error: Error }
  | { type: 'DISPOSE' };

export function runtimeInitialState(): RuntimeState {
  return { value: 'idle' };
}

/**
 * Pure transition function. Returns the *same* state reference when a transition
 * is not allowed so callers can cheaply detect ignored (invalid) events.
 */
export function runtimeTransition(state: RuntimeState, event: RuntimeEvent): RuntimeState {
  // Terminal states accept nothing further.
  if (state.value === 'disposed') return state;

  // DISPOSE and FAIL are legal from any non-terminal state.
  if (event.type === 'DISPOSE') return { value: 'disposed' };
  if (event.type === 'FAIL') return { value: 'failed', error: event.error };

  switch (event.type) {
    case 'LOAD_ENGINE':
      return state.value === 'idle' ? { value: 'loading-engine' } : state;
    case 'ENGINE_READY':
      return state.value === 'loading-engine' ? { value: 'ready' } : state;
    case 'LOAD_WORLD':
      return state.value === 'ready' ||
        state.value === 'running' ||
        state.value === 'paused' ||
        state.value === 'terminal-dwell'
        ? { value: 'loading-world', sessionKey: event.sessionKey }
        : state;
    case 'WORLD_READY':
      return state.value === 'loading-world' ? { value: 'running' } : state;
    case 'PAUSE':
      return state.value === 'running' ? { value: 'paused' } : state;
    case 'RESUME':
      return state.value === 'paused' ? { value: 'running' } : state;
    case 'TERMINAL_REACHED':
      // Only reachable once from 'running'; ignored while already dwelling so the
      // turnaround cannot fire twice.
      return state.value === 'running' ? { value: 'terminal-dwell', enteredAt: event.at } : state;
    case 'TURNAROUND_COMPLETE':
      return state.value === 'terminal-dwell' ? { value: 'running' } : state;
    default:
      return state;
  }
}

/** Thin stateful wrapper around {@link runtimeTransition} with change notification. */
export class RuntimeMachine {
  private state: RuntimeState = runtimeInitialState();

  constructor(private readonly onChange?: (state: RuntimeState) => void) {}

  get current(): RuntimeState {
    return this.state;
  }

  matches(value: RuntimeStateValue): boolean {
    return this.state.value === value;
  }

  /** True once the engine has finished loading and is not failed/disposed. */
  get engineReady(): boolean {
    return (
      this.state.value === 'ready' ||
      this.state.value === 'loading-world' ||
      this.state.value === 'running' ||
      this.state.value === 'paused' ||
      this.state.value === 'terminal-dwell'
    );
  }

  /** Applies an event; notifies subscribers only when the state actually changed. */
  send(event: RuntimeEvent): RuntimeState {
    const next = runtimeTransition(this.state, event);
    if (next !== this.state) {
      this.state = next;
      this.onChange?.(next);
    }
    return this.state;
  }
}
