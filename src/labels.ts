import * as THREE from 'three';

export function makeLabelTexture(text: string, options: { width?: number; height?: number; bg?: string; fg?: string } = {}): THREE.CanvasTexture {
  const width = options.width ?? 512;
  const height = options.height ?? 160;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');

  ctx.fillStyle = options.bg ?? '#f7d900';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  ctx.fillRect(0, height - 24, width, 24);
  ctx.fillStyle = options.fg ?? '#111111';
  ctx.font = 'bold 54px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2 - 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
