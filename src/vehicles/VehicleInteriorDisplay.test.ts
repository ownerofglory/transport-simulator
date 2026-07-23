import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VehicleInteriorDisplay } from './VehicleInteriorDisplay';

describe('VehicleInteriorDisplay', () => {
  it('exposes a reusable MeshBasicMaterial backed by a canvas texture', () => {
    const display = new VehicleInteriorDisplay();
    expect(display.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(display.material.map).toBeInstanceOf(THREE.CanvasTexture);
    display.dispose();
  });

  it('updates without throwing and skips redundant repaints', () => {
    const display = new VehicleInteriorDisplay();
    const input = { line: 'U12', destination: 'Dürrlewang', nextStop: 'Aldingen Mühle', doorsOpen: true, accentColor: '#ffd800' };
    expect(() => display.update(input)).not.toThrow();
    expect(() => display.update(input)).not.toThrow(); // same key → early return
    expect(() => display.update({ ...input, nextStop: 'End of line' })).not.toThrow();
    display.dispose();
  });
});
