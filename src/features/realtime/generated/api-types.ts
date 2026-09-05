/* eslint-disable */
/* tslint:disable */
// @ts-nocheck
/*
 * ---------------------------------------------------------------
 * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##
 * ##                                                           ##
 * ## AUTHOR: acacode                                           ##
 * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##
 * ---------------------------------------------------------------
 */

export interface Departure {
  cancelled?: boolean;
  countdownMinutes?: number;
  destination?: string;
  estimatedTime?: string;
  id?: string;
  line?: string;
  plannedTime?: string;
  platform?: string;
}

export interface DeparturesResponse {
  departures?: Departure[];
  generatedAt?: string;
}

export type DomainLegMode = "walk" | "stadtbahn" | "s-bahn" | "bus";

export type DomainLocationType = "stop" | "address" | "poi" | "coord";

export interface GeoPoint {
  lat?: number;
  lon?: number;
}

export interface HandlersPointRequest {
  lat?: number;
  lon?: number;
}

export interface HandlersRouteRequest {
  destination?: HandlersPointRequest;
  origin?: HandlersPointRequest;
  profile?: string;
}

export interface Journey {
  arrivalTime?: string;
  departureTime?: string;
  distanceM?: number;
  durationMinutes?: number;
  id?: string;
  interchanges?: number;
  legs?: JourneyLeg[];
  messages?: string[];
  summary?: string;
}

export interface JourneyLeg {
  destination?: string;
  destinationName?: string;
  destinationTime?: string;
  durationMinutes?: number;
  geometry?: GeoPoint[];
  id?: string;
  line?: string;
  messages?: string[];
  mode?: DomainLegMode;
  originName?: string;
  originTime?: string;
  platform?: string;
  routeDescription?: string;
  stops?: JourneyStop[];
}

export interface JourneyStop {
  arrivalTime?: string;
  departureTime?: string;
  id?: string;
  lat?: number;
  lon?: number;
  name?: string;
}

export interface JourneysResponse {
  generatedAt?: string;
  journeys?: Journey[];
}

export interface LiveTrafficStatus {
  enabled?: boolean;
  positionModel?: string;
}

export interface LiveVehicle {
  bearing?: number;
  confidence?: LivetrafficConfidence;
  delaySeconds?: number;
  direction?: string;
  distanceM?: number;
  estimatedAt?: string;
  lat?: number;
  line?: string;
  lon?: number;
  mode?: LivetrafficVehicleMode;
  nextStop?: string;
  previousStop?: string;
  routeId?: string;
  runId?: string;
  shapeId?: string;
  source?: LivetrafficPositionSource;
  status?: LivetrafficVehicleStatus;
  tripId?: string;
}

export type LivetrafficConfidence = "low" | "medium" | "high";

export type LivetrafficPositionSource =
  | "schedule"
  | "realtime_inferred"
  | "measured";

export type LivetrafficVehicleMode =
  | "tram"
  | "light-rail"
  | "s-bahn"
  | "bus"
  | "rail";

export type LivetrafficVehicleStatus =
  | "not_started"
  | "at_stop"
  | "in_transit"
  | "completed";

export interface Location {
  id?: string;
  lat?: number;
  lon?: number;
  name?: string;
  type?: DomainLocationType;
}

export interface LocationsResponse {
  locations?: Location[];
}

export interface Place {
  id?: string;
  lat?: number;
  lon?: number;
  name?: string;
  type?: DomainLocationType;
}

export interface RespondErrorBody {
  code?: string;
  message?: string;
}

export interface RespondErrorEnvelope {
  error?: RespondErrorBody;
}

export interface RoutingPoint {
  lat?: number;
  lon?: number;
}

export interface RoutingRoute {
  points?: RoutingPoint[];
}

export interface SearchJourneyRequest {
  dateTime?: string;
  destination?: Place;
  destinationId?: string;
  origin?: Place;
  originId?: string;
  timeMode?: string;
}

export interface Station {
  id?: string;
  lat?: number;
  lon?: number;
  name?: string;
}

export interface StationSearchResponse {
  stations?: Station[];
}

export interface VehicleSnapshot {
  degraded?: boolean;
  generatedAt?: string;
  positionModel?: string;
  snapshotAgeSeconds?: number;
  vehicles?: LiveVehicle[];
}
