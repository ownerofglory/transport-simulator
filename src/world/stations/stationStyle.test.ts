import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { undergroundHallHalfLengthM } from './hallExtent';
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

describe('station catalog schema 2', () => {
  it('carries architecture, access, and signage detail through to the definition', () => {
    const provider = new VvsStadtbahnStationProvider();
    const station: RouteStation = { name: 'Rotebühlplatz (Stadtmitte)', distanceM: 400 };
    const resolved = provider.resolve(station, { layer: {} as never, placement: placementAt(station, true) });

    expect(resolved.architecture?.hall?.ceiling).toBe('trussed-vault');
    expect(resolved.architecture?.walls?.finish).toBe('tile');
    expect(resolved.architecture?.lighting?.style).toBe('strip-continuous');
    expect(resolved.access?.map((entry) => entry.type)).toEqual(['escalator', 'stairs']);
    expect(resolved.signage?.exits).toContain('Königstraße');
  });

  it('gives underground stops departure boards and ad cases, surface stops neither', () => {
    const provider = new VvsStadtbahnStationProvider();
    // Absent from the catalog, so both come from the archetype defaults.
    const station: RouteStation = { name: 'Unclassified Test Stop', distanceM: 500 };

    const underground = provider.resolve(station, { layer: {} as never, placement: placementAt(station, true) });
    expect(underground.furniture?.dfiDisplays).toBe(2);
    expect(underground.furniture?.adVitrines).toBeGreaterThan(0);

    const surface = provider.resolve(station, { layer: {} as never, placement: placementAt(station, false) });
    expect(surface.furniture?.dfiDisplays).toBe(0);
    expect(surface.furniture?.adVitrines).toBe(0);
  });
});

describe('platform height', () => {
  const station: RouteStation = { name: 'Unclassified Test Stop', distanceM: 500 };

  it('gives Stadtbahn stops the 0.8 m high-floor deck', () => {
    const provider = new VvsStadtbahnStationProvider();
    const resolved = provider.resolve(station, {
      layer: { stationStyleId: 'vvs-stadtbahn' } as never,
      placement: placementAt(station, false)
    });
    expect(resolved.platform.heightM).toBe(0.8);
  });

  it('leaves the low kerb for tram networks that only fall back to this style', () => {
    const provider = new VvsStadtbahnStationProvider();
    const resolved = provider.resolve(station, {
      layer: {} as never, // no stationStyleId: Odessa/Ulm/Lviv trams
      placement: placementAt(station, false)
    });
    expect(resolved.platform.heightM).toBe(0.22);
  });

  it('carries surface canopy and parapet detail from the catalog', () => {
    const provider = new VvsStadtbahnStationProvider();
    const budapester: RouteStation = { name: 'Budapester Platz', distanceM: 300 };
    const resolved = provider.resolve(budapester, {
      layer: { stationStyleId: 'vvs-stadtbahn' } as never,
      placement: placementAt(budapester, false)
    });
    expect(resolved.platform.heightM).toBe(0.8);
    expect(resolved.architecture?.canopy?.nameOnFascia).toBe(true);
    expect(resolved.environment?.edgeParapet).toBe('wall');
    expect(resolved.signage?.lines).toContain('U12');
  });
});

describe('underground hall extent', () => {
  // The station box and the tunnel cut read this same function; if they ever
  // disagree you get daylight at the bore mouth or slabs across the bore.
  it('grows the box to fit a long platform', () => {
    expect(undergroundHallHalfLengthM('stadtbahn', 'Charlottenplatz')).toBe(66); // 120 m platform
  });

  it('keeps the legacy box for stops with no catalog platform', () => {
    expect(undergroundHallHalfLengthM('stadtbahn', 'Unclassified Test Stop')).toBe(41);
  });

  it('uses the full-length S-Bahn box regardless of the Stadtbahn catalog', () => {
    expect(undergroundHallHalfLengthM('s-bahn', 'Charlottenplatz')).toBe(77.5);
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
