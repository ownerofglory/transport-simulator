import { describe, expect, it } from 'vitest';
import { cameraKeyDirection, cameraSwipeDirection } from './InputController';

describe('cameraSwipeDirection', () => {
  it('cycles forward on an upward mobile swipe and backward on a downward one', () => {
    expect(cameraSwipeDirection(8, -80, true)).toBe('next');
    expect(cameraSwipeDirection(-12, 96, true)).toBe('previous');
  });

  it('ignores desktop, short, and predominantly horizontal gestures', () => {
    expect(cameraSwipeDirection(0, -100, false)).toBeUndefined();
    expect(cameraSwipeDirection(0, 71, true)).toBeUndefined();
    expect(cameraSwipeDirection(90, -80, true)).toBeUndefined();
  });
});

describe('cameraKeyDirection', () => {
  it('uses desktop arrow keys while preserving them for mobile controls', () => {
    expect(cameraKeyDirection('ArrowUp', false)).toBe('next');
    expect(cameraKeyDirection('ArrowDown', false)).toBe('previous');
    expect(cameraKeyDirection('ArrowUp', true)).toBeUndefined();
  });
});
