import type { CityDefinition } from '../cities';
import type { TransportModeDefinition } from '../domain/transport';
import type { DemoRoute } from '../route';
import { buildTransitVehicle } from './buildTransitVehicle';
import type { VehicleDefinition } from './VehicleDefinition';
import { VehicleInteriorDisplay } from './VehicleInteriorDisplay';
import { VehicleVisualController } from './VehicleVisualController';

// Legacy route/city/mode still forwarded to the builders during migration (e.g. a
// funicular reads route.controlPoints for its uphill orientation). Live callers
// pass none of these.
export type VehicleBuildCompat = {
  route?: DemoRoute;
  city?: CityDefinition;
  modeDefinition?: TransportModeDefinition;
};

// Builds the complete presentation for a vehicle from its definition: the mesh
// instance, its shared interior display, and the VehicleVisualController that owns
// them. The simulator and the live follow both go through this one factory so a
// given definition always yields the same interactive model.
export class VehicleVisualFactory {
  create(definition: VehicleDefinition, compat: VehicleBuildCompat = {}): VehicleVisualController {
    const display = new VehicleInteriorDisplay();
    const instance = buildTransitVehicle({
      definition,
      route: compat.route,
      city: compat.city,
      modeDefinition: compat.modeDefinition,
      makeInteriorDisplayMaterial: () => display.material
    });
    const controller = new VehicleVisualController(instance, display, {
      line: definition.line,
      destination: definition.destination,
      lineAccentColor: definition.lineAccentColor,
      interiorCameraProfile: definition.interiorCameraProfile
    });
    controller.updateInteriorDisplay(definition.destination, false); // initial board, not blank
    return controller;
  }
}

export const vehicleVisualFactory = new VehicleVisualFactory();
