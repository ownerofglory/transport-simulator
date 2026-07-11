import { createStuttgartLandmarks } from '../landmarks';
import { routePackages, type RouteFeedManifest } from '../route';
import type { TransportModeDefinition } from '../domain/transport';
import type { CityDefinition } from './types';

const stuttgartTransportModes: TransportModeDefinition[] = [
  {
    id: 'stadtbahn',
    label: 'Stadtbahn',
    available: true,
    vehicleFamily: 'SSB DT8 / Stadler Tango',
    vehicleKind: 'stadtbahn',
    guidewayKind: 'stadtbahn',
    interiorCameraProfile: 'rail',
    passengerOffsetM: 4.2,
    lineAccentColor: '#ffd800'
  },
  {
    id: 'bus',
    label: 'Bus',
    available: true,
    vehicleFamily: 'Mercedes-Benz city bus',
    vehicleKind: 'bus',
    guidewayKind: 'bus',
    interiorCameraProfile: 'bus',
    lineAccentColor: '#ffd800'
  },
  {
    id: 's-bahn',
    label: 'S-Bahn',
    available: true,
    vehicleFamily: 'DB class 430',
    vehicleKind: 's-bahn',
    guidewayKind: 's-bahn',
    interiorCameraProfile: 's-bahn',
    lineAccentColor: '#e0202b'
  },
  {
    id: 'zacke',
    label: 'Zacke',
    available: true,
    vehicleFamily: 'SSB S-ZT 4.2',
    vehicleKind: 'zacke',
    guidewayKind: 'zacke',
    interiorCameraProfile: 'rail',
    lineAccentColor: '#ffd800'
  },
  {
    id: 'seilbahn',
    label: 'Seilbahn',
    available: true,
    vehicleFamily: 'Historic Stuttgart funicular car',
    vehicleKind: 'seilbahn',
    guidewayKind: 'seilbahn',
    interiorCameraProfile: 'rail',
    lineAccentColor: '#ffd800'
  }
];

const fallbackManifest: RouteFeedManifest = {
  generatedAt: new Date(0).toISOString(),
  sourceUrl: 'demo',
  license: 'internal',
  attribution: 'Demo route fallback. Real VVS GTFS route packages could not be loaded.',
  modes: [
    {
      mode: 'stadtbahn',
      file: '/data/demo-route.json',
      routeCount: routePackages.length,
      lines: [...new Set(routePackages.map((route) => route.line))]
    }
  ]
};

export const stuttgartCity: CityDefinition = {
  id: 'stuttgart',
  name: 'Stuttgart',
  title: 'Stuttgart Transit Simulator',
  shortLabel: 'Stuttgart',
  menuTitle: 'Stuttgart Transit Simulator',
  description: 'Free, non-commercial simulator for Stuttgart public transport.',
  manifestFile: '/data/route-manifest.json',
  defaultTransportMode: 'stadtbahn',
  noticeNetworkName: 'VVS / SSB',
  freeRideNotice: 'Free non-commercial simulator.',
  transportModes: stuttgartTransportModes,
  routeManifestFallback: fallbackManifest,
  demoRoutesFallback: routePackages,
  defaultLineByMode: {
    stadtbahn: 'U12',
    bus: '43',
    's-bahn': 'S1',
    zacke: '10',
    seilbahn: '20'
  },
  landmarkFactory: createStuttgartLandmarks
};
