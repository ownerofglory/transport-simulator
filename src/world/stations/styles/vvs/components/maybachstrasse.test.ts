import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VvsStationMaterials } from '../VvsStationMaterials';
import { buildMaybachstrasseFittings } from './maybachstrasse';

describe('Maybachstraße station fittings', () => {
  it('adds its authored glazed access, wall insets, and lighting to a deep hall', () => {
    const local = new THREE.Group();
    const materials = new VvsStationMaterials();

    buildMaybachstrasseFittings(local, materials, { lengthM: 82, ceilingHeightM: 6.35 });

    expect(local.getObjectByName('Maybachstraße station fittings')).toBeDefined();
    expect(local.getObjectByName('Maybachstraße glazed lift pavilion')).toBeDefined();
    expect(local.getObjectByName('Maybachstraße wall panel joints')).toBeDefined();
    expect(local.children[0].children.filter((child) => child.name === 'Maybachstraße circular wall inset')).toHaveLength(4);
    expect(local.children[0].children.filter((child) => child.name === 'Maybachstraße warm wall light')).toHaveLength(2);

    materials.dispose();
  });
});
