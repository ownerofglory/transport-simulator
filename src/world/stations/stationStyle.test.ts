import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { undergroundHallHalfLengthM } from './hallExtent';
import {
  ISLAND_TAPER_M,
  islandSpreadZones,
  islandTaperM,
  islandTrackSpreadM,
  vehicleHalfWidthM
} from './trackLayout';
import { TrackSpreadProfile } from '../trackSpread';
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
  it('resolves the registered station styles and nothing else', () => {
    const registry = createStationStyleRegistry();
    expect(registry.has('vvs-stadtbahn')).toBe(true);
    expect(registry.resolveOptional('vvs-stadtbahn')?.id).toBe('vvs-stadtbahn');
    expect(registry.resolveOptional('db-sbahn')?.id).toBe('db-sbahn');
    expect(registry.resolveOptional('rer')).toBeUndefined();
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
    // Keyed by the name the route feed carries, not the fuller signage name.
    const station: RouteStation = { name: 'Rotebühlplatz', distanceM: 400 };
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

describe('island platforms', () => {
  const enbw: RouteStation = { name: 'EnBW City', distanceM: 3646 };
  const ssbLayer = { stationStyleId: 'vvs-stadtbahn' } as never;

  it('resolves an island stop to the island layout in both surface and tunnel', () => {
    const provider = new VvsStadtbahnStationProvider();
    for (const underground of [false, true]) {
      const resolved = provider.resolve(enbw, { layer: ssbLayer, placement: placementAt(enbw, underground) });
      expect(resolved.platform.layout).toBe('island');
      expect(resolved.platform.widthM).toBe(9);
    }
  });

  it('opens the tracks just wide enough to clear the deck', () => {
    // 9 m deck: each edge 4.5 m out, plus 1.3 m of car body → tracks at 5.8 m,
    // which is 3.7 m outside the normal 2.1 m offset.
    expect(islandTrackSpreadM(9, 2.1)).toBeCloseTo(3.7);
    // A deck narrow enough to fit between the tracks as they run needs nothing.
    expect(islandTrackSpreadM(1.4, 2.1)).toBe(0);
  });

  it('spreads the tracks only around island stops on the route', () => {
    const stations: RouteStation[] = [
      { name: 'Fasanenhof', distanceM: 1000 },
      { name: 'EnBW City', distanceM: 2000 }
    ];
    const profile = new TrackSpreadProfile(islandSpreadZones(stations, 'stadtbahn', 2.1, 'vvs-stadtbahn'));
    expect(profile.spreadAtDistance(1000)).toBe(0); // side platforms: untouched
    expect(profile.spreadAtDistance(2000)).toBeCloseTo(3.7);
    expect(profile.laneOffsetAt(2000, -2.1)).toBeCloseTo(-5.8);
    expect(profile.laneOffsetAt(2000, 2.1)).toBeCloseTo(5.8);
    // Closed again well before the next stop.
    expect(profile.spreadAtDistance(2000 - 44 - ISLAND_TAPER_M)).toBe(0);
  });

  it('leaves the tracks alone for tram networks that only fall back to this style', () => {
    const stations: RouteStation[] = [{ name: 'EnBW City', distanceM: 2000 }];
    expect(islandSpreadZones(stations, 'stadtbahn', 2.1, undefined)).toEqual([]);
  });

  it('stretches an underground island box past the taper, so the bore starts on straight track', () => {
    const halfLengthM = undergroundHallHalfLengthM('stadtbahn', 'EnBW City', 'vvs-stadtbahn');
    expect(halfLengthM).toBeGreaterThan(80 / 2 + ISLAND_TAPER_M);
    // Same stop without the style selected by name: the legacy box.
    expect(undergroundHallHalfLengthM('stadtbahn', 'EnBW City')).toBe(46);
  });
});

describe('S-Bahn Stammstrecke islands', () => {
  const style = 'db-sbahn';
  const hbf: RouteStation = { name: 'Stuttgart Hauptbahnhof (tief)', distanceM: 4000 };

  it('gives the Stammstrecke stops an island platform at S-Bahn boarding height', () => {
    const provider = createStationStyleRegistry().resolveOptional(style)!;
    const resolved = provider.resolve(hbf, {
      layer: { stationStyleId: style } as never,
      placement: placementAt(hbf, true)
    });
    expect(resolved.platform.layout).toBe('island');
    expect(resolved.platform.heightM).toBe(0.96);
    expect(resolved.platform.lengthM).toBe(210);
    expect(resolved.displayName).toBe('Stuttgart Hauptbahnhof');
  });

  it('gives each Stammstrecke stop its own wall colour on one design', () => {
    const provider = createStationStyleRegistry().resolveOptional(style)!;
    const colours = new Map<string, string | undefined>();
    for (const name of ['Stuttgart Hauptbahnhof (tief)', 'Stadtmitte', 'Feuersee', 'Schwabstraße']) {
      const station: RouteStation = { name, distanceM: 1000 };
      const resolved = provider.resolve(station, {
        layer: { stationStyleId: style } as never,
        placement: placementAt(station, true)
      });
      expect(resolved.architecture?.columns?.style).toBe('round');
      expect(resolved.architecture?.lighting?.style).toBe('strip-continuous');
      colours.set(name, resolved.architecture?.walls?.color);
    }
    expect(new Set(colours.values()).size).toBe(4);
    expect(colours.get('Stuttgart Hauptbahnhof (tief)')).toBe('#c8102e');
    expect(colours.get('Stadtmitte')).toBe('#009a4d');
    expect(colours.get('Feuersee')).toBe('#1f5fbf');
    expect(colours.get('Schwabstraße')).toBe('#f2b800');
  });

  it('opens the S-Bahn tracks by the wider car body', () => {
    // 11 m deck: 5.5 m to each edge plus 1.55 m of car body → 7.05 m out, which
    // is 4.7 m outside the S-Bahn's 2.35 m track offset.
    expect(islandTrackSpreadM(11, 2.35, vehicleHalfWidthM('s-bahn'))).toBeCloseTo(4.7);
    // The same deck on a narrower Stadtbahn car needs less room.
    expect(islandTrackSpreadM(11, 2.35, vehicleHalfWidthM('stadtbahn'))).toBeCloseTo(4.45);
  });

  it('stretches the S-Bahn box past its longer taper', () => {
    const halfLengthM = undergroundHallHalfLengthM('s-bahn', 'Feuersee', style);
    expect(halfLengthM).toBe(210 / 2 + 4 + islandTaperM('s-bahn') + 6);
    // Unnamed style: the legacy S-Bahn box, untouched.
    expect(undergroundHallHalfLengthM('s-bahn', 'Feuersee')).toBe(77.5);
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
