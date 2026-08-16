import * as THREE from 'three';

/**
 * Spatial hash of alignment stretches that have already been drawn.
 *
 * Many live routes share the same physical alignment — the central tunnel
 * carries most of the network — and drawing each route's geometry stacks
 * near-identical rails or bores on top of each other. That is both wasted
 * geometry and a visible artefact: coincident surfaces z-fight, and following a
 * vehicle underground shows several overlapping tunnels.
 *
 * A segment is skipped when a previously claimed one runs within `radiusM` at a
 * similar heading. Headings are folded to [0, π) so the two directions of one
 * physical track compare as the same alignment.
 */

export type TrackOccupancyOptions = {
  /** Spatial hash bucket size; must exceed `radiusM`. */
  cellM: number;
  radiusM: number;
  angleRad: number;
  /** Sample spacing along a segment. */
  sampleM: number;
  /** Fraction of a segment's samples already covered before it is skipped. */
  coverRatio: number;
};

type Sample = { x: number; z: number; ang: number };

export class TrackOccupancy {
  private readonly cells = new Map<string, Sample[]>();

  constructor(private readonly options: TrackOccupancyOptions) {}

  clear(): void {
    this.cells.clear();
  }

  /**
   * Splits a centerline into runs of segments not already covered, claiming the
   * ones it keeps. Duplicated stretches become gaps, which whichever route got
   * there first already fills.
   */
  claimRuns(centers: THREE.Vector3[]): THREE.Vector3[][] {
    const runs: THREE.Vector3[][] = [];
    let current: THREE.Vector3[] = [];
    for (let i = 0; i < centers.length - 1; i++) {
      const a = centers[i];
      const b = centers[i + 1];
      if (this.segmentCovered(a, b)) {
        if (current.length >= 2) runs.push(current);
        current = [];
        continue;
      }
      this.claimSegment(a, b);
      if (current.length === 0) current.push(a);
      current.push(b);
    }
    if (current.length >= 2) runs.push(current);
    return runs;
  }

  segmentCovered(a: THREE.Vector3, b: THREE.Vector3): boolean {
    let total = 0;
    let covered = 0;
    for (const sample of this.sampleSegment(a, b)) {
      total++;
      if (this.sampleCovered(sample)) covered++;
    }
    return total > 0 && covered / total >= this.options.coverRatio;
  }

  claimSegment(a: THREE.Vector3, b: THREE.Vector3): void {
    for (const sample of this.sampleSegment(a, b)) {
      const key = this.cellKey(sample.x, sample.z);
      const list = this.cells.get(key);
      if (list) list.push(sample);
      else this.cells.set(key, [sample]);
    }
  }

  private sampleCovered({ x, z, ang }: Sample): boolean {
    const { cellM, radiusM } = this.options;
    const cx = Math.floor(x / cellM);
    const cz = Math.floor(z / cellM);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.cells.get(`${cx + dx}/${cz + dz}`);
        if (!list) continue;
        for (const other of list) {
          if (Math.hypot(other.x - x, other.z - z) <= radiusM && this.angleClose(other.ang, ang)) return true;
        }
      }
    }
    return false;
  }

  private sampleSegment(a: THREE.Vector3, b: THREE.Vector3): Sample[] {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const ang = foldAngle(dx, dz);
    const steps = Math.max(1, Math.ceil(length / this.options.sampleM));
    const samples: Sample[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      samples.push({ x: a.x + dx * t, z: a.z + dz * t, ang });
    }
    return samples;
  }

  private angleClose(a: number, b: number): boolean {
    let delta = Math.abs(a - b);
    if (delta > Math.PI / 2) delta = Math.PI - delta;
    return delta <= this.options.angleRad;
  }

  private cellKey(x: number, z: number): string {
    return `${Math.floor(x / this.options.cellM)}/${Math.floor(z / this.options.cellM)}`;
  }
}

/** Heading folded to [0, π): direction-agnostic, so both directions match. */
function foldAngle(dx: number, dz: number): number {
  let ang = Math.atan2(dz, dx);
  if (ang < 0) ang += Math.PI;
  return ang % Math.PI;
}
