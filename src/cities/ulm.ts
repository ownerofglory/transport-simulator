import type { TransportModeDefinition } from '../domain/transport';
import type { CityDefinition } from './types';

// Ulm-specific transport modes mapped onto shared vehicle/guideway behavior.
const ulmTransportModes: TransportModeDefinition[] = [
  {
    id: 'tram',
    label: 'Tram',
    available: true,
    vehicleFamily: 'Siemens Avenio M (SWU Ulm)',
    vehicleKind: 'stadtbahn', // reuse shared rail/stadtbahn vehicle renderer for tram mode
    guidewayKind: 'stadtbahn', // reuse shared double-track rail guideway behavior
    interiorCameraProfile: 'tram',
    passengerOffsetM: 2.8, // fallback passenger camera offset in meters for tram interiors
    lineAccentColor: '#7ac143' // SWU-like green accent
  },
  {
    id: 'bus',
    label: 'Bus',
    available: true,
    vehicleFamily: 'SWU city bus',
    vehicleKind: 'bus',
    guidewayKind: 'bus',
    interiorCameraProfile: 'bus',
    lineAccentColor: '#1e6ad6' // blue bus accent
  }
];

// City module definition used by the catalog/app controller.
export const ulmCity: CityDefinition = {
  id: 'ulm',
  name: 'Ulm',
  title: 'Ulm Transit Simulator',
  shortLabel: 'Ulm',
  menuTitle: 'Ulm Transit Simulator',
  description: 'Free, non-commercial simulator for SWU public transport in Ulm/Neu-Ulm.',
  manifestFile: '/data/ulm/route-manifest.json',
  defaultTransportMode: 'tram',
  noticeNetworkName: 'SWU',
  freeRideNotice: 'Free non-commercial simulator.',
  transportModes: ulmTransportModes,

  // Fallback manifest keeps the app usable if the generated manifest fetch fails.
  routeManifestFallback: {
    generatedAt: '2026-06-27T10:12:11.971Z',
    sourceUrl: 'https://www.nvbw.de/fileadmin/user_upload/service/open_data/fahrplandaten_mit_liniennetz/ding.zip',
    license: 'Derived from the official DING GTFS feed for simulator use.',
    attribution: 'Contains DING/SWU route data derived from the official DING GTFS feed.',
    modes: [
      { mode: 'tram', file: '/data/ulm/routes-tram.json', routeCount: 12, lines: ['1', '2', 'E'] },
      { mode: 'bus', file: '/data/ulm/routes-bus.json', routeCount: 86, lines: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', 'E', 'MS9', 'MS14', 'N1', 'N2', 'N3', 'N4', 'N7', 'N8', 'SEV2'] }
    ]
  },

  // No hard-coded demo fallback routes for Ulm; use generated route packages.
  demoRoutesFallback: [],

  // Preferred initial line per transport mode.
  defaultLineByMode: {
    tram: '1',
    bus: '5'
  }
};
