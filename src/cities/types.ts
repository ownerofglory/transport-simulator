import * as THREE from 'three';
import type { DemoRoute, RouteFeedManifest } from '../route';
import type { LandmarkZone } from '../landmarks';
import type { TransportMode, TransportModeDefinition } from '../domain/transport';

// Lightweight city entry used by the public city catalog.
export type CityCatalogEntry = {
  id: string;
  name: string;
  title: string;
  description?: string;
  manifestFile: string;
  defaultTransportMode: TransportMode;
};

// Top-level city catalog loaded before city-specific route manifests.
export type CityCatalog = {
  generatedAt: string;
  cities: CityCatalogEntry[];
};

// Optional city hook for adding curated landmark silhouettes near a route.
export type CityLandmarkFactory = (
  route: Array<{ lat: number; lon: number }>,
  projectGeo: (lat: number, lon: number) => THREE.Vector3,
  surfaceHeight: (lat: number, lon: number) => Promise<number>
) => { group: THREE.Group; zones: LandmarkZone[] };

// Full in-code city definition used by the app controller after catalog selection.
export type CityDefinition = CityCatalogEntry & {
  shortLabel: string;
  menuTitle: string;
  noticeNetworkName: string;
  freeRideNotice: string;
  transportModes: TransportModeDefinition[];

  // Optional correction for generated local route coordinates.
  mirrorRouteX?: boolean;

  // Fallback data keeps the app usable when generated city files fail to load.
  routeManifestFallback: RouteFeedManifest;
  demoRoutesFallback: DemoRoute[];

  // Optional exact default route per mode; takes priority over defaultLineByMode.
  defaultRouteIdByMode?: Partial<Record<TransportMode, string>>;

  // Preferred initial line per mode when no exact route id is configured.
  defaultLineByMode: Partial<Record<TransportMode, string>>;

  // Optional procedural landmark layer and OSM-building exclusion zones.
  landmarkFactory?: CityLandmarkFactory;
};
