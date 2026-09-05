import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { prepareOverviewVehicle } from './LiveVehicleModels';

describe('prepareOverviewVehicle', () => {
  it('removes real lights while preserving emissive vehicle meshes', () => {
    const root = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ emissive: 0xffaa22 })
    );
    body.castShadow = true;
    body.add(new THREE.SpotLight(), new THREE.PointLight());
    root.add(body);

    prepareOverviewVehicle(root);

    const lights: THREE.Light[] = [];
    root.traverse((object) => {
      if (object instanceof THREE.Light) lights.push(object);
    });
    expect(lights).toHaveLength(0);
    expect(body.parent).toBe(root);
    expect(body.castShadow).toBe(false);
    expect((body.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0xffaa22);
  });
});
