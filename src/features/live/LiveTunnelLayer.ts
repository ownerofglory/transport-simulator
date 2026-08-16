import * as THREE from 'three';
import { smoothTrackXZ } from './liveTrackGeometry';
import { buildTunnelBore, createTunnelMaterials, type TunnelMaterials } from '../../world/tunnels/tunnelSection';
import { TrackOccupancy } from './liveOccupancy';
import type { Projection } from './liveProjection';
import type { TrackedVehicle } from './LiveVehicleStore';
import { LiveTunnelIndex } from './LiveTunnelIndex';

const TUNNEL_DEPTH_M = 5;

/**
 * Route-derived tunnel linings for the live view, built from the same section
 * as Explore.
 *
 * Unlike Explore, Live has no single route: every visible vehicle drags its
 * whole alignment in, and the Stuttgart feed carries ~144 km of bore across ~105
 * ranges. Building all of it — as this layer first did — is both far too much
 * geometry and visibly wrong, because most lines share the central tunnel and
 * their coincident bores z-fight into a mess when the camera follows a vehicle
 * underground.
 *
 * Three limits, in the order they cut the most:
 *
 *   1. Altitude. Looking down at the network there is nothing to see inside a
 *      bore; the surface glows already mark underground runs, so no lining is
 *      built at all above BUILD_ALTITUDE_M.
 *   2. Distance. Only ranges near the camera focus are built, not every range
 *      of every matched route.
 *   3. Duplication. A stretch another route has already lined is skipped, so a
 *      shared corridor is one tunnel rather than five stacked ones.
 *
 * Detail follows the follow target: the route the camera is riding gets the
 * full section with luminaires and services, everything else gets a plain
 * shell at coarser ring spacing.
 */

// Above this the camera is looking at the network, not riding in it.
const BUILD_ALTITUDE_M = 900;
// Ranges further than this from the camera focus are not worth their geometry.
const BUILD_RADIUS_M = 1500;
// Shared corridors collapse to one bore. The radius is wider than the track
// layer's (which preserves genuinely parallel tracks) because two lines running
// side by side underground share one physical tunnel.
const DEDUP = {
  cellM: 20,
  radiusM: 7,
  angleRad: (30 * Math.PI) / 180,
  sampleM: 8,
  coverRatio: 0.55
};
// Coarser rings for bores the camera only passes by.
const SHELL_RING_SPACING_M = 18;

type Route = { id: string; geoPoints?: [number, number][]; tunnelMask?: boolean[] };

export type LiveTunnelView = {
  /** Camera height above ground; the overview gate. */
  altitudeM: number;
  /** Camera focus in world space; ranges are built around it. */
  focus: THREE.Vector3;
  /** Route id of the followed vehicle, which gets the detailed bore. */
  followRouteId: string | null;
};

export class LiveTunnelLayer {
  readonly group = new THREE.Group();
  private readonly built = new Set<string>();
  // Stretches already lined, so a shared corridor is drawn once.
  private readonly occupancy = new TrackOccupancy(DEDUP);
  private terrainRevision = -1;
  private followRouteId: string | null = null;
  // Where the current set of bores was built around, so panning across the city
  // cannot accumulate every tunnel it ever passed.
  private builtFocus: THREE.Vector3 | null = null;
  // One material/texture set shared by every bore, kept across rebuilds.
  private materials: TunnelMaterials | null = null;

  constructor(
    private readonly projection: Projection,
    private readonly index: LiveTunnelIndex,
    private readonly groundHeightAt: (x: number, z: number) => number = () => 0
  ) {
    this.group.name = 'Live route tunnel linings';
  }

