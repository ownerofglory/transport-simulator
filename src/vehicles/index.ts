import {
  buildProceduralTransitVehicle,
  createBusVehicle,
  createFerryVehicle,
  createSBahnVehicle,
  createSeilbahnVehicle,
  createStadtbahnVehicle,
  createTramVehicle,
  createZackeVehicle
} from './procedural';

export {
  // Registry-backed entry point: resolves vehicleDesignId / vehicleFamily / vehicleKind
  // to either a JSON blueprint or one of the procedural builders below.
  buildTransitVehicle,
  vehicleRegistry
} from './buildTransitVehicle';

export { VehicleRegistry } from './registry';
export type { VehicleBuilder, VehicleBlueprintRegistrationResult } from './registry';

// Individual procedural builders remain available for direct use and as the
// implementation backing the registry's built-in kind builders.
export {
  buildProceduralTransitVehicle,
  createBusVehicle,
  createFerryVehicle,
  createSBahnVehicle,
  createSeilbahnVehicle,
  createStadtbahnVehicle,
  createTramVehicle,
  createZackeVehicle
};

export type { VehicleBuildContext, VehicleInstance, VehicleTexturePaths, VehicleVisualConfig } from './types';

export type {
  VehicleBlueprintConfig,
  VehicleBlueprintKind,
  VehicleCameraAnchor,
  VehicleDestinationDisplayConfig,
  VehicleDoorConfig,
  VehicleGangwayConfig,
  VehicleInteriorConfig,
  VehicleMaterialConfig,
  VehiclePantographConfig,
  VehicleRoofEquipmentConfig,
  VehicleSectionConfig,
  VehicleWindowConfig
} from './blueprint/VehicleBlueprintConfig';
export { validateVehicleBlueprint } from './blueprint/validateVehicleBlueprint';
export type { VehicleBlueprintValidationResult } from './blueprint/validateVehicleBlueprint';
export { buildVehicleFromBlueprint } from './blueprint/buildVehicleFromBlueprint';
