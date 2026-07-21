import { describe, it, expect } from 'vitest';
import { bearingDeg, destinationPoint, easeTowards, haversineM, predict, SNAP_THRESHOLD_M } from './interpolation';

const origin = { lat: 48.7758, lon: 9.1829 };

describe('haversineM', () => {
  it('is zero for identical points', () => {
    expect(haversineM(origin, origin)).toBeCloseTo(0, 5);
  });

  it('matches a known ~1.11 km per 0.01° latitude step', () => {
    const north = { lat: origin.lat + 0.01, lon: origin.lon };
    expect(haversineM(origin, north)).toBeGreaterThan(1100);
    expect(haversineM(origin, north)).toBeLessThan(1120);
  });
});

describe('bearingDeg', () => {
  it('reports due north and due east', () => {
    expect(bearingDeg(origin, { lat: origin.lat + 0.01, lon: origin.lon })).toBeCloseTo(0, 1);
    expect(bearingDeg(origin, { lat: origin.lat, lon: origin.lon + 0.01 })).toBeCloseTo(90, 0);
  });
});

describe('destinationPoint', () => {
  it('round-trips with haversine distance', () => {
    const dest = destinationPoint(origin, 45, 500);
    expect(haversineM(origin, dest)).toBeCloseTo(500, 0);
  });
});

describe('predict', () => {
  it('advances along the bearing at the given speed', () => {
    const p = predict(origin, 90, 10, 5); // 10 m/s east for 5 s = 50 m
    expect(haversineM(origin, p)).toBeCloseTo(50, 0);
  });

  it('holds position when barely moving', () => {
    expect(predict(origin, 90, 0, 5)).toEqual(origin);
  });

  it('caps extrapolation of a stale fix', () => {
    const far = predict(origin, 90, 40, 100_000); // absurd elapsed time
    // Capped at 45 s of travel, not 100000 s.
    expect(haversineM(origin, far)).toBeLessThan(40 * 46);
  });
});

describe('easeTowards', () => {
  it('moves partway toward a nearby target', () => {
    const target = { lat: origin.lat + 0.0005, lon: origin.lon };
    const eased = easeTowards(origin, target, 0.1);
    expect(eased.lat).toBeGreaterThan(origin.lat);
    expect(eased.lat).toBeLessThan(target.lat);
  });

  it('snaps when the error exceeds the threshold', () => {
    const target = destinationPoint(origin, 0, SNAP_THRESHOLD_M + 100);
    expect(easeTowards(origin, target, 0.016)).toEqual(target);
  });
});
