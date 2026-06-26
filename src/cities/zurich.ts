import type { TransportModeDefinition } from '../domain/transport';
import type { CityDefinition } from './types';

const zurichTransportModes: TransportModeDefinition[] = [
  {
    id: 'tram',
    label: 'Tram',
    available: true,
    vehicleFamily: 'VBZ Tram',
    vehicleKind: 'stadtbahn',
    guidewayKind: 'stadtbahn',
    interiorCameraProfile: 'tram',
    passengerOffsetM: 3.2,
    lineAccentColor: '#0066b3'
  },
  {
    id: 'bus',
    label: 'Bus',
    available: true,
    vehicleFamily: 'VBZ Bus',
    vehicleKind: 'bus',
    guidewayKind: 'bus',
    interiorCameraProfile: 'bus',
    lineAccentColor: '#1f7a3d'
  },
  {
    id: 's-bahn',
    label: 'S-Bahn',
    available: true,
    vehicleFamily: 'S18 suburban train',
    vehicleKind: 's-bahn',
    guidewayKind: 's-bahn',
    interiorCameraProfile: 's-bahn',
    lineAccentColor: '#d6001c'
  },
  {
    id: 'funicular',
    label: 'Funicular',
    available: true,
    vehicleFamily: 'Zürich funicular',
    vehicleKind: 'zacke',
    guidewayKind: 'zacke',
    interiorCameraProfile: 'rail',
    lineAccentColor: '#6b4f2a'
  }
];

export const zurichCity: CityDefinition = {
  id: 'zurich',
  name: 'Zurich',
  title: 'Zurich Transit Simulator',
  shortLabel: 'Zurich',
  menuTitle: 'Zurich Transit Simulator',
  description: 'Free, non-commercial simulator for VBZ and Zürich-area public transport.',
  manifestFile: '/data/zurich/route-manifest.json',
  defaultTransportMode: 'tram',
  noticeNetworkName: 'VBZ / ZVV',
  freeRideNotice: 'Free non-commercial simulator.',
  transportModes: zurichTransportModes,
  routeManifestFallback: {
    generatedAt: '2026-06-26T00:00:00.000Z',
    sourceUrl: 'https://data.stadt-zuerich.ch/dataset/vbz_fahrplandaten_gtfs/download/2026_google_transit.zip',
    license: 'Data from Stadt Zürich / VBZ GTFS feed for simulator use.',
    attribution: 'Contains VBZ schedule and stop data from the official Stadt Zürich GTFS feed.',
    modes: [
      {
        mode: 'tram',
        file: '/data/zurich/routes-tram.json',
        routeCount: 41,
        lines: ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '19', '50', '51', 'E']
      },
      {
        mode: 's-bahn',
        file: '/data/zurich/routes-s-bahn.json',
        routeCount: 6,
        lines: ['S18', 'SN18']
      },
      {
        mode: 'bus',
        file: '/data/zurich/routes-bus.json',
        routeCount: 683,
        lines: ['1', '2', '3', '4', '5', '7', '9', '10', '12', '22', '25', '31', '32', '33', '37', '38', '39', '40', '42', '44', '45', '46', '61', '62', '64', '66', '67', '69', '70', '72', '73', '75', '76', '77', '78', '80', '83', '89', '91', '99', '121', '122', '123', '125', '126', '127', '128', '129', '131', '132', '133', '134', '136', '137', '140', '142', '145', '150', '151', '152', '153', '155', '156', '160', '161', '162', '163', '165', '170', '184', '185', '200', '201', '205', '210', '212', '214', '215', '220', '221', '223', '225', '227', '228', '229', '230', '232', '235', '236', '240', '245', '280', '301', '302', '305', '306', '307', '309', '314', '315', '317', '325', '449', '450', '451', '452', '453', '454', '455', '456', '485', '491', '492', '501', '504', '510', '515', '520', '521', '522', '524', '525', '529', '530', '531', '533', '534', '535', '540', '542', '543', '545', '546', '555', '593', '605', '610', '611', '612', '615', '620', '621', '623', '630', '632', '634', '640', '650', '652', '655', '656', '657', '658', '659', '660', '662', '670', '671', '674', '675', '676', '677', '679', '680', '681', '682', '701', '703', '704', '705', '706', '720', '721', '725', '726', '727', '731', '732', '733', '734', '735', '736', '739', '742', '743', '745', '748', '749', '751', '752', '754', '756', '759', '760', '761', '762', '765', '766', '768', '769', '771', '772', '773', '774', '781', '787', '795', '796', '797', '806', '807', '809', '811', '812', '813', '816', '817', '818', '825', '826', '827', '830', '831', '832', '833', '835', '837', '842', '845', '846', '850', '851', '852', '854', '856', '857', '858', '859', '862', '867', '869', '870', '871', '875', '878', '879', '880', '882', '883', '884', '885', '888', '892', '893', '905', '910', '912', '916', '918', '919', '921', '922', '923', '925', '931', '932', '940', '950', '951', '952', '955', '961', '962', '970', '972', '973', '974', '991', '992', '993', '994', '996', 'E', 'EV', 'EV1', 'EV2', 'EV3', 'EV4', 'EV5', 'EV6', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9', 'N10', 'N12', 'N13', 'N14', 'N15', 'N16', 'N17', 'N18', 'N22', 'N23', 'N24', 'N25', 'N26', 'N28', 'N29', 'N30', 'N33', 'N34', 'N36', 'N45', 'N46', 'N50', 'N51', 'N52', 'N53', 'N54', 'N58', 'N59', 'N60', 'N61', 'N62', 'N64', 'N65', 'N68', 'N69', 'N70', 'N71', 'N72', 'N74', 'N75', 'N76', 'N77', 'N78', 'N79', 'N81', 'N82', 'N84', 'N86', 'N87', 'N88', 'N91', 'N92', 'N95']
      },
      {
        mode: 'funicular',
        file: '/data/zurich/routes-funicular.json',
        routeCount: 6,
        lines: ['23', '24', '26']
      }
    ]
  },
  demoRoutesFallback: [],
  defaultLineByMode: {
    tram: '11',
    bus: '31',
    's-bahn': 'S18',
    funicular: '23'
  }
};
