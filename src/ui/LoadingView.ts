/** Full-screen loading overlay shown during catalog/route/WASM loading. */
export class LoadingView {
  private readonly root = document.createElement('div');

  constructor(parent: HTMLElement) {
    this.root.className = 'loading';
    this.root.textContent = 'Loading VVS GTFS route packages...';
    parent.appendChild(this.root);
  }

  show(text: string): void {
    this.root.textContent = text;
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  dispose(): void {
    this.root.remove();
  }
}
