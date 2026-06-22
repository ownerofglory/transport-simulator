import type { TransportModeDefinition } from '../domain/transport';
import type { CityDefinition } from './types';

const odessaTransportModes: TransportModeDefinition[] = [
  {
    id: 'tram',
    label: 'Tram',
    available: true,
    vehicleFamily: 'Tatra-Yug K1T306 style low-floor tram',
    vehicleKind: 'stadtbahn',
    guidewayKind: 'stadtbahn',
    interiorCameraProfile: 'tram',
    passengerOffsetM: 2.4,
    lineAccentColor: '#d32f2f'
  },
  {
    id: 'trolleybus',
    label: 'Trolleybus',
    available: true,
    vehicleFamily: 'Odesa trolleybus',
    vehicleKind: 'bus',
    guidewayKind: 'bus',
    interiorCameraProfile: 'bus',
    lineAccentColor: '#1976d2'
  },
  {
    id: 'bus',
    label: 'Bus',
    available: true,
    vehicleFamily: 'Odesa city bus',
    vehicleKind: 'bus',
    guidewayKind: 'bus',
    interiorCameraProfile: 'bus',
    lineAccentColor: '#43a047'
  }
];

export const odessaCity: CityDefinition = {
  id: 'odessa',
  name: 'Odessa',
  title: 'Odessa Transit Simulator',
  shortLabel: 'Odessa',
  menuTitle: 'Odessa Transit Simulator',
  description: 'Free, non-commercial simulator for Odesa urban transport.',
  manifestFile: '/data/odessa/route-manifest.json',
  defaultTransportMode: 'tram',
  noticeNetworkName: 'Odesmiskelektrotrans',
  freeRideNotice: 'Free non-commercial simulator.',
  transportModes: odessaTransportModes,
  mirrorRouteX: true,
  routeManifestFallback: {
    generatedAt: '2026-06-22T00:00:00.000Z',
    sourceUrl: 'https://www.oget.od.ua/',
    license: 'Routing/dimensions derived for simulator use from public Odesa line information.',
    attribution: 'Based on public Odesmiskelektrotrans and Odesa public transport line information.',
    modes: [
      { mode: 'tram', file: '/data/odessa/routes-tram.json', routeCount: 8, lines: ['5', '10', '17', '28'] },
      { mode: 'trolleybus', file: '/data/odessa/routes-trolleybus.json', routeCount: 2, lines: ['7'] },
      { mode: 'bus', file: '/data/odessa/routes-bus.json', routeCount: 2, lines: ['117'] }
    ]
  },
  demoRoutesFallback: [],
  defaultLineByMode: {
    tram: '28',
    trolleybus: '7',
    bus: '117'
  }
};
