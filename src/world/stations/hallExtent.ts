import type { GuidewayKind } from '../../domain/transport';
import { VvsStationCatalog } from './styles/vvs/VvsStationCatalog';

/**
 * How far an underground station box reaches either side of the stop.
 *
 * This is shared on purpose. `GuidewayLayer` cuts the tunnel bore around each
 * underground stop and the station provider builds the box that fills the gap;
 * if the two disagree you either see daylight between the bore mouth and the
 * hall, or the hall's slabs cut across the inside of the bore. One function so
 * they cannot drift.
 *
 * Rail halls grow with the platform they contain (Charlottenplatz's 120 m
 * platform does not fit the 82 m default box), with headroom for the stairs and
 * back wall beyond the platform ends.
 */

const SBAHN_HALF_HALL_M = 77.5; // 155 m box: full S-Bahn platform plus ends
const RAIL_MIN_HALF_HALL_M = 41; // legacy 82 m box
const PLATFORM_END_MARGIN_M = 6;

const catalog = new VvsStationCatalog();

export function undergroundHallHalfLengthM(guidewayKind: GuidewayKind, stationName: string): number {
  if (guidewayKind === 's-bahn') return SBAHN_HALF_HALL_M;
  const platformLengthM = catalog.get(stationName)?.platform?.lengthM ?? 0;
  return Math.max(RAIL_MIN_HALF_HALL_M, platformLengthM / 2 + PLATFORM_END_MARGIN_M);
}
