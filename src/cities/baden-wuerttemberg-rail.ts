import type { TransportModeDefinition } from '../domain/transport';
import type { CityDefinition } from './types';

const badenWuerttembergRailTransportModes: TransportModeDefinition[] = [
  {
    id: 'rail',
    label: 'Rail',
    available: true,
    vehicleFamily: 'bwegt regional train (Coradia Continental / Desiro HC / Flirt / Mireo / Talent style)',
    vehicleKind: 's-bahn',
    guidewayKind: 's-bahn',
    interiorCameraProfile: 's-bahn',
    lineAccentColor: '#f2d21b'
  }
];

export const badenWuerttembergRailCity: CityDefinition = {
  id: 'baden-wuerttemberg-rail',
  name: 'Baden-Württemberg Rail',
  title: 'Baden-Württemberg Rail Simulator',
  shortLabel: 'BW Rail',
  menuTitle: 'Baden-Württemberg Rail Simulator',
  description: 'Free, non-commercial simulator for regional and inter-regional train routes across Baden-Württemberg.',
  manifestFile: '/data/baden-wuerttemberg-rail/route-manifest.json',
  defaultTransportMode: 'rail',
  noticeNetworkName: 'bwegt / NVBW',
  freeRideNotice: 'Free non-commercial simulator.',
  transportModes: badenWuerttembergRailTransportModes,
  routeManifestFallback: {
    generatedAt: '2026-07-02T00:00:00.000Z',
    sourceUrl: 'https://www.nvbw.de/fileadmin/user_upload/service/open_data/fahrplandaten_mit_liniennetz/bwgesamt.zip',
    license: 'Derived from the official NVBW Baden-Württemberg GTFS feed for simulator use.',
    attribution: 'Contains Baden-Württemberg train route data derived from the official NVBW GTFS feed.',
    modes: [
      {
        mode: 'rail',
        file: '/data/baden-wuerttemberg-rail/routes-rail-network.json',
        routeCount: 0,
        lines: []
      }
    ]
  },
  demoRoutesFallback: [],
  defaultRouteIdByMode: {
    rail: 'ddb-90-T12S-1-1-14-H-1-Special#2283-2-35'
  },
  defaultLineByMode: {
    rail: 'MEX12'
  }
};
