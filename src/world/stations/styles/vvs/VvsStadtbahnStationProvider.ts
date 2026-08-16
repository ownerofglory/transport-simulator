import * as THREE from 'three';
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
import {
  interTrackWalkwayWidthM,
  isIslandLayout,
  islandTrackSpreadM,
  vehicleHalfWidthM
} from '../../trackLayout';
import { createSeededRandom, hashString } from '../../variation';
import { VvsStationCatalog } from './VvsStationCatalog';
import { VvsStationMaterials } from './VvsStationMaterials';
import { buildVvsAccess } from './components/access';
import { DEFAULT_DECK_TOP_M, buildVvsSidePlatforms, sidePlatformOffset } from './components/platform';
import {
  buildVvsUndergroundColumnRow,
  buildVvsUndergroundHall,
  buildVvsUndergroundLighting,
  buildVvsUndergroundSideLighting
} from './components/undergroundHall';
import { buildVvsCanopy } from './components/canopy';
import { buildVvsFurniture } from './components/furniture';
import { buildVvsCenterPlatform, buildVvsIslandFittings, islandHalfWidthM } from './components/island';
import { buildVvsDfiBoards, buildVvsRetainingWall } from './components/environment';
import {
  buildVvsStationSigns,
  buildVvsSuspendedDfi,
  buildVvsVitrines,
  buildVvsWayfinding
} from './components/signage';
import {
  buildVvsEdgeParapet,
  buildVvsInfoKiosk,
  buildVvsLampColumns,
  buildVvsPlatformRailing,
  buildVvsSurfaceVitrines,
  buildVvsTotem
} from './components/surfaceFurniture';
import { buildVvsTerminusBuffer } from './components/terminus';

// Legacy single-item platform layout, used as the default so unlisted stops
// keep close to the original look (seeded counts still allow 1–2 benches).
const DEFAULT_SURFACE_PLATFORM = { layout: 'side', lengthM: 76, widthM: 8, heightM: 0.22, curved: true } as const;

// The Stadtbahn is a high-platform network: every stop, surface or underground,
// boards level from a 0.8 m deck — that is what the tram-to-Stadtbahn
// conversion was for. The low 0.22 m kerb above stays the default for the
// street-running tram networks that borrow this provider as their fallback, so
// the height is only raised when a mode selects a style by name.
const SSB_PLATFORM_HEIGHT_M = 0.8;

/**
 * What separates one network's use of this kit from another's. The components
 * are generic; only the identity, the boarding height, and whether the stops
 * carry SSB street furniture differ, so a second network (DB's S-Bahn) is a
 * different set of options over the same builders rather than a second copy.
 */
export type VvsStationStyleOptions = {
  id: string;
  platformHeightM: number;
  /** The blue U totem and the orange SSB kiosk are SSB kit; DB stops have neither. */
  ssbStreetFurniture: boolean;
};

