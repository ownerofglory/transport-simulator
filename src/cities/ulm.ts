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
    generatedAt: '2026-06-22T00:00:00.000Z',
    sourceUrl: 'https://www.swu.de/privatkunden/produkte-leistungen/mobilitaet/',
    license: 'Routing/dimensions derived for simulator use from public SWU line information.',
    attribution: 'Based on public SWU Ulm/Neu-Ulm line information.',
    modes: [
      { mode: 'tram', file: '/data/ulm/routes-tram.json', routeCount: 4, lines: ['1', '2'] }, // two tram lines, both directions
      { mode: 'bus', file: '/data/ulm/routes-bus.json', routeCount: 2, lines: ['5'] } // bus line 5, both directions
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
