import * as THREE from 'three';
import { smoothTrackXZ } from './liveTrackGeometry';
import { buildTunnelBore, createTunnelMaterials, type TunnelMaterials } from '../../world/tunnels/tunnelSection';
import type { Projection } from './liveProjection';
import type { TrackedVehicle } from './LiveVehicleStore';
import { LiveTunnelIndex } from './LiveTunnelIndex';

const TUNNEL_DEPTH_M = 5;

/**
 * Builds the same route-derived lining/portals used by Explore, but only for
 * rail alignments that currently have a visible live vehicle. The surface glow
 * remains visible from above; the lining is revealed when following a vehicle
 * underground.
 */
export class LiveTunnelLayer {
  readonly group = new THREE.Group();
  private readonly built = new Set<string>();
  private terrainRevision = -1;
  // One material/texture set shared by every bore, kept across rebuilds.
  private materials: TunnelMaterials | null = null;

  constructor(
    private readonly projection: Projection,
    private readonly index: LiveTunnelIndex,
    private readonly groundHeightAt: (x: number, z: number) => number = () => 0
  ) {
    this.group.name = 'Live route tunnel linings';
  }

  update(vehicles: TrackedVehicle[], terrainRevision: number): void {
    // Ground height is baked into the lining, so never build against the flat
    // placeholder (revision 0) and rebuild once the terrain changes — otherwise
    // the bore sits at y≈-5 while the train rides real terrain metres away.
    if (terrainRevision === 0) return;
    if (terrainRevision !== this.terrainRevision) {
      this.terrainRevision = terrainRevision;
      this.clear();
    }
    for (const vehicle of vehicles) {
      const route = this.index.routeFor(vehicle);
      if (!route || this.built.has(route.id)) continue;
      this.buildRoute(route);
      this.built.add(route.id);
    }
  }

  /** Drops all built linings so they can be rebuilt at corrected heights. */
  private clear(): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
    });
    this.group.clear();
    this.built.clear();
  }

  dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
    });
    // Materials/textures are shared by every bore, so they are released once here.
    this.materials?.dispose();
    this.materials = null;
    this.group.removeFromParent();
  }

  private buildRoute(route: { geoPoints?: [number, number][]; tunnelMask?: boolean[] }): void {
    const points = route.geoPoints ?? [];
    const mask = route.tunnelMask ?? [];
    if (points.length < 2 || !mask.some(Boolean)) return;

    this.materials ??= createTunnelMaterials();
    for (const [start, end] of ranges(mask)) {
      if (end - start < 1) continue;
      const routePoints = points.slice(Math.max(0, start - 1), Math.min(points.length, end + 2));
      // Smooth the bore centerline the same way as the overground rails and the
      // motion path, so a followed vehicle stays centered in the tunnel on curves.
      const curvePoints = smoothTrackXZ(
        routePoints.map(([lat, lon]) => this.projection.project(lat, lon))
      );
      for (const p of curvePoints) p.y = this.groundHeightAt(p.x, p.z) - TUNNEL_DEPTH_M;
      if (curvePoints.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(curvePoints, false, 'centripetal');
      this.group.add(
        buildTunnelBore({
          curve,
          lengthM: curve.getLength(),
          // Live tunnels are rail alignments; the shared section table keys off
          // guideway kind and stadtbahn is the right default for these bores.
          guidewayKind: 'stadtbahn',
          materials: this.materials
        })
      );
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
