// Station data passed into the Go/WASM simulator.
export type StationConfig = {
  name: string;
  distanceM: number; // distance from route start in meters
  scheduledS?: number; // optional scheduled time from trip start in seconds
  // Present in generated GTFS route packages; optional for legacy demo routes.
  lat?: number;
  lon?: number;
};

// Config used to initialize or restart one simulator session.
export type SimulatorConfig = {
  line: string;
  destination: string;
  routeLengthM: number; // total route length in meters
  speedLimitMps: number; // speed limit in meters per second
  mode?: 'ride' | 'driver';
  startStationIndex?: number; // optional selected departure station
  stations: StationConfig[];
};

// Authoritative simulator state returned from Go/WASM after each tick.
export type SimulatorState = {
  line: string;
  destination: string;
  distanceM: number; // current distance along the route in meters
  speedMps: number; // current speed in meters per second
  nextStation: string;
  stationIndex: number; // current/last reached station index
  doorsOpen: boolean;
  dwelling: boolean; // true while stopped for passenger dwell time
  dwellRemainingS: number; // remaining dwell time in seconds
  tripComplete: boolean;
  simTimeS: number; // elapsed simulation time in seconds
  mode: 'ride' | 'driver';
  driverScore: number;
  lastStopErrorM: number; // driver stop accuracy error in meters
  timetableDeltaS: number; // positive means late, negative means early
  safetyEvents: number;
  speeding: boolean;
};
