import * as THREE from 'three';
import type { CityDefinition } from '../cities';
import type { TransportModeDefinition } from '../domain/transport';
import type { DemoRoute } from '../route';
import type { VehicleDefinition } from './VehicleDefinition';

export type VehicleDoorLeaf = {
  group: THREE.Group;
  closedZ: number;
  direction: -1 | 1;
};

export type VehicleTexturePaths = {
  exterior?: string[];
  interior?: string[];
};

export type VehicleVisualConfig = {
  vehicleFamily: string;
  destinationText: string;
  lineAccentColor: string;
  texturePaths?: VehicleTexturePaths;
  interiorCameraAnchors?: {
    passenger?: [number, number, number];
    cab?: [number, number, number];
  };
};

export type VehicleInstance = {
  root: THREE.Group;
  cars: THREE.Group[];
  doors: VehicleDoorLeaf[];
  windowBands: THREE.Mesh[];
  cabShells: THREE.Mesh[];
  passengerShells: THREE.Mesh[];
  cabDisplays: THREE.Mesh[];
  glassMaterial?: THREE.MeshStandardMaterial;
  exteriorPaintMaterials?: THREE.MeshStandardMaterial[];
  trainHalfLengthM: number;
  /** Brightens head/tail lamps at night and dawn; dims them in daylight. */
  setExteriorLightsOn?: (on: boolean) => void;
  updateInteriorDisplay?: (nextStation: string, doorsOpen: boolean) => void;
  dispose?: () => void;
};

// What callers pass to buildTransitVehicle. The definition is the intended input;
// route/city/modeDefinition are temporary compatibility fields still accepted from
// existing call sites. buildTransitVehicle normalizes either form into a
// ResolvedVehicleBuildContext before the registry and builders run.
export type VehicleBuildContext = {
  definition?: VehicleDefinition;

  // Temporary compatibility fields.
  route?: DemoRoute;
  city?: CityDefinition;
  modeDefinition?: TransportModeDefinition;

  makeInteriorDisplayMaterial: () => THREE.MeshBasicMaterial;
};

// The normalized context the registry and builders actually consume: a definition
// is always present, and route/modeDefinition are always populated (synthesized
// from the definition when a caller only supplied one).
export type ResolvedVehicleBuildContext = {
  definition: VehicleDefinition;
  route: DemoRoute;
  city?: CityDefinition;
  modeDefinition: TransportModeDefinition;
  makeInteriorDisplayMaterial: () => THREE.MeshBasicMaterial;
};
