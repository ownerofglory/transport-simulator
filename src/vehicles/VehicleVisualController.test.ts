import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VehicleVisualController } from './VehicleVisualController';
import type { VehicleInstance } from './types';

function makeInstance() {
  const doorLeaf = { group: new THREE.Group(), closedZ: 0, direction: 1 as const };
  const glass = new THREE.MeshStandardMaterial({ transparent: true });
  const band = new THREE.Mesh();
  const cabShell = new THREE.Mesh();
  const passengerShell = new THREE.Mesh();
  const cabDisplay = new THREE.Mesh();
  const lights: boolean[] = [];
  const instance: VehicleInstance = {
    root: new THREE.Group(),
    cars: [],
    doors: [doorLeaf],
    windowBands: [band],
    cabShells: [cabShell],
    passengerShells: [passengerShell],
    cabDisplays: [cabDisplay],
    glassMaterial: glass,
    trainHalfLengthM: 20.15,
    setExteriorLightsOn: (on) => lights.push(on)
  };
  return { instance, doorLeaf, glass, band, cabShell, passengerShell, cabDisplay, lights };
}

function make() {
  const m = makeInstance();
  const controller = new VehicleVisualController(m.instance, null, {
    line: 'U12',
    destination: 'Dürrlewang',
    lineAccentColor: '#ffd800',
    interiorCameraProfile: 'tram'
  });
  return { ...m, controller };
}

describe('VehicleVisualController.setPresentation', () => {
  it('hides body shells and clears the glass in passenger view', () => {
    const { controller, glass, band, passengerShell, cabShell } = make();
    controller.setPresentation('passenger', false);
    expect(passengerShell.visible).toBe(false);
    expect(band.visible).toBe(false);
    expect(cabShell.visible).toBe(true); // cab shell only hides in cab view
    expect(glass.opacity).toBeCloseTo(0.1, 5);
  });

  it('hides the cab shell and display in cab view', () => {
    const { controller, cabShell, cabDisplay } = make();
    controller.setPresentation('cab', false);
    expect(cabShell.visible).toBe(false);
    expect(cabDisplay.visible).toBe(false);
  });

  it('restores the exterior in chase view', () => {
    const { controller, glass, passengerShell, cabShell } = make();
    controller.setPresentation('passenger', false);
    controller.setPresentation('chase', false);
    expect(passengerShell.visible).toBe(true);
    expect(cabShell.visible).toBe(true);
    expect(glass.opacity).toBeCloseTo(0.58, 5);
  });

  it('keeps the exterior solid while a cinematic (photo) is active', () => {
    const { controller, passengerShell } = make();
    controller.setPresentation('passenger', true);
    expect(passengerShell.visible).toBe(true);
  });
});

describe('VehicleVisualController.updateDoors', () => {
  it('slides doors open toward the full offset and back closed', () => {
    const { controller, doorLeaf } = make();
    for (let i = 0; i < 80; i++) controller.updateDoors(true, 0.1);
    expect(doorLeaf.group.position.z).toBeGreaterThan(0.6);
    for (let i = 0; i < 80; i++) controller.updateDoors(false, 0.1);
    expect(doorLeaf.group.position.z).toBeLessThan(0.05);
  });
});

describe('VehicleVisualController.updateExteriorLights', () => {
  it('switches lamps on below the daylight threshold', () => {
    const { controller, lights } = make();
    controller.updateExteriorLights(0.2);
    controller.updateExteriorLights(0.9);
    expect(lights).toEqual([true, false]);
  });
});
