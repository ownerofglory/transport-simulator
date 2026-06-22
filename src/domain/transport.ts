export type TransportMode = string;

export type VehicleKind = 'stadtbahn' | 'bus' | 's-bahn' | 'zacke' | 'seilbahn';
export type GuidewayKind = 'stadtbahn' | 'bus' | 's-bahn' | 'zacke' | 'seilbahn';
export type InteriorCameraProfile = 'rail' | 'bus' | 's-bahn' | 'tram';

export type TransportModeDefinition = {
  id: TransportMode;
  label: string;
  available: boolean;
  vehicleFamily: string;
  vehicleKind: VehicleKind;
  guidewayKind: GuidewayKind;
  interiorCameraProfile: InteriorCameraProfile;
  passengerOffsetM?: number;
  lineAccentColor?: string;
};

export const fallbackTransportModeDefinition: TransportModeDefinition = {
  id: 'stadtbahn',
  label: 'Stadtbahn',
  available: true,
  vehicleFamily: 'Light rail vehicle',
  vehicleKind: 'stadtbahn',
  guidewayKind: 'stadtbahn',
  interiorCameraProfile: 'rail',
  passengerOffsetM: 4.2,
  lineAccentColor: '#ffd800'
};

export function routeTransportMode(value: string | undefined): TransportMode {
  return value?.trim() || fallbackTransportModeDefinition.id;
}

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

export function transportModeLabel(mode: TransportMode, definitions: TransportModeDefinition[]): string {
  return resolveTransportModeDefinition(mode, definitions).label;
}
