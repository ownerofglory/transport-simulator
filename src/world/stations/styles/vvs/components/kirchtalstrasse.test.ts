import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VvsStationMaterials } from '../VvsStationMaterials';
import { buildKirchtalstrasseFittings } from './kirchtalstrasse';

describe('Kirchtalstraße station fittings', () => {
  it('adds its central pier, blue chevrons, linear lighting, and wirework', () => {
    const local = new THREE.Group();
    const materials = new VvsStationMaterials();

    buildKirchtalstrasseFittings(local, materials, { lengthM: 90, ceilingHeightM: 5.9 });

    const fittings = local.getObjectByName('Kirchtalstraße station fittings')!;
    expect(local.getObjectByName('Kirchtalstraße central support pier')).toBeDefined();
    expect(local.getObjectByName('Kirchtalstraße ceiling crossbeam')).toBeDefined();
    expect(fittings.children.filter((child) => child.name === 'Kirchtalstraße blue wall chevron')).toHaveLength(12);
    expect(fittings.children.filter((child) => child.name === 'Kirchtalstraße linear ceiling light')).toHaveLength(2);
    expect(fittings.children.filter((child) => child.name === 'Kirchtalstraße overhead wire')).toHaveLength(4);

    materials.dispose();
  });
});
