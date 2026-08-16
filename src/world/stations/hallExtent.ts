import type { GuidewayKind } from '../../domain/transport';
import { catalogFor, fallbackCatalog } from './catalogs';
import {
  DEFAULT_ISLAND_LENGTH_M,
  catalogIslandWidthM,
  islandSpreadHalfLengthM,
  islandTaperM
} from './trackLayout';

/**
 * How far an underground station box reaches either side of the stop.
 *
 * This is shared on purpose. `GuidewayLayer` cuts the tunnel bore around each
 * underground stop and the station provider builds the box that fills the gap;
 * if the two disagree you either see daylight between the bore mouth and the
 * hall, or the hall's slabs cut across the inside of the bore. One function so
 * they cannot drift.
 *
 * Halls grow with the platform they contain (Charlottenplatz's 120 m platform
 * does not fit the 82 m default box, and an S-Bahn Stammstrecke platform is
 * 210 m), with headroom for the stairs and back wall beyond the platform ends.
 */

const SBAHN_MIN_HALF_HALL_M = 77.5; // 155 m box: full S-Bahn platform plus ends
const RAIL_MIN_HALF_HALL_M = 41; // legacy 82 m box
const PLATFORM_END_MARGIN_M = 6;

export function undergroundHallHalfLengthM(
  guidewayKind: GuidewayKind,
  stationName: string,
  stationStyleId?: string
): number {
  // Without a named style, fall back to the VVS catalog: that is what every
  // stadtbahn city gets, and it keeps their boxes the length they already were.
  const catalog = catalogFor(stationStyleId) ?? fallbackCatalog();
  const platformLengthM = catalog.get(stationName)?.platform?.lengthM ?? 0;
  const minHalfLengthM = guidewayKind === 's-bahn' ? SBAHN_MIN_HALF_HALL_M : RAIL_MIN_HALF_HALL_M;
  const halfLengthM = Math.max(minHalfLengthM, platformLengthM / 2 + PLATFORM_END_MARGIN_M);
  if (catalogIslandWidthM(stationName, guidewayKind, stationStyleId) === null) return halfLengthM;

  // An island stop's tracks are still swinging back together well past the
  // platform ends. The box has to reach beyond that: the bore begins where the
  // box stops, and it is bored around tracks at their normal spacing.
  const spreadEndM =
    islandSpreadHalfLengthM(platformLengthM || DEFAULT_ISLAND_LENGTH_M) + islandTaperM(guidewayKind);
  return Math.max(halfLengthM, spreadEndM + PLATFORM_END_MARGIN_M);
}
