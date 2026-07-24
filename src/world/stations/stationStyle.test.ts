import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createStationStyleRegistry } from './index';
import type { StationPlacement, RouteStation } from './types';

function placementAt(station: RouteStation, underground: boolean): StationPlacement {
  return {
    station,
    index: 0,
    t: 0,
    center: new THREE.Vector3(),
    tangent: new THREE.Vector3(0, 0, 1),
    yaw: 0,
    underground
  };
}

describe('station style registry', () => {
  it('resolves the vvs-stadtbahn provider and no others by default', () => {
    const registry = createStationStyleRegistry();
    expect(registry.has('vvs-stadtbahn')).toBe(true);
    expect(registry.resolveOptional('vvs-stadtbahn')?.id).toBe('vvs-stadtbahn');
    expect(registry.resolveOptional('db-sbahn')).toBeUndefined();
    expect(registry.resolveOptional(undefined)).toBeUndefined();
  });

  it('classifies surface vs underground stops by archetype', () => {
    const provider = createStationStyleRegistry().resolveOptional('vvs-stadtbahn')!;
    const station: RouteStation = { name: 'Charlottenplatz', distanceM: 500 };

    const surface = provider.resolve(station, { layer: {} as never, placement: placementAt(station, false) });
    expect(surface.archetype).toBe('surface-side');
    expect(surface.platform.layout).toBe('side');

    const underground = provider.resolve(station, { layer: {} as never, placement: placementAt(station, true) });
    expect(underground.archetype).toBe('underground-side');
  });
});
