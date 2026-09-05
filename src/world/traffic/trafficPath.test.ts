import { describe, it, expect } from 'vitest';
import { buildPathGeometry, dampAngle, poseAtDistance, lerpAt, pickHeightAnchors, shortestAngleDelta } from './trafficPath';

describe('buildPathGeometry', () => {
  it('accumulates straight-line distance and reports the total', () => {
    const path = buildPathGeometry([
      { x: 0, z: 0 },
      { x: 3, z: 4 }, // 3-4-5 triangle
      { x: 3, z: 14 }
    ]);
    expect(path.cum[0]).toBe(0);
    expect(path.cum[1]).toBeCloseTo(5, 6);
    expect(path.cum[2]).toBeCloseTo(15, 6);
    expect(path.total).toBeCloseTo(15, 6);
  });

  it('handles a single point without dividing by zero', () => {
    const path = buildPathGeometry([{ x: 1, z: 2 }]);
    expect(path.total).toBe(0);
  });
});

describe('poseAtDistance', () => {
  const path = buildPathGeometry([
    { x: 0, z: 0 },
    { x: 0, z: 10 },
    { x: 10, z: 10 }
  ]);

  it('sits exactly on a vertex at its cumulative distance', () => {
    expect(poseAtDistance(path, 10)).toMatchObject({ x: 0, z: 10 });
  });

  it('interpolates midway along a segment', () => {
    const pose = poseAtDistance(path, 5);
    expect(pose.x).toBeCloseTo(0, 6);
    expect(pose.z).toBeCloseTo(5, 6);
  });

  it('faces along the direction of travel (three.js yaw convention)', () => {
    // Heading toward +z: atan2(dx=0, dz=10) = 0.
    expect(poseAtDistance(path, 5).headingRad).toBeCloseTo(0, 6);
    // Heading toward +x after the turn: atan2(dx=10, dz=0) = PI/2.
    expect(poseAtDistance(path, 15).headingRad).toBeCloseTo(Math.PI / 2, 6);
  });

  it('clamps beyond either end instead of extrapolating', () => {
    expect(poseAtDistance(path, -5)).toMatchObject({ x: 0, z: 0 });
    expect(poseAtDistance(path, 999)).toMatchObject({ x: 10, z: 10 });
  });
});

describe('angle smoothing', () => {
  it('turns across the wrap boundary by the shortest path', () => {
    expect(shortestAngleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 6);
    expect(shortestAngleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 6);
  });

  it('converges without overshooting and is independent of frame subdivision', () => {
    const oneStep = dampAngle(0, Math.PI / 2, 6, 1 / 30);
    const twoSteps = dampAngle(dampAngle(0, Math.PI / 2, 6, 1 / 60), Math.PI / 2, 6, 1 / 60);
    expect(oneStep).toBeGreaterThan(0);
    expect(oneStep).toBeLessThan(Math.PI / 2);
    expect(twoSteps).toBeCloseTo(oneStep, 6);
  });
});

describe('lerpAt', () => {
  const atM = Float64Array.from([0, 100, 300]);
  const values = Float64Array.from([10, 20, 0]);

  it('interpolates between anchors', () => {
    expect(lerpAt(atM, values, 50)).toBeCloseTo(15, 6);
    expect(lerpAt(atM, values, 200)).toBeCloseTo(10, 6);
  });

  it('clamps outside the anchor range', () => {
    expect(lerpAt(atM, values, -10)).toBe(10);
    expect(lerpAt(atM, values, 1000)).toBe(0);
  });

  it('returns the single value for a one-anchor series', () => {
    expect(lerpAt(Float64Array.from([5]), Float64Array.from([42]), 999)).toBe(42);
  });
});

describe('pickHeightAnchors', () => {
  const cum = Float64Array.from([0, 10, 20, 30, 40, 50, 60, 70]);
  const points = Array.from(cum, (atM) => ({ atM }));

  it('thins points down to roughly spacingM apart', () => {
    const anchors = pickHeightAnchors(points, cum, 25, 100);
    expect(anchors.map((a) => a.atM)).toEqual([0, 30, 60, 70]);
  });

  it('always keeps the final point even if it falls inside the spacing', () => {
    const anchors = pickHeightAnchors(points, cum, 1000, 100);
    expect(anchors.at(-1)?.atM).toBe(70);
  });

  it('caps the number of anchors', () => {
    const anchors = pickHeightAnchors(points, cum, 1, 3);
    expect(anchors).toHaveLength(3);
  });
});
