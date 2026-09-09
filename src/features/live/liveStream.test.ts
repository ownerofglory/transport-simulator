import { describe, it, expect, vi, afterEach } from 'vitest';
import { openVehicleStream } from './liveApi';
import { LiveVehicleStore } from './LiveVehicleStore';
import type { LiveVehicle, RenderableVehicle } from './liveTypes';

// Minimal EventSource stand-in: records listeners so tests can emit events.
class FakeEventSource {
  static last: FakeEventSource | null = null;
  readonly listeners = new Map<string, Set<EventListener>>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: EventListener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: EventListener) {
    this.listeners.get(type)?.delete(fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) } as MessageEvent);
  }
  emitRaw(type: string, data: string) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data } as MessageEvent);
  }
  countFor(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

vi.stubGlobal('EventSource', FakeEventSource);
afterEach(() => {
  FakeEventSource.last = null;
});

const BASE = { lat: 48.7758, lon: 9.1829 };
function veh(runId: string, over: Partial<LiveVehicle> = {}): LiveVehicle {
  return { runId, lat: BASE.lat, lon: BASE.lon, mode: 'light-rail', status: 'in_transit', ...over } as LiveVehicle;
}

describe('openVehicleStream', () => {
  it('subscribes to the documented stream path and disposes cleanly', () => {
    const dispose = openVehicleStream({ onVehicle: () => {} });
    const es = FakeEventSource.last!;
    expect(es.url).toContain('/live/vehicles/stream');
    expect(es.countFor('vehicle-upsert')).toBe(1);
    expect(es.countFor('delta')).toBe(1);

    dispose();
    expect(es.closed).toBe(true);
    expect(es.countFor('vehicle-upsert')).toBe(0);
    expect(es.countFor('delta')).toBe(0);
  });

  it('delivers every upsert in a batched delta', () => {
    const onVehicle = vi.fn();
    openVehicleStream({ onVehicle });
    FakeEventSource.last!.emit('delta', { upserts: [veh('a'), veh('b')] });
    expect(onVehicle.mock.calls.map(([vehicle]) => vehicle.runId)).toEqual(['a', 'b']);
  });

  it('survives a malformed event instead of tearing down the subscription', () => {
    const onVehicle = vi.fn();
    openVehicleStream({ onVehicle });
    const es = FakeEventSource.last!;

    expect(() => es.emitRaw('vehicle-upsert', 'not json')).not.toThrow();
    es.emit('vehicle-upsert', veh('a'));
    expect(onVehicle).toHaveBeenCalledTimes(1);
  });
});

describe('stream merge policy', () => {
  // Mirrors the rule in useLiveVehicles: refresh tracked runs only.
  function wire(store: LiveVehicleStore) {
    return openVehicleStream({
      onVehicle: (v) => {
        if (v.runId && store.get(v.runId)) store.patchOne(v);
      }
    });
  }
  const at = (ms: number) => new Date(ms).toISOString();

  it('refreshes a tracked run', () => {
    const store = new LiveVehicleStore();
    store.applySnapshot([veh('a', { estimatedAt: at(0) }) as RenderableVehicle], 0);
    wire(store);

    FakeEventSource.last!.emit('vehicle-upsert', veh('a', { lat: BASE.lat + 0.001, estimatedAt: at(5000) }));
    expect(store.get('a')!.server.lat).toBeCloseTo(BASE.lat + 0.001, 6);
  });

  it('ignores runs outside the viewport/mode selection', () => {
    // The stream carries the whole network; spawning from it would bypass the
    // bbox and the user's mode filter.
    const store = new LiveVehicleStore();
    store.applySnapshot([veh('a', { estimatedAt: at(0) }) as RenderableVehicle], 0);
    wire(store);

    FakeEventSource.last!.emit('vehicle-upsert', veh('zzz', { estimatedAt: at(5000) }));
    expect(store.get('zzz')).toBeUndefined();
    expect(store.trackedSize).toBe(1);
  });

  it('never rewinds a newer sample with a late event', () => {
    const store = new LiveVehicleStore();
    store.applySnapshot([veh('a', { estimatedAt: at(0) }) as RenderableVehicle], 0);
    store.applySnapshot([veh('a', { lat: BASE.lat + 0.002, estimatedAt: at(10_000) }) as RenderableVehicle], 10_000);
    wire(store);

    // A stream event generated before the poll sample arrives afterwards.
    FakeEventSource.last!.emit('vehicle-upsert', veh('a', { lat: BASE.lat + 0.001, estimatedAt: at(4000) }));
    expect(store.get('a')!.server.lat).toBeCloseTo(BASE.lat + 0.002, 6);
  });

  it('does not disturb other runs', () => {
    const store = new LiveVehicleStore();
    store.applySnapshot(
      [veh('a', { estimatedAt: at(0) }), veh('b', { estimatedAt: at(0) })] as RenderableVehicle[],
      0
    );
    wire(store);

    FakeEventSource.last!.emit('vehicle-upsert', veh('a', { lat: BASE.lat + 0.001, estimatedAt: at(5000) }));
    expect(store.get('b')).toBeDefined();
    expect(store.get('b')!.server.lat).toBeCloseTo(BASE.lat, 6);
  });
});
