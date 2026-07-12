// TypeScript mirror of the transit-simulator-backend OpenAPI definitions.
// The backend proxies the Stuttgart VVS TRIAS API and returns real-time data.

export type LocationType = 'stop' | 'address' | 'poi' | 'coord';
export type LegMode = 'walk' | 'stadtbahn' | 's-bahn' | 'bus';

// A resolvable place (stop/address/poi/coordinate) with WGS84 coordinates.
export type RealtimeLocation = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: LocationType;
};

export type LocationsResponse = {
  locations: RealtimeLocation[];
};

export type JourneyLeg = {
  id: string;
  mode: LegMode;
  line?: string;
  originName: string;
  originTime: string;
  destination?: string;
  destinationName: string;
  destinationTime: string;
  durationMinutes?: number;
  platform?: string;
  routeDescription?: string;
  messages?: string[];
};

export type Journey = {
  id: string;
  summary?: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes?: number;
  interchanges?: number;
  distanceM?: number;
  legs: JourneyLeg[];
  messages?: string[];
};

export type JourneysResponse = {
  generatedAt: string;
  journeys: Journey[];
};

export type Departure = {
  id: string;
  line: string;
  destination: string;
  platform?: string;
  plannedTime: string;
  estimatedTime?: string;
  countdownMinutes?: number;
  cancelled?: boolean;
};

export type DeparturesResponse = {
  generatedAt: string;
  departures: Departure[];
};

// Minimal place payload used as a journey origin/destination in search requests.
export type Place = {
  id?: string;
  name?: string;
  lat?: number;
  lon?: number;
  type?: LocationType;
};

export type SearchJourneyRequest = {
  origin?: Place;
  originId?: string;
  destination?: Place;
  destinationId?: string;
  dateTime?: string;
  timeMode?: 'departure' | 'arrival';
};
