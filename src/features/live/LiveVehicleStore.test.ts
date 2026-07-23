import { describe, it, expect } from 'vitest';
import { LiveVehicleStore } from './LiveVehicleStore';
import type { RenderableVehicle } from './liveTypes';

const BASE = { lat: 48.7758, lon: 9.1829 };

function veh(runId: string, over: Partial<RenderableVehicle> = {}): RenderableVehicle {
  return {
    runId,
    lat: BASE.lat,
    lon: BASE.lon,
    mode: 'light-rail',
    status: 'in_transit',
    ...over
  } as RenderableVehicle;
}

describe('LiveVehicleStore.patchOne', () => {
  it('updates one run without despawning the rest of the fleet', () => {
    const store = new LiveVehicleStore();
    const t0 = 1_000_000;
    store.applySnapshot([veh('a'), veh('b'), veh('c')], t0);
    expect(store.size).toBe(3);

    // The 5 s follow poll patches only the followed run, repeatedly. Before the
    // fix this ran a full-snapshot merge and aged out a, b, c after two misses.
    for (let i = 1; i <= 5; i++) {
      store.patchOne(veh('b', { estimatedAt: new Date(t0 + i * 1000).toISOString() }), t0 + i * 1000);
    }

    expect(store.size).toBe(3);
    expect(store.get('a')).toBeDefined();
    expect(store.get('c')).toBeDefined();
  });
});

describe('LiveVehicleStore snapshot despawn', () => {
  it('still ages out runs absent from a full snapshot', () => {
    const store = new LiveVehicleStore();
    store.applySnapshot([veh('a'), veh('b')], 0);
    store.applySnapshot([veh('a')], 1000); // b miss 1
    expect(store.size).toBe(2);
    store.applySnapshot([veh('a')], 2000); // b miss 2 -> despawn
    expect(store.get('b')).toBeUndefined();
  });
});

describe('LiveVehicleStore.upsert speed inference', () => {
  it('forces speed to zero at a stop', () => {
    const store = new LiveVehicleStore();
    store.upsert(veh('a'), 0);
    store.upsert(veh('a', { lat: BASE.lat + 0.001, status: 'at_stop', estimatedAt: new Date(2000).toISOString() }), 2000);
    expect(store.get('a')!.speedMps).toBe(0);
  });

  it('rate-limits inferred speed so a single fix cannot spike it', () => {
    const store = new LiveVehicleStore();
    store.upsert(veh('a'), 0);
    // ~111 m north over 2 s => raw ~55 m/s, but acceleration is capped.
    store.upsert(veh('a', { lat: BASE.lat + 0.001, estimatedAt: new Date(2000).toISOString() }), 2000);
    const speed = store.get('a')!.speedMps;
    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeLessThanOrEqual(1.4 * 2 + 1e-6); // MAX_ACCEL_MPS2 * dt
  });

  it('ignores a stale (older) fix instead of rewinding', () => {
    const store = new LiveVehicleStore();
    store.upsert(veh('a', { estimatedAt: new Date(5000).toISOString() }), 5000);
    const before = store.get('a')!.server;
    store.upsert(veh('a', { lat: BASE.lat + 0.01, estimatedAt: new Date(3000).toISOString() }), 3000);
    expect(store.get('a')!.server).toEqual(before); // position unchanged
  });
});
