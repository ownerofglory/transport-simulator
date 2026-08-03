import type { TransportModeDefinition } from '../domain/transport';
import type { CityDefinition } from './types';

// Vancouver runs one rapid transit system: TransLink's driverless SkyTrain.
// The guideway reuses the shared s-bahn track behaviour (standard gauge, wide
// track spacing); only the vehicle renderer is SkyTrain-specific.
const vancouverTransportModes: TransportModeDefinition[] = [
  {
    id: 'skytrain',
    label: 'SkyTrain',
    available: true,
    vehicleFamily: 'TransLink SkyTrain Mark III',
    vehicleKind: 'skytrain',
    guidewayKind: 's-bahn',
    interiorCameraProfile: 's-bahn',
    passengerOffsetM: 3.4, // seated passenger camera offset for the fallback view
    lineAccentColor: '#0033a0' // Expo Line blue, the network's house colour
  }
];

export const vancouverCity: CityDefinition = {
  id: 'vancouver',
  name: 'Vancouver',
  title: 'Vancouver SkyTrain Simulator',
  shortLabel: 'Vancouver',
  menuTitle: 'Vancouver SkyTrain Simulator',
  description: 'Free, non-commercial simulator for the TransLink SkyTrain network.',
  manifestFile: '/data/vancouver/route-manifest.json',
  defaultTransportMode: 'skytrain',
  noticeNetworkName: 'TransLink SkyTrain',
  freeRideNotice: 'Free non-commercial simulator.',
  transportModes: vancouverTransportModes,
  routeManifestFallback: {
    generatedAt: '2026-08-03T00:00:00.000Z',
    sourceUrl: 'https://gtfs-static.translink.ca/gtfs/google_transit.zip',
    license: 'TransLink Open API terms; static GTFS reused for simulator use.',
    attribution: 'Contains TransLink SkyTrain route data derived from the official TransLink GTFS feed.',
    modes: [
      {
        mode: 'skytrain',
        file: '/data/vancouver/routes-skytrain.json',
        routeCount: 14,
        lines: ['Canada', 'Expo', 'Millennium']
      }
    ]
  },
  // No hard-coded demo fallback routes for Vancouver; use generated route packages.
  demoRoutesFallback: [],
  defaultLineByMode: {
    skytrain: 'Expo'
  }
};
