import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createDbSBahnStationProvider } from './DbSBahnStationProvider';
import { buildStammstreckeInterior, stammstreckeColumnOffsets } from './stammstreckeInterior';
import { disposeStation } from '../../StationFactory';

vi.mock('../../../../labels', () => ({ makeLabelTexture: () => new THREE.Texture() }));

const resolve = (name = 'Stuttgart Hauptbahnhof (tief)') => createDbSBahnStationProvider().resolve(
  { name, distanceM: 500 }, { layer: {} as never, placement: { underground: true } as never }
);

const STAMMSTRECKE = ['Stuttgart Hauptbahnhof (tief)', 'Stadtmitte', 'Feuersee', 'Schwabstraße'];

describe('Stammstrecke S-Bahn interior', () => {
  it('keeps the documented platform dimensions across the four stops', () => {
    for (const name of STAMMSTRECKE) {
      const definition = resolve(name);
      expect(definition.platform).toMatchObject({ lengthM: 210, heightM: 0.96, layout: 'island', curved: true });
      expect(definition.architecture?.customAsset).toBe('stuttgart-stammstrecke');
    }
  });

  it('leaves stops outside the Stammstrecke on the generic build', () => {
    const other = resolve('Flughafen/Messe');
    expect(other.architecture?.customAsset).toBeUndefined();
    expect(buildStammstreckeInterior(new THREE.Group(), new THREE.Group(), {} as never, other)).toBe(false);
  });

  it('gives every stop the same fittings in its own colour, name and track number', () => {
    const cladding = new Map<string, string>();
    for (const name of STAMMSTRECKE) {
      const definition = resolve(name);
      const local = new THREE.Group();
      const root = new THREE.Group();
      root.add(local);
      expect(buildStammstreckeInterior(local, root, {} as never, definition)).toBe(true);

      const piers: THREE.Mesh[] = [];
      const names = new Set<string>();
      root.traverse(object => {
        if (object.name === 'Lower pier cladding in the station colour') piers.push(object as THREE.Mesh);
        names.add(object.name);
      });
      // Same authored kit at every stop...
      expect(piers.length).toBeGreaterThan(6);
      expect(names.has('Fine suspended ceiling slats')).toBe(true);
      expect(names.has('Continuous white station-name frieze')).toBe(true);
      expect(names.has('Suspended platform wayfinding')).toBe(true);
      // ...carrying this stop's own name on the frieze.
      expect(names.has(definition.displayName)).toBe(true);
      cladding.set(name, `#${(piers[0].material as THREE.MeshStandardMaterial).color.getHexString()}`);
    }
    // ...in four colours nobody shares.
    expect(new Set(cladding.values()).size).toBe(4);
    expect(cladding.get('Stuttgart Hauptbahnhof (tief)')).toBe('#a73930');
    expect(cladding.get('Stadtmitte')).toBe('#009a4d');
    expect(cladding.get('Feuersee')).toBe('#1f5fbf');
    expect(cladding.get('Schwabstraße')).toBe('#f2b800');
  });

  it('keeps piers and seats away from the lift and full escalator runs', () => {
    const definition = resolve();
    const offsets = stammstreckeColumnOffsets(definition);
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
    expect(buildStammstreckeInterior(local, root, {} as never, definition)).toBe(true);
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
