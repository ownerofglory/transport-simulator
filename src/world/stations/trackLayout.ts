import type { GuidewayKind } from '../../domain/transport';
import type { TrackSpreadZone } from '../trackSpread';
import type { RouteStation, StationArchetype, StationPlatformDefinition } from './types';
import { VvsStationCatalog } from './styles/vvs/VvsStationCatalog';

/**
 * Where a route's tracks have to pull apart for an island platform.
 *
 * Most Stadtbahn stops are a pair of side platforms outside the two tracks, but
 * a sizeable minority are islands: one deck between the tracks, opposing trains
 * berthing either side of it. That is not a decoration — the tracks physically
 * diverge around the platform — so the layout is read from the same station
 * catalog the builders use and handed to the world, which owns track geometry.
 *
 * Like `hallExtent`, this exists so two systems cannot disagree: the spread the
 * tracks take and the width of the deck built between them come from one
 * formula.
 */

// Half the body width of a Stadtbahn car. The side-platform builder holds its
// track-side edge 3.4 m out from a track centred at 2.1 m, which is the same
// clearance measured the other way.
const VEHICLE_HALF_WIDTH_M = 1.3;

// Island decks default to the width a side platform gets, so a stop that only
// says `layout: island` still comes out a usable size.
export const DEFAULT_ISLAND_WIDTH_M = 8;

// Matches the platform builder's default length, so a stop that only says
// `layout: island` spreads its tracks over the deck it actually gets.
export const DEFAULT_ISLAND_LENGTH_M = 76;

// Transition either side of the platform. A 3.2 m throw over 30 m is roughly a
// 1:9 turnout, which is what the real junctions into an island station use, and
// it keeps the swing gentle enough to ride through.
export const ISLAND_TAPER_M = 30;

// The tracks stay fully apart a little past the platform ends, so the taper
// never starts alongside the deck.
const PLATFORM_END_CLEARANCE_M = 4;

/** Route distance either side of the stop over which the tracks stay fully apart. */
export function islandSpreadHalfLengthM(platformLengthM: number): number {
  return platformLengthM / 2 + PLATFORM_END_CLEARANCE_M;
}

// Moving the running tracks is topology, and the catalog is keyed by bare stop
// name, so a station name shared with another city would otherwise re-lay its
// tracks. Only the network that selects this style by name gets islands.
const SSB_STYLE_ID = 'vvs-stadtbahn';

const catalog = new VvsStationCatalog();

/** How far each track moves outward to clear an island deck of this width. */
export function islandTrackSpreadM(platformWidthM: number, baseTrackOffsetM: number): number {
  return Math.max(0, platformWidthM / 2 + VEHICLE_HALF_WIDTH_M - Math.abs(baseTrackOffsetM));
}

/**
 * Width of the strip that fits between two tracks at their normal spacing — the
 * emergency walkway and pole line, not a platform. Used by `mixed` layouts,
 * which previously drew a deck wide enough for the trains to clip through.
 */
export function interTrackWalkwayWidthM(baseTrackOffsetM: number): number {
  return Math.max(0.6, 2 * (Math.abs(baseTrackOffsetM) - VEHICLE_HALF_WIDTH_M) - 0.2);
}

/** True when a resolved stop puts its platform between the tracks. */
export function isIslandLayout(
  platform?: Partial<Pick<StationPlatformDefinition, 'layout'>>,
  archetype?: StationArchetype
): boolean {
  return platform?.layout === 'island' || archetype === 'surface-island' || archetype === 'underground-island';
}

/**
 * Island deck width for a stop, or null when it is not an island. Reads the
 * bundled catalog directly: the world needs this before any station is built.
 */
export function catalogIslandWidthM(
  stationName: string,
  guidewayKind: GuidewayKind,
  stationStyleId?: string
): number | null {
  if (stationStyleId !== SSB_STYLE_ID) return null;
  if (guidewayKind !== 'stadtbahn' && guidewayKind !== 's-bahn') return null;
  const override = catalog.get(stationName);
  if (!override || !isIslandLayout(override.platform, override.archetype)) return null;
  return override.platform?.widthM ?? DEFAULT_ISLAND_WIDTH_M;
}

/** Spread zones for every island stop on a route. Empty for most routes. */
export function islandSpreadZones(
  stations: readonly RouteStation[],
  guidewayKind: GuidewayKind,
  baseTrackOffsetM: number,
  stationStyleId?: string
): TrackSpreadZone[] {
  const zones: TrackSpreadZone[] = [];
  for (const station of stations) {
    const widthM = catalogIslandWidthM(station.name, guidewayKind, stationStyleId);
    if (widthM === null) continue;
    const spreadM = islandTrackSpreadM(widthM, baseTrackOffsetM);
    if (spreadM <= 0) continue;
    zones.push({
      centerM: station.distanceM,
      halfLengthM: islandSpreadHalfLengthM(catalog.get(station.name)?.platform?.lengthM ?? DEFAULT_ISLAND_LENGTH_M),
      taperM: ISLAND_TAPER_M,
      spreadM
    });
  }
  return zones;
}
