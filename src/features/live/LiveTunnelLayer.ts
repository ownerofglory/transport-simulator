import * as THREE from 'three';
import type { Projection } from './liveProjection';
import type { TrackedVehicle } from './LiveVehicleStore';
import { LiveTunnelIndex } from './LiveTunnelIndex';

const TUNNEL_DEPTH_M = 5;
// Match Explore's tunnel bore (GuidewayLayer): a wide, smooth lining so the
// follow camera stays comfortably inside on curves instead of feeling cramped.
const BORE_RADIUS_M = 8.2;
const BORE_RADIAL_SEGMENTS = 18;

/**
 * Builds the same route-derived lining/portals used by Explore, but only for
 * rail alignments that currently have a visible live vehicle. The surface glow
 * remains visible from above; the lining is revealed when following a vehicle
 * underground.
 */
export class LiveTunnelLayer {
  readonly group = new THREE.Group();
  private readonly built = new Set<string>();

  constructor(
    private readonly projection: Projection,
    private readonly index: LiveTunnelIndex,
    private readonly groundHeightAt: (x: number, z: number) => number = () => 0
  ) {
    this.group.name = 'Live route tunnel linings';
  }

  update(vehicles: TrackedVehicle[]): void {
    for (const vehicle of vehicles) {
      const route = this.index.routeFor(vehicle);
      if (!route || this.built.has(route.id)) continue;
      this.buildRoute(route);
      this.built.add(route.id);
    }
  }

  dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.filter(Boolean).forEach((material) => material.dispose());
    });
    this.group.removeFromParent();
  }

  private buildRoute(route: { geoPoints?: [number, number][]; tunnelMask?: boolean[] }): void {
    const points = route.geoPoints ?? [];
    const mask = route.tunnelMask ?? [];
    if (points.length < 2 || !mask.some(Boolean)) return;

    const liningMaterial = new THREE.MeshStandardMaterial({ color: 0x777a78, roughness: 0.92, side: THREE.BackSide });
    const portalMaterial = new THREE.MeshStandardMaterial({ color: 0x555957, roughness: 0.88 });
    const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffedbd });
    for (const [start, end] of ranges(mask)) {
      if (end - start < 1) continue;
      const routePoints = points.slice(Math.max(0, start - 1), Math.min(points.length, end + 2));
      const curvePoints = routePoints.map(([lat, lon]) => {
        const p = this.projection.project(lat, lon);
        p.y = this.groundHeightAt(p.x, p.z) - TUNNEL_DEPTH_M;
        return p;
      });
      if (curvePoints.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(curvePoints, false, 'centripetal');
      const segments = Math.max(16, curvePoints.length * 3);
      const lining = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, BORE_RADIUS_M, BORE_RADIAL_SEGMENTS, false), liningMaterial);
      lining.name = 'Live tunnel lining';
      this.group.add(lining);

      const lights = curve.getSpacedPoints(Math.max(3, Math.floor(curve.getLength() / 40))).map((point) => point.add(new THREE.Vector3(0, 5.8, 0)));
      if (lights.length > 1) this.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lights), segments, 0.075, 5), lightMaterial));

      for (const t of [0, 1]) {
        const portal = new THREE.Mesh(new THREE.TorusGeometry(BORE_RADIUS_M, 0.5, 8, 24), portalMaterial);
        portal.position.copy(curve.getPointAt(t));
        portal.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), curve.getTangentAt(t).normalize());
        this.group.add(portal);
      }
    }
  }
}

function ranges(mask: boolean[]): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= mask.length; i++) {
    if (mask[i] && start < 0) start = i;
    if (!mask[i] && start >= 0) {
      result.push([start, i - 1]);
      start = -1;
    }
  }
  return result;
}

export { TUNNEL_DEPTH_M };
