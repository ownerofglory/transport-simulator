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
};

// Appearance-only descriptors. Colors, finishes, and roof kind never determine
// where a platform goes.
export type StationArchitectureDefinition = {
  family?: string;
  roof?: 'none' | 'short-canopy' | 'full-canopy' | 'hall' | 'custom';
  wallFinish?: string;
  columnStyle?: string;
  accentColor?: string;
  customAsset?: string;
};

// Accessibility is topology, not decoration: recorded explicitly per stop.
export type StationAccessDefinition = {
  type: 'stairs' | 'ramp' | 'lift' | 'escalator' | 'crossing';
  side: 'left' | 'right' | 'center';
  offsetM: number;
  direction?: string;
};

export type StationFurnitureDefinition = {
  shelters?: number;
  benches?: number;
  ticketMachines?: number;
  dfiDisplays?: number;
  bins?: number;
  bicycleParking?: boolean;
};

export type StationEnvironmentDefinition = {
  retainingWall?: 'left' | 'right' | 'both';
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
