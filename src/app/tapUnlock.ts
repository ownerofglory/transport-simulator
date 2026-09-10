/**
 * Counts the rapid repeat taps behind a hidden toggle (the HUD title unlocks
 * debug mode). Pausing longer than the window between taps starts the count
 * over, so ordinary clicks on the title never accumulate into a trigger.
 */
export type TapUnlockState = {
  count: number;
  lastTapMs: number;
};

export const NO_TAPS: TapUnlockState = { count: 0, lastTapMs: 0 };

export type TapUnlockOptions = {
  /** Taps needed to fire. */
  required: number;
  /** Longest gap between two taps that still counts as the same run. */
  windowMs: number;
};

/**
 * Folds one tap into the running count. Returns the next state and whether this
 * tap completed a run — the count resets on completion so the next run starts
 * clean (the same gesture toggles debug mode back off).
 */
export function registerTap(
  state: TapUnlockState,
  nowMs: number,
  { required, windowMs }: TapUnlockOptions
): { state: TapUnlockState; triggered: boolean } {
  const continues = state.count > 0 && nowMs - state.lastTapMs <= windowMs;
  const count = (continues ? state.count : 0) + 1;
  if (count >= required) return { state: { ...NO_TAPS }, triggered: true };
  return { state: { count, lastTapMs: nowMs }, triggered: false };
}
