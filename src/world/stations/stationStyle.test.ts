import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createStationStyleRegistry } from './index';
import { VvsStadtbahnStationProvider } from './styles/vvs/VvsStadtbahnStationProvider';
import { VvsStationCatalog } from './styles/vvs/VvsStationCatalog';
import { createSeededRandom, hashString } from './variation';
import type { StationPlacement, RouteStation } from './types';

function placementAt(station: RouteStation, underground: boolean): StationPlacement {
  return {
    station,
    index: 0,
    t: 0,
    center: new THREE.Vector3(),
    tangent: new THREE.Vector3(0, 0, 1),
    yaw: 0,
    underground
  };
}

describe('station style registry', () => {
  it('resolves the vvs-stadtbahn provider and no others by default', () => {
    const registry = createStationStyleRegistry();
    expect(registry.has('vvs-stadtbahn')).toBe(true);
    expect(registry.resolveOptional('vvs-stadtbahn')?.id).toBe('vvs-stadtbahn');
    expect(registry.resolveOptional('db-sbahn')).toBeUndefined();
    expect(registry.resolveOptional(undefined)).toBeUndefined();
  });

  it('classifies surface vs underground stops by archetype', () => {
    const provider = createStationStyleRegistry().resolveOptional('vvs-stadtbahn')!;
    // A name deliberately absent from the bundled catalog, so it uses defaults.
    const station: RouteStation = { name: 'Unclassified Test Stop', distanceM: 500 };

    const surface = provider.resolve(station, { layer: {} as never, placement: placementAt(station, false) });
    expect(surface.archetype).toBe('surface-side');
    expect(surface.platform.layout).toBe('side');

    const underground = provider.resolve(station, { layer: {} as never, placement: placementAt(station, true) });
    expect(underground.archetype).toBe('underground-side');
  });

  it('resolves the same appearance for a station across sessions (deterministic seed)', () => {
    const provider = new VvsStadtbahnStationProvider();
    const station: RouteStation = { name: 'Bopser', distanceM: 900 };
    const a = provider.resolve(station, { layer: {} as never, placement: placementAt(station, false) });
    const b = provider.resolve(station, { layer: {} as never, placement: placementAt(station, false) });
    expect(a.seed).toBe(b.seed);
    expect(a.furniture).toEqual(b.furniture);
  });

  it('lets catalog overrides win over seeded defaults', () => {
    const catalog = new VvsStationCatalog({
      schemaVersion: 1,
      style: 'vvs-stadtbahn',
      stations: {
        Bopser: { archetype: 'surface-interchange', furniture: { benches: 3, ticketMachines: 2 } }
      }
    });
    const provider = new VvsStadtbahnStationProvider(catalog);
    const station: RouteStation = { name: 'Bopser', distanceM: 900 };
    const resolved = provider.resolve(station, { layer: {} as never, placement: placementAt(station, false) });
    expect(resolved.archetype).toBe('surface-interchange');
    expect(resolved.furniture?.benches).toBe(3);
    expect(resolved.furniture?.ticketMachines).toBe(2);
  });

  it('applies bundled catalog classifications (Degerloch interchange)', () => {
    const provider = new VvsStadtbahnStationProvider();
    const station: RouteStation = { name: 'Degerloch', distanceM: 100 };
    const resolved = provider.resolve(station, { layer: {} as never, placement: placementAt(station, false) });
    expect(resolved.archetype).toContain('interchange');
    expect(resolved.furniture?.dfiDisplays).toBe(2);
    expect(resolved.environment?.plaza).toBe(true);
    expect(resolved.platform.lengthM).toBe(120);
  });
});

describe('seeded variation', () => {
  it('hashes strings to stable non-zero seeds', () => {
    expect(hashString('vvs:Bopser')).toBe(hashString('vvs:Bopser'));
    expect(hashString('vvs:Bopser')).not.toBe(hashString('vvs:Degerloch'));
    expect(hashString('')).toBeGreaterThan(0);
  });

  it('produces a repeatable sequence for a given seed', () => {
    const a = createSeededRandom(1234);
    const b = createSeededRandom(1234);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
    expect(createSeededRandom(42).int(1, 2)).toBe(createSeededRandom(42).int(1, 2));
  });
});
