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

export interface SearchJourneyRequest {
  dateTime?: string;
  destination?: Place;
  destinationId?: string;
  origin?: Place;
  originId?: string;
  timeMode?: string;
}
