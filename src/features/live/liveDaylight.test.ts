import { describe, it, expect } from 'vitest';
import { daylightAt } from './liveDaylight';

describe('daylightAt', () => {
  it('puts the sun highest and brightest at midday', () => {
    const noon = daylightAt(12);
    const midnight = daylightAt(0);
    expect(noon.elevationDeg).toBeGreaterThan(midnight.elevationDeg);
    expect(noon.sunIntensity).toBeGreaterThan(midnight.sunIntensity);
  });

  it('keeps the sun below the horizon at night', () => {
    expect(daylightAt(0).elevationDeg).toBeLessThan(0);
    expect(daylightAt(23).elevationDeg).toBeLessThan(0);
  });

  it('is continuous across midnight (24:00 === 0:00)', () => {
    const a = daylightAt(0);
    const b = daylightAt(24);
    expect(b.skyColor).toBe(a.skyColor);
    expect(b.sunIntensity).toBeCloseTo(a.sunIntensity, 6);
    expect(b.elevationDeg).toBeCloseTo(a.elevationDeg, 6);
  });

  it('wraps out-of-range hours into the day', () => {
    expect(daylightAt(25).elevationDeg).toBeCloseTo(daylightAt(1).elevationDeg, 6);
    expect(daylightAt(-1).sunIntensity).toBeCloseTo(daylightAt(23).sunIntensity, 6);
  });

  it('interpolates sky color between keyframes rather than snapping', () => {
    // 10:00 sits between the 08:00 and 12:00 keyframes.
    const mid = daylightAt(10).skyColor;
    expect(mid).not.toBe(daylightAt(8).skyColor);
    expect(mid).not.toBe(daylightAt(12).skyColor);
  });
});
