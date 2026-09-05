import * as THREE from 'three';
import type { Projection } from './liveProjection';
import type { TrackedVehicle } from './LiveVehicleStore';
import type { LiveTunnelIndex } from './LiveTunnelIndex';
import { resampleTrackXZ, smoothTrackXZ } from './liveTrackGeometry';
import { TrackOccupancy } from './liveOccupancy';

// Overground running rails for the live rail network (Stadtbahn / S-Bahn / rail),
// so vehicles don't float on bare terrain. Mirrors the Explore GuidewayLayer look
// — a ballast strip with two steel rails — but derived from the live route feeds
// (via LiveTunnelIndex) and drawn only along non-tunnel segments. Built lazily and
// cached per route, and only once the camera is low enough to actually see rails.

// Below this altitude rails are worth drawing; above it they are sub-pixel and we
// skip the geometry entirely.
const BUILD_ALTITUDE_M = 1600;
const BUILD_RADIUS_M = 1900;
const FOCUS_REBUILD_M = 900;
const GAUGE_M = 1.5;
const RAIL_RADIUS_M = 0.12;
const BALLAST_HALF_WIDTH_M = 1.5;

// Segment de-duplication: many routes share the same physical alignment, and
// drawing each one stacks near-identical rails. The radius stays under real
// double-track spacing (~4 m) so genuinely parallel tracks still both get
// drawn — only true duplicates collapse.
const DEDUP = {
  cellM: 12,
  radiusM: 3,
  angleRad: (25 * Math.PI) / 180,
  sampleM: 6,
  coverRatio: 0.6
};

type Route = { id: string; geoPoints?: [number, number][]; tunnelMask?: boolean[] };

export class LiveTrackLayer {
  readonly group = new THREE.Group();
  private readonly built = new Set<string>();
  // Stretches already laid with rails, so a shared alignment is drawn once.
  private readonly occupancy = new TrackOccupancy(DEDUP);
  private terrainRevision = -1;
  private vehicleSignature = -1;
  private queuedIndexVersion = -1;
  private pending: Route[] = [];
  private pendingIndex = 0;
  private builtFocus: THREE.Vector3 | null = null;
  private readonly railMaterial = new THREE.MeshStandardMaterial({ color: 0x8a9095, metalness: 0.7, roughness: 0.3 });
  private readonly ballastMaterial = new THREE.MeshStandardMaterial({ color: 0x5c5a54, roughness: 0.96 });

  constructor(
    private readonly projection: Projection,
    private readonly index: LiveTunnelIndex,
    private readonly groundHeightAt: (x: number, z: number) => number
  ) {
    this.group.name = 'Live overground rails';
  }

  update(
    vehicles: TrackedVehicle[],
    altitudeM: number,
    terrainRevision: number,
    focus?: THREE.Vector3
  ): void {
    if (altitudeM > BUILD_ALTITUDE_M) return;
    // Rails bake in ground height, so skip the flat placeholder and rebuild once
    // the terrain resolves or recenters.
    if (terrainRevision === 0) return;
    if (terrainRevision !== this.terrainRevision) {
      this.terrainRevision = terrainRevision;
      this.clear();
    }
    if (focus && this.builtFocus && horizontalDistance(this.builtFocus, focus) >= FOCUS_REBUILD_M) {
      this.clear();
    }
    if (focus) this.builtFocus ??= focus.clone();

    const signature = hashRunIds(vehicles);
    if (signature !== this.vehicleSignature || this.index.version !== this.queuedIndexVersion) {
      const routes = new Map<string, Route>();
      for (const vehicle of vehicles) {
        const route = this.index.routeFor(vehicle) as Route | null;
        if (route?.geoPoints && route.geoPoints.length >= 2 && !this.built.has(route.id)) {
          routes.set(route.id, route);
        }
      }
      this.pending = [...routes.values()];
      this.pendingIndex = 0;
      this.vehicleSignature = signature;
      this.queuedIndexVersion = this.index.version;
    }

    // Route construction creates several TubeGeometries. Limit it to one route
    // per frame so a newly loaded feed cannot monopolise the render loop.
    const route = this.pending[this.pendingIndex++];
    if (route && !this.built.has(route.id)) {
      this.buildRoute(route, focus);
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

  private buildRoute(route: Route, focus?: THREE.Vector3): void {
    const geo = route.geoPoints!;
    const mask = route.tunnelMask ?? [];
    // Project + smooth the whole route once. Smoothing preserves the point count,
    // so the tunnel mask below stays index-aligned.
    const smoothed = smoothTrackXZ(geo.map(([lat, lon]) => this.projection.project(lat, lon)));
    for (const [start, end] of overgroundRanges(mask, geo.length)) {
      if (end - start < 1) continue;
      const spans = focus
        ? nearFocusSpans(smoothed, start, end, focus, BUILD_RADIUS_M)
        : [[start, end] as [number, number]];
      for (const [spanStart, spanEnd] of spans) {
        // Resample this visible stretch to a smooth, denser centerline matching
        // the motion path, then bake rail height from the terrain.
        const centers = resampleTrackXZ(smoothed.slice(spanStart, spanEnd + 1));
        if (centers.length < 2) continue;
        for (const c of centers) c.y = this.groundHeightAt(c.x, c.z) + 0.12;
        for (const run of this.occupancy.claimRuns(centers)) this.buildRun(run);
      }
    }
  }

  /** Drops all built rails so they can be rebuilt at corrected heights. */
  private clear(): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
    });
    this.group.clear();
    this.built.clear();
    this.occupancy.clear();
    this.vehicleSignature = -1;
    this.queuedIndexVersion = -1;
    this.pending = [];
    this.pendingIndex = 0;
    this.builtFocus = null;
  }

  /** Rails + ballast for one contiguous stretch of centerline points. */
  private buildRun(centers: THREE.Vector3[]): void {
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

function horizontalDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Visible contiguous spans with one neighbour point retained at each edge. */
function nearFocusSpans(
  points: THREE.Vector3[],
  start: number,
  end: number,
  focus: THREE.Vector3,
  radiusM: number
): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  const radius2 = radiusM * radiusM;
  let spanStart = -1;
  for (let i = start; i <= end; i++) {
    const dx = points[i].x - focus.x;
    const dz = points[i].z - focus.z;
    const near = dx * dx + dz * dz <= radius2;
    if (near && spanStart < 0) spanStart = Math.max(start, i - 1);
    if (!near && spanStart >= 0) {
      result.push([spanStart, Math.min(end, i)]);
      spanStart = -1;
    }
  }
  if (spanStart >= 0) result.push([spanStart, end]);
  return result;
}

function hashRunIds(vehicles: TrackedVehicle[]): number {
  let hash = 2166136261;
  for (const vehicle of vehicles) {
    for (let i = 0; i < vehicle.runId.length; i++) {
      hash ^= vehicle.runId.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash ^ vehicles.length;
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
