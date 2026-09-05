import { vi } from 'vitest';

// Three.js label and tunnel materials use canvas-backed textures. jsdom exposes
// the element but deliberately leaves getContext unimplemented, which used to
// flood otherwise-successful test runs with misleading errors.
const canvasContext = new Proxy(
  {},
  {
    get(_target, property) {
      if (property === 'measureText') return (text: string) => ({ width: text.length * 10 });
      if (property === 'getImageData') {
        return (_x: number, _y: number, width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
          width,
          height
        });
      }
      if (property === 'createLinearGradient' || property === 'createRadialGradient') {
        return () => ({ addColorStop() {} });
      }
      if (property === 'createPattern') return () => null;
      return () => undefined;
    },
    set() {
      return true;
    }
  }
) as CanvasRenderingContext2D;

vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext);
