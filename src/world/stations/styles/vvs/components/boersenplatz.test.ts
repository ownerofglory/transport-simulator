import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VvsStationMaterials } from '../VvsStationMaterials';
import { buildBoersenplatzFittings } from './boersenplatz';

describe('Börsenplatz station fittings', () => {
  it('adds the green soffit, colored insets, platform bands, and glazed access core', () => {
    const local = new THREE.Group();
    const materials = new VvsStationMaterials();

    buildBoersenplatzFittings(local, materials, { lengthM: 82, ceilingHeightM: 5.8 });

    const fittings = local.getObjectByName('Börsenplatz station fittings')!;
    expect(local.getObjectByName('Börsenplatz glazed access core')).toBeDefined();
    expect(fittings.children.filter((child) => child.name === 'Börsenplatz green soffit band')).toHaveLength(2);
    expect(fittings.children.filter((child) => child.name === 'Börsenplatz colored wall inset')).toHaveLength(6);
    expect(fittings.children.filter((child) => child.name === 'Börsenplatz yellow platform finish')).toHaveLength(2);
    expect(fittings.children.filter((child) => child.name === 'Börsenplatz turquoise exit marker')).toHaveLength(8);

    materials.dispose();
  });
});
