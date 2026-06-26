import type { TransportModeDefinition } from '../domain/transport';
import type { CityDefinition } from './types';

const freiburgTransportModes: TransportModeDefinition[] = [
  {
    id: 'tram',
    label: 'Tram',
    available: true,
    vehicleFamily: 'VAG Freiburg tram',
    vehicleKind: 'stadtbahn',
    guidewayKind: 'stadtbahn',
    interiorCameraProfile: 'tram',
    passengerOffsetM: 3.0,
    lineAccentColor: '#1e8f4f'
  },
  {
    id: 's-bahn',
    label: 'S-Bahn',
    available: true,
    vehicleFamily: 'Breisgau S-Bahn',
    vehicleKind: 's-bahn',
    guidewayKind: 's-bahn',
    interiorCameraProfile: 's-bahn',
    lineAccentColor: '#c62828'
  },
  {
    id: 'bus',
    label: 'Bus',
    available: true,
    vehicleFamily: 'Freiburg city bus',
    vehicleKind: 'bus',
    guidewayKind: 'bus',
    interiorCameraProfile: 'bus',
    lineAccentColor: '#1f5fbf'
  },
  {
    id: 'rail',
    label: 'Rail',
    available: true,
    vehicleFamily: 'Regional rail',
    vehicleKind: 's-bahn',
    guidewayKind: 's-bahn',
    interiorCameraProfile: 's-bahn',
    lineAccentColor: '#c62828'
  }
];

export const freiburgCity: CityDefinition = {
  id: 'freiburg',
  name: 'Freiburg',
  title: 'Freiburg Transit Simulator',
  shortLabel: 'Freiburg',
  menuTitle: 'Freiburg Transit Simulator',
  description: 'Free, non-commercial simulator for Freiburg and the RVF urban network.',
  manifestFile: '/data/freiburg/route-manifest.json',
  defaultTransportMode: 'tram',
  noticeNetworkName: 'VAG Freiburg / RVF',
  freeRideNotice: 'Free non-commercial simulator.',
  transportModes: freiburgTransportModes,
  routeManifestFallback: {
    generatedAt: '2026-06-26T00:00:00.000Z',
    sourceUrl: 'https://www.nvbw.de/fileadmin/user_upload/service/open_data/fahrplandaten_mit_liniennetz/rvf.zip',
    license: 'Data from the official RVF/NVBW GTFS feed for simulator use.',
    attribution: 'Contains RVF/NVBW schedule and stop data from the official Freiburg regional GTFS feed.',
    modes: [
      {
        mode: 'tram',
        file: '/data/freiburg/routes-tram.json',
        routeCount: 12,
        lines: ['1', '2', '3', '4', '5', 'SC']
      },
      {
        mode: 's-bahn',
        file: '/data/freiburg/routes-s-bahn.json',
        routeCount: 14,
        lines: ['S1', 'S2', 'S3', 'S5', 'S10', 'S11']
      },
      {
        mode: 'rail',
        file: '/data/freiburg/routes-rail.json',
        routeCount: 10,
        lines: ['FLX10', 'IC', 'RB 26', 'RB 27', 'RE72', 'RE 7', 'SEV', 'SEV S2', 'SEV S3', 'SEV S5', 'SEV S11']
      },
      {
        mode: 'bus',
        file: '/data/freiburg/routes-bus.json',
        routeCount: 367,
        lines: ['001', '1', '1A', '2', '3', '4', '5', '6', '7', '008', '9', '10', '011', '11', '14', '15', '17', '18', '19', '21', '22', '23', '24', '25', '27', '32', '33', '34', '36', '37', '93', '101', '103', '107', '108', '122', '130', '131', '132', '134', '136', '140', '142', '144', '146', '147', '200', '202', '204', '206', '208', '210', '212', '214', '216', '218', '230', '232', '240', '242', '244', '250', '252', '260', '262', '263', '270', '280', '290', '292', '294', '297', '299', '312', '342', '400', '405', '411', '430', '432', '436', '439', '450', '452', '460', '461', '462', '467', '468', '470', '471', '473', '475', '476', '500', '510', '512', '520', '530', '550', '560', '562', '564', '566', '570', '572', '620', '624', '630', '630S', '631', '632', '640', '641', '644', '650A', '650B', '650S', '651', '653', '700', '701', '750', '751', '752', '822', '7200', '7204', '7205', '7208', '7212', '7216', '7231', '7240', '7255', '7257', '7258', '7259', '7261', '7262', '7300', '7319', '7321', '7322', '7342', '7343', '9051', 'C', 'City8', 'F', 'Festbus', 'G', 'Linie 1', 'Linie 2', 'Linie 3', 'N07', 'N11', 'N33', 'N40', 'N41', 'N99', 'N122', 'N401', 'N474', 'N508', 'N867', 'N872', 'N887', 'N1135', 'N1720', 'N1759', 'R026', 'RB26', 'RB27', 'RB42', 'RE2', 'RE7', 'S10', 'S11', 'S181', 'S670', 'SEV', 'X1', 'X2', 'X4']
      }
    ]
  },
  demoRoutesFallback: [],
  defaultLineByMode: {
    tram: '1',
    bus: '1',
    's-bahn': 'S1',
    rail: 'RE 7'
  }
};
