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
import { createSeededRandom, hashString } from '../../variation';
import { VvsStationCatalog } from './VvsStationCatalog';
import { VvsStationMaterials } from './VvsStationMaterials';
import { buildVvsSidePlatforms } from './components/platform';
import { buildVvsUndergroundHall, buildVvsUndergroundSideLighting } from './components/undergroundHall';
import { buildVvsCanopy } from './components/canopy';
import { buildVvsFurniture } from './components/furniture';
import { buildVvsIslandStation } from './components/island';
import { buildVvsStationSigns, buildVvsWayfinding } from './components/signage';

// Legacy single-item platform layout, used as the default so unlisted stops
// keep close to the original look (seeded counts still allow 1–2 benches).
const DEFAULT_SURFACE_PLATFORM = { layout: 'side', lengthM: 76, widthM: 8, heightM: 0.22, curved: true } as const;

/**
 * SSB/VVS Stadtbahn station style. Resolves each stop into a semantic
 * definition (archetype + topology from the catalog, appearance filled from
 * seeded variation) and assembles it from shared, parameterized components.
 *
 * The palette is created lazily and reused across every stop in a route.
 */
export class VvsStadtbahnStationProvider implements StationStyleProvider {
  readonly id = 'vvs-stadtbahn';
  private materials: VvsStationMaterials | undefined;

  constructor(private readonly catalog = new VvsStationCatalog()) {}

  resolve(station: RouteStation, context: StationResolveContext): StationVisualDefinition {
    const underground = context.placement.underground;
    const override = this.catalog.get(station.name);
    const seed = override?.seed ?? hashString(`vvs:${station.name}`);
    const rng = createSeededRandom(seed);

    const archetype = override?.archetype ?? (underground ? 'underground-side' : 'surface-side');
    const platform = { ...DEFAULT_SURFACE_PLATFORM, ...override?.platform };

    // Appearance-only counts: catalog wins, else a small deterministic value.
    const furniture = {
      shelters: override?.furniture?.shelters ?? 1,
      benches: override?.furniture?.benches ?? rng.int(1, 2),
      ticketMachines: override?.furniture?.ticketMachines ?? 1,
      dfiDisplays: override?.furniture?.dfiDisplays ?? 0,
      bins: override?.furniture?.bins ?? rng.int(1, 2),
      bicycleParking: override?.furniture?.bicycleParking
    };

    return {
      stationId: station.name,
      displayName: override?.displayName ?? station.name,
      archetype,
      platform,
      architecture: override?.architecture,
      environment: override?.environment,
      furniture,
      seed
    };
  }

  build(
    definition: StationVisualDefinition,
    placement: StationPlacement,
    context: StationBuildContext
  ): StationInstance {
    const materials = (this.materials ??= new VvsStationMaterials());
    const { station, underground } = placement;
    const rng = createSeededRandom(definition.seed ?? hashString(`vvs:${station.name}`));
    // Canopy length varies within a tight band so surface stops read as related
    // but not identical. Never affects platform length or track geometry.
    const canopyLengthM = 22 + rng.next() * 5;
    const furniture = definition.furniture ?? {};
    const counts = {
      benches: furniture.benches ?? 1,
      ticketMachines: furniture.ticketMachines ?? 1,
      bins: furniture.bins ?? 1
    };

    const scaffold = createStationScaffold(
      `${underground ? 'Underground' : 'Surface'} station ${station.name}`,
      placement
    );
    context.root.add(scaffold.root);

    // Surface island platforms are a distinct topology; everything else uses the
    // paired side-platform layout (surface or underground).
    if (!underground && definition.archetype === 'surface-island') {
      buildVvsIslandStation(
        scaffold.root,
        scaffold.local,
        context.layer,
        materials,
        station,
        definition.platform,
        canopyLengthM,
        counts
      );
      return {
        root: scaffold.root,
        dispose: () => disposeStation(scaffold.root, materials.shared)
      };
    }

    if (underground) buildVvsUndergroundHall(scaffold.local, materials);

    // Curved platforms follow the route in world space → untransformed root.
    buildVvsSidePlatforms(scaffold.root, context.layer, materials, station, definition.platform);

    for (const side of [-1, 1]) {
      if (underground) buildVvsUndergroundSideLighting(scaffold.local, materials, side);
      else buildVvsCanopy(scaffold.local, materials, side, canopyLengthM);
      buildVvsFurniture(scaffold.local, materials, side, underground, counts);
      buildVvsStationSigns(scaffold.local, context.layer, side, station, underground);
    }

    if (underground) buildVvsWayfinding(scaffold.local, station);

    return {
      root: scaffold.root,
      dispose: () => disposeStation(scaffold.root, materials.shared)
    };
  }
}
