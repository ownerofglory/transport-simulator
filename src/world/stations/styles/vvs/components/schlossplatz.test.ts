import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VvsStationMaterials } from '../VvsStationMaterials';
import { buildSchlossplatzFittings } from './schlossplatz';

describe('Schlossplatz curved shell fittings', () => {
  it('adds the rounded ribbed shell, light wedges, and station plaques', () => {
    const local = new THREE.Group();
    const materials = new VvsStationMaterials();
    buildSchlossplatzFittings(local, materials, { lengthM: 120, ceilingHeightM: 5.8 });
    const fittings = local.getObjectByName('Schlossplatz curved shell fittings')!;
    expect(fittings.children.filter((child) => child.name === 'Schlossplatz rounded wall shell')).toHaveLength(2);
    expect(fittings.children.filter((child) => child.name === 'Schlossplatz shell ribs')).toHaveLength(2);
    expect(fittings.children.filter((child) => child.name === 'Schlossplatz recessed light wedge').length).toBeGreaterThan(3);
    expect(fittings.children.filter((child) => child.name === 'Schlossplatz station plaque')).toHaveLength(2);
    materials.dispose();
  });
});
