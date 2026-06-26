import type { TransportModeDefinition } from '../domain/transport';
import type { CityDefinition } from './types';

const lvivTransportModes: TransportModeDefinition[] = [
  {
    id: 'tram',
    label: 'Tram',
    available: true,
    vehicleFamily: 'Lviv tram',
    vehicleKind: 'stadtbahn',
    guidewayKind: 'stadtbahn',
    interiorCameraProfile: 'tram',
    passengerOffsetM: 2.8,
    lineAccentColor: '#1f9a52'
  },
  {
    id: 'bus',
    label: 'Bus',
    available: true,
    vehicleFamily: 'Lviv city bus',
    vehicleKind: 'bus',
    guidewayKind: 'bus',
    interiorCameraProfile: 'bus',
    lineAccentColor: '#1565c0'
  }
];

export const lvivCity: CityDefinition = {
  id: 'lviv',
  name: 'Lviv',
  title: 'Lviv Transit Simulator',
  shortLabel: 'Lviv',
  menuTitle: 'Lviv Transit Simulator',
  description: 'Free, non-commercial simulator for Lviv public transport.',
  manifestFile: '/data/lviv/route-manifest.json',
  defaultTransportMode: 'tram',
  noticeNetworkName: 'Lviv public transport',
  freeRideNotice: 'Free non-commercial simulator.',
  transportModes: lvivTransportModes,
  routeManifestFallback: {
    generatedAt: '2026-06-26T00:00:00.000Z',
    sourceUrl: 'https://track.ua-gis.com/gtfs/lviv/static.zip',
    license: 'Data from the Lviv static GTFS feed for simulator use.',
    attribution: 'Contains Lviv public transport schedule and stop data from the provided GTFS feed.',
    modes: [
      {
        mode: 'tram',
        file: '/data/lviv/routes-tram.json',
        routeCount: 16,
        lines: ['Т01', 'Т02', 'Т03', 'Т04', 'Т06', 'Т07', 'Т08', 'Т09']
      },
      {
        mode: 'bus',
        file: '/data/lviv/routes-bus.json',
        routeCount: 126,
        lines: ['А01', 'А03', 'А05', 'А06', 'А07', 'А08а', 'А09', 'А10', 'А11', 'А12', 'А14', 'А15', 'А16', 'А17', 'А18', 'А19', 'А20', 'А21', 'А22', 'А23', 'А25', 'А27', 'А29', 'А31', 'А32', 'А33', 'А34', 'А37', 'А39', 'А39а', 'А40', 'А41', 'А43', 'А45', 'А46', 'А47', 'А48', 'А49', 'А51', 'А52', 'А53', 'А55', 'А56', 'А57', 'А59', 'А60', 'А61', 'А62', 'А63', 'А80', 'А84', 'А92', 'А99', 'АТ8', 'Тр22', 'Тр23', 'Тр24', 'Тр25', 'Тр27', 'Тр30', 'Тр31', 'Тр32', 'Тр38']
      }
    ]
  },
  demoRoutesFallback: [],
  defaultLineByMode: {
    tram: 'Т04',
    bus: 'А01'
  }
};
