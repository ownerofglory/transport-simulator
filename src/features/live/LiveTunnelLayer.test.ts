import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { LiveTunnelLayer, type LiveTunnelView } from './LiveTunnelLayer';
import { makeProjection } from './liveProjection';
import type { LiveTunnelIndex } from './LiveTunnelIndex';
import type { TrackedVehicle } from './LiveVehicleStore';

const ORIGIN = { lat: 48.78, lon: 9.18 };

type Route = { id: string; geoPoints: [number, number][]; tunnelMask: boolean[] };

/**
 * A north-south alignment that is in tunnel for its whole length, optionally
 * shifted east (`lonOffset`) or started further north (`latOffset`).
 */
function tunnelLine(id: string, { lonOffset = 0, latOffset = 0 } = {}): Route {
  const geoPoints: [number, number][] = [];
  for (let i = 0; i <= 20; i++) {
    geoPoints.push([ORIGIN.lat + latOffset + i * 0.0005, ORIGIN.lon + lonOffset]);
  }
  return { id, geoPoints, tunnelMask: geoPoints.map(() => true) };
}

function makeLayer(routes: Record<string, Route>) {
  const index = { routeFor: (v: TrackedVehicle) => routes[v.runId] ?? null } as unknown as LiveTunnelIndex;
  return new LiveTunnelLayer(makeProjection(ORIGIN), index, () => 0);
}

const vehicle = (runId: string) => ({ runId }) as unknown as TrackedVehicle;

const view = (overrides: Partial<LiveTunnelView> = {}): LiveTunnelView => ({
  altitudeM: 300,
  focus: new THREE.Vector3(0, 0, 0),
  followRouteId: null,
  ...overrides
});

/** Meshes in a bore group; a shell is lining + portals, full adds fittings. */
function meshCount(layer: LiveTunnelLayer): number {
  let count = 0;
  layer.group.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) count += 1;
  });
  return count;
}

describe('LiveTunnelLayer', () => {
  it('builds a lining for a nearby tunnel range', () => {
    const layer = makeLayer({ a: tunnelLine('a') });
    layer.update([vehicle('a')], 1, view());
    expect(layer.group.children.length).toBeGreaterThan(0);
  });

  it('builds nothing at all from the overview altitude', () => {
    // Looking down at the network, the surface glows mark underground runs and
    // no lining is visible — this is the bulk of the saving.
    const layer = makeLayer({ a: tunnelLine('a') });
    layer.update([vehicle('a')], 1, view({ altitudeM: 4000 }));
    expect(layer.group.children.length).toBe(0);
  });

  it('skips ranges far from the camera focus', () => {
    // ~11 km north of the focus: matched to a visible vehicle, but nowhere near
    // the camera, so its 105-range route never turns into geometry.
    const layer = makeLayer({ far: tunnelLine('far', { latOffset: 0.1 }) });
    layer.update([vehicle('far')], 1, view());
    expect(layer.group.children.length).toBe(0);
  });

  it('lines a shared corridor once, however many lines run through it', () => {
    const routes = { a: tunnelLine('a'), b: tunnelLine('b'), c: tunnelLine('c') };
    const layer = makeLayer(routes);
    layer.update([vehicle('a')], 1, view());
    const afterFirst = layer.group.children.length;
    layer.update([vehicle('b'), vehicle('c')], 1, view());
    expect(layer.group.children.length).toBe(afterFirst);
  });

  it('still lines a genuinely separate tunnel nearby', () => {
    // ~73 m east: a different bore, not the same corridor drawn twice.
    const routes = { a: tunnelLine('a'), far: tunnelLine('far', { lonOffset: 0.001 }) };
    const layer = makeLayer(routes);
    layer.update([vehicle('a')], 1, view());
    const afterFirst = layer.group.children.length;
    layer.update([vehicle('far')], 1, view());
    expect(layer.group.children.length).toBeGreaterThan(afterFirst);
  });

  it('gives the followed route the detailed section and others a shell', () => {
    const shell = makeLayer({ a: tunnelLine('a') });
    shell.update([vehicle('a')], 1, view());

    const full = makeLayer({ a: tunnelLine('a') });
    full.update([vehicle('a')], 1, view({ followRouteId: 'a' }));

    // Luminaires and services only exist on the followed bore.
    expect(meshCount(full)).toBeGreaterThan(meshCount(shell));
  });

  it('rebuilds when the follow target changes, so the new route claims the corridor', () => {
    const routes = { a: tunnelLine('a'), b: tunnelLine('b') };
    const layer = makeLayer(routes);
    layer.update([vehicle('a'), vehicle('b')], 1, view());
    const shells = meshCount(layer);
    layer.update([vehicle('a'), vehicle('b')], 1, view({ followRouteId: 'b' }));
    expect(meshCount(layer)).toBeGreaterThan(shells);
  });

  it('releases bores once the camera has panned a full radius away', () => {
    const layer = makeLayer({ a: tunnelLine('a') });
    layer.update([vehicle('a')], 1, view());
    expect(layer.group.children.length).toBeGreaterThan(0);
    // 4 km away: nothing built for the old focus is in range any more.
    layer.update([vehicle('a')], 1, view({ focus: new THREE.Vector3(4000, 0, 4000) }));
    expect(layer.group.children.length).toBe(0);
  });

  it('does not build against the flat terrain placeholder (revision 0)', () => {
    const layer = makeLayer({ a: tunnelLine('a') });
    layer.update([vehicle('a')], 0, view());
    expect(layer.group.children.length).toBe(0);
    layer.update([vehicle('a')], 1, view());
    expect(layer.group.children.length).toBeGreaterThan(0);
  });
});
