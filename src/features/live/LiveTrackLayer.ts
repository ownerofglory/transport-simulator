import * as THREE from 'three';
import type { Projection } from './liveProjection';
import type { TrackedVehicle } from './LiveVehicleStore';
import type { LiveTunnelIndex } from './LiveTunnelIndex';

// Overground running rails for the live rail network (Stadtbahn / S-Bahn / rail),
// so vehicles don't float on bare terrain. Mirrors the Explore GuidewayLayer look
// — a ballast strip with two steel rails — but derived from the live route feeds
// (via LiveTunnelIndex) and drawn only along non-tunnel segments. Built lazily and
// cached per route, and only once the camera is low enough to actually see rails.

// Below this altitude rails are worth drawing; above it they are sub-pixel and we
// skip the geometry entirely.
const BUILD_ALTITUDE_M = 1600;
const GAUGE_M = 1.5;
const RAIL_RADIUS_M = 0.12;
const BALLAST_HALF_WIDTH_M = 1.5;

type Route = { id: string; geoPoints?: [number, number][]; tunnelMask?: boolean[] };

export class LiveTrackLayer {
  readonly group = new THREE.Group();
  private readonly built = new Set<string>();
  private readonly railMaterial = new THREE.MeshStandardMaterial({ color: 0x8a9095, metalness: 0.7, roughness: 0.3 });
  private readonly ballastMaterial = new THREE.MeshStandardMaterial({ color: 0x5c5a54, roughness: 0.96 });

  constructor(
    private readonly projection: Projection,
    private readonly index: LiveTunnelIndex,
    private readonly groundHeightAt: (x: number, z: number) => number
  ) {
    this.group.name = 'Live overground rails';
  }

  update(vehicles: TrackedVehicle[], altitudeM: number): void {
    if (altitudeM > BUILD_ALTITUDE_M) return;
    for (const vehicle of vehicles) {
      const route = this.index.routeFor(vehicle) as Route | null;
      if (!route?.geoPoints || route.geoPoints.length < 2 || this.built.has(route.id)) continue;
      this.buildRoute(route);
      this.built.add(route.id);
    }
  }

  dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
    });
    this.railMaterial.dispose();
    this.ballastMaterial.dispose();
    this.group.removeFromParent();
  }

  private buildRoute(route: Route): void {
    const geo = route.geoPoints!;
    const mask = route.tunnelMask ?? [];
    for (const [start, end] of overgroundRanges(mask, geo.length)) {
      if (end - start < 1) continue;
      const centers = geo.slice(start, end + 1).map(([lat, lon]) => {
        const p = this.projection.project(lat, lon);
        p.y = this.groundHeightAt(p.x, p.z) + 0.12;
        return p;
      });
      if (centers.length < 2) continue;
      const laterals = horizontalNormals(centers);
      const segments = Math.max(8, centers.length * 2);

      for (const sign of [-1, 1]) {
        const railPoints = centers.map((c, i) => c.clone().addScaledVector(laterals[i], (sign * GAUGE_M) / 2));
        const rail = new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPoints, false, 'centripetal'), segments, RAIL_RADIUS_M, 6, false),
          this.railMaterial
        );
        rail.name = 'Live rail';
        this.group.add(rail);
      }

      this.group.add(new THREE.Mesh(ribbonGeometry(centers, laterals, BALLAST_HALF_WIDTH_M, -0.06), this.ballastMaterial));
    }
  }
}

// Index ranges [start, end] where the route is NOT in a tunnel. With no mask the
// whole route is overground.
function overgroundRanges(mask: boolean[], length: number): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < length; i++) {
    const inTunnel = Boolean(mask[i]);
    if (!inTunnel && start < 0) start = i;
    if (inTunnel && start >= 0) {
      result.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) result.push([start, length - 1]);
  return result;
}

// Per-point horizontal unit vector perpendicular to the track direction.
function horizontalNormals(points: THREE.Vector3[]): THREE.Vector3[] {
  return points.map((_, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z);
    if (dir.lengthSq() < 1e-6) return new THREE.Vector3(1, 0, 0);
    dir.normalize();
    return new THREE.Vector3(dir.z, 0, -dir.x); // rotate 90° in the ground plane
  });
}

// A flat ribbon strip following the centerline, `halfWidth` to each side.
function ribbonGeometry(centers: THREE.Vector3[], laterals: THREE.Vector3[], halfWidth: number, yOffset: number): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < centers.length; i++) {
    const c = centers[i];
    const l = laterals[i];
    const left = c.clone().addScaledVector(l, halfWidth);
    const right = c.clone().addScaledVector(l, -halfWidth);
    vertices.push(left.x, left.y + yOffset, left.z, right.x, right.y + yOffset, right.z);
    if (i < centers.length - 1) {
      const base = i * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
