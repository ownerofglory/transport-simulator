import type { CityDefinition } from '../cities';
import type { DemoRoute } from '../route';
import type { InteriorCameraProfile, TransportModeDefinition, VehicleKind } from '../domain/transport';
import { isStadtbahnDoubleFormation } from './procedural';
import { isBusLineArticulated } from './blueprint/bus/buildBusFromBlueprint';
import { defaultBusBlueprint } from './blueprint/bus/defaultBusBlueprint';

// The single description of *which* vehicle to build and how to label it, shared by
// the simulator and live follow. Both resolve to an equivalent definition for the
// same vehicle (e.g. a Stuttgart U12), so neither path can silently drift into a
// different model. Placement (route distance vs live along-track) is NOT here.
export type VehicleDefinition = {
  cityId?: string;
  modeId: string;

  vehicleKind: VehicleKind;
  vehicleDesignId?: string;
  interiorCameraProfile: InteriorCameraProfile;

  line: string;
  destination: string;
  lineAccentColor: string;

  formation?: {
    articulated?: boolean;
    doubleFormation?: boolean;
  };
};

/** SSB-yellow for most modes, DB-red for S-Bahn — the display accent fallback. */
export function defaultLineAccentColor(kind: VehicleKind): string {
  return kind === 's-bahn' ? '#e0202b' : '#ffd800';
}

/** Interior-camera profile fallback when no city mode is available to read it from. */
export function defaultInteriorCameraProfile(kind: VehicleKind): InteriorCameraProfile {
  if (kind === 'bus') return 'bus';
  if (kind === 's-bahn') return 's-bahn';
  return 'tram';
}

// Formation flags, computed the same way for both resolvers so a U12 is a double
// Stadtbahn and an X-bus is articulated regardless of which mode built it.
function resolveFormation(kind: VehicleKind, line: string, cityId: string | undefined): VehicleDefinition['formation'] {
  if (kind === 'stadtbahn') return { doubleFormation: isStadtbahnDoubleFormation(line) };
  if (kind === 'bus') return { articulated: isBusLineArticulated(defaultBusBlueprint, line, cityId) };
  return undefined;
}

/** Builds a definition from a simulator route + its city/mode configuration. */
export function resolveRouteVehicleDefinition(
  route: DemoRoute,
  city: CityDefinition | undefined,
  mode: TransportModeDefinition
): VehicleDefinition {
  const kind = mode.vehicleKind ?? 'stadtbahn';
  return {
    cityId: city?.id,
    modeId: mode.id,
    vehicleKind: kind,
    vehicleDesignId: route.vehicleDesignId ?? city?.vehicleDesignId ?? mode.vehicleDesignId,
    interiorCameraProfile: mode.interiorCameraProfile,
    line: route.line,
    destination: route.destination,
    lineAccentColor: mode.lineAccentColor ?? defaultLineAccentColor(kind),
    formation: resolveFormation(kind, route.line, city?.id)
  };
}

export { resolveFormation };
