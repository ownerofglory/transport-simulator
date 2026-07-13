import type { CameraMode } from '../../world/CameraController';

/**
 * Which workspace is active. Only simulation and photo exist today; the union is
 * intentionally extendable (e.g. a future vehicle-constructor workspace) without
 * changing existing callers.
 *
 * Photo remembers the camera mode it interrupted and whether the simulation was
 * running so exit can restore both.
 */
export type WorkspaceState =
  | { value: 'simulation' }
  | { value: 'photo'; previousCameraMode: CameraMode; resumeAfterExit: boolean };

export type WorkspaceEvent =
  | { type: 'ENTER_PHOTO'; previousCameraMode: CameraMode; resumeAfterExit: boolean }
  | { type: 'EXIT_PHOTO' };

export function workspaceInitialState(): WorkspaceState {
  return { value: 'simulation' };
}

/** Pure transition; unknown transitions return the same reference (ignored). */
export function workspaceTransition(state: WorkspaceState, event: WorkspaceEvent): WorkspaceState {
  switch (event.type) {
    case 'ENTER_PHOTO':
      // Entering photo while already in photo keeps the original snapshot.
      return state.value === 'simulation'
        ? { value: 'photo', previousCameraMode: event.previousCameraMode, resumeAfterExit: event.resumeAfterExit }
        : state;
    case 'EXIT_PHOTO':
      return state.value === 'photo' ? { value: 'simulation' } : state;
    default:
      return state;
  }
}
