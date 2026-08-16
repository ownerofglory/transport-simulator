import { VvsStadtbahnStationProvider } from '../vvs/VvsStadtbahnStationProvider';
import { VvsStationCatalog } from '../vvs/VvsStationCatalog';
import kvvStadtbahnStations from './configs/kvv-stadtbahn-stations.json';

/**
 * KVV Karlsruhe station style, for the VBK trams and the AVG tram-trains that
 * share the Kombilösung tunnel.
 *
 * Karlsruhe needs its own style rather than entries in the Stuttgart catalog
 * for the reason catalogs are keyed by bare stop name: both cities have a
 * Europaplatz and a Marktplatz. A separate catalog keeps them apart, and keeps
 * Karlsruhe's low 34 cm tram platforms from raising Stuttgart's.
 *
 * The seven tunnel stops are one architecture: a white box with no platform
 * columns, the station name in dark red along the wall, and a dense field of
 * suspended tubes instead of a continuous strip.
 */
export function createKvvStadtbahnStationProvider(): VvsStadtbahnStationProvider {
  return new VvsStadtbahnStationProvider(new VvsStationCatalog(kvvStadtbahnStations as never), {
    id: 'kvv-stadtbahn',
    platformHeightM: 0.34,
    ssbStreetFurniture: false
  });
}
