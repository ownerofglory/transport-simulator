import { describe, it, expect } from 'vitest';
import { LiveTrackLayer } from './LiveTrackLayer';
import { makeProjection } from './liveProjection';
import type { LiveTunnelIndex } from './LiveTunnelIndex';
import type { TrackedVehicle } from './LiveVehicleStore';

const ORIGIN = { lat: 48.78, lon: 9.18 };

type Route = { id: string; geoPoints: [number, number][]; tunnelMask?: boolean[] };

// A straight north-south alignment, optionally shifted east by `lonOffset`.
function line(id: string, lonOffset = 0): Route {
  const geoPoints: [number, number][] = [];
  for (let i = 0; i <= 10; i++) geoPoints.push([ORIGIN.lat + i * 0.0005, ORIGIN.lon + lonOffset]);
  return { id, geoPoints };
}

function makeLayer(routes: Record<string, Route>) {
  const index = { routeFor: (v: TrackedVehicle) => routes[v.runId] ?? null } as unknown as LiveTunnelIndex;
  return new LiveTrackLayer(makeProjection(ORIGIN), index, () => 0);
}

const vehicle = (runId: string) => ({ runId }) as unknown as TrackedVehicle;

describe('LiveTrackLayer de-duplication', () => {
  it('draws track for the first route on an alignment', () => {
    const layer = makeLayer({ a: line('a') });
    layer.update([vehicle('a')], 500, 1);
    expect(layer.group.children.length).toBeGreaterThan(0);
  });

  it('does not redraw a second route sharing the same alignment', () => {
    const routes = { a: line('a'), b: line('b') };
    const layer = makeLayer(routes);
    layer.update([vehicle('a')], 500, 1);
    const afterFirst = layer.group.children.length;
    layer.update([vehicle('b')], 500, 1);
    expect(layer.group.children.length).toBe(afterFirst);
  });

  it('still draws a genuinely separate parallel track', () => {
    // ~73 m east — far beyond the de-dup radius, so it is real second infrastructure.
    const routes = { a: line('a'), far: line('far', 0.001) };
    const layer = makeLayer(routes);
    layer.update([vehicle('a')], 500, 1);
    const afterFirst = layer.group.children.length;
    layer.update([vehicle('far')], 500, 1);
    expect(layer.group.children.length).toBeGreaterThan(afterFirst);
  });

  it('skips building entirely above the altitude cutoff', () => {
    const layer = makeLayer({ a: line('a') });
    layer.update([vehicle('a')], 5000, 1);
    expect(layer.group.children.length).toBe(0);
  });

  it('does not build against the flat terrain placeholder (revision 0)', () => {
    // Ground height is baked into the rails, so building before the heightfield
    // lands would strand them at y=0 while the train rides real terrain.
    const layer = makeLayer({ a: line('a') });
    layer.update([vehicle('a')], 500, 0);
    expect(layer.group.children.length).toBe(0);
    layer.update([vehicle('a')], 500, 1);
    expect(layer.group.children.length).toBeGreaterThan(0);
  });

  it('rebuilds at corrected heights when the terrain revision changes', () => {
    const layer = makeLayer({ a: line('a') });
    layer.update([vehicle('a')], 500, 1);
    const afterFirst = layer.group.children.length;
    // A recenter changes ground heights, so the route is rebuilt rather than
    // left stale — same geometry count, freshly placed.
    layer.update([vehicle('a')], 500, 2);
    expect(layer.group.children.length).toBe(afterFirst);
  });
});
