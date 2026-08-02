import { describe, expect, it } from 'vitest';
import { advanceFlight, easeInOut, flightDuration, type CameraFlight } from './cameraFlight';

function flight(overrides: Partial<CameraFlight> = {}): CameraFlight {
  return {
    fromX: 0,
    fromZ: 0,
    fromY: 0,
    fromDistance: 700,
    toX: 1000,
    toZ: 0,
    toDistance: 430,
    elapsed: 0,
    duration: 1,
    ...overrides
  };
}

describe('flightDuration', () => {
  it('clamps to a readable range regardless of distance', () => {
    expect(flightDuration(0)).toBeCloseTo(0.55);
    expect(flightDuration(1_000_000)).toBeCloseTo(2.2);
  });

  it('takes longer for longer hops inside the range', () => {
    expect(flightDuration(4000)).toBeGreaterThan(flightDuration(1500));
  });
});

describe('easeInOut', () => {
  it('starts and ends at rest', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
  });

  it('clamps out-of-range time', () => {
    expect(easeInOut(-3)).toBe(0);
    expect(easeInOut(4)).toBe(1);
  });
});

describe('advanceFlight', () => {
  it('lands exactly on the destination when the flight completes', () => {
    const f = flight();
    const sample = advanceFlight(f, 1, 250);

    expect(sample.done).toBe(true);
    expect(sample.x).toBeCloseTo(1000);
    expect(sample.z).toBeCloseTo(0);
    expect(sample.distance).toBeCloseTo(430);
    expect(sample.y).toBeCloseTo(250);
  });

  it('stays between the endpoints while in flight', () => {
    const f = flight();
    const sample = advanceFlight(f, 0.25, 250);

    expect(sample.done).toBe(false);
    expect(sample.x).toBeGreaterThan(0);
    expect(sample.x).toBeLessThan(1000);
    expect(sample.distance).toBeLessThan(700);
    expect(sample.distance).toBeGreaterThan(430);
  });

  it('follows the ground height sampled during the flight, not at take-off', () => {
    const f = flight();
    advanceFlight(f, 0.5, 0);
    // Terrain streamed in and raised the destination: the next frame eases toward
    // the new height rather than staying at the stale one.
    const sample = advanceFlight(f, 0.25, 400);

    expect(sample.y).toBeGreaterThan(0);
    expect(sample.y).toBeLessThan(400);
  });
});
