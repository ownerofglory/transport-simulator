import { describe, expect, it } from 'vitest';
import { panOffset, panScale } from './cameraPan';

// Camera looking north-to-south from +z: right is +x, forward (into the screen)
// is -z. Matches the scene's default azimuth.
const RIGHT = { x: 1, z: 0 };
const FORWARD = { x: 0, z: -1 };

describe('panScale', () => {
  it('pans further per pixel the further out the camera is', () => {
    expect(panScale(2000)).toBeGreaterThan(panScale(400));
    expect(panScale(0)).toBe(0);
  });
});

describe('panOffset', () => {
  const scale = panScale(1000);

  it('moves the camera the way the drag goes, not the ground', () => {
    // Dragging right pushes the view right, so the world slides left.
    const right = panOffset(RIGHT, FORWARD, 100, 0, scale);
    expect(right.x).toBeGreaterThan(0);
    expect(right.z).toBeCloseTo(0);

    const left = panOffset(RIGHT, FORWARD, -100, 0, scale);
    expect(left.x).toBeLessThan(0);
  });

  it('drags down by pushing the view forward, into the screen', () => {
    const down = panOffset(RIGHT, FORWARD, 0, 100, scale);
    expect(down.z).toBeLessThan(0); // forward is -z
    expect(down.x).toBeCloseTo(0);
  });

  it('follows the camera basis when the view is rotated', () => {
    // Rotated 90°: camera right now points along +z.
    const offset = panOffset({ x: 0, z: 1 }, { x: 1, z: 0 }, 100, 0, scale);
    expect(offset.z).toBeGreaterThan(0);
    expect(offset.x).toBeCloseTo(0);
  });

  it('does not move on a zero drag', () => {
    const offset = panOffset(RIGHT, FORWARD, 0, 0, scale);
    expect(offset.x).toBeCloseTo(0);
    expect(offset.z).toBeCloseTo(0);
  });
});
