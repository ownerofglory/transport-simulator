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
import { undergroundHallHalfLengthM } from '../../hallExtent';
import { createSeededRandom, hashString } from '../../variation';
import { VvsStationCatalog } from './VvsStationCatalog';
import { VvsStationMaterials } from './VvsStationMaterials';
import { buildVvsAccess } from './components/access';
import { buildVvsSidePlatforms, sidePlatformOffset } from './components/platform';
import { buildVvsUndergroundHall, buildVvsUndergroundSideLighting } from './components/undergroundHall';
import { buildVvsCanopy } from './components/canopy';
import { buildVvsFurniture } from './components/furniture';
import { buildVvsCenterPlatform, buildVvsIslandStation } from './components/island';
import { buildVvsDfiBoards, buildVvsRetainingWall } from './components/environment';
import {
  buildVvsStationSigns,
  buildVvsSuspendedDfi,
  buildVvsVitrines,
  buildVvsWayfinding
} from './components/signage';
import { buildVvsTerminusBuffer } from './components/terminus';

// Legacy single-item platform layout, used as the default so unlisted stops
// keep close to the original look (seeded counts still allow 1–2 benches).
const DEFAULT_SURFACE_PLATFORM = { layout: 'side', lengthM: 76, widthM: 8, heightM: 0.22, curved: true } as const;

