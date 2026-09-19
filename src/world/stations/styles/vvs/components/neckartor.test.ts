import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VvsStationMaterials } from '../VvsStationMaterials';
import { buildNeckartorFittings } from './neckartor';

describe('Neckartor station fittings', () => {
  it('adds the colored panel grid, glazed gallery, wirework, and station plaque', () => {
    const local = new THREE.Group();
    const materials = new VvsStationMaterials();

    buildNeckartorFittings(local, materials, { lengthM: 120, ceilingHeightM: 6.1 });

    const fittings = local.getObjectByName('Neckartor station fittings')!;
    expect(local.getObjectByName('Neckartor glazed access gallery')).toBeDefined();
    expect(local.getObjectByName('Neckartor station plaque')).toBeDefined();
    expect(fittings.children.filter((child) => child.name === 'Neckartor colored wall panel')).toHaveLength(12);
    expect(fittings.children.filter((child) => child.name === 'Neckartor overhead wire')).toHaveLength(4);

    materials.dispose();
  });
});
