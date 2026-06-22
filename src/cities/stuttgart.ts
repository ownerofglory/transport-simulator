import { createStuttgartLandmarks } from '../landmarks';
import { routePackages, type RouteFeedManifest } from '../route';
import type { CityDefinition } from './types';

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
