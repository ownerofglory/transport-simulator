import type { TransportModeDefinition } from '../domain/transport';
import type { CityDefinition } from './types';

// Karlsruhe runs two integrated rail-bound networks under the KVV brand: VBK's
// city tram network and AVG's two-system Stadtbahn tram-trains that continue
// onto mainline tracks into the surrounding region (the "Karlsruhe model").
// Both share the stadtbahn guideway and vehicle kind, so each mode names its own
// registered vehicle design to keep the two cars visually distinct.
const karlsruheTransportModes: TransportModeDefinition[] = [
  {
    id: 'tram',
    label: 'Tram',
    available: true,
    vehicleFamily: 'VBK city tram (GT6/GT8 style)',
    vehicleKind: 'stadtbahn',
    vehicleDesignId: 'karlsruhe-vbk-tram',
    guidewayKind: 'stadtbahn',
    interiorCameraProfile: 'tram',
    passengerOffsetM: 2.8, // fallback passenger camera offset in meters for tram interiors
    lineAccentColor: '#e2001a' // VBK-like red accent
  },
  {
    id: 'stadtbahn',
    label: 'Stadtbahn',
    available: true,
    vehicleFamily: 'AVG Stadler CITYLINK tram-train',
    vehicleKind: 'stadtbahn',
    vehicleDesignId: 'karlsruhe-avg-citylink',
    guidewayKind: 'stadtbahn',
    // Tram profile so the interior camera anchors to a car mesh the way the other
    // articulated trams do, rather than using the un-anchored rail fallback.
    interiorCameraProfile: 'tram',
    passengerOffsetM: 3.6, // fallback passenger camera offset in meters for tram-train interiors
    lineAccentColor: '#0069b4' // AVG-like blue accent
  },
  {
    id: 'bus',
    label: 'Bus',
    available: true,
    vehicleFamily: 'VBK city bus',
    vehicleKind: 'bus',
    guidewayKind: 'bus',
    interiorCameraProfile: 'bus',
    lineAccentColor: '#f39200' // orange bus accent
  }
];

// City module definition used by the catalog/app controller.
export const karlsruheCity: CityDefinition = {
  id: 'karlsruhe',
  name: 'Karlsruhe',
  title: 'Karlsruhe Transit Simulator',
  shortLabel: 'Karlsruhe',
  menuTitle: 'Karlsruhe Transit Simulator',
  description: 'Free, non-commercial simulator for KVV public transport (VBK trams, AVG Stadtbahn tram-trains, VBK buses) in Karlsruhe and its surroundings.',
  manifestFile: '/data/karlsruhe/route-manifest.json',
  defaultTransportMode: 'stadtbahn',
  noticeNetworkName: 'KVV',
  freeRideNotice: 'Free non-commercial simulator.',
  transportModes: karlsruheTransportModes,

  // Fallback manifest keeps the app usable if the generated manifest fetch fails.
  routeManifestFallback: {
    generatedAt: '2026-08-12T14:24:23.216Z',
    sourceUrl: 'https://www.nvbw.de/fileadmin/user_upload/service/open_data/fahrplandaten_mit_liniennetz/bwgesamt.zip',
    license: 'Derived from the official NVBW Baden-Württemberg GTFS feed for simulator use.',
    attribution: 'Contains Karlsruhe VBK/AVG (KVV) route data derived from the official NVBW GTFS feed.',
    modes: [
      {
        mode: 'tram',
        file: '/data/karlsruhe/routes-tram.json',
        routeCount: 69,
        lines: ['1', '2', '3', '4', '5', '6', '8', '17', '18', 'NL1', 'NL2', 'S2']
      },
      {
        mode: 'stadtbahn',
        file: '/data/karlsruhe/routes-stadtbahn.json',
        routeCount: 149,
        lines: ['FEX', 'S1', 'S4', 'S5', 'S6', 'S7', 'S8', 'S11', 'S12', 'S31', 'S32', 'S41', 'S42', 'S51', 'S52', 'S53', 'S71', 'S81']
      },
      {
        mode: 'bus',
        file: '/data/karlsruhe/routes-bus.json',
        routeCount: 86,
        lines: ['21', '22', '23', '24', '26', '27', '30', '31', '31X', '32', '42', '44', '47', '50', '51', '52', '55', '60', '62', '70', '71', '72', '73', '74', '75', '83', '107', 'ALT32', 'NL3']
      }
    ]
  },

  // No hard-coded demo fallback routes for Karlsruhe; use generated route packages.
  demoRoutesFallback: [],

  // Preferred initial line per transport mode.
  defaultLineByMode: {
    tram: '2',
    stadtbahn: 'S4',
    bus: '55'
  }
};
