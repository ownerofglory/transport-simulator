import { VvsStationCatalog } from './styles/vvs/VvsStationCatalog';
import vvsStadtbahnStations from './styles/vvs/configs/vvs-stadtbahn-stations.json';
import dbSBahnStations from './styles/db/configs/db-sbahn-stations.json';

/**
 * The bundled station catalogs, keyed by style id.
 *
 * Both the station provider and the systems that have to agree with it —
 * `hallExtent` (how long a box is) and `trackLayout` (whether the tracks part
 * around it) — read a stop's description from here, so a style cannot describe
 * a station one way and have the world build the ground around it another.
 */

const CATALOGS = new Map<string, VvsStationCatalog>([
  ['vvs-stadtbahn', new VvsStationCatalog(vvsStadtbahnStations as never)],
  ['db-sbahn', new VvsStationCatalog(dbSBahnStations as never)]
]);

export function catalogFor(stationStyleId: string | undefined): VvsStationCatalog | undefined {
  return stationStyleId ? CATALOGS.get(stationStyleId) : undefined;
}

/**
 * Catalog used when a mode has not named a style. Every stadtbahn-guideway city
 * falls back to the VVS design, so this keeps their boxes the length they were.
 */
export function fallbackCatalog(): VvsStationCatalog {
  return CATALOGS.get('vvs-stadtbahn')!;
}
