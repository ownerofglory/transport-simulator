import type { Workspace, WorkspaceTarget } from './Workspace';
import type { EngineInputEvent } from './EngineInputEvent';

/**
 * Default driving workspace: throttle/brake/look feed the runtime input, zoom
 * adjusts the camera, and photo-toggle enters cinematic mode. Held input is
 * released on exit so leaving the workspace can't leave a control latched.
 */
export class SimulationWorkspace implements Workspace {
  readonly id = 'simulation';

  constructor(private readonly target: WorkspaceTarget) {}

  enter(): void {}

  exit(): void {
    this.target.input.reset();
  }

  handleInput(event: EngineInputEvent): boolean {
    switch (event.type) {
      case 'throttle':
        this.target.input.setThrottle(event.value);
        return true;
      case 'brake':
        this.target.input.setBrake(event.value);
        return true;
      case 'look':
        this.target.input.setLook(event.left, event.right);
        return true;
      case 'zoom':
        this.target.adjustZoom(event.delta);
        return true;
      case 'photo-toggle':
        this.target.enterPhotoMode();
        return true;
      default:
        return false;
    }
  }
}
