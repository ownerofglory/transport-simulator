import type { TransportModeDefinition } from '../domain/transport';
import type { CityDefinition } from './types';

const mexicoCityTransportModes: TransportModeDefinition[] = [
  {
    id: 'metro',
    label: 'Metro',
    available: true,
    vehicleFamily: 'STC Metro train',
    vehicleKind: 's-bahn',
    vehicleDesignId: 'cdmx-metro-nm16',
    guidewayKind: 's-bahn',
    interiorCameraProfile: 's-bahn',
    lineAccentColor: '#ef6521' // STC orange
  },
  {
    id: 'tram',
    label: 'Tren Ligero',
    available: true,
    vehicleFamily: 'Tren Ligero',
    vehicleKind: 'stadtbahn',
    guidewayKind: 'stadtbahn',
    interiorCameraProfile: 'tram',
    passengerOffsetM: 3.0,
    lineAccentColor: '#1259a8', // STE blue
    vehicleDesignId: 'cdmx-tren-ligero-te95'
  },
  {
    // GTFS route_type 2 for the city; carries El Insurgente (Zinacantepec -
    // Santa Fe) alongside the Tren Suburbano (Buenavista - Cuautitlán), so the
    // mode is named and liveried after the line the simulator opens on.
    id: 'rail',
    label: 'Insurgente',
    available: true,
    vehicleFamily: 'El Insurgente (CAF)',
    vehicleKind: 's-bahn',
    vehicleDesignId: 'cdmx-insurgente-caf',
    guidewayKind: 's-bahn',
    interiorCameraProfile: 's-bahn',
    lineAccentColor: '#c8102e'
  },
  {
    id: 'cablebus',
    label: 'Cablebús',
    available: true,
    vehicleFamily: 'Cablebús cabin',
    vehicleKind: 'seilbahn',
    guidewayKind: 'seilbahn',
    interiorCameraProfile: 'rail',
    lineAccentColor: '#ff9800'
  },
  {
    id: 'trolleybus',
    label: 'Trolleybus',
    available: true,
    vehicleFamily: 'Mexico City trolleybus',
    vehicleKind: 'bus',
    guidewayKind: 'bus',
    interiorCameraProfile: 'bus',
    lineAccentColor: '#1e88e5'
  },
  {
    id: 'bus',
    label: 'Bus',
    available: true,
    vehicleFamily: 'Mexico City bus',
    vehicleKind: 'bus',
    guidewayKind: 'bus',
    interiorCameraProfile: 'bus',
    lineAccentColor: '#2e7d32'
  }
];

