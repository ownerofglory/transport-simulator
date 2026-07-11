import * as THREE from 'three';
import type { WorldLayerContext } from './WorldLayerContext';

/** Builds the ground/terrain relief that follows the route corridor. */
export class RouteLayer {
  constructor(private readonly ctx: WorldLayerContext) {}

  /** Adds the ground plane to the scene and returns it (for visibility toggling). */
  build(): THREE.Mesh {
    const bounds = this.ctx.routeBounds();
    const width = Math.max(900, bounds.size.x + 700);
    const depth = Math.max(900, bounds.size.z + 700);
    const groundGeometry = this.ctx.route.surfaceHeightsM?.length
      ? this.makeGroundTerrain(bounds.center, width, depth)
      : new THREE.PlaneGeometry(width, depth);
    const ground = new THREE.Mesh(groundGeometry, new THREE.MeshStandardMaterial({
      color: 0x52764b,
      roughness: 1,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    }));
    if (!this.ctx.route.surfaceHeightsM?.length) {
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(bounds.center.x, -0.04, bounds.center.z);
    }
    ground.receiveShadow = true;
    ground.renderOrder = -100;
    ground.name = 'Untextured terrain relief';
    this.ctx.scene.add(ground);

    if (this.ctx.routeGeoPoints().length >= 2) return ground;

    const roadMat = new THREE.MeshStandardMaterial({ color: 0x394047, roughness: 0.9 });
    const roadCount = Math.max(3, Math.min(26, Math.round(this.ctx.route.routeLengthM / 850)));
    for (let i = 1; i < roadCount; i++) {
      const t = i / roadCount;
      const p = this.ctx.curve.getPointAt(t);
      const tangent = this.ctx.curve.getTangentAt(t).normalize();
      const yaw = Math.atan2(tangent.x, tangent.z);
      const road = new THREE.Mesh(new THREE.PlaneGeometry(520, 22), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.rotation.z = yaw + Math.PI / 2;
      road.position.set(p.x, 0.01, p.z);
      this.ctx.scene.add(road);
    }
    return ground;
  }

  private makeGroundTerrain(center: THREE.Vector3, widthM: number, depthM: number): THREE.PlaneGeometry {
    const xSegments = THREE.MathUtils.clamp(Math.ceil(widthM / 140), 40, 140);
    const zSegments = THREE.MathUtils.clamp(Math.ceil(depthM / 140), 40, 140);
    const geometry = new THREE.PlaneGeometry(widthM, depthM, xSegments, zSegments);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(center.x, 0, center.z);

    const routeSamples = Array.from({ length: 321 }, (_, index) => {
      const t = index / 320;
      const point = this.ctx.curve.getPointAt(t);
      return { x: point.x, y: point.y, z: point.z, t };
    });
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const x = positions.getX(vertex);
      const z = positions.getZ(vertex);
      let nearestDistanceSq = Number.POSITIVE_INFINITY;
      let nearestY = 0;
      let nearestT = 0;
      for (let index = 1; index < routeSamples.length; index++) {
        const a = routeSamples[index - 1];
        const b = routeSamples[index];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const lengthSq = dx * dx + dz * dz || 1;
        const segmentT = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / lengthSq, 0, 1);
        const closestX = a.x + dx * segmentT;
        const closestZ = a.z + dz * segmentT;
        const distanceSq = (x - closestX) ** 2 + (z - closestZ) ** 2;
        if (distanceSq < nearestDistanceSq) {
          nearestDistanceSq = distanceSq;
          nearestY = THREE.MathUtils.lerp(a.y, b.y, segmentT);
          nearestT = THREE.MathUtils.lerp(a.t, b.t, segmentT);
        }
      }
      // Use the actual curve Y so terrain tracks the spline exactly. For tunnel
      // segments the curve dips underground, so take max with surface height to
      // keep the terrain mesh at ground level above tunnels.
      const surfaceY = this.ctx.surfaceHeightAt(nearestT);
      positions.setY(vertex, Math.max(nearestY, surfaceY) - 0.55);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }
}
