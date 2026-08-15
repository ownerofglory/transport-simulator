import type {
  StationAccessDefinition,
  StationArchetype,
  StationArchitectureDefinition,
  StationEnvironmentDefinition,
  StationFurnitureDefinition,
  StationPlatformDefinition,
  StationSignageDefinition
} from '../../types';
import catalogData from './configs/vvs-stadtbahn-stations.json';

/**
 * Optional per-station overrides, keyed by a stable station id (currently the
 * GTFS stop name the route feed carries). Only the fields a station actually
 * customizes need to be present; everything else falls back to archetype
 * defaults and seeded variation. Topology fields here are authoritative and are
 * never overridden by seeded variation.
 */
export type VvsStationOverride = {
  displayName?: string;
  archetype?: StationArchetype;
  platform?: Partial<StationPlatformDefinition>;
  architecture?: StationArchitectureDefinition;
  access?: StationAccessDefinition[];
  signage?: StationSignageDefinition;
  furniture?: StationFurnitureDefinition;
  environment?: StationEnvironmentDefinition;
  seed?: number;
};

type VvsStationCatalogFile = {
  schemaVersion: number;
  style: string;
  stations: Record<string, VvsStationOverride>;
};

/** Read-only lookup over the bundled VVS station catalog. */
export class VvsStationCatalog {
  private readonly stations: Record<string, VvsStationOverride>;

  constructor(file: VvsStationCatalogFile = catalogData as VvsStationCatalogFile) {
    this.stations = file.stations ?? {};
  }

  get(stationId: string): VvsStationOverride | undefined {
    return this.stations[stationId];
  }
}
