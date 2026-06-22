import * as THREE from 'three';
import type { DemoRoute, RouteFeedManifest } from '../route';
import type { LandmarkZone } from '../landmarks';
import type { TransportMode } from '../domain/transport';

export type CityCatalogEntry = {
  id: string;
  name: string;
  title: string;
  description?: string;
  manifestFile: string;
  defaultTransportMode: TransportMode;
};

export type CityCatalog = {
  generatedAt: string;
  cities: CityCatalogEntry[];
};

export type CityLandmarkFactory = (
  route: Array<{ lat: number; lon: number }>,
  projectGeo: (lat: number, lon: number) => THREE.Vector3,
  surfaceHeight: (lat: number, lon: number) => Promise<number>
) => { group: THREE.Group; zones: LandmarkZone[] };

export type CityDefinition = CityCatalogEntry & {
  shortLabel: string;
  menuTitle: string;
  noticeNetworkName: string;
  freeRideNotice: string;
  routeManifestFallback: RouteFeedManifest;
  demoRoutesFallback: DemoRoute[];
  defaultLineByMode: Partial<Record<TransportMode, string>>;
  landmarkFactory?: CityLandmarkFactory;
};
