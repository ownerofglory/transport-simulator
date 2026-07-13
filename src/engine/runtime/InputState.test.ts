import { describe, it, expect, vi } from 'vitest';
import { InputState } from './InputState';

describe('InputState', () => {
  it('clamps throttle and brake to [0, 1]', () => {
    const input = new InputState();
    input.setThrottle(2);
    input.setBrake(-1);
    expect(input.throttle).toBe(1);
    expect(input.brake).toBe(0);
  });

  it('maps look keys to a signed axis and cancels opposing/matching keys', () => {
    const input = new InputState();
    input.setLook(true, false);
    expect(input.lookX).toBe(-1);
    input.setLook(false, true);
    expect(input.lookX).toBe(1);
    input.setLook(true, true);
    expect(input.lookX).toBe(0);
    input.setLook(false, false);
    expect(input.lookX).toBe(0);
  });

  it('reset clears all values', () => {
    const input = new InputState();
    input.setThrottle(1);
    input.setBrake(1);
    input.setLook(false, true);
    input.reset();
    expect(input.throttle).toBe(0);
    expect(input.brake).toBe(0);
    expect(input.lookX).toBe(0);
  });

  it('notifies the change listener on every mutation', () => {
    const input = new InputState();
    const listener = vi.fn();
    input.onChange(listener);
    input.setThrottle(0.5);
    input.setBrake(0.5);
    input.setLook(true, false);
    input.reset();
    expect(listener).toHaveBeenCalledTimes(4);
    expect(listener).toHaveBeenLastCalledWith(input);
  });

  it('stops notifying after the listener is cleared', () => {
    const input = new InputState();
    const listener = vi.fn();
    input.onChange(listener);
    input.onChange(null);
    input.setThrottle(1);
    expect(listener).not.toHaveBeenCalled();
  });
});
