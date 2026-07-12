import { useSyncExternalStore } from 'react';
import type { SimulatorState } from '../../simulator/simulator-types';

/** UI-facing projection of the simulator state, decoupled from render frames. */
export type SimulatorUiSnapshot = {
  line: string;
  destination: string;
  speedKph: number;
  speedMps: number;
  nextStation: string;
  doorsOpen: boolean;
  dwellRemainingS: number;
  tripComplete: boolean;
  mode: 'ride' | 'driver';
  driverScore: number;
  timetableDeltaS: number;
  distanceM: number;
  stationIndex: number;
};

const EMPTY: SimulatorUiSnapshot = {
  line: '',
  destination: '',
  speedKph: 0,
  speedMps: 0,
  nextStation: '',
  doorsOpen: false,
  dwellRemainingS: 0,
  tripComplete: false,
  mode: 'ride',
  driverScore: 0,
  timetableDeltaS: 0,
  distanceM: 0,
  stationIndex: 0
};

/**
 * External store the imperative SimulatorRuntime pushes into each frame, read by
 * React via useSyncExternalStore. Publishes are throttled and deduped so the 60fps
 * render loop does not thrash React re-renders.
 */
export class SimulatorSnapshotStore {
  private snapshot = EMPTY;
  private listeners = new Set<() => void>();
  private lastPublishedAt = 0;

  getSnapshot = (): SimulatorUiSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update(state: SimulatorState, force = false): void {
    const now = performance.now();
    if (!force && now - this.lastPublishedAt < 100) return;
    const next: SimulatorUiSnapshot = {
      line: state.line,
      destination: state.destination,
      speedKph: Math.round(state.speedMps * 3.6),
      speedMps: state.speedMps,
      nextStation: state.nextStation,
      doorsOpen: state.doorsOpen,
      dwellRemainingS: state.dwellRemainingS,
      tripComplete: state.tripComplete,
      mode: state.mode,
      driverScore: state.driverScore,
      timetableDeltaS: state.timetableDeltaS,
      distanceM: state.distanceM,
      stationIndex: state.stationIndex
    };
    if (equal(next, this.snapshot)) return;
    this.snapshot = next;
    this.lastPublishedAt = now;
    for (const listener of this.listeners) listener();
  }
}

function equal(a: SimulatorUiSnapshot, b: SimulatorUiSnapshot): boolean {
  return a.line === b.line
    && a.destination === b.destination
    && a.speedKph === b.speedKph
    && a.nextStation === b.nextStation
    && a.doorsOpen === b.doorsOpen
    && a.dwellRemainingS === b.dwellRemainingS
    && a.tripComplete === b.tripComplete
    && a.mode === b.mode
    && a.driverScore === b.driverScore
    && a.timetableDeltaS === b.timetableDeltaS
    && a.distanceM === b.distanceM
    && a.stationIndex === b.stationIndex;
}

export function useSimulatorSnapshot(store: SimulatorSnapshotStore): SimulatorUiSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
