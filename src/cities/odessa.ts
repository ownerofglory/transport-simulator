import type { TransportModeDefinition } from '../domain/transport';
import type { CityDefinition } from './types';

// Odessa-specific transport modes mapped onto the shared vehicle/guideway systems.
const odessaTransportModes: TransportModeDefinition[] = [
  {
    id: 'tram',
    label: 'Tram',
    available: true,
    vehicleFamily: 'Tatra-Yug K1T306 style low-floor tram',
    vehicleKind: 'stadtbahn', // reuse shared rail/tram renderer
    guidewayKind: 'stadtbahn', // reuse shared double-track rail guideway behavior
    interiorCameraProfile: 'tram',
    passengerOffsetM: 2.4, // fallback passenger camera offset in meters for tram interiors
    lineAccentColor: '#d32f2f' // red tram accent
  },
  {
    id: 'trolleybus',
    label: 'Trolleybus',
    available: true,
    vehicleFamily: 'Odesa trolleybus',
    vehicleKind: 'bus', // trolleybus currently reuses the bus vehicle renderer
    guidewayKind: 'bus', // road-following guideway behavior
    interiorCameraProfile: 'bus',
    lineAccentColor: '#1976d2' // blue trolleybus accent
  },
  {
    id: 'bus',
    label: 'Bus',
    available: true,
    vehicleFamily: 'Odesa city bus',
    vehicleKind: 'bus',
    guidewayKind: 'bus',
    interiorCameraProfile: 'bus',
    lineAccentColor: '#43a047' // green bus accent
  }
];

// City module definition consumed by the catalog/app controller.
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

  // Fallback manifest keeps the city available if generated route manifest loading fails.
  routeManifestFallback: {
    generatedAt: '2026-06-22T00:00:00.000Z',
    sourceUrl: 'https://www.oget.od.ua/',
    license: 'Routing/dimensions derived for simulator use from public Odesa line information.',
    attribution: 'Based on public Odesmiskelektrotrans and Odesa public transport line information.',
    modes: [
      {
        mode: 'tram',
        file: '/data/odessa/routes-tram.json',
        routeCount: 36, // 18 tram lines, both directions
        lines: ['1', '3', '5', '6', '7', '7-к', '10', '11', '12', '13', '15', '17', '18', '20', '21', '26', '27', '28']
      },
      {
        mode: 'trolleybus',
        file: '/data/odessa/routes-trolleybus.json',
        routeCount: 4, // trolleybus lines 7 and 10, both directions
        lines: ['7', '10']
      },
      {
        mode: 'bus',
        file: '/data/odessa/routes-bus.json',
        routeCount: 2, // bus line 117, both directions
        lines: ['117']
      }
    ]
  },

  // No hard-coded demo fallback routes for Odessa; use generated route packages.
  demoRoutesFallback: [],

  // Preferred exact default route id for tram mode.
  defaultRouteIdByMode: {
    tram: '1655942'
  },

  // Preferred initial line per transport mode.
  defaultLineByMode: {
    tram: '28',
    trolleybus: '7',
    bus: '117'
  }
};
