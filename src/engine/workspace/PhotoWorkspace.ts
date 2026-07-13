import type { Workspace, WorkspaceTarget } from './Workspace';
import type { EngineInputEvent } from './EngineInputEvent';

/**
 * Cinematic presentation workspace. Driving input (throttle/brake/look) is
 * ignored here; zoom still works, photo-cycle changes the preset, and
 * photo-exit/toggle returns to the simulation workspace.
 */
export class PhotoWorkspace implements Workspace {
  readonly id = 'photo';

  constructor(private readonly target: WorkspaceTarget) {}

  enter(): void {
    // Release any held driving input on entry so it can't leak into photo mode.
    this.target.input.reset();
  }

  exit(): void {}

  handleInput(event: EngineInputEvent): boolean {
    switch (event.type) {
      case 'photo-exit':
      case 'photo-toggle':
        this.target.exitPhotoMode();
        return true;
      case 'photo-cycle':
        this.target.cyclePhotoPreset();
        return true;
      case 'zoom':
        this.target.adjustZoom(event.delta);
        return true;
      default:
        // Swallow driving input so it doesn't reach the simulator in photo mode.
        return true;
    }
  }
}
