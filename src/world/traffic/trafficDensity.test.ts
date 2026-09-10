import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import type { LatLon } from './trafficGeo';
import { trafficDensityScale } from './trafficDensity';
import type { TrafficDensity } from '../../app/types';

const fetchRoadRoute = vi.fn<(profile: string, origin: LatLon, destination: LatLon, signal?: AbortSignal) => Promise<LatLon[] | null>>();
vi.mock('./roadRoutingClient', () => ({ fetchRoadRoute: (...args: unknown[]) => fetchRoadRoute(...(args as [string, LatLon, LatLon, AbortSignal?])) }));

const { RoadTrafficSystem } = await import('./RoadTrafficSystem');

// ~1.6 km of straight road, long enough to clear MIN_TRIP_SEPARATION_M.
const ROAD: LatLon[] = Array.from({ length: 24 }, (_, index) => ({ lat: 48.8 + index * 0.0006, lon: 9.2 }));

const context = {
  projectGeo: (lat: number, lon: number) => ({ x: (lon - 9.2) * 73000, z: (lat - 48.8) * 111320 }),
  terrainHeightAt: async () => 0
};

/** Lets the spawn chain's awaited terrain lookups settle between frames. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

async function run(density: TrafficDensity, frames: number) {
  fetchRoadRoute.mockClear();
  const system = new RoadTrafficSystem(context);
  system.setDensity(density);
  const center = new THREE.Vector3(0, 0, 0);
  for (let frame = 0; frame < frames; frame++) {
    system.update(center, { lat: 48.805, lon: 9.2 }, 0.5);
    await settle();
  }
  const population = (system as unknown as { active: unknown[] }).active.length;
  system.dispose();
  return { population, requests: fetchRoadRoute.mock.calls.length };
}

describe('trafficDensityScale', () => {
  it('doubles at medium and triples at many', () => {
    expect(trafficDensityScale('few')).toBe(1);
    expect(trafficDensityScale('medium')).toBe(2);
    expect(trafficDensityScale('many')).toBe(3);
  });
});

describe('road traffic density', () => {
  beforeEach(() => {
    fetchRoadRoute.mockReset();
    fetchRoadRoute.mockResolvedValue(ROAD);
  });

  it('scales the population by the density step', async () => {
    const few = await run('few', 200);
    const medium = await run('medium', 200);
    const many = await run('many', 200);
    expect(few.population).toBeGreaterThan(0);
    expect(medium.population).toBe(few.population * 2);
    expect(many.population).toBe(few.population * 3);
  });

  it('routes no more trips at many than at few', async () => {
    const few = await run('few', 200);
    const many = await run('many', 200);
    // The whole point of the setting: extra vehicles reuse routes already
    // fetched, so the routing server sees the same load at every density.
    expect(many.requests).toBeLessThanOrEqual(few.requests);
  });
});
