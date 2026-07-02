import type { TransportModeDefinition } from '../domain/transport';
import type { CityDefinition } from './types';

const wuppertalTransportModes: TransportModeDefinition[] = [
  {
    id: 'schwebebahn',
    label: 'Schwebebahn',
    available: true,
    vehicleFamily: 'Wuppertal Schwebebahn GTW 15',
    vehicleKind: 'schwebebahn',
    guidewayKind: 'schwebebahn',
    interiorCameraProfile: 'tram',
    lineAccentColor: '#61c7d9'
  }
];

export const wuppertalCity: CityDefinition = {
  id: 'wuppertal',
  name: 'Wuppertal',
  title: 'Wuppertal Schwebebahn Simulator',
  shortLabel: 'Wuppertal',
  menuTitle: 'Wuppertal Schwebebahn Simulator',
  description: 'Free, non-commercial simulator for the Wuppertaler Schwebebahn suspended railway.',
  manifestFile: '/data/wuppertal/route-manifest.json',
  defaultTransportMode: 'schwebebahn',
  noticeNetworkName: 'WSW mobil',
  freeRideNotice: 'Free non-commercial simulator.',
  transportModes: wuppertalTransportModes,
  routeManifestFallback: {
    generatedAt: '2026-07-02T00:00:00.000Z',
    sourceUrl: 'https://daten.wuppertal.de/Transport_Verkehr/Schwebebahnhoefe_EPSG4326_JSON.json',
    license: 'CC BY 4.0',
    attribution: 'Contains official Wuppertal Schwebebahn station data under CC BY 4.0.',
    modes: [
      {
        mode: 'schwebebahn',
        file: '/data/wuppertal/routes-schwebebahn.json',
        routeCount: 2,
        lines: ['60']
      }
    ]
  },
  demoRoutesFallback: [],
  defaultRouteIdByMode: {
    schwebebahn: 'wuppertal-schwebebahn-60-eastbound'
  },
  defaultLineByMode: {
    schwebebahn: '60'
  }
};