// Clear height to the underside of an underground ceiling, matching the legacy
// box. Stops with a taller vault raise it through `architecture.hall.heightM`.
const DEFAULT_CEILING_HEIGHT_M = 5.46;

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
    // Underground stops always carry a suspended departure board and a couple of
    // ad cases; a bare box with neither never occurs on the network.
    const furniture = {
      shelters: override?.furniture?.shelters ?? 1,
      benches: override?.furniture?.benches ?? rng.int(1, 2),
      ticketMachines: override?.furniture?.ticketMachines ?? 1,
      dfiDisplays: override?.furniture?.dfiDisplays ?? (underground ? 2 : 0),
      bins: override?.furniture?.bins ?? rng.int(1, 2),
      bicycleParking: override?.furniture?.bicycleParking,
      adVitrines: override?.furniture?.adVitrines ?? (underground ? rng.int(2, 3) : 0)
    };

    return {
      stationId: station.name,
      displayName: override?.displayName ?? station.name,
      archetype,
      platform,
      architecture: override?.architecture,
      access: override?.access,
      signage: override?.signage,
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
    const accentColor = definition.architecture?.accentColor;
    const accent = materials.accent(accentColor);
    const layout = definition.platform?.layout;

    const scaffold = createStationScaffold(
      `${underground ? 'Underground' : 'Surface'} station ${station.name}`,
      placement
    );
    context.root.add(scaffold.root);

    // Island platforms are a distinct topology; everything else uses the paired
    // side-platform layout (surface or underground). Selected by explicit layout
    // or the surface-island archetype.
    if (!underground && (layout === 'island' || definition.archetype === 'surface-island')) {
      buildVvsIslandStation(
        scaffold.root,
        scaffold.local,
        context.layer,
        materials,
        station,
        definition.platform,
        canopyLengthM,
        counts,
        accent
      );
      return {
        root: scaffold.root,
        dispose: () => disposeStation(scaffold.root, materials.shared)
      };
    }

    // The hall has to be exactly as long as the gap the guideway layer cuts in
    // the tunnel bore, so its extent comes from the shared helper rather than
    // from this stop's own platform length.
    const hall = definition.architecture?.hall;
    const hallLengthM = undergroundHallHalfLengthM(context.layer.guidewayKind, station.name) * 2;
    const ceilingHeightM = hall?.heightM ?? DEFAULT_CEILING_HEIGHT_M;
    if (underground) {
      buildVvsUndergroundHall(scaffold.local, materials, {
        lengthM: hallLengthM,
        widthM: hall?.widthM,
        heightM: ceilingHeightM,
        ceiling: hall?.ceiling,
        ceilingColor: hall?.ceilingColor,
        trussColor: hall?.trussColor,
        wallFinish: definition.architecture?.walls?.finish,
        wallColor: definition.architecture?.walls?.color,
        plinthColor: definition.architecture?.walls?.plinthColor,
        stationName: definition.displayName,
        nameBandRepeatM: definition.signage?.nameBandRepeatM
      });
      if (definition.access?.length) {
        buildVvsAccess(scaffold.local, materials, definition.access, { ceilingHeightM });
      }
    }

    // Staggered stops offset the two side platforms along the route.
    const staggerM = definition.platform?.staggerM ?? 0;

    // Curved platforms follow the route in world space → untransformed root.
    buildVvsSidePlatforms(scaffold.root, context.layer, materials, station, definition.platform, staggerM, underground);
    // Mixed layouts (side + center) add a narrow island deck between the tracks.
    if (layout === 'mixed') {
      buildVvsCenterPlatform(scaffold.root, context.layer, materials, station, definition.platform);
    }

    const retainingWall = definition.environment?.retainingWall;
    const dfiDisplays = definition.furniture?.dfiDisplays ?? 0;

    // Appearance from architecture data: platform width shifts furniture/canopy
    // outward; roof kind sets canopy length; accent color tints fascia/posts.
    const platformLengthM = definition.platform?.lengthM ?? 76;
    const platformOffset = sidePlatformOffset(definition.platform?.widthM ?? 8);
    const lateral = platformOffset - 7.4;
    const roof = definition.architecture?.roof;
    // Interchanges default to a full canopy (unless the catalog says otherwise).
    const interchange = definition.archetype === 'surface-interchange';
    const fullCanopy = roof === 'full-canopy' || roof === 'hall' || (interchange && roof === undefined);
    const canopyLen = roof === 'none' ? 0 : fullCanopy ? Math.min(platformLengthM * 0.9, platformLengthM - 4) : canopyLengthM;
    const canopyCenterZ = fullCanopy ? 0 : 8;

    for (const side of [-1, 1]) {
      const zShift = side * (staggerM / 2);
      if (underground) {
        buildVvsUndergroundSideLighting(scaffold.local, materials, side, {
          lengthM: hallLengthM,
          heightM: ceilingHeightM,
          columnStyle: definition.architecture?.columns?.style,
          columnColor: definition.architecture?.columns?.color,
          columnSpacingM: definition.architecture?.columns?.spacingM,
          lighting: definition.architecture?.lighting?.style,
          lightColor: definition.architecture?.lighting?.color
        });
        buildVvsVitrines(scaffold.local, materials, side, definition.furniture?.adVitrines ?? 0, hallLengthM);
        if (dfiDisplays > 0) {
          buildVvsSuspendedDfi(
            scaffold.local,
            context.layer,
            materials,
            side,
            dfiDisplays,
            platformLengthM,
            ceilingHeightM,
            definition.signage?.platformNumber
          );
        }
      } else buildVvsCanopy(scaffold.local, materials, side, {
        lengthM: canopyLen,
        platformOffsetM: platformOffset,
        centerZ: canopyCenterZ + zShift,
        accent
      });
      buildVvsFurniture(scaffold.local, materials, side, underground, counts, lateral, zShift);
      buildVvsStationSigns(scaffold.local, context.layer, side, station, underground, lateral, zShift, accentColor);

      // Hillside/cutting stops carry a retaining wall behind the platform.
      if (!underground && (retainingWall === 'both' || (retainingWall === 'left' && side === -1) ||
        (retainingWall === 'right' && side === 1))) {
        buildVvsRetainingWall(scaffold.local, materials, side);
      }
      // Surface interchanges add post-mounted departure boards (side 1 only to
      // avoid doubling; count spreads them along the platform). Underground
      // stops use the suspended boards built above instead.
      if (!underground && dfiDisplays > 0 && side === 1) {
        buildVvsDfiBoards(scaffold.local, context.layer, materials, side, station, dfiDisplays, platformLengthM, lateral);
      }
    }

    // Terminus stops cap the outward track end (toward the nearer route end)
    // with buffer stops and an end wall.
    if (definition.archetype === 'terminus') {
      const endSign = placement.t >= 0.5 ? 1 : -1;
      buildVvsTerminusBuffer(scaffold.local, materials, platformLengthM, endSign);
    }

    if (underground) buildVvsWayfinding(scaffold.local, station, definition.signage?.exits);

    return {
      root: scaffold.root,
      dispose: () => disposeStation(scaffold.root, materials.shared)
    };
  }
}
