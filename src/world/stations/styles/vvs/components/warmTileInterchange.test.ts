import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VvsStationMaterials } from '../VvsStationMaterials';
import { buildWarmTileInterchangeFittings } from './warmTileInterchange';

describe('warm tile interchange fittings', () => {
  it('adds tiled walls, red bands, fluorescent rows, wirework, and station plaques', () => {
    const local = new THREE.Group();
    const materials = new VvsStationMaterials();

    buildWarmTileInterchangeFittings(local, materials, {
      lengthM: 82,
      ceilingHeightM: 5.5,
      stationName: 'Marienplatz'
    });

    const fittings = local.getObjectByName('Marienplatz warm tile interchange fittings')!;
    expect(local.getObjectByName('Warm tile wall vertical joints')).toBeDefined();
    expect(fittings.children.filter((child) => child.name === 'Warm tile red name band')).toHaveLength(2);
    expect(fittings.children.filter((child) => child.name === 'Warm tile fluorescent row')).toHaveLength(3);
    expect(fittings.children.filter((child) => child.name === 'Warm tile overhead service wire')).toHaveLength(3);
    expect(fittings.children.filter((child) => child.name === 'Warm tile station plaque')).toHaveLength(2);

    materials.dispose();
  });
});
