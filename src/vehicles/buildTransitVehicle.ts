import { buildBusVehicle } from './blueprint/bus/buildBusFromBlueprint';
import { defaultBusBlueprint } from './blueprint/bus/defaultBusBlueprint';
import { buildSBahnVehicle } from './blueprint/sbahn/buildSBahnFromBlueprint';
import { defaultSBahnBlueprint } from './blueprint/sbahn/defaultSBahnBlueprint';
import {
  buildProceduralTransitVehicle,
  createKarlsruheCitylinkVehicle,
  createKarlsruheTramVehicle,
  createStadtbahnVehicle
} from './procedural';
import { VehicleRegistry } from './registry';
import type { ResolvedVehicleBuildContext, VehicleBuildContext, VehicleInstance } from './types';
import { resolveRouteVehicleDefinition, type VehicleDefinition } from './VehicleDefinition';
import { fallbackTransportModeDefinition, type TransportModeDefinition } from '../domain/transport';
import type { DemoRoute } from '../route';
import genericModernTram from './configs/generic-modern-tram.json';
import genericBus from './configs/generic-bus.json';
import stuttgartDt8Tango from './configs/stuttgart-dt8-tango.json';

// Default app-wide vehicle registry. Built-in kind builders delegate to the
// existing procedural factory (unchanged behavior); blueprint configs are
// registered by id so routes/modes can opt in via vehicleDesignId without
// touching the procedural code path.
export const vehicleRegistry = new VehicleRegistry();

for (const kind of ['stadtbahn', 'bus', 's-bahn', 'zacke', 'seilbahn', 'ferry', 'schwebebahn', 'skytrain'] as const) {
  vehicleRegistry.registerKindBuilder(kind, buildProceduralTransitVehicle);
}
vehicleRegistry.setFinalFallback(createStadtbahnVehicle);

// SkyTrain degrades to the S-Bahn design if its own builder is ever unregistered:
// both are wide, multi-car, standard-gauge metro stock on the same guideway.
vehicleRegistry.registerGenericKindBuilder('skytrain', (context) => buildSBahnVehicle(defaultSBahnBlueprint, context));

// The bus kind renders from a declarative bus blueprint (see blueprint/bus/).
// Registering the default config by id also lets routes/cities opt into it
// explicitly via vehicleDesignId, and gives custom bus configs a template.
vehicleRegistry.registerBuilder(defaultBusBlueprint.id, (context) => buildBusVehicle(defaultBusBlueprint, context));
vehicleRegistry.registerBuilder(defaultSBahnBlueprint.id, (context) => buildSBahnVehicle(defaultSBahnBlueprint, context));

// Karlsruhe runs two visually distinct cars on the same 'stadtbahn' vehicle kind,
// so each is registered by design id and selected via the mode's vehicleDesignId
// rather than by branching on (city, mode) inside the procedural dispatch.
vehicleRegistry.registerBuilder('karlsruhe-vbk-tram', createKarlsruheTramVehicle);
vehicleRegistry.registerBuilder('karlsruhe-avg-citylink', createKarlsruheCitylinkVehicle);

for (const rawConfig of [genericModernTram, genericBus, stuttgartDt8Tango]) {
  const result = vehicleRegistry.registerBlueprintFromJson(rawConfig);
  if (!result.ok) {
    // A broken built-in config should never crash the app at import time; surface it loudly instead.
    console.error(`Built-in vehicle blueprint "${(rawConfig as { id?: string }).id ?? 'unknown'}" failed validation:`, result.errors);
  }
}

// Minimal route/mode synthesized from a definition so the registry and existing
// builders (which still read route/modeDefinition) keep working when a caller
// supplies only a definition — e.g. the live follow vehicle, which no longer
// invents a fake DemoRoute of its own.
function synthesizeRoute(def: VehicleDefinition): DemoRoute {
  return {
    line: def.line,
    destination: def.destination,
    controlPoints: [],
    stations: [],
    vehicleDesignId: def.vehicleDesignId
  } as unknown as DemoRoute;
}

function synthesizeMode(def: VehicleDefinition): TransportModeDefinition {
  return {
    ...fallbackTransportModeDefinition,
    id: def.modeId,
    vehicleFamily: '',
    vehicleKind: def.vehicleKind,
    interiorCameraProfile: def.interiorCameraProfile,
    lineAccentColor: def.lineAccentColor,
    vehicleDesignId: def.vehicleDesignId
  };
}

// Normalizes either input form (new `definition`, or legacy route/city/mode) into
// one ResolvedVehicleBuildContext with a definition and populated route/mode.
export function resolveBuildContext(context: VehicleBuildContext): ResolvedVehicleBuildContext {
  const modeDefinition =
    context.modeDefinition ?? (context.definition ? synthesizeMode(context.definition) : { ...fallbackTransportModeDefinition });
  if (!context.route && !context.definition) {
    throw new Error('buildTransitVehicle requires a definition or a route.');
  }
  const route = context.route ?? synthesizeRoute(context.definition!);
  const definition = context.definition ?? resolveRouteVehicleDefinition(route, context.city, modeDefinition);
  return { definition, route, city: context.city, modeDefinition, makeInteriorDisplayMaterial: context.makeInteriorDisplayMaterial };
}

export function buildTransitVehicle(context: VehicleBuildContext): VehicleInstance {
  return vehicleRegistry.build(resolveBuildContext(context));
}
