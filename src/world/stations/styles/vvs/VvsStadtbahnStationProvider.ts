import { createStationScaffold, disposeStation } from '../../StationFactory';
import type {
  RouteStation,
  StationBuildContext,
  StationInstance,
  StationPlacement,
  StationResolveContext,
  StationStyleProvider,
  StationVisualDefinition
} from '../../types';
import { VvsStationMaterials } from './VvsStationMaterials';
import { buildVvsSidePlatforms } from './components/platform';
import { buildVvsUndergroundHall, buildVvsUndergroundSideLighting } from './components/undergroundHall';
import { buildVvsCanopy } from './components/canopy';
import { buildVvsFurniture } from './components/furniture';
import { buildVvsStationSigns, buildVvsWayfinding } from './components/signage';

/**
 * SSB/VVS Stadtbahn station style. Assembles the current Stuttgart surface and
 * underground stops from shared, parameterized components. This is a faithful
 * modularization of the legacy StationLayer.buildRailStations: same materials,
 * dimensions, placement, and station markers, now split so future archetypes
 * and per-station data can vary appearance without touching StationLayer.
 *
 * The palette is created lazily and reused across every stop in a route, so all
 * stations share GPU materials as the legacy builder did.
 */
export class VvsStadtbahnStationProvider implements StationStyleProvider {
  readonly id = 'vvs-stadtbahn';
  private materials: VvsStationMaterials | undefined;

  resolve(station: RouteStation, context: StationResolveContext): StationVisualDefinition {
    const underground = context.placement.underground;
    return {
      stationId: station.name,
      displayName: station.name,
      archetype: underground ? 'underground-side' : 'surface-side',
      platform: { layout: 'side', lengthM: 76, widthM: 8, heightM: 0.22, curved: true }
    };
  }

  build(
    _definition: StationVisualDefinition,
    placement: StationPlacement,
    context: StationBuildContext
  ): StationInstance {
    const materials = (this.materials ??= new VvsStationMaterials());
    const { station, underground } = placement;

    const scaffold = createStationScaffold(
      `${underground ? 'Underground' : 'Surface'} station ${station.name}`,
      placement
    );
    context.root.add(scaffold.root);

    if (underground) buildVvsUndergroundHall(scaffold.local, materials);

    // Curved platforms follow the route in world space → untransformed root.
    buildVvsSidePlatforms(scaffold.root, context.layer, materials, station);

    for (const side of [-1, 1]) {
      if (underground) buildVvsUndergroundSideLighting(scaffold.local, materials, side);
      else buildVvsCanopy(scaffold.local, materials, side);
      buildVvsFurniture(scaffold.local, materials, side, underground);
      buildVvsStationSigns(scaffold.local, context.layer, side, station, underground);
    }

    if (underground) buildVvsWayfinding(scaffold.local, station);

    return {
      root: scaffold.root,
      dispose: () => disposeStation(scaffold.root, materials.shared)
    };
  }
}
