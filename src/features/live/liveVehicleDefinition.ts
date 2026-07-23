import type { CityDefinition } from '../../cities';
import type { VehicleKind } from '../../domain/transport';
import {
  defaultInteriorCameraProfile,
  defaultLineAccentColor,
  resolveFormation,
  type VehicleDefinition
} from '../../vehicles/VehicleDefinition';
import type { LiveMode, LiveVehicle } from './liveTypes';

// Maps a live traffic mode to a vehicle kind. Light-rail/tram share the Stadtbahn
// body; s-bahn/rail share the S-Bahn body.
function liveModeToKind(mode: LiveMode | undefined): VehicleKind {
  if (mode === 'bus') return 'bus';
  if (mode === 's-bahn' || mode === 'rail') return 's-bahn';
  return 'stadtbahn';
}

/**
 * Resolves a live vehicle into the same {@link VehicleDefinition} the simulator's
 * route resolver produces for the equivalent vehicle. It reads the vehicle's kind's
 * mode from the city so design id, interior-camera profile and accent match the
 * simulator; only when no city is available does it fall back to per-kind defaults.
 */
export function resolveLiveVehicleDefinition(vehicle: LiveVehicle, city: CityDefinition | undefined): VehicleDefinition {
  const kind = liveModeToKind(vehicle.mode);
  const mode = city?.transportModes.find((m) => m.vehicleKind === kind);
  const line = vehicle.line ?? '';
  return {
    cityId: city?.id,
    modeId: mode?.id ?? kind,
    vehicleKind: kind,
    vehicleDesignId: city?.vehicleDesignId ?? mode?.vehicleDesignId,
    interiorCameraProfile: mode?.interiorCameraProfile ?? defaultInteriorCameraProfile(kind),
    line,
    destination: vehicle.direction ?? '',
    lineAccentColor: mode?.lineAccentColor ?? defaultLineAccentColor(kind),
    formation: resolveFormation(kind, line, city?.id)
  };
}
