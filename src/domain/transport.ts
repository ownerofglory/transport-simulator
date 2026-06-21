export const transportModes = ['stadtbahn', 'bus', 's-bahn', 'zacke', 'seilbahn'] as const;

export type TransportMode = (typeof transportModes)[number];

export type TransportModeDefinition = {
  id: TransportMode;
  label: string;
  available: boolean;
  vehicleFamily: string;
};

export const transportModeDefinitions: TransportModeDefinition[] = [
  { id: 'stadtbahn', label: 'Stadtbahn', available: true, vehicleFamily: 'SSB DT8' },
  { id: 'bus', label: 'Bus', available: true, vehicleFamily: 'Mercedes-Benz city bus' },
  { id: 's-bahn', label: 'S-Bahn', available: true, vehicleFamily: 'DB class 423' },
  { id: 'zacke', label: 'Zacke', available: true, vehicleFamily: 'SSB S-ZT 4.2' },
  { id: 'seilbahn', label: 'Seilbahn', available: true, vehicleFamily: '1929 teak funicular car' }
];

export function routeTransportMode(value: string | undefined): TransportMode {
  return transportModes.includes(value as TransportMode) ? value as TransportMode : 'stadtbahn';
}

export function transportModeLabel(mode: TransportMode): string {
  return transportModeDefinitions.find((definition) => definition.id === mode)?.label ?? mode;
}
