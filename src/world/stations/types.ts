import type * as THREE from 'three';
import type { StationConfig } from '../../simulator/simulator-types';
import type { WorldLayerContext } from '../layers/WorldLayerContext';

/**
 * Data-driven station kit types.
 *
 * The station visual system separates station *topology* (where platforms and
 * tracks go) from station *appearance* (canopies, walls, colors, furniture).
 * A city/mode selects a {@link StationStyleProvider} by `stationStyleId`; the
 * provider resolves each route stop into a {@link StationVisualDefinition} and
 * builds it from shared, parameterized components.
 *
 * These types are intentionally rendering-agnostic data: no Three.js geometry
 * lives here, only the description a provider needs to build a stop.
 */

// One route stop as seen by the station system. Route packages currently only
// carry name/distance/schedule; providers invent the rest from archetypes.
export type RouteStation = StationConfig;

// Coarse station family. Drives which archetype builder a provider selects and
// how much furniture/architecture a stop gets. Not every value is implemented
// by every provider; unknown archetypes fall back to the provider default.
export type StationArchetype =
  | 'surface-side'
  | 'surface-island'
  | 'surface-staggered'
  | 'surface-interchange'
  | 'cutting'
  | 'underground-side'
  | 'underground-island'
  | 'underground-interchange'
  | 'terminus'
  | 'landmark';

// Platform topology: layout and dimensions. Must not be randomized — this is
// real infrastructure, not decoration.
export type StationPlatformDefinition = {
  layout: 'side' | 'island' | 'mixed';
  lengthM: number;
  widthM: number;
  trackOffsetsM?: number[];
  platformOffsetsM?: number[];
  heightM: number;
  curved?: boolean;
  staggerM?: number;
  surfaceFinish?: StationSurfaceFinish;
};

// How an underground hall is roofed. Stuttgart's boxes are visibly different
// from each other: plain slabs, longitudinal coffers, dark ribbed metal decks,
// and Rotebühlplatz's pitched roof on exposed steel trusses.
export type StationCeilingStyle = 'flat-slab' | 'coffered' | 'ribbed-metal' | 'trussed-vault';

// Wall build-up. `enamel-panel` and `tile` add a coloured cladding field with a
// dark plinth; `concrete` leaves the structural wall bare (the legacy look).
export type StationWallFinish = 'concrete' | 'enamel-panel' | 'tile';

export type StationColumnStyle = 'none' | 'square' | 'round';

// Platform lighting: short segments (legacy), one continuous strip per side, or
// recessed rows set into the ceiling.
export type StationLightingStyle = 'strip-segments' | 'strip-continuous' | 'recessed-rows';

// Underground box shell. Length is not configurable here: it has to agree with
// the tunnel cut, so it comes from `undergroundHallHalfLengthM`.
export type StationHallDefinition = {
  widthM?: number;
  heightM?: number;
  ceiling?: StationCeilingStyle;
  ceilingColor?: string;
  trussColor?: string;
};

export type StationWallsDefinition = {
  finish?: StationWallFinish;
  color?: string; // station identity colour of the cladding field
  plinthColor?: string;
  bandColor?: string; // frieze band the station name sits in
};

export type StationColumnsDefinition = {
  style?: StationColumnStyle;
  color?: string;
  spacingM?: number;
};

// Surface canopy form. `flat-slab` is the common thin white deck on slender
// posts; `butterfly` is the cantilevered spine roof; `curved-shell` the
// translucent barrel used on the newer stops.
export type StationCanopyStyle = 'flat-slab' | 'butterfly' | 'curved-shell';

export type StationCanopyDefinition = {
  style?: StationCanopyStyle;
  fasciaColor?: string;
  postColor?: string;
  // Stops print the stop name along the canopy fascia rather than only on
  // separate sign plates.
  nameOnFascia?: boolean;
};

// Deck finish of a surface platform. Stuttgart lays most of its stops in block
// paving with a contrasting edge band rather than plain slab.
export type StationSurfaceFinish = 'slab' | 'block-paving' | 'asphalt';

export type StationLightingDefinition = {
  style?: StationLightingStyle;
  color?: string;
};

// Appearance-only descriptors. Colors, finishes, and roof kind never determine
// where a platform goes.
export type StationArchitectureDefinition = {
  family?: string;
  roof?: 'none' | 'short-canopy' | 'full-canopy' | 'hall' | 'custom';
  hall?: StationHallDefinition;
  walls?: StationWallsDefinition;
  columns?: StationColumnsDefinition;
  lighting?: StationLightingDefinition;
  canopy?: StationCanopyDefinition;
  accentColor?: string;
  customAsset?: string;
};

