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

  it('uses the authored Maybachstraße underground box and its three served lines', () => {
    const provider = new VvsStadtbahnStationProvider();
    const station: RouteStation = { name: 'Maybachstraße', distanceM: 400 };
    const resolved = provider.resolve(station, { layer: {} as never, placement: placementAt(station, true) });

    expect(resolved.archetype).toBe('underground-side');
    expect(resolved.architecture?.family).toBe('maybachstrasse-deep-box');
    expect(resolved.architecture?.hall?.ceiling).toBe('ribbed-metal');
    expect(resolved.signage?.lines).toEqual(['U6', 'U13', 'U16']);
    expect(resolved.furniture?.dfiDisplays).toBe(3);
  });

  it('uses Börsenplatz’s curved green platform treatment and its served lines', () => {
    const provider = new VvsStadtbahnStationProvider();
    const station: RouteStation = { name: 'Börsenplatz', distanceM: 400 };
    const resolved = provider.resolve(station, { layer: {} as never, placement: placementAt(station, true) });

    expect(resolved.architecture?.family).toBe('boersenplatz-green-curve');
    expect(resolved.platform.curved).toBe(true);
    expect(resolved.signage?.lines).toEqual(['U1', 'U9', 'U11']);
  });

  it('uses Rotebühlplatz Stadtmitte’s trussed interchange treatment and its served lines', () => {
    const provider = new VvsStadtbahnStationProvider();
    const station: RouteStation = { name: 'Rotebühlplatz', distanceM: 400 };
    const resolved = provider.resolve(station, { layer: {} as never, placement: placementAt(station, true) });

    expect(resolved.displayName).toBe('Rotebühlplatz Stadtmitte');
    expect(resolved.architecture?.family).toBe('rotebuehlplatz-trussed-interchange');
    expect(resolved.architecture?.hall?.ceiling).toBe('trussed-vault');
    expect(resolved.signage?.lines).toEqual(['U1', 'U2', 'U4', 'U11']);
  });

  it('shares the warm tile interchange treatment across Marienplatz, Österreichischer Platz, and Rathaus', () => {
    const provider = new VvsStadtbahnStationProvider();
    const expectedLines: Record<string, string[]> = {
      Marienplatz: ['U1', 'U14'],
      'Österreichischer Platz': ['U1', 'U14'],
      Rathaus: ['U2', 'U4', 'U11', 'U14']
    };

    for (const [name, lines] of Object.entries(expectedLines)) {
      const station: RouteStation = { name, distanceM: 400 };
      const resolved = provider.resolve(station, { layer: {} as never, placement: placementAt(station, true) });
      expect(resolved.architecture?.family).toBe('warm-tile-interchange');
      expect(resolved.architecture?.walls?.finish).toBe('tile');
      expect(resolved.signage?.lines).toEqual(lines);
    }
  });

  it('uses Neckartor’s colorful glazed gallery treatment and full interchange service list', () => {
    const provider = new VvsStadtbahnStationProvider();
    const station: RouteStation = { name: 'Neckartor', distanceM: 400 };
    const resolved = provider.resolve(station, { layer: {} as never, placement: placementAt(station, true) });

    expect(resolved.architecture?.family).toBe('neckartor-glazed-gallery');
    expect(resolved.platform.lengthM).toBe(120);
    expect(resolved.signage?.lines).toEqual(['U1', 'U2', 'U4', 'U9', 'U11', 'U14']);
    expect(resolved.access?.map((entry) => entry.type)).toEqual(['escalator', 'stairs', 'lift']);
  });

  it('uses Schlossplatz’s rounded shell treatment and core service lines', () => {
    const provider = new VvsStadtbahnStationProvider();
    const station: RouteStation = { name: 'Schlossplatz', distanceM: 400 };
    const resolved = provider.resolve(station, { layer: {} as never, placement: placementAt(station, true) });
    expect(resolved.architecture?.family).toBe('schlossplatz-curved-shell');
    expect(resolved.platform.curved).toBe(true);
    expect(resolved.signage?.lines).toEqual(['U5', 'U6', 'U7', 'U12', 'U15']);
    expect(resolved.furniture?.dfiDisplays).toBe(4);
  });

  it('uses Kirchtalstraße’s blue-chevron island platform treatment for U15', () => {
    const provider = new VvsStadtbahnStationProvider();
    const station: RouteStation = { name: 'Kirchtalstraße', distanceM: 400 };
    const resolved = provider.resolve(station, { layer: {} as never, placement: placementAt(station, true) });

    expect(resolved.archetype).toBe('underground-island');
    expect(resolved.platform.layout).toBe('island');
    expect(resolved.platform.widthM).toBe(9);
    expect(resolved.architecture?.family).toBe('kirchtalstrasse-blue-chevron');
    expect(resolved.signage?.lines).toEqual(['U15']);
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

  it('gives Killesberg its filmstrip walls on a column-free island', () => {
    const provider = new VvsStadtbahnStationProvider();
    const station: RouteStation = { name: 'Killesberg', distanceM: 2759 };
    const resolved = provider.resolve(station, { layer: ssbLayer, placement: placementAt(station, true) });
    expect(resolved.platform.layout).toBe('island');
    expect(resolved.architecture?.walls?.mural).toBe('film-strip');
    expect(resolved.architecture?.walls?.finish).toBe('concrete');
    expect(resolved.architecture?.columns?.style).toBe('none');
    // Still a terminus: the buffer stops belong on the spread tracks.
    expect(resolved.archetype).toBe('terminus');
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

describe('Karlsruhe Kombilösung', () => {
  const style = 'kvv-stadtbahn';
  const stops = [
    'KA Europaplatz (U)',
    'KA Marktplatz (Kaiserstraße U)',
    'KA Marktplatz (Pyramide U)',
    'Karlsruhe Kronenplatz (U)',
    'KA Durlacher Tor/KIT-Campus Süd (U)',
    'KA Ettlinger Tor/Staatstheater (U)',
    'Karlsruhe Kongresszentrum (U)'
  ];

  it('builds the tunnel stops as one architecture on low tram platforms', () => {
    const provider = createStationStyleRegistry().resolveOptional(style)!;
    for (const name of stops) {
      const station: RouteStation = { name, distanceM: 500 };
      const resolved = provider.resolve(station, {
        layer: { stationStyleId: style } as never,
        placement: placementAt(station, true)
      });
      expect(resolved.platform.layout).toBe('side');
      expect(resolved.platform.heightM).toBe(0.34); // low-floor tram, not Stuttgart's 0.8
      expect(resolved.architecture?.lighting?.style).toBe('suspended-tubes');
      expect(resolved.architecture?.columns?.style).toBe('none');
      expect(resolved.architecture?.walls?.nameColor).toBe('#9c1c38');
      expect(resolved.displayName).not.toContain('(U)');
    }
  });

  it('keeps Karlsruhe and Stuttgart stops of the same name apart', () => {
    const registry = createStationStyleRegistry();
    // Karlsruhe's surface Europaplatz is not in its catalog, and Stuttgart's is
    // in a different one: neither can pick up the other's design.
    const surface: RouteStation = { name: 'Karlsruhe Europaplatz', distanceM: 100 };
    const karlsruhe = registry.resolveOptional(style)!.resolve(surface, {
      layer: { stationStyleId: style } as never,
      placement: placementAt(surface, false)
    });
    expect(karlsruhe.architecture).toBeUndefined();

    const stuttgart: RouteStation = { name: 'Europaplatz', distanceM: 100 };
    const vvs = registry.resolveOptional('vvs-stadtbahn')!.resolve(stuttgart, {
      layer: { stationStyleId: 'vvs-stadtbahn' } as never,
      placement: placementAt(stuttgart, false)
    });
    expect(vvs.platform.heightM).toBe(0.8);
    expect(vvs.platform.layout).toBe('island');
  });
});

describe('S-Bahn Stammstrecke islands', () => {
  const style = 'db-sbahn';

  it('uses long, equipped platforms at outdoor DB stops without changing the generic fallback', () => {
    const station: RouteStation = { name: 'Ötlingen', distanceM: 1000 };
    const provider = createStationStyleRegistry().resolveOptional(style)!;
    const context = { placement: placementAt(station, false) };
    const db = provider.resolve(station, { ...context, layer: { stationStyleId: style } as never });
    const fallback = provider.resolve(station, { ...context, layer: {} as never });

    expect(db.platform.lengthM).toBe(210);
    expect(db.platform.heightM).toBe(0.96);
    expect(db.furniture?.dfiDisplays).toBe(3);
    expect(db.furniture?.adVitrines).toBe(1);
    expect(fallback.platform.lengthM).toBe(76);
  });
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
    expect(resolved.displayName).toBe('Hauptbahnhof');
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
    expect(colours.get('Stuttgart Hauptbahnhof (tief)')).toBe('#a73930');
    expect(colours.get('Stadtmitte')).toBe('#009a4d');
    expect(colours.get('Feuersee')).toBe('#1f5fbf');
    expect(colours.get('Schwabstraße')).toBe('#f2b800');
  });

  it('separates the two Flughafen/Messe stops by style, not by name', () => {
    const registry = createStationStyleRegistry();
    const station: RouteStation = { name: 'Flughafen/Messe', distanceM: 1000 };

    const sbahn = registry.resolveOptional('db-sbahn')!.resolve(station, {
      layer: { stationStyleId: 'db-sbahn' } as never,
      placement: placementAt(station, true)
    });
    const stadtbahn = registry.resolveOptional('vvs-stadtbahn')!.resolve(station, {
      layer: { stationStyleId: 'vvs-stadtbahn' } as never,
      placement: placementAt(station, false)
    });

    // Both are islands, but they are different stations: an underground vault
    // against a surface terminus.
    expect(sbahn.platform.layout).toBe('island');
    expect(stadtbahn.platform.layout).toBe('island');
    expect(sbahn.architecture?.hall?.ceiling).toBe('metal-vault');
    expect(sbahn.platform.lengthM).toBe(210);
    expect(stadtbahn.archetype).toBe('terminus');
    expect(stadtbahn.architecture?.hall).toBeUndefined();
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
