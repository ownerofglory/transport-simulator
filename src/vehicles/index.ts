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

// Declarative bus blueprint (config-driven Citaro family renderer).
export { buildBusVehicle } from './blueprint/bus/buildBusFromBlueprint';
export { defaultBusBlueprint } from './blueprint/bus/defaultBusBlueprint';
export { parseBusBlueprint } from './blueprint/bus/BusBlueprintConfig';
export type { BusBlueprintConfig, BusBlueprintParseResult, BusMaterialConfig, BusMaterialRole, BusSectionConfig } from './blueprint/bus/BusBlueprintConfig';

// Declarative S-Bahn blueprint (config-driven DB BR 430 family renderer).
export { buildSBahnVehicle } from './blueprint/sbahn/buildSBahnFromBlueprint';
export { defaultSBahnBlueprint } from './blueprint/sbahn/defaultSBahnBlueprint';
export { parseSBahnBlueprint } from './blueprint/sbahn/SBahnBlueprintConfig';
export type { SBahnBlueprintConfig, SBahnBlueprintParseResult, SBahnMaterialRole } from './blueprint/sbahn/SBahnBlueprintConfig';
