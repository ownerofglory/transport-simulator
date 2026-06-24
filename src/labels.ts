import * as THREE from 'three';

/** Creates a canvas-backed texture for station signs, vehicle displays, and POI labels. */
export function makeLabelTexture(
  text: string,
  options: { width?: number; height?: number; bg?: string; fg?: string } = {}
): THREE.CanvasTexture {
  // Default texture size balances text clarity with moderate GPU memory use.
  const width = options.width ?? 512;
  const height = options.height ?? 160;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');

  ctx.fillStyle = options.bg ?? '#f7d900'; // SSB-like yellow fallback background.
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)'; // subtle lower shadow band for label depth.
  ctx.fillRect(0, height - 24, width, 24); // 24 px footer band.

  ctx.fillStyle = options.fg ?? '#111111'; // near-black fallback text color.
  ctx.font = 'bold 54px Inter, Arial, sans-serif'; // large readable sign text.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Slight upward offset visually centers capital-heavy station names.
  ctx.fillText(text, width / 2, height / 2 - 4);

  const texture = new THREE.CanvasTexture(canvas);

  // Treat canvas colors as sRGB so labels match CSS-like colors in Three.js.
  texture.colorSpace = THREE.SRGBColorSpace;

  return texture;
}