// Accessibility is topology, not decoration: recorded explicitly per stop.
// `offsetM` is along-route from the stop centre, `side` selects the platform.
export type StationAccessDefinition = {
  type: 'stairs' | 'ramp' | 'lift' | 'escalator' | 'crossing';
  side: 'left' | 'right' | 'center';
  offsetM: number;
  direction?: string;
  // Escalator/stair runs default to a flight from platform to street soffit;
  // widthM covers a doubled-up bank (Stadtmitte has three side by side).
  widthM?: number;
};

// Wayfinding content. Exit street names are real infrastructure, so they are
// authored rather than invented; the rest is signage the stop actually carries.
export type StationSignageDefinition = {
  exits?: string[];
  platformNumber?: string;
  // Repeat distance of the name frieze along an underground wall.
  nameBandRepeatM?: number;
  // The blue "U Stadtbahn" totem mast that marks a surface stop from the
  // street. Defaults on for surface stops; set false where the stop has none.
  totem?: boolean;
  // Lines called at the stop, listed on the totem under the station name.
  lines?: string[];
};

export type StationFurnitureDefinition = {
  shelters?: number;
  benches?: number;
  ticketMachines?: number;
  dfiDisplays?: number;
  bins?: number;
  bicycleParking?: boolean;
  // Backlit advertising cases; wall-mounted underground, freestanding outside.
  adVitrines?: number;
  // Orange SSB information/ticket kiosk found at the busier surface stops.
  infoKiosk?: boolean;
  // Lamp columns along the platform; 0 leaves the stop lit only by its canopy.
  lampColumns?: number;
};

export type StationEnvironmentDefinition = {
  retainingWall?: 'left' | 'right' | 'both';
  // Outer edge treatment. Viaduct and bridge stops are closed by a solid
  // parapet; everything else gets the usual tubular railing.
  edgeParapet?: 'railing' | 'wall';
  roadCrossing?: boolean;
  plaza?: boolean;
  vegetation?: 'none' | 'urban' | 'suburban' | 'wooded';
};

// The full resolved description of a single stop's appearance and topology.
export type StationVisualDefinition = {
  stationId: string;
  displayName: string;
  archetype: StationArchetype;
  platform: StationPlatformDefinition;
  architecture?: StationArchitectureDefinition;
  access?: StationAccessDefinition[];
  signage?: StationSignageDefinition;
  furniture?: StationFurnitureDefinition;
  environment?: StationEnvironmentDefinition;
  // Deterministic seed for controlled procedural variation of appearance-only
  // details (canopy length, bench count, poster content, ...). Never used to
  // vary topology, accessibility, or track geometry.
  seed?: number;
};

// Where a stop sits along the route curve, resolved once from route geometry
// and shared by every component that builds the stop. Underground/tangent/yaw
// come from the same helpers the legacy StationLayer used, so placement is
// identical to the previous per-guideway builders.
export type StationPlacement = {
  station: RouteStation;
  index: number;
  t: number;
  center: THREE.Vector3;
  tangent: THREE.Vector3;
  yaw: number;
  underground: boolean;
};

// Inputs available while turning a route stop into a visual definition.
export type StationResolveContext = {
  layer: WorldLayerContext;
  placement: StationPlacement;
};

// Shared build state passed to every station build. Materials and the scene
// root are created once per route so stops reuse GPU resources, matching the
// legacy builders which allocated materials once outside the station loop.
export type StationBuildContext = {
  layer: WorldLayerContext;
  // StationLayer.root; provider adds each stop's group here.
  root: THREE.Group;
};

// A built stop with a single owning group and disposal, so StationLayer can
// treat every style uniformly.
export type StationInstance = {
  root: THREE.Group;
  dispose: () => void;
};

/**
 * Resolves route stops into visual definitions and builds them. One provider
 * per city/mode station style (e.g. `vvs-stadtbahn`, `db-sbahn`). Providers own
 * their component kit; StationLayer only coordinates.
 */
export interface StationStyleProvider {
  readonly id: string;
  resolve(station: RouteStation, context: StationResolveContext): StationVisualDefinition;
  build(
    definition: StationVisualDefinition,
    placement: StationPlacement,
    context: StationBuildContext
  ): StationInstance;
}
