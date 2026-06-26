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
  buildProceduralTransitVehicle as buildTransitVehicle,
  createBusVehicle,
  createFerryVehicle,
  createSBahnVehicle,
  createSeilbahnVehicle,
  createStadtbahnVehicle,
  createTramVehicle,
  createZackeVehicle
};

export type { VehicleBuildContext, VehicleInstance, VehicleTexturePaths, VehicleVisualConfig } from './types';
