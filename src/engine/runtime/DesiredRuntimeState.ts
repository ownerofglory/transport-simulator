import type { CameraMode } from '../../world/CameraController';
import type { DebugWeather, Season, TrafficDensity } from '../../app/types';
import type { RouteSession } from '../../simulator/SimulatorRuntime';

/**
 * The complete state React *wants* the runtime to be in. React produces this
 * declaratively; the {@link RuntimeReconciler} diffs it against the previous
 * value and issues the minimal set of imperative commands — replacing the old
 * one-effect-per-command chain in AppShell.
 *
 * Photo/workspace activation is intentionally not here yet: it stays
 * runtime-authoritative (Phase 1) until the WorkspaceManager lands (Phase 9).
 */
export type DesiredRuntimeState = {
  session: RouteSession | null;
  simulation: {
    paused: boolean;
  };
  presentation: {
    season: Season;
    time: 'auto' | number;
    cameraMode: CameraMode;
    trafficDensity: TrafficDensity;
    /** Debug-mode weather override; 'auto' follows the live provider. */
    debugWeather: DebugWeather;
  };
};
