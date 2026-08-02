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
    expect(store.trackedSize).toBe(3);

    // The 5 s follow poll patches only the followed run, repeatedly. Before the
    // fix this ran a full-snapshot merge and aged out a, b, c after two misses.
    for (let i = 1; i <= 5; i++) {
      store.patchOne(veh('b', { estimatedAt: new Date(t0 + i * 1000).toISOString() }), t0 + i * 1000);
    }

    expect(store.trackedSize).toBe(3);
    expect(store.get('a')).toBeDefined();
    expect(store.get('c')).toBeDefined();
  });
});

describe('LiveVehicleStore snapshot despawn', () => {
  it('still ages out runs absent from a full snapshot', () => {
    const store = new LiveVehicleStore();
    store.applySnapshot([veh('a'), veh('b')], 0);
    store.applySnapshot([veh('a')], 1000); // b miss 1
    expect(store.trackedSize).toBe(2);
    store.applySnapshot([veh('a')], 2000); // b miss 2 -> despawn
    expect(store.get('b')).toBeUndefined();
  });
});

describe('LiveVehicleStore seeding', () => {
  const at = (ms: number) => new Date(ms).toISOString();

  it('does not render a run until a second fix has given it a speed', () => {
    const store = new LiveVehicleStore();
    store.applySnapshot([veh('a', { estimatedAt: at(0) })], 0);
    expect(store.trackedSize).toBe(1);
    expect(store.size).toBe(0); // tracked, but not drawn yet
    expect(store.list()).toEqual([]);

    store.applySnapshot([veh('a', { lat: BASE.lat + 0.002, estimatedAt: at(15_000) })], 15_000);
    expect(store.size).toBe(1);
    expect(store.get('a')!.speedMps).toBeGreaterThan(0);
  });

  it('shows a newly seeded run at its latest fix, not a stale first position', () => {
    // Regression: a one-fix run stood still for a whole poll interval and then
    // teleported the full distance it had actually travelled.
    const store = new LiveVehicleStore();
    store.applySnapshot([veh('a', { estimatedAt: at(0) })], 0);
    const spawnLat = store.get('a')!.render.lat;

    store.applySnapshot([veh('a', { lat: BASE.lat + 0.005, estimatedAt: at(15_000) })], 15_000);
    const seeded = store.get('a')!;
    expect(seeded.render.lat).toBeCloseTo(BASE.lat + 0.005, 6);
    expect(seeded.render.lat).not.toBeCloseTo(spawnLat, 6);
  });

  it('keeps easing after seeding instead of snapping every fix', () => {
    const store = new LiveVehicleStore();
    store.applySnapshot([veh('a', { estimatedAt: at(0) })], 0);
    store.applySnapshot([veh('a', { lat: BASE.lat + 0.002, estimatedAt: at(15_000) })], 15_000);

    // A third fix must not re-anchor `render` onto the server position.
    store.applySnapshot([veh('a', { lat: BASE.lat + 0.004, estimatedAt: at(30_000) })], 30_000);
    const t = store.get('a')!;
    expect(t.render.lat).not.toBeCloseTo(t.server.lat, 6);
  });
});

describe('LiveVehicleStore.upsert speed inference', () => {
  it('forces speed to zero at a stop', () => {
    const store = new LiveVehicleStore();
    store.upsert(veh('a'), 0);
    store.upsert(veh('a', { lat: BASE.lat + 0.001, status: 'at_stop', estimatedAt: new Date(2000).toISOString() }), 2000);
    expect(store.get('a')!.speedMps).toBe(0);
  });

  it('caps — but does not rate-limit — the first measurement', () => {
    // `prevMps` is 0 here because the run had one fix, not because it was standing
    // still, so the acceleration limit must not apply. It would otherwise starve
    // the estimate to 2.8 m/s and the run would immediately fall behind.
    const store = new LiveVehicleStore();
    store.upsert(veh('a'), 0);
    // ~111 m north over 2 s => raw ~55 m/s, clamped to the 45 m/s ceiling.
    store.upsert(veh('a', { lat: BASE.lat + 0.001, estimatedAt: new Date(2000).toISOString() }), 2000);
    expect(store.get('a')!.speedMps).toBeCloseTo(45, 5);
  });

  it('rate-limits once a speed is known, so one bad fix cannot spike it', () => {
    const store = new LiveVehicleStore();
    store.upsert(veh('a'), 0);
    // Seed a slow speed: ~11 m north over 2 s ≈ 5.6 m/s.
    store.upsert(veh('a', { lat: BASE.lat + 0.0001, estimatedAt: new Date(2000).toISOString() }), 2000);
    const seeded = store.get('a')!.speedMps;

    // Now a 111 m jump over 2 s: acceleration-limited from the known speed.
    store.upsert(veh('a', { lat: BASE.lat + 0.0011, estimatedAt: new Date(4000).toISOString() }), 4000);
    expect(store.get('a')!.speedMps).toBeLessThanOrEqual(seeded + 1.4 * 2 + 1e-6);
  });

  it('ignores a stale (older) fix instead of rewinding', () => {
    const store = new LiveVehicleStore();
    store.upsert(veh('a', { estimatedAt: new Date(5000).toISOString() }), 5000);
    const before = store.get('a')!.server;
    store.upsert(veh('a', { lat: BASE.lat + 0.01, estimatedAt: new Date(3000).toISOString() }), 3000);
    expect(store.get('a')!.server).toEqual(before); // position unchanged
  });
});
