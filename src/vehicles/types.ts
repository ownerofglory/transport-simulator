import * as THREE from 'three';
import type { CityDefinition } from '../cities';
import type { TransportModeDefinition } from '../domain/transport';
import type { DemoRoute } from '../route';

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
  trainHalfLengthM: number;
  /** Brightens head/tail lamps at night and dawn; dims them in daylight. */
  setExteriorLightsOn?: (on: boolean) => void;
  updateInteriorDisplay?: (nextStation: string, doorsOpen: boolean) => void;
  dispose?: () => void;
};

export type VehicleBuildContext = {
  route: DemoRoute;
  city?: CityDefinition;
  modeDefinition?: TransportModeDefinition;
  makeInteriorDisplayMaterial: () => THREE.MeshBasicMaterial;
};
