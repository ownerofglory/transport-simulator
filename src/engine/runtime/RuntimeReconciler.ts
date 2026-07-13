import type { CameraMode } from '../../world/CameraController';
import type { Season } from '../../app/types';
import type { RouteSession } from '../../simulator/SimulatorRuntime';
import type { DesiredRuntimeState } from './DesiredRuntimeState';
import { worldKey } from './worldKey';

/** The subset of runtime commands the reconciler drives (kept narrow for testing). */
export interface ReconcilerRuntime {
  loadRoute(session: RouteSession): void;
  setStartStation(session: RouteSession): void;
  setRideMode(session: RouteSession): void;
  setSeason(season: Season): void;
  setTime(time: 'auto' | number): void;
  setCameraMode(mode: CameraMode): void;
  setPaused(paused: boolean): void;
}

/**
 * Diffs successive {@link DesiredRuntimeState} values and issues only the
 * commands whose inputs changed:
 *
 * - A change to the structural {@link worldKey} rebuilds the world once.
 * - A start-station or ride-mode change updates the existing world.
 * - Season/time/camera/pause changes update presentation without rebuilding.
 *
 * Applying the same desired state twice is a no-op.
 */
export class RuntimeReconciler {
  private previous: DesiredRuntimeState | null = null;

  constructor(private readonly runtime: ReconcilerRuntime) {}

  apply(next: DesiredRuntimeState): void {
    const previous = this.previous;

    if (!next.session) {
      this.previous = next;
      return;
    }

    if (!previous?.session || worldKey(previous.session) !== worldKey(next.session)) {
      this.runtime.loadRoute(next.session);
    } else {
      if (previous.session.startStationIndex !== next.session.startStationIndex) {
        this.runtime.setStartStation(next.session);
      }
      if (previous.session.mode !== next.session.mode) {
        this.runtime.setRideMode(next.session);
      }
    }

    if (previous?.presentation.season !== next.presentation.season) {
      this.runtime.setSeason(next.presentation.season);
    }
    if (previous?.presentation.time !== next.presentation.time) {
      this.runtime.setTime(next.presentation.time);
    }
    if (previous?.presentation.cameraMode !== next.presentation.cameraMode) {
      this.runtime.setCameraMode(next.presentation.cameraMode);
    }
    if (previous?.simulation.paused !== next.simulation.paused) {
      this.runtime.setPaused(next.simulation.paused);
    }

    this.previous = next;
  }
}
