export type StationConfig = {
  name: string;
  distanceM: number;
  scheduledS?: number;
};

export type SimulatorConfig = {
  line: string;
  destination: string;
  routeLengthM: number;
  speedLimitMps: number;
  mode?: 'ride' | 'driver';
  startStationIndex?: number;
  stations: StationConfig[];
};

export type SimulatorState = {
  line: string;
  destination: string;
  distanceM: number;
  speedMps: number;
  nextStation: string;
  stationIndex: number;
  doorsOpen: boolean;
  dwelling: boolean;
  dwellRemainingS: number;
  tripComplete: boolean;
  simTimeS: number;
  mode: 'ride' | 'driver';
  driverScore: number;
  lastStopErrorM: number;
  timetableDeltaS: number;
  safetyEvents: number;
  speeding: boolean;
};
