import { StationStyleRegistry } from './StationStyleRegistry';
import { VvsStadtbahnStationProvider } from './styles/vvs/VvsStadtbahnStationProvider';
import { createDbSBahnStationProvider } from './styles/db/DbSBahnStationProvider';

export * from './types';
export { StationStyleRegistry } from './StationStyleRegistry';
export { orientAlongRoute, resolveStationPlacement } from './placement';

/**
 * Registry of the station styles known to the app. Cities/modes select one via
 * `stationStyleId`; unmatched styles fall back to the legacy per-guideway
 * builders in StationLayer.
 */
export function createStationStyleRegistry(): StationStyleRegistry {
  return new StationStyleRegistry()
    .register(new VvsStadtbahnStationProvider())
    .register(createDbSBahnStationProvider());
}
