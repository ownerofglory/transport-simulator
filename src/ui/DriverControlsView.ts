/** Throttle/brake buttons shown in driver mode. */
export class DriverControlsView {
  readonly root = document.createElement('div');
  private driveHandler: ((kind: 'throttle' | 'brake', held: boolean) => void) | null = null;

  constructor() {
    this.root.className = 'driver-controls';
    this.root.dataset.panel = 'driver';
    this.root.innerHTML = `
      <button data-drive="throttle">Throttle</button><button data-drive="brake">Brake</button>
      <div class="hint">W/ArrowUp throttle · S/ArrowDown brake</div>
    `;

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-drive]')) {
      const kind = button.dataset.drive as 'throttle' | 'brake';
      button.addEventListener('pointerdown', () => this.driveHandler?.(kind, true));
      button.addEventListener('pointerup', () => this.driveHandler?.(kind, false));
      button.addEventListener('pointerleave', () => this.driveHandler?.(kind, false));
    }
  }

  /** Appends this view's element into the given container. */
  mountInto(container: HTMLElement): void {
    container.appendChild(this.root);
  }

  onDriveInput(handler: (kind: 'throttle' | 'brake', held: boolean) => void): void {
    this.driveHandler = handler;
  }

  dispose(): void {
    this.root.remove();
  }
}