const SSB_STYLE: VvsStationStyleOptions = {
  id: 'vvs-stadtbahn',
  platformHeightM: SSB_PLATFORM_HEIGHT_M,
  ssbStreetFurniture: true
};

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
  private materials: VvsStationMaterials | undefined;

  constructor(
    private readonly catalog = new VvsStationCatalog(),
    private readonly style: VvsStationStyleOptions = SSB_STYLE
  ) {}

  get id(): string {
    return this.style.id;
  }

  resolve(station: RouteStation, context: StationResolveContext): StationVisualDefinition {
    const underground = context.placement.underground;
    const override = this.catalog.get(station.name);
    const seed = override?.seed ?? hashString(`vvs:${station.name}`);
    const rng = createSeededRandom(seed);

    const archetype = override?.archetype ?? (underground ? 'underground-side' : 'surface-side');
    const styled = context.layer?.stationStyleId === this.style.id;
    const platform = {
      ...DEFAULT_SURFACE_PLATFORM,
      ...(styled ? { heightM: this.style.platformHeightM } : {}),
      ...override?.platform,
      // A stop can be marked as an island by either field; the layout is the one
      // switch the builders (and the world's track spread) read afterwards.
      ...(isIslandLayout(override?.platform, override?.archetype) ? { layout: 'island' as const } : {})
    };

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

    // Everything that stands *on* the platform rides this group, so raising the
    // deck raises the canopy, furniture, and signs with it. The components were
    // authored around the legacy tram kerb, so the group carries the difference.
    const deckTopM = definition.platform?.heightM ?? DEFAULT_DECK_TOP_M;
    const deck = new THREE.Group();
    deck.name = 'Platform deck fittings';
    deck.position.y = deckTopM - DEFAULT_DECK_TOP_M;
    scaffold.local.add(deck);

    // The hall has to be exactly as long as the gap the guideway layer cuts in
    // the tunnel bore, so its extent comes from the shared helper rather than
    // from this stop's own platform length.
    const hall = definition.architecture?.hall;
    const hallLengthM =
      undergroundHallHalfLengthM(context.layer.guidewayKind, station.name, context.layer.stationStyleId) * 2;
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
        mural: definition.architecture?.walls?.mural,
        stationName: definition.displayName,
        nameBandRepeatM: definition.signage?.nameBandRepeatM
      });
      if (definition.access?.length) {
        buildVvsAccess(scaffold.local, materials, definition.access, { ceilingHeightM, deckTopM });
      }
    }

    // Staggered stops offset the two side platforms along the route.
    const staggerM = definition.platform?.staggerM ?? 0;
    const island = layout === 'island';

    if (island) {
      // One deck between the tracks. The world has already pulled the tracks
      // apart around this stop by the same width, so the deck lands in the gap.
      buildVvsCenterPlatform(scaffold.root, context.layer, materials, station, definition.platform, underground);
    } else {
      // Curved platforms follow the route in world space → untransformed root.
      buildVvsSidePlatforms(scaffold.root, context.layer, materials, station, definition.platform, staggerM, underground);
      // Mixed layouts add the narrow walkway that fits between two normal
      // tracks — not a platform: at 4.2 m centres there is no room for one.
      if (layout === 'mixed') {
        buildVvsCenterPlatform(scaffold.root, context.layer, materials, station, {
          ...definition.platform,
          widthM: interTrackWalkwayWidthM(
            context.layer.oppositeLaneOffsetM,
            vehicleHalfWidthM(context.layer.guidewayKind)
          )
        }, underground);
      }
    }

    const retainingWall = definition.environment?.retainingWall;
    const dfiDisplays = definition.furniture?.dfiDisplays ?? 0;

    // Appearance from architecture data: platform width shifts furniture/canopy
    // outward; roof kind sets canopy length; accent color tints fascia/posts.
    const platformLengthM = definition.platform?.lengthM ?? 76;
    const platformOffset = sidePlatformOffset(definition.platform?.widthM ?? 8);
    const lateral = platformOffset - 7.4;
    const roof = definition.architecture?.roof;
    const canopy = definition.architecture?.canopy;
    // Interchanges default to a full canopy (unless the catalog says otherwise).
    const interchange = definition.archetype === 'surface-interchange';
    const fullCanopy = roof === 'full-canopy' || roof === 'hall' || (interchange && roof === undefined);
    const canopyLen = roof === 'none' ? 0 : fullCanopy ? Math.min(platformLengthM * 0.9, platformLengthM - 4) : canopyLengthM;
    const canopyCenterZ = fullCanopy ? 0 : 8;

    if (island) {
      this.buildIslandStation(scaffold.local, deck, context, materials, definition, station, {
        canopyLengthM: canopyLen,
        accent,
        underground,
        hallLengthM,
        ceilingHeightM,
        platformLengthM,
        dfiDisplays
      });
    } else for (const side of [-1, 1]) {
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
      } else buildVvsCanopy(deck, materials, side, {
        lengthM: canopyLen,
        platformOffsetM: platformOffset,
        centerZ: canopyCenterZ + zShift,
        accent,
        style: canopy?.style,
        postMaterial: canopy?.postColor ? materials.painted(canopy.postColor) : undefined,
        nameOnFascia: canopy?.nameOnFascia ? definition.displayName : undefined
      });
      buildVvsFurniture(deck, materials, side, underground, counts, lateral, zShift);
      buildVvsStationSigns(deck, context.layer, side, station, underground, lateral, zShift, accentColor);

      // Hillside/cutting stops carry a retaining wall behind the platform.
      if (!underground && (retainingWall === 'both' || (retainingWall === 'left' && side === -1) ||
        (retainingWall === 'right' && side === 1))) {
        buildVvsRetainingWall(scaffold.local, materials, side);
      }
      // Surface interchanges add post-mounted departure boards (side 1 only to
      // avoid doubling; count spreads them along the platform). Underground
      // stops use the suspended boards built above instead.
      if (!underground && dfiDisplays > 0 && side === 1) {
        buildVvsDfiBoards(deck, context.layer, materials, side, station, dfiDisplays, platformLengthM, lateral);
      }

      if (!underground) {
        this.buildSurfaceStreetFurniture(deck, context, materials, definition, side, platformLengthM, lateral);
      }
    }

    // Terminus stops cap the outward track end (toward the nearer route end)
    // with buffer stops and an end wall.
    if (definition.archetype === 'terminus') {
      const endSign = placement.t >= 0.5 ? 1 : -1;
      // An island terminus buffers on the spread tracks, not the normal pair.
      const baseOffsetM = Math.abs(context.layer.oppositeLaneOffsetM);
      const trackOffsetM = island
        ? baseOffsetM +
          islandTrackSpreadM(
            definition.platform?.widthM ?? 8,
            baseOffsetM,
            vehicleHalfWidthM(context.layer.guidewayKind)
          )
        : baseOffsetM;
      buildVvsTerminusBuffer(scaffold.local, materials, platformLengthM, endSign, trackOffsetM);
    }

    if (underground) buildVvsWayfinding(scaffold.local, station, definition.signage?.exits);

    return {
      root: scaffold.root,
      dispose: () => disposeStation(scaffold.root, materials.shared)
    };
  }

  /**
   * An island stop: one deck between the tracks. Nothing here is per-side —
   * there is a single platform — so the canopy, furniture, and signs are built
   * once, and the underground fittings that a side box hangs over each platform
   * (columns, lighting, departure boards) collapse onto the centre line.
   */
  private buildIslandStation(
    local: THREE.Group,
    deck: THREE.Group,
    context: StationBuildContext,
    materials: VvsStationMaterials,
    definition: StationVisualDefinition,
    station: RouteStation,
    options: {
      canopyLengthM: number;
      accent: THREE.Material;
      underground: boolean;
      hallLengthM: number;
      ceilingHeightM: number;
      platformLengthM: number;
      dfiDisplays: number;
    }
  ): void {
    const { underground, hallLengthM, ceilingHeightM } = options;
    const halfWidthM = islandHalfWidthM(definition.platform);
    const furniture = definition.furniture ?? {};

    if (underground) {
      // A single row of columns down the centre of the deck, and a light run
      // over each platform edge.
      buildVvsUndergroundColumnRow(local, materials, 0, {
        lengthM: hallLengthM,
        heightM: ceilingHeightM,
        columnStyle: definition.architecture?.columns?.style,
        columnColor: definition.architecture?.columns?.color,
        columnSpacingM: definition.architecture?.columns?.spacingM
      });
      for (const side of [-1, 1]) {
        buildVvsUndergroundLighting(local, materials, side * (halfWidthM - 0.9), {
          lengthM: hallLengthM,
          heightM: ceilingHeightM,
          lighting: definition.architecture?.lighting?.style,
          lightColor: definition.architecture?.lighting?.color
        });
        buildVvsVitrines(local, materials, side, furniture.adVitrines ?? 0, hallLengthM);
        if (options.dfiDisplays > 0) {
          buildVvsSuspendedDfi(
            local,
            context.layer,
            materials,
            side,
            options.dfiDisplays,
            options.platformLengthM,
            ceilingHeightM,
            definition.signage?.platformNumber,
            halfWidthM - 1.2
          );
        }
      }
    }

    if (!underground) {
      // A trough island is walled close in on both sides, not set back behind a
      // platform, so the wall follows the deck rather than the default lateral.
      const retainingWall = definition.environment?.retainingWall;
      for (const side of [-1, 1]) {
        if (retainingWall === 'both' || (retainingWall === 'left' && side === -1) || (retainingWall === 'right' && side === 1)) {
          buildVvsRetainingWall(local, materials, side, halfWidthM + 4.6);
        }
      }
      if (options.dfiDisplays > 0) {
        buildVvsDfiBoards(
          deck,
          context.layer,
          materials,
          1,
          station,
          options.dfiDisplays,
          options.platformLengthM,
          halfWidthM - 1.4 - 6.4
        );
      }
    }

    buildVvsIslandFittings(deck, context.layer, materials, station, {
      widthM: definition.platform?.widthM,
      lengthM: definition.platform?.lengthM,
      underground,
      canopyLengthM: options.canopyLengthM,
      canopyStyle: definition.architecture?.canopy?.style,
      counts: {
        benches: furniture.benches ?? 1,
        ticketMachines: furniture.ticketMachines ?? 1,
        bins: furniture.bins ?? 1
      },
      accent: options.accent,
      displayName: definition.displayName
    });

    // A surface island is still marked from the street by its totem; the rest of
    // the street kit (back railing, parapet) belongs to a platform with a back.
    if (!underground && this.style.ssbStreetFurniture && definition.signage?.totem !== false) {
      buildVvsTotem(
        deck,
        materials,
        1,
        { name: definition.displayName, distanceM: 0 },
        0,
        definition.signage?.lines,
        -18,
        halfWidthM - 1.1
      );
    }
  }

  /**
   * The street-level kit a Stuttgart surface stop carries: the blue U totem, the
   * back railing, lamp columns, poster cases, an info kiosk at the busier stops,
   * and a parapet where the platform sits on a viaduct rather than on ground.
   */
  private buildSurfaceStreetFurniture(
    deck: THREE.Group,
    context: StationBuildContext,
    materials: VvsStationMaterials,
    definition: StationVisualDefinition,
    side: number,
    platformLengthM: number,
    lateral: number
  ): void {
    const furniture = definition.furniture ?? {};
    const signage = definition.signage;

    if (this.style.ssbStreetFurniture && signage?.totem !== false) {
      buildVvsTotem(deck, materials, side, { name: definition.displayName, distanceM: 0 }, lateral, signage?.lines);
    }

    const parapet = definition.environment?.edgeParapet;
    if (parapet === 'wall') buildVvsEdgeParapet(deck, materials, side, platformLengthM, lateral);
    else buildVvsPlatformRailing(deck, materials, side, platformLengthM, lateral);

    buildVvsLampColumns(deck, materials, side, furniture.lampColumns ?? 2, platformLengthM, lateral);
    buildVvsSurfaceVitrines(deck, materials, side, furniture.adVitrines ?? 0, platformLengthM, lateral);
    // One kiosk per stop, on the same side as the departure boards.
    if (this.style.ssbStreetFurniture && furniture.infoKiosk && side === 1) {
      buildVvsInfoKiosk(deck, context.layer, materials, side, lateral);
    }
  }
}
