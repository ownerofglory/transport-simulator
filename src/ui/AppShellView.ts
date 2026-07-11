/**
 * The HUD shell: root panel, collapsible header, content mount point, primary
 * control buttons (pause/camera/photo/reset), and the attribution notice.
 * Selection/stats/driver views mount into {@link contentEl}.
 */
export class AppShellView {
  readonly root = document.createElement('div');
  readonly contentEl = document.createElement('div');
  readonly controlsEl = document.createElement('div');

  private readonly notice = document.createElement('div');
  private readonly titleEl: HTMLHeadingElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly cameraButton: HTMLButtonElement;
  private readonly photoButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;

  private readonly onMenuClick = (): void => this.setCollapsed(!this.root.classList.contains('collapsed'));

  constructor(parent: HTMLElement) {
    this.root.className = 'hud';
    this.contentEl.className = 'hud-content';

    const header = document.createElement('div');
    header.className = 'hud-header';
    header.innerHTML = `
      <div><h1>Stuttgart Transit Simulator</h1><div class="label">Free, non-commercial simulator</div></div>
      <button class="menu-toggle" data-action="menu" aria-expanded="true" aria-label="Collapse menu">−</button>
    `;

    this.controlsEl.className = 'controls';
    this.controlsEl.innerHTML = `
      <button data-action="pause">Pause</button><button data-action="camera">Camera</button><button data-action="photo">Photo</button><button data-action="reset">Restart</button>
    `;

    this.root.append(header, this.contentEl);
    parent.appendChild(this.root);

    this.notice.className = 'notice';
    parent.appendChild(this.notice);

    this.titleEl = header.querySelector('h1') as HTMLHeadingElement;
    this.subtitleEl = header.querySelector('.label') as HTMLDivElement;
    this.menuButton = header.querySelector('[data-action="menu"]') as HTMLButtonElement;
    this.pauseButton = this.controlsEl.querySelector('[data-action="pause"]') as HTMLButtonElement;
    this.cameraButton = this.controlsEl.querySelector('[data-action="camera"]') as HTMLButtonElement;
    this.photoButton = this.controlsEl.querySelector('[data-action="photo"]') as HTMLButtonElement;
    this.resetButton = this.controlsEl.querySelector('[data-action="reset"]') as HTMLButtonElement;

    this.menuButton.addEventListener('click', this.onMenuClick);
    this.setCollapsed(window.matchMedia('(max-width: 760px)').matches);
  }

  setTitle(title: string): void {
    this.titleEl.textContent = title;
  }

  setSubtitle(subtitle: string): void {
    this.subtitleEl.textContent = subtitle;
  }

  setPause(paused: boolean): void {
    this.pauseButton.textContent = paused ? 'Resume' : 'Pause';
  }

  setDriverMode(driver: boolean): void {
    this.root.classList.toggle('driver-mode', driver);
  }

  setNotice(text: string): void {
    this.notice.textContent = text;
  }

  onPause(handler: () => void): void {
    this.pauseButton.addEventListener('click', handler);
  }

  onCamera(handler: () => void): void {
    this.cameraButton.addEventListener('click', handler);
  }

  onReset(handler: () => void): void {
    this.resetButton.addEventListener('click', handler);
  }

  onPhoto(handler: () => void): void {
    this.photoButton.addEventListener('click', handler);
  }

  dispose(): void {
    this.menuButton.removeEventListener('click', this.onMenuClick);
    this.root.remove();
    this.notice.remove();
  }

  private setCollapsed(collapsed: boolean): void {
    this.root.classList.toggle('collapsed', collapsed);
    this.menuButton.textContent = collapsed ? '+' : '−';
    this.menuButton.setAttribute('aria-expanded', String(!collapsed));
    this.menuButton.setAttribute('aria-label', collapsed ? 'Expand menu' : 'Collapse menu');
  }
}
