import { describe, it, expect } from 'vitest';
import { flatDistanceM, randomGeoPointNear } from './trafficGeo';

describe('flatDistanceM', () => {
  it('measures a known offset (Stuttgart-ish latitude)', () => {
    const a = { lat: 48.7758, lon: 9.1829 };
    const b = { lat: 48.7758 + 1 / 111_320, lon: 9.1829 }; // ~1m north
    expect(flatDistanceM(a, b)).toBeCloseTo(1, 1);
  });

  it('is zero for identical points', () => {
    const p = { lat: 48.7758, lon: 9.1829 };
    expect(flatDistanceM(p, p)).toBe(0);
  });
});

describe('randomGeoPointNear', () => {
  it('never places a point beyond the requested radius', () => {
    const center = { lat: 48.7758, lon: 9.1829 };
    for (let i = 0; i < 500; i++) {
      const point = randomGeoPointNear(center, 500);
      expect(flatDistanceM(center, point)).toBeLessThanOrEqual(500 + 1e-6);
    }
  });

  it('spreads across the disc rather than clustering at the center', () => {
    const center = { lat: 48.7758, lon: 9.1829 };
    const distances = Array.from({ length: 500 }, () => flatDistanceM(center, randomGeoPointNear(center, 500)));
    const beyondHalfRadius = distances.filter((d) => d > 250).length;
    // Uniform-over-area sampling puts 75% of points beyond half the radius;
    // a naive uniform-over-radius sampler would cluster near the center instead.
    expect(beyondHalfRadius).toBeGreaterThan(distances.length * 0.6);
  });
});
