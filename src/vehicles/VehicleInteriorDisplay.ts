import * as THREE from 'three';

// The next-stop interior board painted onto a canvas texture (line badge, "NÄCHSTER
// HALT" / "TÜREN GEÖFFNET · DANACH", the station, and "Richtung <destination>").
// Shared so the simulator's active vehicle and the live follow vehicle render an
// identical display instead of each keeping its own copy (a recurring parity bug).
export class VehicleInteriorDisplay {
  readonly material: THREE.MeshBasicMaterial;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;
  private lastKey = '';

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    this.canvas = canvas;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    this.texture = texture;
    this.material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
  }

  /** Repaints only when the visible content changes. */
  update(input: { line: string; destination: string; nextStop: string; doorsOpen: boolean; accentColor: string }): void {
    const station = input.nextStop === 'End of line' ? 'Endstation' : input.nextStop || input.destination;
    const key = `${input.line}/${input.destination}/${station}/${input.doorsOpen}/${input.accentColor}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#071015';
    ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = input.accentColor;
    ctx.fillRect(0, 0, 1024, 14);
    ctx.fillRect(24, 40, 126, 126);
    ctx.fillStyle = '#11151a';
    ctx.font = '800 56px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(input.line, 87, 104);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#a9b7bd';
    ctx.font = '600 30px Inter, Arial, sans-serif';
    ctx.fillText(input.doorsOpen ? 'TÜREN GEÖFFNET · DANACH' : 'NÄCHSTER HALT', 184, 62);

    let fontSize = 58;
    do {
      ctx.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
      fontSize -= 2;
    } while (ctx.measureText(station).width > 806 && fontSize > 30);
    ctx.fillStyle = '#f5f7f6';
    ctx.fillText(station, 184, 126);

    ctx.fillStyle = input.accentColor;
    ctx.font = '500 25px Inter, Arial, sans-serif';
    ctx.fillText(`Richtung ${input.destination}`, 184, 202);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}
