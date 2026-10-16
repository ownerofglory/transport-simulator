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
    generatedAt: '2026-06-27T10:12:11.975Z',
    sourceUrl: 'https://gw.x24.digital/api/od-all/gtfs/v1/download/static',
    license: 'CC BY via official Odesa GTFS od-all feed.',
    attribution: 'Contains Odesa route data derived from the official Odessa od-all GTFS feed.',
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
        routeCount: 20,
        lines: ['2', '3', '7', '8', '8тр', '9', '9тр', '10', '12', '17тр']
      },
      {
        mode: 'bus',
        file: '/data/odessa/routes-bus.json',
        routeCount: 90,
        lines: ['6Е', '7', '11', '16Е', '18', '26', '104', '105', '105А', '110', '111', '115', '121', '127', '128', '146', '148', '149', '150', '165', '168', '171', '175', '185 ч/з Костанді', '190', '191', '198', '201', '202', '203', '208', '214', '220А', '221', '232А', '233', '237', '240', '242', '250', '280', '288', 'С2', 'С6', 'С10']
      }
    ]
  },

  // No hard-coded demo fallback routes for Odessa; use generated route packages.
  demoRoutesFallback: [],

  // Preferred exact default route id for tram mode.
  defaultRouteIdByMode: {
    tram: '1655954'
  },

  // Preferred initial line per transport mode.
  defaultLineByMode: {
    tram: '5',
    trolleybus: '7',
    bus: '104'
  }
};