  update(vehicles: TrackedVehicle[], terrainRevision: number, view: LiveTunnelView): void {
    // Ground height is baked into the lining, so never build against the flat
    // placeholder (revision 0) and rebuild once the terrain changes — otherwise
    // the bore sits at y≈-5 while the train rides real terrain metres away.
    if (terrainRevision === 0) return;
    if (terrainRevision !== this.terrainRevision) {
      this.terrainRevision = terrainRevision;
      this.clear();
    }
    // Whoever claims a corridor first owns it, so a change of follow target has
    // to re-run the claims with the new priority.
    if (view.followRouteId !== this.followRouteId) {
      this.followRouteId = view.followRouteId;
      this.clear();
    }
    // Once the camera has moved a full radius, everything built for the old
    // focus is out of range: drop it rather than keep it resident forever.
    if (this.builtFocus && horizontalDistance(this.builtFocus, view.focus) > BUILD_RADIUS_M) {
      this.clear();
    }
    if (view.altitudeM > BUILD_ALTITUDE_M) return;
    this.builtFocus ??= view.focus.clone();

    // The followed route builds first so it claims its corridor at full detail
    // before any neighbour shells it.
    const routes = new Map<string, Route>();
    for (const vehicle of vehicles) {
      const route = this.index.routeFor(vehicle) as Route | null;
      if (route?.geoPoints?.length) routes.set(route.id, route);
    }
    const ordered = [...routes.values()].sort((a, b) =>
      Number(b.id === view.followRouteId) - Number(a.id === view.followRouteId)
    );
    for (const route of ordered) this.buildRoute(route, view);
  }

  /** Drops all built linings so they can be rebuilt at corrected heights. */
  private clear(): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
    });
    this.group.clear();
    this.built.clear();
    this.occupancy.clear();
    this.builtFocus = null;
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

  private buildRoute(route: Route, view: LiveTunnelView): void {
    const points = route.geoPoints ?? [];
    const mask = route.tunnelMask ?? [];
    if (points.length < 2 || !mask.some(Boolean)) return;

    const detail = route.id === view.followRouteId ? 'full' : 'shell';

    for (const [start, end] of ranges(mask)) {
      if (end - start < 1) continue;
      // A change of follow target clears everything, so a range's detail never
      // has to be revised in place: built is built.
      const key = `${route.id}:${start}`;
      if (this.built.has(key)) continue;

      const routePoints = points.slice(Math.max(0, start - 1), Math.min(points.length, end + 2));
      // Smooth the bore centerline the same way as the overground rails and the
      // motion path, so a followed vehicle stays centered in the tunnel on curves.
      const curvePoints = smoothTrackXZ(
        routePoints.map(([lat, lon]) => this.projection.project(lat, lon))
      );
      if (curvePoints.length < 2) continue;
      if (!nearFocus(curvePoints, view.focus, BUILD_RADIUS_M)) continue;
      for (const p of curvePoints) p.y = this.groundHeightAt(p.x, p.z) - TUNNEL_DEPTH_M;

      for (const run of this.occupancy.claimRuns(curvePoints)) {
        this.buildBore(run, detail);
      }
      this.built.add(key);
    }
  }

  private buildBore(curvePoints: THREE.Vector3[], detail: 'full' | 'shell'): void {
    this.materials ??= createTunnelMaterials();
    const curve = new THREE.CatmullRomCurve3(curvePoints, false, 'centripetal');
    this.group.add(
      buildTunnelBore({
        curve,
        lengthM: curve.getLength(),
        // Live tunnels are rail alignments; the shared section table keys off
        // guideway kind and stadtbahn is the right default for these bores.
        guidewayKind: 'stadtbahn',
        materials: this.materials,
        detail,
        ringSpacingM: detail === 'shell' ? SHELL_RING_SPACING_M : undefined
      })
    );
  }
}

function horizontalDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** True when any sampled point of the centerline is within radius of the focus. */
function nearFocus(points: THREE.Vector3[], focus: THREE.Vector3, radiusM: number): boolean {
  const squared = radiusM * radiusM;
  // Every 4th point is plenty: consecutive shape points are far closer together
  // than the radius being tested.
  for (let i = 0; i < points.length; i += 4) {
    const dx = points[i].x - focus.x;
    const dz = points[i].z - focus.z;
    if (dx * dx + dz * dz <= squared) return true;
  }
  return false;
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
