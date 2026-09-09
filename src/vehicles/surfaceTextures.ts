import * as THREE from 'three';

// Deterministic tiling finishes, generated once per train/bus rather than per frame.
// Procedural approximations, not scans of the operator's upholstery.
export function makeSsbSurfaceTexture(kind: 'fabric' | 'floor'): THREE.DataTexture {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  let seed = 812;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed >>> 24;
      const weave = (x + y) % 2 === 0 ? 4 : -4;
      const fleck = kind === 'fabric' && x % 13 < 2 && y % 17 < 5;
      const base = kind === 'floor' ? [104, 109, 109] : fleck ? [126, 145, 157] : [54, 83, 105];
      const variation = kind === 'floor' ? (noise > 225 ? 24 : noise < 30 ? -20 : 0) : weave;
      const index = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) pixels[index + channel] = base[channel] + variation;
      pixels[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.name = `SSB ${kind} finish`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.repeat.set(kind === 'floor' ? 3 : 2, kind === 'floor' ? 22 : 3);
  texture.needsUpdate = true;
  return texture;
}
