import { describe, it, expect } from 'vitest';
import { workspaceInitialState, workspaceTransition } from './workspaceMachine';

describe('workspaceTransition', () => {
  it('starts in simulation', () => {
    expect(workspaceInitialState()).toEqual({ value: 'simulation' });
  });

  it('enters photo, preserving the interrupted camera + resume intent', () => {
    const s = workspaceTransition(workspaceInitialState(), {
      type: 'ENTER_PHOTO',
      previousCameraMode: 'chase',
      resumeAfterExit: true
    });
    expect(s).toEqual({ value: 'photo', previousCameraMode: 'chase', resumeAfterExit: true });
  });

  it('restores simulation on exit', () => {
    const photo = workspaceTransition(workspaceInitialState(), {
      type: 'ENTER_PHOTO',
      previousCameraMode: 'cab',
      resumeAfterExit: false
    });
    expect(workspaceTransition(photo, { type: 'EXIT_PHOTO' })).toEqual({ value: 'simulation' });
  });

  it('ignores ENTER_PHOTO while already in photo (keeps original snapshot)', () => {
    const photo = workspaceTransition(workspaceInitialState(), {
      type: 'ENTER_PHOTO',
      previousCameraMode: 'chase',
      resumeAfterExit: true
    });
    const again = workspaceTransition(photo, {
      type: 'ENTER_PHOTO',
      previousCameraMode: 'passenger',
      resumeAfterExit: false
    });
    expect(again).toBe(photo);
  });

  it('ignores EXIT_PHOTO while in simulation', () => {
    const sim = workspaceInitialState();
    expect(workspaceTransition(sim, { type: 'EXIT_PHOTO' })).toBe(sim);
  });
});
