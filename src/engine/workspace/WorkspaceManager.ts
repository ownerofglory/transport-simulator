import type { Workspace } from './Workspace';
import type { EngineInputEvent } from './EngineInputEvent';

/**
 * Holds the active {@link Workspace} and routes input to it. Activating a
 * workspace exits the previous one first, so enter/exit are always balanced.
 */
export class WorkspaceManager {
  private active: Workspace | null = null;

  get activeId(): string | null {
    return this.active?.id ?? null;
  }

  async activate(next: Workspace): Promise<void> {
    if (this.active === next) return;
    await this.active?.exit();
    this.active = next;
    await next.enter();
  }

  handleInput(event: EngineInputEvent): boolean {
    return this.active?.handleInput(event) ?? false;
  }

  fixedUpdate(dt: number): void {
    this.active?.fixedUpdate?.(dt);
  }

  update(dt: number): void {
    this.active?.update?.(dt);
  }
}
