import { buildBusVehicle } from './blueprint/bus/buildBusFromBlueprint';
import { defaultBusBlueprint } from './blueprint/bus/defaultBusBlueprint';
import { buildSBahnVehicle } from './blueprint/sbahn/buildSBahnFromBlueprint';
import { defaultSBahnBlueprint } from './blueprint/sbahn/defaultSBahnBlueprint';
import { buildProceduralTransitVehicle, createStadtbahnVehicle } from './procedural';
import { VehicleRegistry } from './registry';
import type { VehicleBuildContext, VehicleInstance } from './types';
import genericModernTram from './configs/generic-modern-tram.json';
import genericBus from './configs/generic-bus.json';
import stuttgartDt8Tango from './configs/stuttgart-dt8-tango.json';

// Default app-wide vehicle registry. Built-in kind builders delegate to the
// existing procedural factory (unchanged behavior); blueprint configs are
// registered by id so routes/modes can opt in via vehicleDesignId without
// touching the procedural code path.
export const vehicleRegistry = new VehicleRegistry();

for (const kind of ['stadtbahn', 'bus', 's-bahn', 'zacke', 'seilbahn', 'ferry', 'schwebebahn'] as const) {
  vehicleRegistry.registerKindBuilder(kind, buildProceduralTransitVehicle);
}
vehicleRegistry.setFinalFallback(createStadtbahnVehicle);

// The bus kind renders from a declarative bus blueprint (see blueprint/bus/).
// Registering the default config by id also lets routes/cities opt into it
// explicitly via vehicleDesignId, and gives custom bus configs a template.
vehicleRegistry.registerBuilder(defaultBusBlueprint.id, (context) => buildBusVehicle(defaultBusBlueprint, context));
vehicleRegistry.registerBuilder(defaultSBahnBlueprint.id, (context) => buildSBahnVehicle(defaultSBahnBlueprint, context));

for (const rawConfig of [genericModernTram, genericBus, stuttgartDt8Tango]) {
  const result = vehicleRegistry.registerBlueprintFromJson(rawConfig);
  if (!result.ok) {
    // A broken built-in config should never crash the app at import time; surface it loudly instead.
    console.error(`Built-in vehicle blueprint "${(rawConfig as { id?: string }).id ?? 'unknown'}" failed validation:`, result.errors);
  }
}

export function buildTransitVehicle(context: VehicleBuildContext): VehicleInstance {
  return vehicleRegistry.build(context);
}
