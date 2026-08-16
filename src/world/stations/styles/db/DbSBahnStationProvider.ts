import { VvsStadtbahnStationProvider } from '../vvs/VvsStadtbahnStationProvider';
import { VvsStationCatalog } from '../vvs/VvsStationCatalog';
import dbSBahnStations from './configs/db-sbahn-stations.json';

/**
 * DB S-Bahn station style.
 *
 * The component kit under `styles/vvs/` is generic — platforms, halls, columns,
 * lighting, signage — and the network's identity lives in its catalog, so this
 * is the same builders driven by different data rather than a second copy of
 * them. What differs structurally is the boarding height (96 cm to the S-Bahn
 * floor, against the Stadtbahn's 80) and the absence of SSB street furniture:
 * a DB stop carries no blue U totem and no orange information kiosk.
 *
 * The Stammstrecke stations are one design in four colours — a long island in a
 * box, big round columns down the centre, and enamel track walls in the
 * station's own colour: Hauptbahnhof red, Stadtmitte green, Feuersee blue,
 * Schwabstraße yellow.
 */
export function createDbSBahnStationProvider(): VvsStadtbahnStationProvider {
  return new VvsStadtbahnStationProvider(new VvsStationCatalog(dbSBahnStations as never), {
    id: 'db-sbahn',
    platformHeightM: 0.96,
    ssbStreetFurniture: false
  });
}
