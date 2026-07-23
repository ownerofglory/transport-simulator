import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { smoothTrackXZ, resampleTrackXZ, buildSmoothTrackXZ } from './liveTrackGeometry';

const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);

describe('smoothTrackXZ', () => {
  it('preserves point count and endpoints', () => {
    const pts = [v(0, 0), v(10, 4), v(20, -4), v(30, 0)];
    const out = smoothTrackXZ(pts, 2);
    expect(out).toHaveLength(pts.length);
    expect(out[0].equals(pts[0])).toBe(true);
    expect(out.at(-1)!.equals(pts.at(-1)!)).toBe(true);
  });

  it('pulls an interior zig-zag toward its neighbours', () => {
    const pts = [v(0, 0), v(10, 10), v(20, 0)];
    const out = smoothTrackXZ(pts, 1);
    // 0.2*0 + 0.6*10 + 0.2*0 = 6 < 10
    expect(out[1].z).toBeCloseTo(6, 5);
  });
});

describe('resampleTrackXZ', () => {
  it('returns short inputs unchanged', () => {
    const pts = [v(0, 0), v(10, 0)];
    expect(resampleTrackXZ(pts)).toHaveLength(2);
  });

  it('densifies a long polyline and stays near the original line', () => {
    const pts = [v(0, 0), v(50, 0), v(100, 0)];
    const out = resampleTrackXZ(pts, 5);
    expect(out.length).toBeGreaterThan(pts.length);
    for (const p of out) expect(Math.abs(p.z)).toBeLessThan(0.5); // straight line stays flat
  });
});

describe('buildSmoothTrackXZ', () => {
  it('smooths and resamples without drifting off a straight track', () => {
    const pts = [v(0, 0), v(30, 0), v(60, 0), v(90, 0)];
    const out = buildSmoothTrackXZ(pts, 5);
    expect(out.length).toBeGreaterThanOrEqual(pts.length);
    expect(out[0].x).toBeCloseTo(0, 3);
    expect(out.at(-1)!.x).toBeCloseTo(90, 3);
  });
});
