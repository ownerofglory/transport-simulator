import { describe, it, expect } from 'vitest';
import {
  RuntimeMachine,
  runtimeInitialState,
  runtimeTransition,
  type RuntimeState
} from './RuntimeMachine';

const engineReady = (): RuntimeState => {
  let s = runtimeInitialState();
  s = runtimeTransition(s, { type: 'LOAD_ENGINE' });
  s = runtimeTransition(s, { type: 'ENGINE_READY' });
  return s;
};

const running = (): RuntimeState => {
  let s = runtimeTransition(engineReady(), { type: 'LOAD_WORLD', sessionKey: 'a' });
  s = runtimeTransition(s, { type: 'WORLD_READY' });
  return s;
};

describe('runtimeTransition — valid transitions', () => {
  it('walks idle → loading-engine → ready → loading-world → running', () => {
    let s = runtimeInitialState();
    expect(s.value).toBe('idle');
    s = runtimeTransition(s, { type: 'LOAD_ENGINE' });
    expect(s.value).toBe('loading-engine');
    s = runtimeTransition(s, { type: 'ENGINE_READY' });
    expect(s.value).toBe('ready');
    s = runtimeTransition(s, { type: 'LOAD_WORLD', sessionKey: 'k' });
    expect(s).toEqual({ value: 'loading-world', sessionKey: 'k' });
    s = runtimeTransition(s, { type: 'WORLD_READY' });
    expect(s.value).toBe('running');
  });

  it('pauses and resumes', () => {
    let s = running();
    s = runtimeTransition(s, { type: 'PAUSE' });
    expect(s.value).toBe('paused');
    s = runtimeTransition(s, { type: 'RESUME' });
    expect(s.value).toBe('running');
  });

  it('reloads the world from running/paused/terminal-dwell', () => {
    expect(runtimeTransition(running(), { type: 'LOAD_WORLD', sessionKey: 'b' }).value).toBe('loading-world');
    const paused = runtimeTransition(running(), { type: 'PAUSE' });
    expect(runtimeTransition(paused, { type: 'LOAD_WORLD', sessionKey: 'b' }).value).toBe('loading-world');
  });
});

describe('runtimeTransition — invalid transitions are ignored', () => {
  it('ignores ENGINE_READY before LOAD_ENGINE', () => {
    const s = runtimeInitialState();
    expect(runtimeTransition(s, { type: 'ENGINE_READY' })).toBe(s);
  });

  it('ignores PAUSE unless running', () => {
    const ready = engineReady();
    expect(runtimeTransition(ready, { type: 'PAUSE' })).toBe(ready);
  });

  it('ignores RESUME unless paused', () => {
    const r = running();
    expect(runtimeTransition(r, { type: 'RESUME' })).toBe(r);
  });
});

describe('runtimeTransition — terminal dwell fires once', () => {
  it('enters terminal-dwell from running and ignores repeats', () => {
    const r = running();
    const dwell = runtimeTransition(r, { type: 'TERMINAL_REACHED', at: 100 });
    expect(dwell).toEqual({ value: 'terminal-dwell', enteredAt: 100 });
    // A second TERMINAL_REACHED while dwelling is ignored (no double turnaround).
    const again = runtimeTransition(dwell, { type: 'TERMINAL_REACHED', at: 200 });
    expect(again).toBe(dwell);
  });

  it('returns to running on TURNAROUND_COMPLETE', () => {
    const dwell = runtimeTransition(running(), { type: 'TERMINAL_REACHED', at: 1 });
    expect(runtimeTransition(dwell, { type: 'TURNAROUND_COMPLETE' }).value).toBe('running');
  });
});

describe('runtimeTransition — failure and disposal', () => {
  const states: RuntimeState[] = [
    runtimeInitialState(),
    runtimeTransition(runtimeInitialState(), { type: 'LOAD_ENGINE' }),
    engineReady(),
    running(),
    runtimeTransition(running(), { type: 'PAUSE' })
  ];

  it('can fail from any non-disposed state', () => {
    for (const s of states) {
      const failed = runtimeTransition(s, { type: 'FAIL', error: new Error('x') });
      expect(failed.value).toBe('failed');
    }
  });

  it('can dispose from any state', () => {
    for (const s of states) {
      expect(runtimeTransition(s, { type: 'DISPOSE' }).value).toBe('disposed');
    }
  });

  it('disposed is terminal — accepts nothing further', () => {
    const disposed = runtimeTransition(running(), { type: 'DISPOSE' });
    expect(runtimeTransition(disposed, { type: 'LOAD_ENGINE' })).toBe(disposed);
    expect(runtimeTransition(disposed, { type: 'FAIL', error: new Error('y') })).toBe(disposed);
  });
});

describe('RuntimeMachine wrapper', () => {
  it('notifies only on real changes', () => {
    const changes: RuntimeState[] = [];
    const m = new RuntimeMachine((s) => changes.push(s));
    m.send({ type: 'ENGINE_READY' }); // invalid from idle → no change
    m.send({ type: 'LOAD_ENGINE' });
    m.send({ type: 'ENGINE_READY' });
    expect(changes.map((s) => s.value)).toEqual(['loading-engine', 'ready']);
  });

  it('reports engineReady correctly', () => {
    const m = new RuntimeMachine();
    expect(m.engineReady).toBe(false);
    m.send({ type: 'LOAD_ENGINE' });
    expect(m.engineReady).toBe(false);
    m.send({ type: 'ENGINE_READY' });
    expect(m.engineReady).toBe(true);
    m.send({ type: 'DISPOSE' });
    expect(m.engineReady).toBe(false);
  });
});
