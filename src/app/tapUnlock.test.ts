import { describe, expect, it } from 'vitest';
import { NO_TAPS, registerTap, type TapUnlockState } from './tapUnlock';

const OPTIONS = { required: 10, windowMs: 3000 };

/** Taps `count` times, `gapMs` apart, returning every trigger that fired. */
function tap(count: number, gapMs: number, from: TapUnlockState = NO_TAPS) {
  let state = from;
  let triggers = 0;
  for (let index = 0; index < count; index++) {
    const result = registerTap(state, index * gapMs, OPTIONS);
    state = result.state;
    if (result.triggered) triggers++;
  }
  return { state, triggers };
}

describe('registerTap', () => {
  it('fires on the tenth tap and not before', () => {
    expect(tap(9, 200).triggers).toBe(0);
    expect(tap(10, 200).triggers).toBe(1);
  });

  it('starts over when the taps are too far apart', () => {
    expect(tap(10, 3500).triggers).toBe(0);
  });

  it('resets after firing, so the same gesture toggles back', () => {
    expect(tap(20, 200).triggers).toBe(2);
  });

  it('keeps a run alive at exactly the window length', () => {
    expect(tap(10, OPTIONS.windowMs).triggers).toBe(1);
  });
});
