import { describe, expect, it } from 'vitest';
import { groundDistanceM, needsNewOrigin } from './stationFocus';

const hauptbahnhof = { lat: 48.7838, lon: 9.1817 };

describe('groundDistanceM', () => {
  it('measures short hops in metres', () => {
    // ~1 km north of Hauptbahnhof.
    const north = { lat: hauptbahnhof.lat + 1000 / 111_320, lon: hauptbahnhof.lon };
    expect(groundDistanceM(hauptbahnhof, north)).toBeCloseTo(1000, 0);
  });

  it('is symmetric for nearby points', () => {
    const other = { lat: 48.79, lon: 9.2 };
    expect(groundDistanceM(hauptbahnhof, other)).toBeCloseTo(groundDistanceM(other, hauptbahnhof), 0);
  });
});

describe('needsNewOrigin', () => {
  it('rebuilds the scene when there is no origin yet (entering from the map)', () => {
    expect(needsNewOrigin(null, hauptbahnhof)).toBe(true);
  });

  it('flies within the current scene for a nearby station', () => {
    expect(needsNewOrigin(hauptbahnhof, { lat: 48.7737, lon: 9.1723 })).toBe(false);
  });

  it('rebuilds the scene for a station beyond the projection radius', () => {
    // Vaihingen-ish: far enough out that the fixed origin no longer serves.
    expect(needsNewOrigin(hauptbahnhof, { lat: 48.6, lon: 9.05 })).toBe(true);
  });
});
