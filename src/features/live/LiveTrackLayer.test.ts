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
    layer.update([vehicle('a')], 500);
    expect(layer.group.children.length).toBeGreaterThan(0);
  });

  it('does not redraw a second route sharing the same alignment', () => {
    const routes = { a: line('a'), b: line('b') };
    const layer = makeLayer(routes);
    layer.update([vehicle('a')], 500);
    const afterFirst = layer.group.children.length;
    layer.update([vehicle('b')], 500);
    expect(layer.group.children.length).toBe(afterFirst);
  });

  it('still draws a genuinely separate parallel track', () => {
    // ~73 m east — far beyond the de-dup radius, so it is real second infrastructure.
    const routes = { a: line('a'), far: line('far', 0.001) };
    const layer = makeLayer(routes);
    layer.update([vehicle('a')], 500);
    const afterFirst = layer.group.children.length;
    layer.update([vehicle('far')], 500);
    expect(layer.group.children.length).toBeGreaterThan(afterFirst);
  });

  it('skips building entirely above the altitude cutoff', () => {
    const layer = makeLayer({ a: line('a') });
    layer.update([vehicle('a')], 5000);
    expect(layer.group.children.length).toBe(0);
  });
});
