import { describe, it, expect } from 'vitest';
import {
  bboxContains,
  bboxWidthKm,
  expandBBox,
  modesForTier,
  pollIntervalMs,
  quantizeBBox,
  requestBBox,
  tierForZoom,
  type BBox
} from './viewport';

const stuttgart: BBox = { latMin: 48.74, lonMin: 9.14, latMax: 48.81, lonMax: 9.24 };

describe('tierForZoom', () => {
  it('maps zoom levels to LOD tiers', () => {
    expect(tierForZoom(10)).toBe('city');
    expect(tierForZoom(11)).toBe('city');
    expect(tierForZoom(12)).toBe('district');
    expect(tierForZoom(14)).toBe('district');
    expect(tierForZoom(15)).toBe('street');
    expect(tierForZoom(18)).toBe('street');
  });
});

describe('pollIntervalMs', () => {
  it('polls smaller viewports more often', () => {
    expect(pollIntervalMs('city')).toBeGreaterThan(pollIntervalMs('district'));
    expect(pollIntervalMs('district')).toBeGreaterThan(pollIntervalMs('street'));
  });
});

describe('modesForTier', () => {
  it('requests the rail skeleton only at city tier', () => {
    const modes = modesForTier('city', stuttgart);
    expect(modes).not.toContain('bus');
    expect(modes).toContain('s-bahn');
  });

  it('adds buses at district tier only for a small bbox', () => {
    const wide: BBox = { latMin: 48.5, lonMin: 9.0, latMax: 48.9, lonMax: 9.5 };
    const small: BBox = { latMin: 48.77, lonMin: 9.17, latMax: 48.79, lonMax: 9.2 };
    expect(modesForTier('district', wide)).not.toContain('bus');
    expect(modesForTier('district', small)).toContain('bus');
  });

  it('requests all modes at street tier', () => {
    expect(modesForTier('street', stuttgart)).toContain('bus');
  });

  it('lets the user filter only narrow the automatic set', () => {
    const modes = modesForTier('street', stuttgart, new Set(['tram']));
    expect(modes).toEqual(['tram']);
  });

  it('falls back to the auto set when the user filters everything out', () => {
    // City tier never includes bus, so a bus-only filter yields an empty
    // intersection; the API needs a non-empty list, so we send the auto set.
    const modes = modesForTier('city', stuttgart, new Set(['bus']));
    expect(modes.length).toBeGreaterThan(0);
    expect(modes).not.toContain('bus');
  });
});

describe('bbox math', () => {
  it('expands symmetrically by the margin fraction', () => {
    const b: BBox = { latMin: 0, lonMin: 0, latMax: 10, lonMax: 20 };
    expect(expandBBox(b, 0.1)).toEqual({ latMin: -1, lonMin: -2, latMax: 11, lonMax: 22 });
  });

  it('quantizes outward to the grid', () => {
    const b: BBox = { latMin: 48.7449, lonMin: 9.1401, latMax: 48.8151, lonMax: 9.2399 };
    const q = quantizeBBox(b, 0.01);
    expect(q.latMin).toBeCloseTo(48.74, 6);
    expect(q.latMax).toBeCloseTo(48.82, 6);
    expect(q.lonMin).toBeCloseTo(9.14, 6);
    expect(q.lonMax).toBeCloseTo(9.24, 6);
  });

  it('returns a grid-aligned bbox that fully covers the visible viewport', () => {
    const visible: BBox = { latMin: 48.751, lonMin: 9.151, latMax: 48.759, lonMax: 9.159 };
    const req = requestBBox(visible);
    // Aligned to the 0.01° grid.
    for (const v of [req.latMin, req.lonMin, req.latMax, req.lonMax]) {
      expect(Math.round(v * 100) / 100).toBeCloseTo(v, 6);
    }
    // And it contains the visible viewport (so small pans stay covered).
    expect(bboxContains(req, visible)).toBe(true);
  });

  it('detects containment for hysteresis', () => {
    const outer: BBox = { latMin: 0, lonMin: 0, latMax: 10, lonMax: 10 };
    expect(bboxContains(outer, { latMin: 2, lonMin: 2, latMax: 8, lonMax: 8 })).toBe(true);
    expect(bboxContains(outer, { latMin: -1, lonMin: 2, latMax: 8, lonMax: 8 })).toBe(false);
  });

  it('estimates width in km', () => {
    expect(bboxWidthKm(stuttgart)).toBeGreaterThan(5);
    expect(bboxWidthKm(stuttgart)).toBeLessThan(12);
  });
});
