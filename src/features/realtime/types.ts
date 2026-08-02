// App-facing vocabulary over the generated OpenAPI contracts.
//
// The wire types in ./generated/api-types.ts are the source of truth — never
// edit them by hand; regenerate with `npm run gen:api` after the backend spec
// changes. Because the Swagger 2.0 spec marks every field optional, this module
// renames a few types and tightens the fields the UI relies on always being
// present (the api client normalizes responses to guarantee them).

import type {
  Departure as WireDeparture,
  Journey as WireJourney,
  Location as WireLocation,
  Station as WireStation
} from './generated/api-types';

export type {
  DomainLegMode as LegMode,
  DomainLocationType as LocationType,
  GeoPoint,
  JourneyLeg,
  JourneyStop,
  Place,
  SearchJourneyRequest,
  LocationsResponse,
  JourneysResponse,
  DeparturesResponse,
  StationSearchResponse
} from './generated/api-types';

// A resolved place always has coordinates and a name once the client keeps it.
export type RealtimeLocation = WireLocation & Required<Pick<WireLocation, 'id' | 'name' | 'lat' | 'lon' | 'type'>>;

// A journey the UI can key on and iterate over.
export type Journey = WireJourney & Required<Pick<WireJourney, 'id' | 'legs' | 'departureTime' | 'arrivalTime'>>;

// A departure row the UI can key on and label.
export type Departure = WireDeparture & Required<Pick<WireDeparture, 'id' | 'line' | 'destination'>>;

// A station search hit the UI can key on, label and place on the map.
export type RealtimeStation = WireStation & Required<Pick<WireStation, 'id' | 'name' | 'lat' | 'lon'>>;