export const mexicoCity: CityDefinition = {
  id: 'mexico-city',
  name: 'Mexico City',
  title: 'Mexico City Transit Simulator',
  shortLabel: 'Mexico City',
  menuTitle: 'Mexico City Transit Simulator',
  description: 'Free, non-commercial simulator for Mexico City public transport.',
  manifestFile: '/data/mexico-city/route-manifest.json',
  defaultTransportMode: 'metro',
  noticeNetworkName: 'CDMX public transport',
  freeRideNotice: 'Free non-commercial simulator.',
  transportModes: mexicoCityTransportModes,
  routeManifestFallback: {
    generatedAt: '2026-06-26T00:00:00.000Z',
    sourceUrl: 'https://files.mobilitydatabase.org/mdb-1830/mdb-1830-202603090024/mdb-1830-202603090024.zip',
    license: 'Data from the Mexico City GTFS feed for simulator use.',
    attribution: 'Contains Mexico City public transport schedule and stop data from the provided GTFS feed.',
    modes: [
      {
        mode: 'metro',
        file: '/data/mexico-city/routes-metro.json',
        routeCount: 24,
        lines: ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'L12']
      },
      {
        mode: 'tram',
        file: '/data/mexico-city/routes-tram.json',
        routeCount: 2,
        lines: ['1']
      },
      {
        mode: 'rail',
        file: '/data/mexico-city/routes-rail.json',
        routeCount: 4,
        lines: ['1']
      },
      {
        mode: 'cablebus',
        file: '/data/mexico-city/routes-cablebus.json',
        routeCount: 6,
        lines: ['1', '2', '3']
      },
      {
        mode: 'trolleybus',
        file: '/data/mexico-city/routes-trolleybus.json',
        routeCount: 21,
        lines: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12']
      },
      {
        mode: 'bus',
        file: '/data/mexico-city/routes-bus.json',
        routeCount: 530,
        lines: ['1', '1-D', '1A', '1B', '1C', '2', '2-A', '2A', '2B', '2C', '2D', '2E', '2F', '3', '3A', '4', '4A', '4B', '4C', '5', '5A', '6', '6A', '7', '7A', '7B', '7C', '7D', '8A', '8B', '8C', '8D', '9-C', '9A', '9B', '9C', '9D', '9E', '9F', '10A', '10B', '10C', '10D', '10E', '11-A', '11A', '11B', '11C', '11D', '11E', '11F', '12', '12A', '12B', '12C', '12D', '13-A', '13A', '13B', '13C', '13D', '13E', '14A', '15A', '15B', '15C', '16A', '16B', '16C', '16D', '17-E', '17-F', '17A', '17B', '17C', '17D', '17E', '17F', '17G', '17H', '17I', '17J', '17K', '17L', '18', '18A', '18B', '18C', '18D', '19', '19-A', '19A', '19B', '19C', '19D', '19E', '19F', '19G', '19H', '19I', '20A', '20B', '20C', '20D', '21A', '21B', '21C', '21D', '22A', '22B', '22C', '22D', '23', '23A', '23B', '23C', '23D', '24A', '24B', '24C', '24D', '25', '25A', '25B', '25C', '25D', '25E', '27-A', '31-B', '33', '34-A', '34-B', '37', '39-B', '43', '46-C', '47-A', '52-C', '57-A', '57-C', '59', '59-A', '69', '76', '76-A', '81-A', '101', '101-A', '101-B', '101-D', '102', '103', '104', '107', '107-B', '108', '110', '110-B', '110-C', '111-A', '112', '113-B', '115', '115-A', '116', '116-A', '118', '119', '119-B', '120', '121-A', '123-A', '124', '124-A', '125', '126', '128', '131', '132', '134', '134-A', '134-B', '134-C', '134-D', '141', '142', '143', '144', '144-C', '145', '145-A', '146', '147', '148', '149', '159', '161', '161-C', '161-D', '161-E', '161-F', '162', '162-B', '162-D', '163', '163-A', '163-B', '164', '165-A', '166', '167', '168', '200', '300-A', '300-B', 'Ordinario1 L1', 'Ordinario2 L1', 'Ordinario3 L1', 'Ordinario4 L1', 'PUMA1', 'PUMA2', 'PUMA3', 'PUMA4', 'PUMA5', 'PUMA6', 'PUMA7', 'PUMA8', 'PUMA9', 'PUMA10', 'PUMA11', 'PUMA13', 'SL01', 'Z1', 'Z2A', 'Z2B', 'Z2C', 'Z2D', 'Z2E', 'Z2F', 'Z2G', 'Z2H', 'Z2I', 'Z2J', 'Z3A', 'Z3B', 'Z3C', 'Z3D', 'Z3E', 'Z3F', 'Z3G', 'Z3H', 'Z4A', 'Z4B', 'Z4C', 'Z4D', 'Z4E', 'Z4F', 'Z4G', 'Z4H', 'Z4I', 'Z4J', 'Z4K']
      }
    ]
  },
  demoRoutesFallback: [],
  defaultLineByMode: {
    metro: '1',
    tram: '1',
    rail: '1',
    cablebus: '1',
    trolleybus: '1',
    bus: '20A'
  }
};
