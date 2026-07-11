import type { TransitWorld } from '../world';

/** Context and hooks the photo mode needs from the surrounding app. */
export type PhotoModeControllerDeps = {
  getWorld: () => TransitWorld | null;
  renderFrame: () => void;
  isActive: () => boolean;
  setActive: (active: boolean) => void;
  // City id and route line used to build the screenshot filename.
  getScreenshotContext: () => { cityId: string; line: string };
};

/**
 * Owns the photo-mode overlay DOM, cinematic preset controls, and PNG
 * screenshot export. Photo-mode active state itself lives in app state and is
 * read/written through the {@link PhotoModeControllerDeps} accessors.
 */
export class PhotoModeController {
  private readonly overlay = document.createElement('div');
  private readonly label = document.createElement('div');
  private readonly exitButton = document.createElement('button');
  private readonly cycleButton = document.createElement('button');
  private readonly shotButton = document.createElement('button');

  private readonly onExit = (): void => this.exit();
  private readonly onCycle = (): void => this.cyclePreset();
  private readonly onShot = (): void => void this.exportScreenshot();

  constructor(
    private readonly parent: HTMLElement,
    private readonly deps: PhotoModeControllerDeps
  ) {
    this.overlay.className = 'photo-overlay';
    this.label.className = 'label';
    this.exitButton.textContent = 'Exit';
    this.cycleButton.textContent = 'Angle';
    this.shotButton.textContent = 'Screenshot';
    this.overlay.append(this.exitButton, this.label, this.cycleButton, this.shotButton);
    this.parent.appendChild(this.overlay);

    this.exitButton.addEventListener('click', this.onExit);
    this.cycleButton.addEventListener('click', this.onCycle);
    this.shotButton.addEventListener('click', this.onShot);
  }

  /** Whether photo mode is currently active. */
  isActive(): boolean {
    return this.deps.isActive();
  }

  /** Toggles photo (cinematic) mode on/off; force overrides the toggle direction. */
  toggle(force?: boolean): void {
    const world = this.deps.getWorld();
    if (!world) return;
    const shouldEnable = force ?? !this.deps.isActive();
    if (shouldEnable === this.deps.isActive()) return;
    this.deps.setActive(shouldEnable);
    const result = world.toggleCinematicMode();
    document.body.classList.toggle('photo-mode', result.active);
    this.refreshLabel();
    this.deps.renderFrame();
  }

  /** Exits photo mode (no-op when already inactive). */
  exit(): void {
    this.toggle(false);
  }

  /** Force-clears photo mode state when a ride (re)starts, without a world call. */
  reset(): void {
    this.deps.setActive(false);
    document.body.classList.remove('photo-mode');
  }

  /** Advances to the next cinematic camera preset and re-renders one frame. */
  cyclePreset(): void {
    const world = this.deps.getWorld();
    if (!world) return;
    world.cycleCinematicPreset();
    this.refreshLabel();
    this.deps.renderFrame();
  }

  /** Removes the overlay and its listeners. */
  dispose(): void {
    this.exitButton.removeEventListener('click', this.onExit);
    this.cycleButton.removeEventListener('click', this.onCycle);
    this.shotButton.removeEventListener('click', this.onShot);
    this.overlay.remove();
  }

  private refreshLabel(): void {
    const world = this.deps.getWorld();
    if (world) this.label.textContent = world.currentCinematicPresetLabel();
  }

  private async exportScreenshot(): Promise<void> {
    const world = this.deps.getWorld();
    if (!world) return;

    this.deps.renderFrame();
    document.body.classList.add('photo-capture');
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const blob = await new Promise<Blob | null>((resolve) => world.renderer.domElement.toBlob(resolve, 'image/png'));
    document.body.classList.remove('photo-capture');
    if (!blob) return;

    const { cityId, line } = this.deps.getScreenshotContext();
    const preset = world.currentCinematicPreset().replaceAll('-', '_');
    const safeLine = line.replace(/[^\w-]+/g, '_');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${cityId}_${safeLine}_${preset}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
}
