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

export type VehicleBuildContext = {
  train: THREE.Group;
  route: DemoRoute;
  city?: CityDefinition;
  modeDefinition?: TransportModeDefinition;
  trainCars: THREE.Group[];
  vehicleWindowBands: THREE.Mesh[];
  vehicleCabShells: THREE.Mesh[];
  vehiclePassengerShells: THREE.Mesh[];
  vehicleCabDisplays: THREE.Mesh[];
  vehicleDoorLeaves: VehicleDoorLeaf[];
  makeInteriorDisplayMaterial: () => THREE.MeshBasicMaterial;
  setVehicleGlassMaterial: (material: THREE.MeshStandardMaterial | null) => void;
  setTrainHalfLengthM: (length: number) => void;
};
