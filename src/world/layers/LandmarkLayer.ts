import * as THREE from 'three';
import type { WorldLayerContext } from './WorldLayerContext';

/** Fallback procedural city blocks lining the route when OSM scenery is absent. */
export class LandmarkLayer {
  /** All meshes go under this group; the world adds it to the scene. */
  readonly root = new THREE.Group();
  constructor(private readonly ctx: WorldLayerContext) {}

  build(): void {
    const mats = [
      new THREE.MeshStandardMaterial({ color: 0xb6a38f, roughness: 0.82 }),
      new THREE.MeshStandardMaterial({ color: 0xd1c8b7, roughness: 0.76 }),
      new THREE.MeshStandardMaterial({ color: 0x8e9aa5, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0xc0b3a2, roughness: 0.84 })
    ];

    const blockCount = Math.max(50, Math.min(180, Math.round(this.ctx.route.routeLengthM / 150)));
    for (let i = 0; i < blockCount; i++) {
      const t = i / Math.max(1, blockCount - 1);
      const p = this.ctx.curve.getPointAt(t);
      const tangent = this.ctx.curve.getTangentAt(t).normalize();
      const normal = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
      for (const side of [-1, 1]) {
        const width = 18 + Math.random() * 16;
        const depth = 28 + Math.random() * 18;
        const height = 8 + Math.random() * 34;
        const b = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mats[Math.floor(Math.random() * mats.length)]);
        b.position.copy(p).add(normal.multiplyScalar(side * (72 + Math.random() * 140)));
        b.position.y = height / 2;
        b.position.add(tangent.multiplyScalar((Math.random() - 0.5) * 70));
        b.castShadow = true;
        b.receiveShadow = true;
        this.root.add(b);
      }
    }
  }
}
