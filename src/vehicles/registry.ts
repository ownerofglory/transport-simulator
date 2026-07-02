import type { VehicleKind } from '../domain/transport';
import type { VehicleBlueprintConfig } from './blueprint/VehicleBlueprintConfig';
import { buildVehicleFromBlueprint } from './blueprint/buildVehicleFromBlueprint';
import { validateVehicleBlueprint } from './blueprint/validateVehicleBlueprint';
import type { VehicleBuildContext, VehicleInstance } from './types';

export type VehicleBuilder = (context: VehicleBuildContext) => VehicleInstance;

export type VehicleBlueprintRegistrationResult =
  | { ok: true; id: string; warnings: string[] }
  | { ok: false; errors: string[] };

// Resolution order (highest priority first):
//   1. Explicit vehicleDesignId from route/city/mode config.
//   2. modeDefinition.vehicleFamily, matched against a registered id.
//   3. modeDefinition.vehicleKind, matched against a built-in kind builder.
//   4. A registered generic blueprint fallback for that kind.
//   5. The final fallback builder (defaults to the Stuttgart Stadtbahn builder).
export class VehicleRegistry {
  private readonly buildersById = new Map<string, VehicleBuilder>();
  private readonly buildersByKind = new Map<VehicleKind, VehicleBuilder>();
  private readonly genericBuildersByKind = new Map<string, VehicleBuilder>();
  private finalFallbackBuilder: VehicleBuilder | null = null;

  registerBuilder(id: string, builder: VehicleBuilder): void {
    this.buildersById.set(id, builder);
  }

  registerKindBuilder(kind: VehicleKind, builder: VehicleBuilder): void {
    this.buildersByKind.set(kind, builder);
  }

  registerGenericKindBuilder(kind: string, builder: VehicleBuilder): void {
    this.genericBuildersByKind.set(kind, builder);
  }

  setFinalFallback(builder: VehicleBuilder): void {
    this.finalFallbackBuilder = builder;
  }

  registerBlueprint(config: VehicleBlueprintConfig): void {
    this.registerBuilder(config.id, (context) => buildVehicleFromBlueprint(config, context));
  }

  // Parses and validates an untrusted (e.g. user-uploaded) config before registering it.
  // Never throws: a malformed config is reported back as errors instead of crashing the app.
  registerBlueprintFromJson(raw: unknown): VehicleBlueprintRegistrationResult {
    try {
      const result = validateVehicleBlueprint(raw);
      if (!result.valid) return { ok: false, errors: result.errors };
      this.registerBlueprint(result.config);
      return { ok: true, id: result.config.id, warnings: result.warnings };
    } catch (error) {
      return { ok: false, errors: [`Unexpected error while loading vehicle blueprint: ${String(error)}`] };
    }
  }

  resolve(context: VehicleBuildContext): VehicleBuilder {
    const explicitId = context.route.vehicleDesignId ?? context.city?.vehicleDesignId ?? context.modeDefinition?.vehicleDesignId;
    if (explicitId) {
      const builder = this.buildersById.get(explicitId);
      if (builder) return builder;
    }

    const family = context.modeDefinition?.vehicleFamily;
    if (family) {
      const builder = this.buildersById.get(family);
      if (builder) return builder;
    }

    const kind = context.modeDefinition?.vehicleKind ?? 'stadtbahn';
    const kindBuilder = this.buildersByKind.get(kind);
    if (kindBuilder) return kindBuilder;

    const genericBuilder = this.genericBuildersByKind.get(kind);
    if (genericBuilder) return genericBuilder;

    if (this.finalFallbackBuilder) return this.finalFallbackBuilder;
    throw new Error('VehicleRegistry has no final fallback builder registered.');
  }

  build(context: VehicleBuildContext): VehicleInstance {
    return this.resolve(context)(context);
  }
}
