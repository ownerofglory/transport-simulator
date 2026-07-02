import type { VehicleKind } from '../../domain/transport';

// Blueprint kinds extend the domain VehicleKind with generic categories that
// don't yet have a dedicated domain kind (e.g. 'tram' currently reuses the
// 'stadtbahn' domain kind for guideway/physics purposes).
export type VehicleBlueprintKind = VehicleKind | 'tram';

export type VehicleMaterialConfig = {
  color: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  transparent?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
  texturePath?: string;
};

export type VehicleSectionConfig = {
  center: number;
  length: number;
  widthM?: number;
  heightM?: number;
  cab?: 'front' | 'rear' | null;
  bodyMaterial?: string;
  accentMaterial?: string;
  glassMaterial?: string;
  darkMaterial?: string;
  roofMaterial?: string;
};

export type VehicleDoorConfig = {
  section: number;
  side: 'left' | 'right' | 'both';
  z: number;
  widthM?: number;
  heightM?: number;
  material?: string;
  glassMaterial?: string;
  darkMaterial?: string;
};

export type VehicleWindowConfig = {
  section: number;
  side: 'left' | 'right' | 'both';
  z: number;
  widthM?: number;
  heightM?: number;
  material?: string;
};

export type VehicleGangwayConfig = {
  z: number;
  widthM?: number;
  heightM?: number;
  lengthM?: number;
  material?: string;
};

export type VehicleBogieConfig = {
  z: number;
  widthM?: number;
  lengthM?: number;
  material?: string;
};

export type VehiclePantographConfig = {
  x: number;
  y: number;
  z: number;
  material?: string;
};

export type VehicleRoofEquipmentConfig = {
  type: 'hvac' | 'box' | 'cable-box' | 'custom-box';
  x: number;
  y: number;
  z: number;
  widthM: number;
  heightM: number;
  lengthM: number;
  material?: string;
};

export type VehicleCouplerConfig = {
  end: 'front' | 'rear';
  material?: string;
};

export type VehicleDestinationDisplayConfig = {
  section: number;
  position: [number, number, number];
  rotationY?: number;
  widthM?: number;
  heightM?: number;
  background?: string;
  foreground?: string;
  text?: 'route-destination' | 'route-line' | string;
};

export type VehicleCameraAnchor = {
  section?: number;
  position: [number, number, number];
  lookAt?: [number, number, number];
};

export type VehicleInteriorConfig = {
  enabled?: boolean;
  seatMaterial?: string;
  floorMaterial?: string;
  wallMaterial?: string;
  poleMaterial?: string;
  autoSeats?: boolean;
  autoPoles?: boolean;
  autoPassengerShell?: boolean;
};

export type VehicleBlueprintConfig = {
  id: string;
  kind: VehicleBlueprintKind;
  displayName: string;

  dimensions: {
    lengthM: number;
    widthM: number;
    heightM: number;
    floorHeightM?: number;
  };

  materials: Record<string, VehicleMaterialConfig>;

  sections: VehicleSectionConfig[];
  doors?: VehicleDoorConfig[];
  windows?: VehicleWindowConfig[];
  gangways?: VehicleGangwayConfig[];
  bogies?: VehicleBogieConfig[];
  pantographs?: VehiclePantographConfig[];
  roofEquipment?: VehicleRoofEquipmentConfig[];
  couplers?: VehicleCouplerConfig[];
  destinationDisplays?: VehicleDestinationDisplayConfig[];
  interior?: VehicleInteriorConfig;

  formation?: {
    doubleFormationLines?: string[];
    singleHalfLengthM?: number;
    doubleHalfLengthM?: number;
    duplicateSetOffsetM?: number;
  };

  cameraAnchors?: {
    passenger?: VehicleCameraAnchor;
    cab?: VehicleCameraAnchor;
    chaseTargetOffsetM?: number;
  };
};
