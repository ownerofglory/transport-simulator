import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createDbSBahnStationProvider } from './DbSBahnStationProvider';
import { buildHauptbahnhofInterior, hauptbahnhofColumnOffsets } from './hauptbahnhofInterior';
import { disposeStation } from '../../StationFactory';

vi.mock('../../../../labels', () => ({ makeLabelTexture: () => new THREE.Texture() }));

const resolve = (name = 'Stuttgart Hauptbahnhof (tief)') => createDbSBahnStationProvider().resolve(
  { name, distanceM: 500 }, { layer: {} as never, placement: { underground: true } as never }
);

describe('Hauptbahnhof S-Bahn interior', () => {
  it('keeps the documented platform dimensions and other station styles unchanged', () => {
    const definition = resolve();
    expect(definition.platform).toMatchObject({ lengthM: 210, heightM: 0.96, layout: 'island', curved: true });
    expect(definition.architecture?.customAsset).toBe('stuttgart-hbf-tief');
    expect(resolve('Stadtmitte').architecture?.customAsset).toBeUndefined();
    expect(buildHauptbahnhofInterior(new THREE.Group(), new THREE.Group(), {} as never, resolve('Stadtmitte'))).toBe(false);
  });

  it('keeps piers and seats away from the lift and full escalator runs', () => {
    const definition = resolve();
    const offsets = hauptbahnhofColumnOffsets(definition);
    expect(offsets.length).toBeGreaterThan(6);
    for (const z of offsets) for (const access of definition.access!) {
      if (access.type === 'lift') expect(Math.abs(z - access.offsetM)).toBeGreaterThanOrEqual(5);
      else expect(z <= access.offsetM - 5 || z >= access.offsetM + 9.25 + 5).toBe(true);
    }
  });

  it('preserves curved platform geometry, readable inward signs, and texture ownership', () => {
    const definition = resolve();
    const root = new THREE.Group();
    const local = new THREE.Group();
    root.add(local);
    const shared = new THREE.MeshStandardMaterial();
    const geometry = new THREE.PlaneGeometry(11, 210);
    const floor = new THREE.Mesh(geometry, shared);
    floor.name = `Island platform ${definition.stationId}`;
    root.add(floor);
    expect(buildHauptbahnhofInterior(local, root, {} as never, definition)).toBe(true);
    expect(floor.geometry).toBe(geometry);
    expect(floor.material).not.toBe(shared);
    const map = floor.material.map!;
    const dispose = vi.spyOn(map, 'dispose');
    const signs: THREE.Object3D[] = [];
    root.traverse(object => { if (object.name === 'Hauptbahnhof') signs.push(object); });
    expect(signs.length).toBeGreaterThan(8);
    for (const sign of signs) {
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(sign.quaternion);
      expect(normal.x * sign.position.x).toBeLessThan(0);
    }
    const slats = root.getObjectByName('Fine suspended ceiling slats') as THREE.InstancedMesh;
    expect(slats.isInstancedMesh).toBe(true);
    disposeStation(root, new Set([shared]));
    expect(dispose).toHaveBeenCalledOnce();
    shared.dispose();
  });
});
