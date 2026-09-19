import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VvsStationMaterials } from '../VvsStationMaterials';
import { buildRotebuehlplatzFittings } from './rotebuehlplatz';

describe('Rotebühlplatz station fittings', () => {
  it('adds the older interchange hall’s poster bays, truss members, and suspended signs', () => {
    const local = new THREE.Group();
    const materials = new VvsStationMaterials();

    buildRotebuehlplatzFittings(local, materials, { lengthM: 120, ceilingHeightM: 5.4 });

    const fittings = local.getObjectByName('Rotebühlplatz station fittings')!;
    expect(local.getObjectByName('Rotebühlplatz red roof cross members')).toBeDefined();
    expect(fittings.children.filter((child) => child.name === 'Rotebühlplatz terracotta poster bay')).toHaveLength(8);
    expect(fittings.children.filter((child) => child.name === 'Rotebühlplatz suspended interchange sign')).toHaveLength(4);

    materials.dispose();
  });
});
