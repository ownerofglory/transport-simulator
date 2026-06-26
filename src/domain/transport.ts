// City-specific transport mode id, kept as string so new cities can define custom modes.
export type TransportMode = string;

// Vehicle renderer family used by TransitWorld.
export type VehicleKind = 'stadtbahn' | 'bus' | 's-bahn' | 'zacke' | 'seilbahn' | 'ferry';

// Guideway/track behavior used for route rendering and lane offsets.
export type GuidewayKind = 'stadtbahn' | 'bus' | 's-bahn' | 'zacke' | 'seilbahn' | 'ferry';

// Interior camera placement profile; not always one-to-one with vehicle kind.
export type InteriorCameraProfile = 'rail' | 'bus' | 's-bahn' | 'tram';

// Per-city mode definition connecting UI labels to vehicle, guideway, and camera behavior.
export type TransportModeDefinition = {
  id: TransportMode;
  label: string;
  available: boolean;
  vehicleFamily: string;
  vehicleKind: VehicleKind;
  guidewayKind: GuidewayKind;
  interiorCameraProfile: InteriorCameraProfile;
  passengerOffsetM?: number; // route-forward offset for fallback passenger camera placement
  lineAccentColor?: string; // CSS/canvas color used for vehicle displays and route accents
};

// Default Stuttgart Stadtbahn behavior used when older route data has no transportMode.
export const fallbackTransportModeDefinition: TransportModeDefinition = {
  id: 'stadtbahn',
  label: 'Stadtbahn',
  available: true,
  vehicleFamily: 'Light rail vehicle',
  vehicleKind: 'stadtbahn',
  guidewayKind: 'stadtbahn',
  interiorCameraProfile: 'rail',
  passengerOffsetM: 4.2, // seated passenger camera offset in meters for rail fallback view
  lineAccentColor: '#ffd800' // SSB-like yellow accent
};

// Normalizes optional/legacy route mode values to a usable transport mode id.
export function routeTransportMode(value: string | undefined): TransportMode {
  return value?.trim() || fallbackTransportModeDefinition.id;
}

// Finds a city mode definition, falling back to a safe Stadtbahn-like definition with the requested id.
export function resolveTransportModeDefinition(
  mode: TransportMode,
  definitions: TransportModeDefinition[]
): TransportModeDefinition {
  return definitions.find((definition) => definition.id === mode) ?? {
    ...fallbackTransportModeDefinition,
    id: mode,
    label: mode
  };
}

// Returns the display label for a mode id.
export function transportModeLabel(mode: TransportMode, definitions: TransportModeDefinition[]): string {
  return resolveTransportModeDefinition(mode, definitions).label;
}
